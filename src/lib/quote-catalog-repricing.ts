import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { verifyAndPriceItems } from '@/lib/pricing';
import { calculateOrderAmounts } from '@/lib/order-domain';
import type { PricingQuoteImpact } from '@/lib/pricing-adjustment-impact';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { quoteContentHash } from '@/lib/quote-records';
import { jsonObject, orderRepricingFingerprint, orderRepricingTermsFingerprint, REPRICING_ORDER_INCLUDE } from '@/lib/order-catalog-repricing';

type Change = { productId: string; variantId?: string | null; catalogNumber: string; brand?: string };
type Line = { productId: string | null; catalogNumber: string | null; name: string; unitPrice: number; quantity: number; metadata: string | null; pricingSnapshot: string | null };

function priceInputsChanged(before: string | null, after: string | null) {
  return jsonObject(before).discountInputsHash !== jsonObject(after).discountInputsHash;
}

function affected(line: Line, changes: Change[]) {
  const metadata = jsonObject(line.metadata);
  const snapshot = jsonObject(line.pricingSnapshot);
  const variantId = metadata.variantId ?? snapshot.variantId;
  return changes.some((change) => {
    if (line.productId && line.productId !== change.productId) return false;
    if (!line.productId && (line.catalogNumber?.trim().toLowerCase() !== change.catalogNumber.trim().toLowerCase()
      || metadata.brand !== change.brand)) return false;
    if (change.variantId) return variantId === change.variantId || line.catalogNumber?.trim().toLowerCase() === change.catalogNumber.trim().toLowerCase();
    return true;
  });
}

async function priceLine(tx: Prisma.TransactionClient, line: Line, inquiry: { userId: string | null; email: string }, changes: Change[]) {
  if (!affected(line, changes)) return { productId: line.productId, unitPrice: line.unitPrice, pricingSnapshot: line.pricingSnapshot };
  const metadata = jsonObject(line.metadata);
  const snapshot = jsonObject(line.pricingSnapshot);
  const variantId = typeof metadata.variantId === 'string' ? metadata.variantId
    : typeof snapshot.variantId === 'string' ? snapshot.variantId : undefined;
  const priced = await verifyAndPriceItems([{
    productId: line.productId, catalogNumber: line.catalogNumber, variantId,
    brand: typeof metadata.brand === 'string' ? metadata.brand : undefined,
    name: line.name, price: line.unitPrice, quantity: line.quantity,
  }], { db: tx, userId: inquiry.userId, customerEmail: inquiry.email, allowClientFallback: false, strictQuantity: true, requireDiscountPriority: true });
  const next = priced.verifiedItems[0];
  if (!next || next.source !== 'db' || next.quoteRequired) throw new Error('CATALOG_REPRICING_REQUIRES_REVIEW');
  return { productId: next.productId, unitPrice: next.unitPrice, pricingSnapshot: next.pricingSnapshot };
}

/** One current successor per inquiry. Merchant-accepted orders are never recalculated. */
export async function repriceQuotesAfterCatalogChange(tx: Prisma.TransactionClient, input: {
  impact: PricingQuoteImpact; changes: Change[]; approvalHash: string; operationKey?: string; actor: { id: string; email: string };
}) {
  const results = [];
  for (const previousQuoteId of input.impact.quoteIds) {
    const previous = await tx.quote.findUnique({ where: { id: previousQuoteId }, include: {
      items: { orderBy: { position: 'asc' } }, inquiry: true,
    } });
    if (!previous || previous.inquiry.archivedAt || !['draft', 'sent', 'accepted', 'expired'].includes(previous.status)) continue;
    const quoteId = `catalog_quote_${createHash('sha256').update(`${input.operationKey ?? input.approvalHash}:${previous.id}`).digest('hex').slice(0, 32)}`;
    const items: Prisma.QuoteItemCreateWithoutQuoteInput[] = [];
    let changed = false;
    for (const line of previous.items) {
      if (jsonObject(line.metadata).repricingOrderId || line.quantity <= line.orderedQty || !line.available) continue;
      const quantity = line.quantity - line.orderedQty;
      const next = await priceLine(tx, { ...line, quantity }, previous.inquiry, input.changes);
      if (Math.round(next.unitPrice * 100) !== Math.round(line.unitPrice * 100) || priceInputsChanged(line.pricingSnapshot, next.pricingSnapshot)) changed = true;
      items.push({ position: items.length, ...(line.inquiryItemId ? { inquiryItem: { connect: { id: line.inquiryItemId } } } : {}),
        catalogNumber: line.catalogNumber, name: line.name, quantity, orderedQty: 0,
        ...next, lineTotal: Math.round(next.unitPrice * quantity * 100) / 100,
        leadTime: line.leadTime, available: line.available, notes: line.notes, metadata: line.metadata });
    }
    const proposals = [];
    const priorPendingOrderIds = previous.items.filter((line) => line.available)
      .map((line) => jsonObject(line.metadata).repricingOrderId).filter((id): id is string => typeof id === 'string');
    const pendingOrders = await tx.order.findMany({ where: { inquiryId: previous.inquiryId,
      id: { in: [...new Set([...input.impact.pendingOrderIds, ...priorPendingOrderIds])] }, status: { in: ['pending', 'unpaid'] }, archivedAt: null },
      include: REPRICING_ORDER_INCLUDE, orderBy: { id: 'asc' } });
    for (const order of pendingOrders) {
      // Recover the exact acceptance mapping; never infer it merely from a shared product.
      const acceptances = await tx.quoteConfirmation.findMany({ where: {
        quote: { inquiryId: previous.inquiryId }, action: { in: ['accept', 'partial_accept'] },
      }, include: { quote: { include: { items: true } } } });
      const matching = acceptances.filter((record) => jsonObject(record.details).orderId === order.id);
      if (matching.length !== 1) throw new Error('CATALOG_REPRICING_ORDER_LINK_REQUIRED');
      const acceptance = matching[0];
      const links = jsonObject(acceptance.details).items;
      if (!Array.isArray(links) || links.length !== order.orderItems.length) throw new Error('CATALOG_REPRICING_ORDER_LINK_REQUIRED');
      const orderLines = [];
      let orderChanged = false;
      for (const [position, item] of order.orderItems.entries()) {
        const link = links[position];
        const source = acceptance.quote.items.find((line) => line.id === link?.quoteItemId);
        if (!source || source.productId !== item.productId || (link.orderedQuantity ?? link.quantity) !== item.quantity) throw new Error('CATALOG_REPRICING_ORDER_LINK_REQUIRED');
        const line = { ...source, quantity: item.quantity, unitPrice: item.unitPrice,
          metadata: item.metadata ?? source.metadata, pricingSnapshot: item.pricingSnapshot ?? source.pricingSnapshot };
        const priorProposal = previous.items.find((prior) => prior.available
          && jsonObject(prior.metadata).repricingOrderItemId === item.id);
        const next = priorProposal && !affected(line, input.changes)
          ? { productId: priorProposal.productId, unitPrice: priorProposal.unitPrice, pricingSnapshot: priorProposal.pricingSnapshot }
          : await priceLine(tx, line, previous.inquiry, input.changes);
        if (Math.round(next.unitPrice * 100) !== Math.round((priorProposal?.unitPrice ?? item.unitPrice) * 100)
          || priceInputsChanged(priorProposal?.pricingSnapshot ?? item.pricingSnapshot ?? source.pricingSnapshot, next.pricingSnapshot)) orderChanged = true;
        orderLines.push({ item, source, next });
      }
      // Keep an unresolved earlier proposal even when this catalogue change targets another line.
      const oldProposal = previous.items.some((line) => jsonObject(line.metadata).repricingOrderId === order.id && line.available);
      if (!orderChanged && !oldProposal) continue;
      changed ||= orderChanged;
      const orderFingerprint = orderRepricingFingerprint(order);
      const lines = orderLines.map(({ item, next }) => ({ orderItemId: item.id, quantity: item.quantity,
        unitPrice: next.unitPrice, pricingSnapshot: next.pricingSnapshot }));
      const proposalHash = pricingContentHash({ orderFingerprint, lines });
      const proposedAmounts = calculateOrderAmounts(orderLines.map(({ item, next }) => ({ unitPrice: next.unitPrice, quantity: item.quantity })), order.adjustments);
      proposals.push({ orderId: order.id, orderFingerprint, orderTermsFingerprint: orderRepricingTermsFingerprint(order), proposalHash });
      for (const { item, source, next } of orderLines) items.push({
        position: items.length, catalogNumber: source.catalogNumber,
        name: item.name, quantity: item.quantity, orderedQty: 0, ...next,
        lineTotal: Math.round(next.unitPrice * item.quantity * 100) / 100, leadTime: item.leadTime,
        available: true, metadata: JSON.stringify({ ...jsonObject(item.metadata ?? source.metadata),
          repricingOrderId: order.id, repricingOrderItemId: item.id, repricingProposalHash: proposalHash,
          repricingOriginalTotal: order.total, repricingProposedTotal: proposedAmounts.total,
          repricingPreservedAdjustments: order.adjustments.map((adjustment) => ({ label: adjustment.label, amount: adjustment.amount })),
          previousUnitPrice: item.unitPrice, sourceQuoteItemId: source.id, sourceConfirmationId: acceptance.id }),
      });
    }
    if (!changed) continue;
    for (const item of items) {
      const metadata = jsonObject(item.metadata);
      const variantId = jsonObject(item.pricingSnapshot).variantId;
      item.metadata = JSON.stringify({ ...metadata,
        ...(typeof variantId === 'string' ? { variantId } : {}),
        catalogRepricingApprovalHash: input.approvalHash });
    }
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
    const created = await tx.quote.create({ data: {
      id: quoteId, inquiryId: previous.inquiryId, version: previous.version + 1,
      status: 'draft', subtotal, currency: previous.currency, createdBy: input.actor.id, items: { create: items },
    } });
    if (previous.status !== 'accepted') await tx.quote.update({ where: { id: previous.id }, data: { status: 'superseded' } });
    for (const item of items) if (item.inquiryItem?.connect?.id) await tx.inquiryItem.update({
      where: { id: item.inquiryItem.connect.id }, data: { unitPrice: item.unitPrice, lineTotal: item.lineTotal, pricingSource: 'catalog_repricing' },
    });
    await tx.inquiry.update({ where: { id: previous.inquiryId }, data: { subtotal, hasUnresolvedPricing: true, status: '待人工审核' } });
    await tx.quoteConfirmation.create({ data: {
      quoteId, userId: input.actor.id, email: input.actor.email, action: 'catalog_repricing_prepared',
      details: JSON.stringify({ approvalHash: input.approvalHash, previousQuoteId, pendingOrderIds: proposals.map((proposal) => proposal.orderId),
        ...(input.operationKey ? { kind: 'pricing_refresh', operationKey: input.operationKey } : {}) }),
    } });
    for (const proposal of proposals) await tx.orderEvent.create({ data: { orderId: proposal.orderId,
      type: 'catalog_repricing_required', actorId: input.actor.id, actorEmail: input.actor.email,
      message: '目录价格或适用折扣变化，已生成原订单价格复核，等待客户确认后继续审核',
      metadata: JSON.stringify({ ...proposal, quoteId, quoteVersion: created.version, approvalHash: input.approvalHash }),
    } });
    results.push({ previousQuoteId, quoteId, inquiryId: previous.inquiryId, version: created.version, subtotal, pendingOrderIds: proposals.map((proposal) => proposal.orderId) });
  }
  return results;
}

/** Recompute only the current draft in the original inquiry; no data approval, send or order acceptance. */
export async function refreshCatalogRepricingDraft(tx: Prisma.TransactionClient, input: {
  inquiryId: string; quoteId: string; quoteHash: string; actor: { id: string; email: string };
}) {
  const draft = await tx.quote.findFirst({ where: { inquiryId: input.inquiryId }, orderBy: { version: 'desc' }, include: {
    items: { orderBy: { position: 'asc' } }, inquiry: true, confirmations: { where: { action: 'catalog_repricing_prepared' } },
  } });
  if (!draft || draft.id !== input.quoteId || draft.status !== 'draft' || draft.confirmations.length !== 1
    || draft.inquiry.archivedAt || draft.inquiry.status === 'declined' || quoteContentHash(draft) !== input.quoteHash) throw new Error('REPRICING_VERSION_CHANGED');
  const approvalHash = jsonObject(draft.confirmations[0].details).approvalHash;
  if (typeof approvalHash !== 'string') throw new Error('REPRICING_VERSION_CHANGED');
  const changes: Change[] = draft.items.filter((line) => line.available).map((line) => {
    const productId = line.productId ?? jsonObject(line.pricingSnapshot).productId;
    const brand = jsonObject(line.metadata).brand;
    if (typeof productId !== 'string' || typeof line.catalogNumber !== 'string') throw new Error('CATALOG_REPRICING_REQUIRES_REVIEW');
    return { productId, catalogNumber: line.catalogNumber, ...(typeof brand === 'string' ? { brand } : {}) };
  });
  const pendingOrderIds = draft.items.map((line) => jsonObject(line.metadata).repricingOrderId).filter((id): id is string => typeof id === 'string');
  const result = await repriceQuotesAfterCatalogChange(tx, {
    impact: { quoteIds: [draft.id], pendingOrderIds: [...new Set(pendingOrderIds)], contents: [] },
    changes, approvalHash, actor: input.actor,
    operationKey: pricingContentHash({ kind: 'quote_pricing_refresh', quoteId: draft.id, quoteHash: input.quoteHash }),
  });
  return { quoteId: result[0]?.quoteId ?? draft.id, refreshed: result.length > 0, status: 'draft' };
}
