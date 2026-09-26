import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNextBackgroundTask,
  completeBackgroundTask,
  enqueueBackgroundTask,
  failBackgroundTask,
  recoverStaleBackgroundTasks,
  retryBackgroundTask,
} from '@/lib/background-tasks';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

describe('background task service', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('enqueues, claims and completes a task', async () => {
    const created = await enqueueBackgroundTask('email.send', { to: 'user@example.com' }, { priority: 5 });
    const claimed = await claimNextBackgroundTask('worker-a');
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);

    expect(await completeBackgroundTask(created.id, 'worker-a', { sent: true })).toBe(true);
    const completed = await prisma.backgroundTask.findUnique({ where: { id: created.id } });
    expect(completed?.status).toBe('succeeded');
    expect(completed?.result).toBe('{"sent":true}');
  });

  it('returns an existing task for the same dedupe key', async () => {
    const first = await enqueueBackgroundTask('news.update', {}, { dedupeKey: 'news:2026-07-13' });
    const second = await enqueueBackgroundTask('news.update', { repeated: true }, { dedupeKey: 'news:2026-07-13' });
    expect(second.id).toBe(first.id);
    expect(await prisma.backgroundTask.count()).toBe(1);
  });

  it('reschedules a retry and marks the final attempt failed', async () => {
    const task = await enqueueBackgroundTask('sms.send', {}, { maxAttempts: 2 });
    await claimNextBackgroundTask('worker-a');
    expect(await failBackgroundTask(task.id, 'worker-a', new Error('provider unavailable'))).toBe(true);
    const retrying = await prisma.backgroundTask.findUnique({ where: { id: task.id } });
    expect(retrying?.status).toBe('pending');
    expect(retrying?.lastError).toBe('provider unavailable');

    await prisma.backgroundTask.update({ where: { id: task.id }, data: { runAt: new Date(0) } });
    await claimNextBackgroundTask('worker-b');
    await failBackgroundTask(task.id, 'worker-b', new Error('still unavailable'));
    const failed = await prisma.backgroundTask.findUnique({ where: { id: task.id } });
    expect(failed?.status).toBe('failed');
    expect(failed?.completedAt).toBeTruthy();

    const retried = await retryBackgroundTask(task.id);
    expect(retried?.status).toBe('pending');
    expect(retried?.attempts).toBe(0);
  });

  it('recovers an expired execution lease', async () => {
    const task = await enqueueBackgroundTask('search.index_update', {});
    await claimNextBackgroundTask('lost-worker');
    await prisma.backgroundTask.update({
      where: { id: task.id },
      data: { lockedAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    expect(await recoverStaleBackgroundTasks(new Date(), 15 * 60 * 1000)).toBe(1);
    const recovered = await prisma.backgroundTask.findUnique({ where: { id: task.id } });
    expect(recovered?.status).toBe('pending');
    expect(recovered?.lockedBy).toBeNull();
  });
});
