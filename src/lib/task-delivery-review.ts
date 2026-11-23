import type { BackgroundTask, Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';

type Db = Prisma.TransactionClient;
type Actor = { id: string; email: string };
const types = new Set(['email.send', 'sms.send', 'order.reminder']);
const outcomes = new Set(['all_accepted', 'none_accepted', 'partial', 'unknown']);

export function deliveryReviewable(task: Pick<BackgroundTask, 'type' | 'status'>) {
  return types.has(task.type) && ['awaiting_human', 'failed'].includes(task.status);
}

export function deliveryVersion(task: BackgroundTask) {
  return pricingContentHash({ id: task.id, type: task.type, status: task.status, payload: task.payload, attempts: task.attempts,
    dedupeKey: task.dedupeKey, result: task.result, lastError: task.lastError, updatedAt: task.updatedAt.toISOString() });
}

export async function recordDeliveryReview(tx: Db, taskId: string, input: Record<string, unknown>, actor: Actor) {
  const task = await tx.backgroundTask.findUnique({ where: { id: taskId } });
  const { version, outcome, reference, sha256 } = input;
  if (!task || !types.has(task.type) || typeof version !== 'string' || typeof outcome !== 'string' || !outcomes.has(outcome)
      || typeof reference !== 'string' || !reference.trim() || reference.length > 500
      || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  const review = { actorId: actor.id, taskId, version, outcome, reference: reference.trim(), sha256 };
  const reviewId = pricingContentHash(review);
  const prior = jsonObject(task.result);
  if (prior.reviewId === reviewId) return { status: task.status, reviewId };
  if (!deliveryReviewable(task) || version !== deliveryVersion(task)) return null;
  const status = outcome === 'partial' || outcome === 'unknown' ? 'awaiting_human' : 'delivery_reviewed';
  const changed = await tx.backgroundTask.updateMany({
    where: { id: taskId, type: task.type, status: task.status, updatedAt: task.updatedAt, result: task.result },
    data: { status, result: JSON.stringify({ reviewId, ...review }), completedAt: status === 'delivery_reviewed' ? new Date() : null },
  });
  if (!changed.count) return null;
  await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'task.delivery_reviewed',
    resource: 'tasks', targetType: 'BackgroundTask', targetId: task.id,
    before: { status: task.status, result: task.result, lastError: task.lastError }, after: { status, reviewId, ...review } }, tx);
  return { status, reviewId };
}
