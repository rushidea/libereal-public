import type { Prisma } from '@prisma/client';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { calculateOrderAmounts } from '@/lib/order-domain';
import { heldOrderRedeemPoints, POINTS_DEDUCTION_ROLLBACK_REASON, PREPAY_POINTS_RELEASE_REASON } from '@/lib/points-checkout-service';
import { pointsToYuan } from '@/lib/points-checkout';
import { assertBrandDiscountPricesCurrent } from '@/lib/pricing';
import { requiresWrittenSupplierQuote } from '@/lib/supplier-quote-policy';

export function jsonObject(raw: string | null | undefined): Record<string, unknown> {
  try { const value = JSON.parse(raw ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export const REPRICING_ORDER_INCLUDE = {
  orderItems: { orderBy: { position: 'asc' as const } },
  adjustments: { orderBy: { id: 'asc' as const } },
  paymentAttempts: { orderBy: { id: 'asc' as const } },
  addressSnapshot: true,
} satisfies Prisma.OrderInclude;
type RepricingOrder = Prisma.OrderGetPayload<{ include: typeof REPRICING_ORDER_INCLUDE }>;

// A payment callback can settle while a customer reply is awaited. It does not
// change the proposed goods/quantity/amount; finance must review its fresh result.
export function orderRepricingTermsFingerprint(order: RepricingOrder) {
  return pricingContentHash({
    id: order.id, inquiryId: order.inquiryId, customerId: order.customerId, email: order.email,
    organizationId: order.organizationId, ownerScope: order.ownerScope,
    status: ['pending', 'unpaid'].includes(order.status) ? 'awaiting_merchant_acceptance' : order.status,
    paymentMethod: order.paymentMethod, archivedAt: order.archivedAt,
    subtotal: order.subtotal, total: order.total, adjustmentTotal: order.adjustmentTotal,
    pointsPersonal: order.pointsPersonal, pointsGroup: order.pointsGroup, pointsGroupId: order.pointsGroupId,
    pointsDiscount: order.pointsDiscount, addressSnapshot: order.addressSnapshot,
    legalAcceptedIds: order.legalAcceptedIds, legalAcceptedSnapshot: order.legalAcceptedSnapshot,
    items: order.orderItems, adjustments: order.adjustments,
  });
}

export function orderRepricingFingerprint(order: RepricingOrder) {
  return pricingContentHash({
    terms: orderRepricingTermsFingerprint(order), status: order.status,
    paidAt: order.paidAt, paymentAttempts: order.paymentAttempts,
    pointsApplied: order.pointsApplied, pointsAppliedAt: order.pointsAppliedAt,
    pointsRefundedPersonal: order.pointsRefundedPersonal,
    pointsRefundedGroup: order.pointsRefundedGroup, pointsRefundedCash: order.pointsRefundedCash,
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

export async function assertOrderPricingResolved(tx: Prisma.TransactionClient, orderId: string,
  prospectiveItems?: Prisma.OrderItemCreateWithoutOrderInput[]) {
  if (await pendingOrderRepricing(tx, orderId)) throw new Error('QUOTE_REPRICE_REQUIRED');
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
  if (!order) throw new Error('QUOTE_REPRICE_REQUIRED');
  if (!['pending', 'unpaid'].includes(order.status)) {
    if (prospectiveItems) throw new Error('QUOTE_REPRICE_REQUIRED');
    return;
  }
  // Inspect the exact replacement that will be persisted in this transaction.
  // Missing inquiry/snapshot fields are not an exemption from current brand policy.
  try {
    if (prospectiveItems) for (const original of order.orderItems) {
      const snapshot = jsonObject(original.pricingSnapshot);
      const metadata = jsonObject(original.metadata);
      const variantId = metadata.variantId ?? snapshot.variantId;
      let product = original.productId ? await tx.product.findUnique({ where: { id: original.productId },
        select: { id: true, brand: true, brandRecordId: true, originalPrice: true } }) : null;
      if (!product && original.catalogNumber) {
        const matches = await tx.product.findMany({ where: { catalogNumber: original.catalogNumber,
          ...(typeof metadata.brand === 'string' ? { brand: metadata.brand } : {}) }, take: 2,
          select: { id: true, brand: true, brandRecordId: true, originalPrice: true } });
        if (matches.length > 1) throw new Error('QUOTE_REPRICE_REQUIRED');
        product = matches[0] ?? null;
      }
      const brand = product ? await tx.brand.findUnique({ where: product.brandRecordId ? { id: product.brandRecordId } : { name: product.brand },
        select: { supplierQuoteRequiredAbove: true } }) : null;
      const variant = typeof variantId === 'string' ? await tx.productVariant.findUnique({ where: { id: variantId }, select: { originalPrice: true } }) : null;
      const protectedLine = snapshot.supplierQuoteReviewId || requiresWrittenSupplierQuote(variant?.originalPrice ?? product?.originalPrice, brand?.supplierQuoteRequiredAbove);
      // A generic edit cannot erase the identity of goods awaiting a scoped review.
      if (protectedLine && !prospectiveItems.some(line => line.productId === (product?.id ?? original.productId)
        && (jsonObject(line.metadata).variantId ?? jsonObject(line.pricingSnapshot).variantId ?? null) === (variantId ?? null))) {
        throw new Error('QUOTE_REPRICE_REQUIRED');
      }
    }
    const lines = [];
    for (const line of prospectiveItems ?? order.orderItems) {
      const quantity = line.quantity;
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) throw new Error('QUOTE_REPRICE_REQUIRED');
      const metadata = jsonObject(line.metadata);
      const snapshot = jsonObject(line.pricingSnapshot);
      const variantId = typeof metadata.variantId === 'string' ? metadata.variantId
        : typeof snapshot.variantId === 'string' ? snapshot.variantId : null;
      const product = line.productId ? await tx.product.findUnique({ where: { id: line.productId },
        select: { id: true, catalogNumber: true } }) : null;
      let productId = product?.id ?? null;
      if (product && line.catalogNumber && product.catalogNumber !== line.catalogNumber) {
        const variant = variantId ? await tx.productVariant.findUnique({ where: { id: variantId },
          select: { productId: true, catalogNumber: true } }) : null;
        if (!variant || variant.productId !== product.id || variant.catalogNumber !== line.catalogNumber) throw new Error('QUOTE_REPRICE_REQUIRED');
      }
      if (!productId && line.catalogNumber) {
        const matches = await tx.product.findMany({ where: { catalogNumber: line.catalogNumber,
          ...(typeof metadata.brand === 'string' ? { brand: metadata.brand } : {}) }, select: { id: true }, take: 2 });
        if (matches.length > 1) throw new Error('QUOTE_REPRICE_REQUIRED');
        productId = matches[0]?.id ?? null;
      }
      if (snapshot.inquiryId && snapshot.inquiryId !== order.inquiryId) throw new Error('QUOTE_REPRICE_REQUIRED');
      lines.push({
        productId, catalogNumber: line.catalogNumber ?? null, name: line.name, unitPrice: line.unitPrice,
        quantity, lineTotal: line.unitPrice * quantity, leadTime: line.leadTime, pricingSnapshot: line.pricingSnapshot ?? '{}',
        source: 'db' as const, priceMismatch: false, variantId,
      });
    }
    await assertBrandDiscountPricesCurrent(tx, lines, {
      inquiryId: order.inquiryId ?? undefined, userId: order.customerId, customerEmail: order.email,
    });
  } catch { throw new Error('QUOTE_REPRICE_REQUIRED'); }
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

type RepricingIdentity = { inquiryId: string; quoteId: string; orderId: string; proposalHash: string };
type Actor = { id: string; email: string };
type CustomerResponse = RepricingIdentity & { responseChannel: string; responseReference: string; confirmedTotal?: number; actor: Actor };
type AppliedResult = RepricingIdentity & { stage: 'applied'; before: number; total: number; status: string; financeApprovalHash: string | null; replayed?: boolean };

async function completedRepricing(tx: Prisma.TransactionClient, input: RepricingIdentity) {
  const record = await tx.backgroundTask.findUnique({ where: { dedupeKey: `catalog-order-price:${input.quoteId}:${input.orderId}` } });
  if (record && record.status !== 'succeeded') throw new Error('REPRICING_VERSION_CHANGED');
  if (!record?.result) return null;
  const previous = jsonObject(record.result);
  if (previous.proposalHash !== input.proposalHash || (previous.inquiryId && previous.inquiryId !== input.inquiryId)
    || typeof previous.total !== 'number' || typeof previous.before !== 'number' || typeof previous.status !== 'string') throw new Error('REPRICING_VERSION_CHANGED');
  return { ...input, before: previous.before, total: previous.total, status: previous.status,
    financeApprovalHash: typeof previous.financeApprovalHash === 'string' ? previous.financeApprovalHash : null,
    stage: 'applied', replayed: true } satisfies AppliedResult;
}

async function loadRepricingProposal(tx: Prisma.TransactionClient, input: RepricingIdentity) {
  const pending = await pendingOrderRepricing(tx, input.orderId);
  if (!pending || pending.quoteId !== input.quoteId || pending.proposalHash !== input.proposalHash) throw new Error('REPRICING_VERSION_CHANGED');
  const order = await tx.order.findUnique({ where: { id: input.orderId }, include: REPRICING_ORDER_INCLUDE });
  if (!order || order.inquiryId !== input.inquiryId || !['pending', 'unpaid'].includes(order.status)
    || order.archivedAt) throw new Error('REPRICING_VERSION_CHANGED');
  if (typeof pending.orderTermsFingerprint === 'string'
    ? orderRepricingTermsFingerprint(order) !== pending.orderTermsFingerprint
    : orderRepricingFingerprint(order) !== pending.orderFingerprint) throw new Error('REPRICING_VERSION_CHANGED');
  const quote = await tx.quote.findUnique({ where: { id: input.quoteId }, include: { items: { orderBy: { position: 'asc' } }, inquiry: { select: { userId: true, email: true } } } });
  const latest = await tx.quote.findFirst({ where: { inquiryId: input.inquiryId }, orderBy: { version: 'desc' }, select: { id: true } });
  if (!quote || quote.inquiryId !== input.inquiryId || latest?.id !== quote.id || quote.status !== 'draft') throw new Error('REPRICING_VERSION_CHANGED');
  const lines = quote.items.filter((line) => jsonObject(line.metadata).repricingOrderId === order.id);
  const content = lines.map((line) => ({ orderItemId: jsonObject(line.metadata).repricingOrderItemId, unitPrice: line.unitPrice, quantity: line.quantity, pricingSnapshot: line.pricingSnapshot, leadTime: line.leadTime, notes: line.notes }));
  if (pricingContentHash({ orderFingerprint: pending.orderFingerprint, lines: content }) !== input.proposalHash
    || lines.length !== order.orderItems.length) throw new Error('REPRICING_VERSION_CHANGED');
  for (const item of order.orderItems) {
    const matches = lines.filter((line) => jsonObject(line.metadata).repricingOrderItemId === item.id);
    if (matches.length !== 1 || matches[0].quantity !== item.quantity) throw new Error('REPRICING_VERSION_CHANGED');
  }
  try {
    await assertBrandDiscountPricesCurrent(tx, lines.map((line) => ({
      productId: line.productId, catalogNumber: line.catalogNumber, name: line.name, unitPrice: line.unitPrice,
      quantity: line.quantity, lineTotal: line.lineTotal, leadTime: line.leadTime, pricingSnapshot: line.pricingSnapshot ?? '{}',
      source: 'db' as const, priceMismatch: false,
      variantId: typeof jsonObject(line.pricingSnapshot).variantId === 'string' ? jsonObject(line.pricingSnapshot).variantId as string : null,
    })), { inquiryId: input.inquiryId, userId: quote.inquiry.userId, customerEmail: quote.inquiry.email, requireDiscountPriority: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'BRAND_DISCOUNT_PRICE_DRIFT') throw new Error('REPRICING_VERSION_CHANGED');
    throw error;
  }
  const amounts = calculateOrderAmounts(lines.map((line) => ({ unitPrice: line.unitPrice, quantity: line.quantity })), order.adjustments);
  return { pending, order, quote, lines, amounts };
}

type LoadedProposal = Awaited<ReturnType<typeof loadRepricingProposal>>;
function needsFinanceReview(order: RepricingOrder) {
  return Boolean(order.paidAt || order.paymentAttempts.length
    || order.pointsApplied || order.pointsAppliedAt || order.pointsPersonal || order.pointsGroup || order.pointsDiscount
    || order.pointsRefundedPersonal || order.pointsRefundedGroup || order.pointsRefundedCash || order.adjustments.length);
}

async function pointsEvidence(tx: Prisma.TransactionClient, order: RepricingOrder) {
  const personal = await tx.pointsLog.findMany({ where: { relatedId: order.id }, orderBy: { id: 'asc' } });
  const group = await tx.groupPointsLog.findMany({ where: { relatedId: order.id }, orderBy: { id: 'asc' } });
  const held = await heldOrderRedeemPoints(tx, order);
  const permittedTypes = ['order_redeem', 'order_redeem_refund'];
  const holdRefunds = [POINTS_DEDUCTION_ROLLBACK_REASON, PREPAY_POINTS_RELEASE_REASON];
  const invalidOwner = personal.some((row) => row.userId !== order.customerId) || group.some((row) => row.groupId !== order.pointsGroupId);
  const unknown = [...personal, ...group].some((row) => !permittedTypes.includes(row.type));
  const actualRefund = [...personal, ...group].some((row) => row.type === 'order_redeem_refund' && !holdRefunds.includes(row.reason ?? ''));
  const ledgerNet = (rows: { type: string; reason: string | null; delta: number }[]) => -rows
    .filter((row) => row.type === 'order_redeem' || (row.type === 'order_redeem_refund' && holdRefunds.includes(row.reason ?? '')))
    .reduce((sum, row) => sum + row.delta, 0);
  // The settlement helper intentionally skips zero intent. Audit all records here
  // as well: a zero counter must not hide an actual deduction or excess reversal.
  const recordedNet = { personal: ledgerNet(personal), group: ledgerNet(group) };
  const invalidDirection = [...personal, ...group].some((row) => row.type === 'order_redeem' ? row.delta >= 0 : row.delta <= 0);
  const pointsAdjustment = order.adjustments.filter((row) => row.type === 'points_redeem').reduce((sum, row) => sum + row.amount, 0);
  const inconsistent = invalidOwner || unknown || actualRefund || invalidDirection
    || order.pointsPersonal < 0 || order.pointsGroup < 0
    || held.personal !== order.pointsPersonal || held.group !== order.pointsGroup
    || recordedNet.personal !== order.pointsPersonal || recordedNet.group !== order.pointsGroup
    || Math.round(pointsToYuan(order.pointsPersonal + order.pointsGroup) * 100) !== Math.round(order.pointsDiscount * 100)
    || Math.round((order.pointsDiscount + pointsAdjustment) * 100) !== 0;
  return { personal, group, held, recordedNet, inconsistent };
}

async function customerResponseRecord(tx: Prisma.TransactionClient, input: RepricingIdentity) {
  const record = await tx.backgroundTask.findUnique({ where: { dedupeKey: `catalog-customer-price:${input.quoteId}:${input.orderId}` } });
  const value = record?.result ? JSON.parse(record.result) : null;
  if (value && (value.proposalHash !== input.proposalHash || value.inquiryId !== input.inquiryId)) throw new Error('REPRICING_VERSION_CHANGED');
  return value as { id: string; proposalHash: string; ownerId: string; ownerEmail: string; responseChannel: string; responseReference: string } | null;
}

async function applyRepricing(tx: Prisma.TransactionClient, input: RepricingIdentity, loaded: LoadedProposal, actor: Actor, financeApprovalHash?: string) {
  const { order, quote, lines, amounts } = loaded;
  const response = await customerResponseRecord(tx, input);
  if (!response) throw new Error('CUSTOMER_REPRICING_CONFIRMATION_REQUIRED');
  for (const item of order.orderItems) {
    const line = lines.find((row) => jsonObject(row.metadata).repricingOrderItemId === item.id)!;
    await tx.orderItem.update({ where: { id: item.id }, data: { unitPrice: line.unitPrice, pricingSnapshot: line.pricingSnapshot, leadTime: line.leadTime } });
  }
  // Keep the original adjustment, payment and points records. Finance approval never creates a cash transfer.
  await tx.order.update({ where: { id: order.id }, data: amounts });
  await tx.quoteItem.updateMany({ where: { id: { in: lines.map((line) => line.id) } }, data: { available: false } });
  const result = { inquiryId: input.inquiryId, orderId: order.id, quoteId: quote.id, proposalHash: input.proposalHash,
    before: order.total, total: amounts.total, status: order.status, stage: 'applied' as const, financeApprovalHash: financeApprovalHash ?? null };
  await tx.orderEvent.create({ data: { orderId: order.id, type: 'catalog_repricing_resolved', actorId: actor.id, actorEmail: actor.email,
    message: '客户新价确认及必要的金额复核已完成，原订单仍待 Libereal 审核接受',
    metadata: JSON.stringify({ ...result, customerResponseId: response.id, responseOwnerId: response.ownerId,
      responseChannel: response.responseChannel, responseReference: response.responseReference }) } });
  await tx.backgroundTask.create({ data: { type: 'quote.order_reprice', status: 'succeeded', completedAt: new Date(),
    dedupeKey: `catalog-order-price:${input.quoteId}:${input.orderId}`,
    payload: JSON.stringify({ quoteId: quote.id, orderId: order.id, actorId: actor.id }), result: JSON.stringify(result) } });
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

/** A recorded customer reply survives the wait for finance; it never impersonates a customer message. */
export async function recordCustomerRepricingConfirmation(tx: Prisma.TransactionClient, input: CustomerResponse) {
  const completed = await completedRepricing(tx, input);
  if (completed) return completed;
  const loaded = await loadRepricingProposal(tx, input);
  const points = await pointsEvidence(tx, loaded.order);
  const financeRequired = needsFinanceReview(loaded.order) || points.inconsistent || points.personal.length > 0 || points.group.length > 0;
  if (financeRequired && input.confirmedTotal !== loaded.amounts.total) throw new Error('REPRICING_TOTAL_CONFIRMATION_REQUIRED');
  let response = await customerResponseRecord(tx, input);
  if (!response) {
    const recorded = await tx.quoteConfirmation.create({ data: { quoteId: input.quoteId, userId: input.actor.id, email: input.actor.email,
      action: 'customer_repricing_recorded_by_staff', details: JSON.stringify({ ...input, actor: undefined,
        ownerId: input.actor.id, amounts: loaded.amounts, adjustmentTreatment: 'preserve_original_amounts_pending_finance_review' }) } });
    response = { id: recorded.id, proposalHash: input.proposalHash, ownerId: input.actor.id, ownerEmail: input.actor.email,
      responseChannel: input.responseChannel, responseReference: input.responseReference };
    await tx.backgroundTask.create({ data: { type: 'quote.customer_price_response', status: 'succeeded', completedAt: new Date(),
      dedupeKey: `catalog-customer-price:${input.quoteId}:${input.orderId}`,
      payload: JSON.stringify({ inquiryId: input.inquiryId, orderId: input.orderId, quoteId: input.quoteId, actorId: input.actor.id }),
      result: JSON.stringify({ ...response, inquiryId: input.inquiryId }) } });
  }
  if (financeRequired) return { stage: 'awaiting_finance_review' as const,
    inquiryId: input.inquiryId, orderId: input.orderId, quoteId: input.quoteId, proposalHash: input.proposalHash,
    ownerId: response.ownerId, customerResponseId: response.id, originalTotal: loaded.order.total, proposedTotal: loaded.amounts.total };
  return applyRepricing(tx, input, loaded, input.actor);
}

export async function previewRepricingFinance(tx: Prisma.TransactionClient, input: RepricingIdentity) {
  const completed = await completedRepricing(tx, input);
  if (completed) return completed;
  const loaded = await loadRepricingProposal(tx, input);
  const response = await customerResponseRecord(tx, input);
  const { order, amounts } = loaded;
  const activePayment = order.paymentAttempts.some((attempt) => ['created', 'redirected', 'WAIT_BUYER_PAY'].includes(attempt.status));
  const unknownPayment = order.paymentAttempts.some((attempt) => !['created', 'redirected', 'WAIT_BUYER_PAY', 'TRADE_CLOSED', 'closed', 'failed', 'paid'].includes(attempt.status));
  const paidAttempts = order.paymentAttempts.filter((attempt) => attempt.status === 'paid');
  const paid = Boolean(order.paidAt || paidAttempts.length);
  // Existing Alipay orders have one successful full payment. Never infer a bank
  // receipt from paidAt, or invent an allocation by adding ambiguous transactions.
  const singlePaid = paidAttempts.length === 1 ? paidAttempts[0] : null;
  const verifiedPaidAmount = singlePaid?.provider === 'alipay' && singlePaid.tradeNo && singlePaid.paidAt && order.paidAt
    && Number.isFinite(singlePaid.amount) && singlePaid.amount > 0 ? singlePaid.amount : null;
  const cashDifference = paid && (verifiedPaidAmount === null || Math.round(amounts.total * 100) !== Math.round(verifiedPaidAmount * 100));
  const ledger = await pointsEvidence(tx, order);
  const unsettledPoints = Boolean((order.pointsPersonal || order.pointsGroup) && !order.pointsApplied)
    || Boolean(order.pointsRefundedPersonal || order.pointsRefundedGroup || order.pointsRefundedCash) || ledger.inconsistent;
  const blocker = !response ? 'CUSTOMER_REPRICING_CONFIRMATION_REQUIRED'
    : activePayment || unknownPayment ? 'REPRICING_PAYMENT_RECONCILIATION_REQUIRED'
    : cashDifference ? 'REPRICING_CASH_RESULT_REQUIRED'
    : unsettledPoints ? 'REPRICING_POINTS_RECONCILIATION_REQUIRED' : null;
  const snapshot = {
    inquiryId: input.inquiryId, quoteId: input.quoteId, orderId: order.id, proposalHash: input.proposalHash,
    orderFingerprint: orderRepricingFingerprint(order), customerResponseId: response?.id ?? null,
    customerResponse: response,
    customerId: order.customerId, customerEmail: order.email, paymentMethod: order.paymentMethod,
    originalTotal: order.total, amounts, adjustmentTreatment: 'preserve_original_amounts' as const,
    adjustments: order.adjustments, paymentAttempts: order.paymentAttempts, originalPaidAt: order.paidAt, verifiedPaidAmount,
    pointsEvidence: ledger,
    points: { personal: order.pointsPersonal, group: order.pointsGroup, groupId: order.pointsGroupId,
      discount: order.pointsDiscount, applied: order.pointsApplied,
      refundedPersonal: order.pointsRefundedPersonal, refundedGroup: order.pointsRefundedGroup, refundedCash: order.pointsRefundedCash },
  };
  return { ...snapshot, stage: response ? 'awaiting_finance_review' as const : 'awaiting_customer_response' as const,
    ownerId: response?.ownerId ?? null, blocker, financeApprovalHash: pricingContentHash(snapshot) };
}

/** Explicit finance decision on the displayed existing adjustments. No payment, refund, or points transfer. */
export async function approveRepricingFinance(tx: Prisma.TransactionClient, input: RepricingIdentity & {
  financeApprovalHash: string; preserveOriginalAdjustments: boolean; reason: string; actor: Actor;
}) {
  const completed = await completedRepricing(tx, input);
  if (completed) {
    if (completed.financeApprovalHash !== input.financeApprovalHash) throw new Error('REPRICING_VERSION_CHANGED');
    return completed;
  }
  const preview = await previewRepricingFinance(tx, input);
  if (preview.stage === 'applied' || preview.financeApprovalHash !== input.financeApprovalHash || input.preserveOriginalAdjustments !== true) throw new Error('REPRICING_VERSION_CHANGED');
  if (preview.blocker) throw new Error(preview.blocker);
  const loaded = await loadRepricingProposal(tx, input);
  await tx.quoteConfirmation.create({ data: { quoteId: input.quoteId, userId: input.actor.id, email: input.actor.email,
    action: 'catalog_repricing_finance_approved', details: JSON.stringify({ ...preview, reason: input.reason, actorId: input.actor.id }) } });
  return applyRepricing(tx, input, loaded, input.actor, input.financeApprovalHash);
}
