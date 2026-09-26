import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import { getEphemeralStore, resetEphemeralStoreForTests } from '@/lib/ephemeral-store';

describe('database ephemeral store fallback', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    resetEphemeralStoreForTests();
  });

  it('stores, reads, and atomically consumes short-lived values', async () => {
    const store = getEphemeralStore();
    await store.set('verification:test', 'hash', 60_000);
    await expect(store.get('verification:test')).resolves.toBe('hash');
    await expect(store.compareAndDelete('verification:test', 'wrong')).resolves.toBe(false);
    await expect(store.compareAndDelete('verification:test', 'hash')).resolves.toBe(true);
    await expect(store.get('verification:test')).resolves.toBeNull();
  });

  it('increments counters and enforces task lock ownership', async () => {
    const store = getEphemeralStore();
    await expect(store.increment('rate:test', 60_000)).resolves.toBe(1);
    await expect(store.increment('rate:test', 60_000)).resolves.toBe(2);
    const token = await store.acquireLock('lock:test', 60_000);
    expect(token).toBeTruthy();
    await expect(store.acquireLock('lock:test', 60_000)).resolves.toBeNull();
    await store.releaseLock('lock:test', token!);
    await expect(store.acquireLock('lock:test', 60_000)).resolves.toBeTruthy();
  });
});
