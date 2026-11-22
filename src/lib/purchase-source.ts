import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { creditLimitForAccount } from '@/lib/customer-credit';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { ORDER_APPROVAL_TERMS_INCLUDE, orderApprovalTerms } from '@/lib/order-approval';
import { orderItemView } from '@/lib/commerce-records';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { validateSupplierQuoteReply } from '@/lib/supplier-quote-review';

type Db = Prisma.TransactionClient;
const include = {
  ...ORDER_APPROVAL_TERMS_INCLUDE, receivable: true, creditTransactions: true,
  paymentAttempts: true, statusHistory: { where: { toStatus: 'confirmed' } },
} satisfies Prisma.OrderInclude;
type SourceOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
type Item = SourceOrder['orderItems'][number];
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function loadPurchaseOrderSource(tx: Db, id: string) {
  const order = await tx.order.findUnique({ where: { id }, include });
  if (!order) throw new Error('未找到原客户订单');
  return order;
}

async function acceptance(tx: Db, order: SourceOrder) {
  const confirmations = order.statusHistory.filter(entry => entry.fromStatus === 'pending' && entry.actorId);
  if (confirmations.length !== 1) return null;
  const history = confirmations[0];
  const meta = jsonObject(history.metadata);
  if (meta.action === 'accept_order' && meta.actorType === 'libereal_admin' && meta.version === 2
    && typeof meta.orderVersion === 'string' && /^[a-f0-9]{64}$/.test(meta.orderVersion)) {
    const terms = orderApprovalTerms(order);
    const snapshot = object(meta.snapshot);
    // Reserving credit can resolve an email-only customer's id inside the acceptance transaction.
    const debtor = object(snapshot.credit).debtorId;
    const expected = { ...terms, customerId: snapshot.customerId === null && debtor === order.customerId ? null : terms.customerId };
    const recorded = Object.fromEntries(Object.keys(expected).map(key => [key, snapshot[key]]));
    return pricingContentHash(recorded) === pricingContentHash(expected) ? history : null;
  }
  // Older personal credit orders have independent records written by the merchant quote route.
  if (history.metadata || order.ownerScope !== 'personal' || history.reason !== 'quote_sent'
    || !order.quoteSent || history.createdAt.getTime() !== order.quoteSentAt?.getTime()
    || !isPostDeliveryPaymentMethod(order.paymentMethod) || !history.actorId || history.actorId === order.customerId) return null;
  const actor = await tx.user.findUnique({ where: { id: history.actorId }, select: { email: true, role: true } });
  const mail = await tx.backgroundTask.findUnique({ where: { dedupeKey: `order-confirmation-email:${order.id}` } });
  const payload = jsonObject(mail?.payload);
  return actor?.role === 'admin' && (!history.actorEmail || actor.email === history.actorEmail) && mail?.type === 'email.send'
    && payload.kind === 'quote' && payload.subject === 'LIBEREAL · 订单确认' && payload.to === order.email
    && order.creditTransactions.some(row => row.type === 'reserve' && row.actorId === history.actorId
      && row.userId === order.customerId && row.amount === order.total) ? history : null;
}

export async function purchaseEligibility(tx: Db, order: SourceOrder) {
  const hold = (reason: string) => ({ eligible: false, reason, basis: null });
  if (order.archivedAt || !['confirmed', 'partially_shipped', 'shipped', 'completed'].includes(order.status)) return hold('原客户订单尚未由 Libereal 接受，或已关闭');
  const history = await acceptance(tx, order);
  if (!history) return hold('平台接单依据或已接受的订单内容需要人工核对');
  if (isPostDeliveryPaymentMethod(order.paymentMethod)) {
    const ar = order.receivable;
    const reserves = order.creditTransactions.filter(row => row.type === 'reserve' && row.userId === order.customerId);
    if (!order.customerId || !ar || ar.userId !== order.customerId || ar.amount !== order.total
      || !['open','paid'].includes(ar.status) || reserves.length !== 1 || reserves[0].amount !== order.total
      || order.creditTransactions.some(row => row.type === 'release' && ar.status !== 'paid')) return hold('需核实本单应收、授信占用及结清状态');
    if (ar.status === 'open') {
      const account = await tx.creditAccount.findUnique({ where: { userId: ar.userId } });
      if (!account || !['active','credit_limited'].includes(account.status) || account.usedAmount > creditLimitForAccount(account)
        || account.usedAmount < ar.amount) return hold('本单授信条件需由有权人员处理');
    }
    return { eligible: true, reason: null, basis: { acceptanceId: history.id, receivableId: ar.id, reserveId: reserves[0].id, amount: ar.amount } };
  }
  if (normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay' && order.paidAt) {
    const attempts = order.paymentAttempts.filter(row => row.provider === 'alipay' && row.status === 'paid'
      && row.paidAt && row.tradeNo && row.amount === order.total);
    if (attempts.length === 1) {
      const attempt = attempts[0];
      const receipts = await tx.orderEvent.findMany({ where: { orderId: order.id, type: 'payment_received' } });
      if (receipts.some(row => { const meta = jsonObject(row.metadata); return meta.outTradeNo === attempt.outTradeNo && meta.tradeNo === attempt.tradeNo; })) {
        return { eligible: true, reason: null, basis: { acceptanceId: history.id, paymentAttemptId: attempt.id, amount: attempt.amount } };
      }
    }
  }
  return hold('需核实本单约定的付款条件与实际收款记录');
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
