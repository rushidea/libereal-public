import { randomUUID } from 'node:crypto';
import type { BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { continuePurchasePreparation } from '@/lib/purchase-orders';
import { continuationHistory, discoverPurchaseContinuations, PURCHASE_CONTINUATION, PURCHASE_READY,
  purchaseContinuationKey, readContinuationInput } from '@/lib/purchase-continuation-state';

const waitingPollMs = 15 * 60 * 1_000;

function observed(task: BackgroundTask) {
  return { id: task.id, type: PURCHASE_CONTINUATION, status: task.status, attempts: task.attempts,
    dedupeKey: task.dedupeKey, payload: task.payload, updatedAt: task.updatedAt, runAt: task.runAt };
}

export async function discoverOrderPurchaseWork() {
  return prisma.$transaction(discoverPurchaseContinuations);
}

// All effects in this lane are local database writes. The claim, purchase preparation and receipt
// commit together, so a terminated process leaves either the old work or the complete result.
export async function runOrderPurchaseContinuationOnce(now = new Date()) {
  const task = await prisma.backgroundTask.findFirst({
    where: { type: PURCHASE_CONTINUATION, status: { in: [PURCHASE_READY, 'awaiting_human'] }, runAt: { lte: now } },
    orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!task) return null;
  let owned = false;
  try {
    return await prisma.$transaction(async tx => {
      const claimed = await tx.backgroundTask.updateMany({ where: observed(task), data: { lockedBy: randomUUID(), lockedAt: now } });
      if (claimed.count !== 1) return null;
      owned = true;
      const input = readContinuationInput(task.payload);
      if (task.dedupeKey !== purchaseContinuationKey(input.orderId)) throw new Error('Order continuation source mismatch');
      const receipt = await continuePurchasePreparation(tx, input.orderId, task.id);
      const status = receipt.reason ? 'awaiting_human' : 'succeeded';
      const result = JSON.stringify(receipt);
      const changed = task.status !== status || task.result !== result;
      await tx.backgroundTask.update({ where: { id: task.id }, data: {
        status, result, payload: JSON.stringify({ orderId: input.orderId, version: receipt.version }),
        runAt: receipt.reason ? new Date(now.getTime() + waitingPollMs) : now,
        attempts: changed ? { increment: 1 } : undefined, lastError: null,
        completedAt: receipt.reason ? null : now, lockedAt: null, lockedBy: null,
      } });
      if (changed) await continuationHistory(tx, task.id, 'purchase.continuation_processed',
        { status: task.status, result: task.result, attempts: task.attempts, lastError: task.lastError }, receipt);
      return { id: task.id, status, changed };
    });
  } catch (error) {
    // A competing SQLite writer has not failed the business operation. Leave its own wake-up intact.
    if (!owned) throw error;
    const message = error instanceof Error ? error.message : 'Order preparation failed';
    const attempts = task.attempts + 1;
    const exhausted = attempts >= task.maxAttempts;
    await prisma.$transaction(async tx => {
      const updated = await tx.backgroundTask.updateMany({ where: observed(task), data: {
        status: exhausted ? 'failed' : PURCHASE_READY, attempts: { increment: 1 }, completedAt: exhausted ? now : null,
        runAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts - 1, 7))),
        lastError: message.slice(0, 2000), lockedBy: null, lockedAt: null,
      } });
      if (updated.count === 1) await continuationHistory(tx, task.id, 'purchase.continuation_failed',
        { status: task.status, attempts: task.attempts, lastError: task.lastError }, { attempts, exhausted, error: message.slice(0, 2000) });
    });
    return { id: task.id, status: 'attempt_failed', changed: false };
  }
}
