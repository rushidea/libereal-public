import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writeAuditLog } from '@/lib/audit';
import { Prisma, type BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const BACKGROUND_TASK_TYPES = [
  'email.send',
  'sms.send',
  'order.reminder',
  'quote.expire',
  'search.index_update',
  'news.update',
  'security.mfa_cleanup',
  'aiops.run',
] as const;

const generalTypes = BACKGROUND_TASK_TYPES.filter(type => type !== 'aiops.run');
const externalTypes = new Set<string>(['email.send', 'sms.send', 'order.reminder']);

export function canRetryGeneralTask(type: string) {
  return generalTypes.some(candidate => candidate === type) && !externalTypes.has(type);
}

export type BackgroundTaskType = typeof BACKGROUND_TASK_TYPES[number];
export type BackgroundTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

type TaskClient = Prisma.TransactionClient | typeof prisma;

export type EnqueueTaskOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
};

export async function enqueueBackgroundTask(
  type: BackgroundTaskType,
  payload: unknown,
  options: EnqueueTaskOptions = {},
  client: TaskClient = prisma,
): Promise<BackgroundTask> {
  try {
    return await client.backgroundTask.create({
      data: {
        type,
        payload: JSON.stringify(payload ?? {}),
        runAt: options.runAt ?? new Date(),
        priority: options.priority ?? 0,
        maxAttempts: Math.max(1, options.maxAttempts ?? 3),
        dedupeKey: options.dedupeKey,
      },
    });
  } catch (error) {
    if (options.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await client.backgroundTask.findUnique({ where: { dedupeKey: options.dedupeKey } });
      if (existing) {
        // These handlers only invalidate a global index or run a scheduled maintenance bucket.
        const coalesces = ['search.index_update', 'news.update', 'security.mfa_cleanup'].includes(type);
        if (existing.type !== type || !coalesces && !isDeepStrictEqual(JSON.parse(existing.payload), JSON.parse(JSON.stringify(payload ?? {})))) {
          throw new Error('Task deduplication key is already bound to different work');
        }
        return existing;
      }
    }
    throw error;
  }
}

type ClaimedTask = Pick<BackgroundTask, 'id' | 'type' | 'attempts' | 'maxAttempts' | 'lockedBy' | 'lockedAt' | 'result' | 'lastError'>;

async function recordGeneralFailure(tx: Prisma.TransactionClient, task: ClaimedTask, now: Date, error: string, expired: boolean) {
  const external = externalTypes.has(task.type);
  const status = external ? 'awaiting_human' : task.attempts >= task.maxAttempts ? 'failed' : 'pending';
  const updated = await tx.backgroundTask.updateMany({
    where: { id: task.id, type: task.type, status: 'running', attempts: task.attempts, lockedBy: task.lockedBy, lockedAt: task.lockedAt },
    data: { status, lastError: error.slice(0, 4000), lockedAt: null, lockedBy: null, completedAt: status === 'failed' ? now : null,
      ...(status === 'pending' ? { runAt: expired ? now : new Date(now.getTime() + retryDelayMs(task.attempts)) } : {}) },
  });
  if (updated.count === 1) await writeAuditLog({ action: expired ? 'task.lease_expired' : 'task.attempt_failed',
    resource: 'tasks', targetType: 'BackgroundTask', targetId: task.id,
    before: { attempts: task.attempts, result: task.result, lastError: task.lastError },
    after: { status, error: error.slice(0, 4000) } }, tx);
  return updated.count;
}

export async function recoverStaleBackgroundTasks(now = new Date(), leaseMs = 15 * 60 * 1000): Promise<number> {
  const staleBefore = new Date(now.getTime() - leaseMs);
  const stale = await prisma.backgroundTask.findMany({
    where: { type: { in: generalTypes }, status: 'running', lockedAt: { lt: staleBefore } },
    orderBy: [{ lockedAt: 'asc' }, { id: 'asc' }], take: 100,
  });
  let recovered = 0;
  for (const task of stale) {
    recovered += await prisma.$transaction(tx => recordGeneralFailure(tx, task, now, 'Task execution lease expired', true));
  }
  return recovered;
}

export async function claimNextBackgroundTask(workerId: string, now = new Date()): Promise<BackgroundTask | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.backgroundTask.findFirst({
      where: { type: { in: generalTypes }, status: 'pending', runAt: { lte: now } },
      orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;

    const claimed = await tx.backgroundTask.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        lockedAt: now,
        lockedBy: `${workerId}:${randomUUID()}`,
      },
    });
    if (claimed.count !== 1) return null;
    return tx.backgroundTask.findUnique({ where: { id: candidate.id } });
  });
}

export async function completeBackgroundTask(id: string, claimId: string, result?: unknown): Promise<boolean> {
  const completedAt = new Date();
  const updated = await prisma.backgroundTask.updateMany({
    where: { id, type: { in: generalTypes }, status: 'running', lockedBy: claimId },
    data: {
      status: 'succeeded',
      result: result === undefined ? null : JSON.stringify(result),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      completedAt,
    },
  });
  return updated.count === 1;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export async function failBackgroundTask(id: string, claimId: string, error: unknown): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const task = await tx.backgroundTask.findFirst({ where: { id, type: { in: generalTypes }, status: 'running', lockedBy: claimId } });
    if (!task) return false;
    return await recordGeneralFailure(tx, task, new Date(), error instanceof Error ? error.message : String(error), false) === 1;
  });
}

export async function retryBackgroundTask(id: string, client: TaskClient = prisma): Promise<BackgroundTask | null> {
  const task = await client.backgroundTask.findUnique({ where: { id } });
  if (!task || !canRetryGeneralTask(task.type) || task.status !== 'failed') return null;
  const changed = await client.backgroundTask.updateMany({
    where: { id, type: task.type, status: 'failed', updatedAt: task.updatedAt, attempts: task.attempts },
    data: { status: 'pending', attempts: 0, runAt: new Date(), lockedAt: null, lockedBy: null, completedAt: null },
  });
  return changed.count === 1 ? client.backgroundTask.findUnique({ where: { id } }) : null;
}

export function parseTaskPayload<T>(task: Pick<BackgroundTask, 'payload'>): T {
  const parsed: unknown = JSON.parse(task.payload);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Task payload must be a JSON object');
  }
  return parsed as T;
}
