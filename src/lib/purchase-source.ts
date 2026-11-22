import type { Prisma } from '@prisma/client';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { ORDER_APPROVAL_TERMS_INCLUDE } from '@/lib/order-approval';
import { orderItemView } from '@/lib/commerce-records';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { validateSupplierQuoteReply } from '@/lib/supplier-quote-review';

type Db = Prisma.TransactionClient;
const include = {
  ...ORDER_APPROVAL_TERMS_INCLUDE, receivable: true, creditTransactions: true,
  paymentAttempts: true, statusHistory: { where: { toStatus: 'confirmed' } },
} satisfies Prisma.OrderInclude;
export type SourceOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
type Item = SourceOrder['orderItems'][number];
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function loadPurchaseOrderSource(tx: Db, id: string) {
  const order = await tx.order.findUnique({ where: { id }, include });
  if (!order) throw new Error('未找到原客户订单');
  return order;
}

async function acceptedQuoteLinks(tx: Db, order: SourceOrder) {
  if (!order.inquiryId) return [];
  const matches = (await tx.quoteConfirmation.findMany({ where: { action: { in: ['accept','partial_accept'] },
    quote: { inquiryId: order.inquiryId } }, include: { quote: { include: { items: true } } } }))
    .filter(row => jsonObject(row.details).orderId === order.id);
  if (matches.length !== 1) return [];
  const record = matches[0], links = jsonObject(record.details).items;
  if (!Array.isArray(links) || links.length !== order.orderItems.length) return [];
  return links.map(link => ({ quantity: link?.orderedQuantity ?? link?.quantity,
    source: record.quote.items.find(line => line.id === link?.quoteItemId) }));
}

async function writtenQuote(tx: Db, order: SourceOrder, item: Item, links: Awaited<ReturnType<typeof acceptedQuoteLinks>>) {
  const snap = jsonObject(item.pricingSnapshot);
  const link = links[item.position];
  const quoted = link?.source;
  if (!quoted || link.quantity !== item.quantity || quoted.productId !== item.productId
    || quoted.inquiryItemId !== snap.inquiryItemId || !item.productId || order.inquiryId !== snap.inquiryId
    || snap.productId !== item.productId || !quoted.catalogNumber || snap.catalogNumber !== quoted.catalogNumber
    || (item.catalogNumber !== null && quoted.catalogNumber !== item.catalogNumber) || typeof snap.supplierQuoteReviewId !== 'string') return null;
  // A later accepted repricing may have replaced the original quote line. Only an applied proposal can authorize this mapping.
  if (jsonObject(quoted.pricingSnapshot).supplierQuoteReplyHash !== snap.supplierQuoteReplyHash) {
    const applied = await tx.orderEvent.findMany({ where: { orderId: order.id, type: 'catalog_repricing_resolved' } });
    let matched = false;
    for (const event of applied) {
      const meta = jsonObject(event.metadata);
      if (meta.orderId !== order.id || meta.inquiryId !== order.inquiryId || meta.stage !== 'applied' || typeof meta.quoteId !== 'string') continue;
      const row = await tx.quoteItem.findMany({ where: { quoteId: meta.quoteId, productId: item.productId,
        inquiryItemId: quoted.inquiryItemId, quantity: item.quantity, pricingSnapshot: item.pricingSnapshot } });
      if (row.some(r => jsonObject(r.metadata).repricingOrderItemId === item.id)) matched = true;
    }
    if (!matched) return null;
  }
  const task = await tx.backgroundTask.findUnique({ where: { id: snap.supplierQuoteReviewId } });
  if (!task || task.type !== 'inquiry.supplier_written_quote' || task.status !== 'succeeded') return null;
  const req = jsonObject(task.payload), res = jsonObject(task.result), scope = object(req.scope);
  if (scope.inquiryId !== order.inquiryId || scope.inquiryItemId !== quoted.inquiryItemId || scope.productId !== item.productId
    || (scope.variantId ?? null) !== (snap.variantId ?? null) || scope.catalogNumber !== snap.catalogNumber
    || scope.quantity !== item.quantity || scope.customerEmail !== order.email || (scope.userId && scope.userId !== order.customerId)
    || req.sourceHash !== pricingContentHash(scope) || typeof req.requestHash !== 'string' || req.requestHash !== res.requestHash
    || task.dedupeKey !== `supplier-written-quote:${req.requestHash}` || !res.confirmedBy || !res.confirmedAt) return null;
  try {
    const confirmedAt = new Date(String(res.confirmedAt));
    if (confirmedAt.getTime() > Date.now()) return null;
    const reply = validateSupplierQuoteReply(res.reply, confirmedAt);
    if (snap.supplierQuoteValidUntil !== reply.validUntil || res.replyHash !== snap.supplierQuoteReplyHash
      || pricingContentHash({ requestHash: req.requestHash, reply }) !== res.replyHash) return null;
    return { reviewId: task.id, replyHash: String(res.replyHash), supplier: reply.supplier,
      unitPriceCents: Math.round(reply.supplierUnitPrice * 100), currency: reply.currency, taxBasis: reply.taxBasis,
      leadTime: reply.leadTime, conditions: reply.conditions, validUntil: reply.validUntil,
      channel: reply.channel, reference: reply.reference, confirmedBy: String(res.confirmedBy),
      brand: typeof scope.brand === 'string' ? scope.brand : null, specification: typeof scope.specification === 'string' ? scope.specification : null };
  } catch { return null; }
}

export async function loadPurchaseLines(tx: Db, order: SourceOrder) {
  const links = await acceptedQuoteLinks(tx, order);
  return Promise.all(order.orderItems.map(async item => {
    const view = orderItemView(item);
    const written = await writtenQuote(tx, order, item, links);
    const quoted = written ? links[item.position]?.source : null;
    return { orderItemId: item.id, productId: item.productId, variantId: view.variantId, position: item.position,
      brand: item.brand ?? written?.brand ?? null, catalogNumber: item.catalogNumber ?? quoted?.catalogNumber ?? null,
      name: item.name, spec: view.spec ?? written?.specification ?? null,
      unit: view.unit, quantity: item.quantity, customerLeadTime: item.leadTime,
      customerConditions: view.customerSupplyConditions, written };
  }));
}
export type PurchaseSource = Awaited<ReturnType<typeof loadPurchaseLines>>[number];
