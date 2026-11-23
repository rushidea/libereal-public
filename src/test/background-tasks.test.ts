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

    expect(await completeBackgroundTask(created.id, claimed!.lockedBy!, { sent: true })).toBe(true);
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
    const task = await enqueueBackgroundTask('search.index_update', {}, { maxAttempts: 2 });
    const first = await claimNextBackgroundTask('worker-a');
    expect(await failBackgroundTask(task.id, first!.lockedBy!, new Error('provider unavailable'))).toBe(true);
    const retrying = await prisma.backgroundTask.findUnique({ where: { id: task.id } });
    expect(retrying?.status).toBe('pending');
    expect(retrying?.lastError).toBe('provider unavailable');

    await prisma.backgroundTask.update({ where: { id: task.id }, data: { runAt: new Date(0) } });
    const second = await claimNextBackgroundTask('worker-b');
    await failBackgroundTask(task.id, second!.lockedBy!, new Error('still unavailable'));
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
  it('rejects stale writeback after the same named worker reclaims a task', async () => {
    const task = await enqueueBackgroundTask('quote.expire', { quoteId: 'local' });
    const first = await claimNextBackgroundTask('same-process');
    const later = new Date(Date.now() + 20 * 60_000);
    expect(await recoverStaleBackgroundTasks(later)).toBe(1);
    const second = await claimNextBackgroundTask('same-process', later);
    expect(second?.lockedBy).not.toBe(first?.lockedBy);
    expect(await completeBackgroundTask(task.id, first!.lockedBy!, { late: true })).toBe(false);
    expect(await failBackgroundTask(task.id, first!.lockedBy!, 'late')).toBe(false);
    expect(await completeBackgroundTask(task.id, second!.lockedBy!, { done: true })).toBe(true);
    expect(await prisma.auditLog.count({ where: { targetId: task.id, action: 'task.lease_expired' } })).toBe(1);
  });

  it.each(['sms.send','email.send','order.reminder'] as const)('holds an uncertain %s without replay', async type => {
    const task = await enqueueBackgroundTask(type, { basis: 'original' });
    const claim = await claimNextBackgroundTask('local-simulation');
    expect(await failBackgroundTask(task.id, claim!.lockedBy!, 'receipt not recorded')).toBe(true);
    expect(await retryBackgroundTask(task.id)).toBeNull();
    expect(await recoverStaleBackgroundTasks(new Date(Date.now() + 3_600_000))).toBe(0);
    expect(await claimNextBackgroundTask('other')).toBeNull();
    expect(await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'awaiting_human', attempts: 1, lastError: 'receipt not recorded' });
  });

  it('retains an external provider ambiguity across an expired lease and rejects conflicting recipients', async () => {
    const task = await enqueueBackgroundTask('email.send', { to: 'first@example.test', subject: 'one' }, { dedupeKey: 'order-1' });
    const repeated = await enqueueBackgroundTask('email.send', { subject: 'one', to: 'first@example.test' }, { dedupeKey: 'order-1' });
    expect(repeated.id).toBe(task.id);
    await expect(enqueueBackgroundTask('email.send', { to: 'other@example.test' }, { dedupeKey: 'order-1' })).rejects.toThrow('different work');
    await expect(enqueueBackgroundTask('sms.send', {}, { dedupeKey: 'order-1' })).rejects.toThrow('different work');
    await claimNextBackgroundTask('outbound');
    expect(await recoverStaleBackgroundTasks(new Date(Date.now() + 3_600_000))).toBe(1);
    expect(await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'awaiting_human' });
  });

  it('leaves unknown, human and business-specific rows untouched even with legacy pending status', async () => {
    for (const type of ['order.purchase_prepare','inquiry.supplier_written_quote','unknown.legacy']) {
      await prisma.backgroundTask.create({ data: { type, status: 'pending', payload: '{}' } });
    }
    expect(await claimNextBackgroundTask('legacy')).toBeNull();
    expect(await prisma.backgroundTask.count({ where: { status: 'pending' } })).toBe(3);
  });

});
