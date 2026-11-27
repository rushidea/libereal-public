import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';

type Db = Prisma.TransactionClient;
export const PURCHASE_CONTINUATION = 'order.purchase_prepare';
export const PURCHASE_READY = 'order_ready';

export function purchaseContinuationKey(orderId: string) {
  return `${PURCHASE_CONTINUATION}:${orderId}`;
}

export function readContinuationInput(raw: string) {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('orderId' in value) || typeof value.orderId !== 'string'
      || !('version' in value) || !(value.version === null || typeof value.version === 'string')) {
    throw new Error('Invalid order continuation record');
  }
  return { orderId: value.orderId, version: value.version };
}

export function continuationHistory(tx: Db, id: string, action: string, before: unknown, after: unknown) {
  return writeAuditLog({ action, resource: 'purchases', targetType: 'BackgroundTask', targetId: id, before, after }, tx);
}

export async function requestPurchaseContinuation(tx: Db, orderId: string, version: string | null, retryFailed = false) {
  const dedupeKey = purchaseContinuationKey(orderId);
  const row = await tx.backgroundTask.findUnique({ where: { dedupeKey } });
  const payload = JSON.stringify({ orderId, version });
  if (!row) {
    return tx.backgroundTask.create({ data: { type: PURCHASE_CONTINUATION, status: PURCHASE_READY, dedupeKey, payload } });
  }
  if (row.type !== PURCHASE_CONTINUATION) return null;
  let sourceMatches=false;
  try { sourceMatches=readContinuationInput(row.payload).orderId===orderId; }
  catch { /* A damaged task must not roll back the customer or finance action. */ }
  if (!sourceMatches && !retryFailed) return row;
  if (version === null || row.payload === payload && !(retryFailed && row.status === 'failed')) return row;
  await continuationHistory(tx, row.id, 'purchase.continuation_requested',
    { status: row.status, payload: row.payload, result: row.result, attempts: row.attempts, lastError: row.lastError },
    { orderId, version });
  return tx.backgroundTask.update({ where: { id: row.id }, data: {
    status: PURCHASE_READY, payload, attempts: 0, runAt: new Date(), completedAt: null, lockedAt: null, lockedBy: null,
  } });
}

// Existing accepted orders can predate the software that records a wake-up inside the business transaction.
export async function discoverPurchaseContinuations(tx: Db) {
  const prefix = purchaseContinuationKey('');
  const orders = await tx.$queryRaw<{id: string}[]>`SELECT o.id FROM "Order" o
    WHERE o.archivedAt IS NULL AND o.status IN ('confirmed','partially_shipped')
      AND EXISTS (SELECT 1 FROM OrderItem i WHERE i.orderId=o.id AND i.quantity>i.shippedQty)
      AND NOT EXISTS (SELECT 1 FROM BackgroundTask t WHERE t.dedupeKey=${prefix}||o.id)
    ORDER BY o.createdAt,o.id LIMIT 16`;
  for (const order of orders) await requestPurchaseContinuation(tx, order.id, null);
  return orders.length;
}

export async function purchaseContinuationStatus(tx: Db, orderId: string) {
  const row = await tx.backgroundTask.findUnique({ where: { dedupeKey: purchaseContinuationKey(orderId) },
    select: { type: true, status: true, result: true, completedAt: true, updatedAt: true } });
  if (!row || row.type !== PURCHASE_CONTINUATION) return null;
  let reason: string | null = null;
  if (row.status === 'awaiting_human' && row.result) {
    try {
      const receipt: unknown = JSON.parse(row.result);
      if (receipt && typeof receipt === 'object' && 'reason' in receipt && typeof receipt.reason === 'string') reason = receipt.reason;
    } catch { reason='请核对本单原采购接续记录'; }
  }
  return { status: row.status, reason, updatedAt: row.updatedAt.toISOString() };
}
