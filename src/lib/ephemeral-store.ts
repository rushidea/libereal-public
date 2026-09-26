import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

export interface EphemeralStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  compareAndDelete(key: string, expectedValue: string): Promise<boolean>;
  increment(key: string, ttlMs: number): Promise<number>;
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
}

class DatabaseEphemeralStore implements EphemeralStore {
  async get(key: string): Promise<string | null> {
    const row = await prisma.transientEntry.findUnique({ where: { key } });
    if (!row) return null;
    if (row.expiresAt <= new Date()) {
      await prisma.transientEntry.deleteMany({ where: { key } });
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await prisma.transientEntry.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
  }

  async delete(key: string): Promise<void> {
    await prisma.transientEntry.deleteMany({ where: { key } });
  }

  async compareAndDelete(key: string, expectedValue: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const row = await tx.transientEntry.findUnique({ where: { key } });
      if (!row || row.expiresAt <= new Date() || row.value !== expectedValue) return false;
      await tx.transientEntry.delete({ where: { key } });
      return true;
    });
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.transientEntry.findUnique({ where: { key } });
      const value = row && row.expiresAt > now ? Number(row.value) + 1 : 1;
      const expiresAt = row && row.expiresAt > now ? row.expiresAt : new Date(now.getTime() + ttlMs);
      await tx.transientEntry.upsert({ where: { key }, create: { key, value: String(value), expiresAt }, update: { value: String(value), expiresAt } });
      return value;
    });
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.transientEntry.findUnique({ where: { key } });
      if (row && row.expiresAt > now) return null;
      await tx.transientEntry.upsert({ where: { key }, create: { key, value: token, expiresAt: new Date(now.getTime() + ttlMs) }, update: { value: token, expiresAt: new Date(now.getTime() + ttlMs) } });
      return token;
    });
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.compareAndDelete(key, token);
  }
}

class RedisRestEphemeralStore implements EphemeralStore {
  constructor(private readonly url: string, private readonly token: string) {}

  private async command<T>(...args: Array<string | number>): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`REDIS_HTTP_${response.status}`);
    const body = await response.json() as { result: T; error?: string };
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  get(key: string) { return this.command<string | null>('GET', key); }
  async set(key: string, value: string, ttlMs: number) { await this.command('SET', key, value, 'PX', ttlMs); }
  async delete(key: string) { await this.command('DEL', key); }
  async compareAndDelete(key: string, expectedValue: string) {
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    return (await this.command<number>('EVAL', script, 1, key, expectedValue)) === 1;
  }
  async increment(key: string, ttlMs: number) {
    const script = "local value = redis.call('incr', KEYS[1]); if value == 1 then redis.call('pexpire', KEYS[1], ARGV[1]); end; return value";
    return this.command<number>('EVAL', script, 1, key, ttlMs);
  }
  async acquireLock(key: string, ttlMs: number) {
    const token = randomUUID();
    const result = await this.command<string | null>('SET', key, token, 'NX', 'PX', ttlMs);
    return result === 'OK' ? token : null;
  }
  async releaseLock(key: string, token: string) { await this.compareAndDelete(key, token); }
}

let store: EphemeralStore | null = null;

export function isRedisEphemeralStoreConfigured(): boolean {
  return Boolean(process.env.REDIS_REST_URL?.trim() && process.env.REDIS_REST_TOKEN?.trim());
}

export function getEphemeralStore(): EphemeralStore {
  if (store) return store;
  store = isRedisEphemeralStoreConfigured()
    ? new RedisRestEphemeralStore(process.env.REDIS_REST_URL!.trim(), process.env.REDIS_REST_TOKEN!.trim())
    : new DatabaseEphemeralStore();
  return store;
}

export function resetEphemeralStoreForTests(): void {
  store = null;
}
