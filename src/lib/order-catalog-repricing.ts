import type { Prisma } from '@prisma/client';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { calculateOrderAmounts } from '@/lib/order-domain';

export function jsonObject(raw: string | null | undefined): Record<string, unknown> {
  try { const value = JSON.parse(raw ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export const REPRICING_ORDER_INCLUDE = {
  orderItems: { orderBy: { position: 'asc' as const } },
  adjustments: { orderBy: { id: 'asc' as const } },
  paymentAttempts: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.OrderInclude;
type RepricingOrder = Prisma.OrderGetPayload<{ include: typeof REPRICING_ORDER_INCLUDE }>;

export function orderRepricingFingerprint(order: RepricingOrder) {
  return pricingContentHash({
    id: order.id, inquiryId: order.inquiryId, customerId: order.customerId, email: order.email,
    organizationId: order.organizationId, ownerScope: order.ownerScope, status: order.status,
    paymentMethod: order.paymentMethod, paidAt: order.paidAt, archivedAt: order.archivedAt,
    subtotal: order.subtotal, total: order.total, adjustmentTotal: order.adjustmentTotal,
    pointsPersonal: order.pointsPersonal, pointsGroup: order.pointsGroup, pointsGroupId: order.pointsGroupId,
    pointsDiscount: order.pointsDiscount, pointsApplied: order.pointsApplied,
    items: order.orderItems, adjustments: order.adjustments, paymentAttempts: order.paymentAttempts,
  });
}

export async function pendingOrderRepricing(tx: Prisma.TransactionClient, orderId: string) {
  const events = await tx.orderEvent.findMany({
    where: { orderId, type: 'catalog_repricing_required' },
  });
  const proposals = events.map((event) => ({ event, details: jsonObject(event.metadata) }))
    .sort((left, right) => Number(right.details.quoteVersion) - Number(left.details.quoteVersion));
  const latest = proposals[0];
  if (!latest) return null;
  const resolved = await tx.backgroundTask.findUnique({ where: { dedupeKey: `catalog-order-price:${String(latest.details.quoteId)}:${orderId}` } });
  return resolved && ['succeeded', 'cancelled'].includes(resolved.status) ? null : latest.details;
}

export async function assertOrderPricingResolved(tx: Prisma.TransactionClient, orderId: string) {
  if (await pendingOrderRepricing(tx, orderId)) throw new Error('QUOTE_REPRICE_REQUIRED');
}

/** Follow an actual order cancellation/closure; do not cancel any business action here. */
export async function closeOrderRepricing(tx: Prisma.TransactionClient, orderId: string, actor: { id: string | null; email: string }) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, inquiryId: true } });
  if (!order || !['cancelled', 'closed'].includes(order.status)) return;
  const pending = await pendingOrderRepricing(tx, orderId);
  if (!pending || typeof pending.quoteId !== 'string') return;
  const quote = await tx.quote.findUnique({ where: { id: pending.quoteId }, include: { items: true } });
  if (!quote || quote.inquiryId !== order.inquiryId) throw new Error('REPRICING_VERSION_CHANGED');
  const result = { orderId, quoteId: quote.id, outcome: 'closed_with_order', orderStatus: order.status };
  await tx.backgroundTask.create({ data: { type: 'quote.order_reprice', status: 'cancelled', completedAt: new Date(),
    dedupeKey: `catalog-order-price:${quote.id}:${orderId}`, payload: JSON.stringify({ orderId, quoteId: quote.id }), result: JSON.stringify(result) } });
  const lineIds = quote.items.filter((line) => jsonObject(line.metadata).repricingOrderId === orderId).map((line) => line.id);
  await tx.quoteItem.updateMany({ where: { id: { in: lineIds } }, data: { available: false } });
  await tx.quoteConfirmation.create({ data: { quoteId: quote.id, userId: actor.id, email: actor.email,
    action: 'catalog_repricing_closed_with_order', details: JSON.stringify(result) } });
  await tx.orderEvent.create({ data: { orderId, type: 'catalog_repricing_closed', actorId: actor.id, actorEmail: actor.email,
    message: '原订单已结束，对应价格复核随之结束，历史报价与确认记录保留', metadata: JSON.stringify(result) } });
  const remaining = quote.items.filter((line) => !lineIds.includes(line.id) && line.available);
  if (!remaining.length) await tx.inquiry.update({ where: { id: quote.inquiryId }, data: { hasUnresolvedPricing: false, status: 'closed' } });
}

/** Record a real customer's response received by staff; this is not merchant order acceptance. */
export async function recordCustomerRepricingConfirmation(tx: Prisma.TransactionClient, input: {
  inquiryId: string; quoteId: string; orderId: string; proposalHash: string;
  responseChannel: string; responseReference: string; actor: { id: string; email: string };
}) {
  const dedupeKey = `catalog-order-price:${input.quoteId}:${input.orderId}`;
  const recorded = await tx.backgroundTask.findUnique({ where: { dedupeKey } });
  if (recorded && recorded.status !== 'succeeded') throw new Error('REPRICING_VERSION_CHANGED');
  if (recorded?.result) {
    const previous = JSON.parse(recorded.result);
    if (previous.proposalHash !== input.proposalHash) throw new Error('REPRICING_VERSION_CHANGED');
    return { ...previous, replayed: true };
  }
  const pending = await pendingOrderRepricing(tx, input.orderId);
  if (!pending || pending.quoteId !== input.quoteId || pending.proposalHash !== input.proposalHash) throw new Error('REPRICING_VERSION_CHANGED');
  const order = await tx.order.findUnique({ where: { id: input.orderId }, include: REPRICING_ORDER_INCLUDE });
  if (!order || order.inquiryId !== input.inquiryId || !['pending', 'unpaid'].includes(order.status)
    || order.archivedAt || orderRepricingFingerprint(order) !== pending.orderFingerprint) throw new Error('REPRICING_VERSION_CHANGED');
  // Never rewrite a payment/points fact to make a new catalogue price appear settled.
  if (order.paidAt || order.paymentAttempts.some((attempt) => !['TRADE_CLOSED', 'closed', 'failed'].includes(attempt.status))
    || order.pointsApplied || order.pointsPersonal || order.pointsGroup || order.adjustments.length) {
    throw new Error('REPRICING_FINANCE_REVIEW_REQUIRED');
  }
  const quote = await tx.quote.findUnique({ where: { id: input.quoteId }, include: { items: { orderBy: { position: 'asc' } } } });
  const latest = await tx.quote.findFirst({ where: { inquiryId: input.inquiryId }, orderBy: { version: 'desc' }, select: { id: true } });
  if (!quote || quote.inquiryId !== input.inquiryId || latest?.id !== quote.id || quote.status !== 'draft') throw new Error('REPRICING_VERSION_CHANGED');
  const lines = quote.items.filter((line) => jsonObject(line.metadata).repricingOrderId === order.id);
  const content = lines.map((line) => ({ orderItemId: jsonObject(line.metadata).repricingOrderItemId, unitPrice: line.unitPrice, quantity: line.quantity, pricingSnapshot: line.pricingSnapshot }));
  if (pricingContentHash({ orderFingerprint: pending.orderFingerprint, lines: content }) !== input.proposalHash
    || lines.length !== order.orderItems.length) throw new Error('REPRICING_VERSION_CHANGED');
  for (const item of order.orderItems) {
    const matches = lines.filter((line) => jsonObject(line.metadata).repricingOrderItemId === item.id);
    if (matches.length !== 1 || matches[0].quantity !== item.quantity) throw new Error('REPRICING_VERSION_CHANGED');
    await tx.orderItem.update({ where: { id: item.id }, data: { unitPrice: matches[0].unitPrice, pricingSnapshot: matches[0].pricingSnapshot } });
  }
  const amounts = calculateOrderAmounts(lines.map((line) => ({ unitPrice: line.unitPrice, quantity: line.quantity })), []);
  await tx.order.update({ where: { id: order.id }, data: amounts });
  await tx.quoteItem.updateMany({ where: { id: { in: lines.map((line) => line.id) } }, data: { available: false } });
  const result = { orderId: order.id, quoteId: quote.id, proposalHash: input.proposalHash, before: order.total, total: amounts.total, status: order.status };
  await tx.orderEvent.create({ data: { orderId: order.id, type: 'catalog_repricing_resolved', actorId: input.actor.id, actorEmail: input.actor.email,
    message: '工作人员登记客户确认新价，原订单仍待 Libereal 审核接受', metadata: JSON.stringify({ ...result, responseChannel: input.responseChannel, responseReference: input.responseReference }) } });
  await tx.quoteConfirmation.create({ data: { quoteId: quote.id, userId: input.actor.id, email: input.actor.email,
    action: 'customer_repricing_recorded_by_staff', details: JSON.stringify({ ...result, responseChannel: input.responseChannel, responseReference: input.responseReference }) } });
  await tx.backgroundTask.create({ data: { type: 'quote.order_reprice', status: 'succeeded', completedAt: new Date(), dedupeKey,
    payload: JSON.stringify({ quoteId: quote.id, orderId: order.id, actorId: input.actor.id }), result: JSON.stringify(result) } });
  const pendingOrders = await tx.order.findMany({ where: { inquiryId: input.inquiryId, status: { in: ['pending', 'unpaid'] } }, select: { id: true } });
  let unresolved = false;
  for (const target of pendingOrders) if (await pendingOrderRepricing(tx, target.id)) unresolved = true;
  const remaining = quote.items.some((line) => !jsonObject(line.metadata).repricingOrderId && line.quantity > line.orderedQty && line.available);
  if (!unresolved && !remaining) {
    await tx.quote.update({ where: { id: quote.id }, data: { status: 'accepted', acceptedAt: new Date() } });
    await tx.inquiry.update({ where: { id: input.inquiryId }, data: { hasUnresolvedPricing: false, status: 'closed' } });
  }
  return result;
}
