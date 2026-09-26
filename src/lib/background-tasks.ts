import { Prisma, type BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const BACKGROUND_TASK_TYPES = [
  'email.send',
  'sms.send',
  'order.reminder',
  'quote.expire',
  'search.index_update',
  'news.update',
] as const;

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
      if (existing) return existing;
    }
    throw error;
  }
}

export async function recoverStaleBackgroundTasks(now = new Date(), leaseMs = 15 * 60 * 1000): Promise<number> {
  const staleBefore = new Date(now.getTime() - leaseMs);
  const stale = await prisma.backgroundTask.findMany({
    where: { status: 'running', lockedAt: { lt: staleBefore } },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  if (stale.length === 0) return 0;

  await prisma.$transaction(stale.map((task) => prisma.backgroundTask.update({
    where: { id: task.id },
    data: task.attempts >= task.maxAttempts
      ? {
          status: 'failed',
          lastError: 'Task execution lease expired',
          lockedAt: null,
          lockedBy: null,
          completedAt: now,
        }
      : {
          status: 'pending',
          lastError: 'Task execution lease expired',
          runAt: now,
          lockedAt: null,
          lockedBy: null,
        },
  })));
  return stale.length;
}

export async function claimNextBackgroundTask(workerId: string, now = new Date()): Promise<BackgroundTask | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.backgroundTask.findFirst({
      where: { status: 'pending', runAt: { lte: now } },
      orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;

    const claimed = await tx.backgroundTask.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        lockedAt: now,
        lockedBy: workerId,
      },
    });
    if (claimed.count !== 1) return null;
    return tx.backgroundTask.findUnique({ where: { id: candidate.id } });
  });
}

export async function completeBackgroundTask(id: string, workerId: string, result?: unknown): Promise<boolean> {
  const completedAt = new Date();
  const updated = await prisma.backgroundTask.updateMany({
    where: { id, status: 'running', lockedBy: workerId },
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

export async function failBackgroundTask(id: string, workerId: string, error: unknown): Promise<boolean> {
  const task = await prisma.backgroundTask.findFirst({ where: { id, status: 'running', lockedBy: workerId } });
  if (!task) return false;
  const failedPermanently = task.attempts >= task.maxAttempts;
  const message = error instanceof Error ? error.message : String(error);
  await prisma.backgroundTask.update({
    where: { id },
    data: failedPermanently
      ? {
          status: 'failed',
          lastError: message.slice(0, 4000),
          lockedAt: null,
          lockedBy: null,
          completedAt: new Date(),
        }
      : {
          status: 'pending',
          lastError: message.slice(0, 4000),
          runAt: new Date(Date.now() + retryDelayMs(task.attempts)),
          lockedAt: null,
          lockedBy: null,
        },
  });
  return true;
}

export async function retryBackgroundTask(id: string): Promise<BackgroundTask | null> {
  const task = await prisma.backgroundTask.findUnique({ where: { id } });
  if (!task || task.status !== 'failed') return null;
  return prisma.backgroundTask.update({
    where: { id },
    data: {
      status: 'pending',
      attempts: 0,
      lastError: null,
      result: null,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      completedAt: null,
    },
  });
}

export function parseTaskPayload<T>(task: Pick<BackgroundTask, 'payload'>): T {
  const parsed: unknown = JSON.parse(task.payload);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Task payload must be a JSON object');
  }
  return parsed as T;
}
