import type { Prisma } from '@prisma/client';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { requiresWrittenSupplierQuote } from '@/lib/supplier-quote-policy';
import { calculatePrice } from '@/lib/price-engine';
import { explicitBrandDiscount } from '@/lib/discount-brand-catalog';
import { CONFIRMED_TIER_DISCOUNT_RATES } from '@/lib/discount';
import { quoteContentHash } from '@/lib/quote-records';

type Db = Prisma.TransactionClient;
type Actor = { id: string; email: string };
const TASK_TYPE = 'inquiry.supplier_written_quote';
function object(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
function fail(code: string): never { throw new Error(code); }
function references(metadata: Record<string, unknown>, key: string): Record<string, string> {
  const value = metadata[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {};
}

/** The source is rebuilt from records; client-supplied role, price and scope claims are not authority. */
export async function loadSupplierQuoteScope(db: Db, inquiryId: string, inquiryItemId: string, quantity?: number, requireExistingQuantity = false) {
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId }, select: {
    id: true, userId: true, email: true, status: true, archivedAt: true,
    inquiryItems: { where: { id: inquiryItemId } },
  } });
  if (!inquiry || inquiry.archivedAt || inquiry.status === 'declined') fail('SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE');
  if (inquiry.status === 'closed' && !await db.order.findFirst({ where: {
    inquiryId, archivedAt: null, status: { in: ['pending', 'unpaid'] },
  }, select: { id: true } })) fail('SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE');
  const item = inquiry.inquiryItems[0];
  if (!item) fail('SUPPLIER_QUOTE_ITEM_NOT_ACTIVE');
  const requestedQuantity = quantity ?? item.quantity;
  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) fail('SUPPLIER_QUOTE_QUANTITY_INVALID');
  // A partial quote/order is a distinct quantity approval. Only quantities in the original
  // inquiry or its current quote are eligible; a caller cannot invent an approval scope.
  if (requireExistingQuantity && requestedQuantity !== item.quantity) {
    const latest = await db.quote.findFirst({ where: { inquiryId }, orderBy: { version: 'desc' }, include: { items: true } });
    if (!latest || !['draft', 'sent'].includes(latest.status) || !latest.items.some(line =>
      line.inquiryItemId === item.id && line.quantity - line.orderedQty === requestedQuantity)) fail('SUPPLIER_QUOTE_QUANTITY_INVALID');
  }
  const metadata = object(item.metadata);
  const products = await db.product.findMany({ where: {
    deletedAt: null,
    ...(item.productId ? { id: item.productId } : { catalogNumber: item.catalogNumber ?? '',
      ...(typeof metadata.brand === 'string' ? { brand: metadata.brand } : {}) }),
  }, take: 2, select: { id: true, name: true, catalogNumber: true, brand: true, subBrand: true,
    brandRecordId: true, originalPrice: true, pricingMode: true } });
  if (products.length !== 1) fail('SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED');
  const product = products[0];
  if (typeof metadata.brand === 'string' && metadata.brand !== product.brand) fail('SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED');
  const variantId = typeof metadata.variantId === 'string' ? metadata.variantId : null;
  const variant = variantId ? await db.productVariant.findUnique({ where: { id: variantId },
    select: { id: true, productId: true, catalogNumber: true, originalPrice: true, spec: true } }) : null;
  if (variantId && (!variant || variant.productId !== product.id)) fail('SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED');
  if (item.catalogNumber && item.catalogNumber !== (variant?.catalogNumber ?? product.catalogNumber)) fail('SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED');
  const brand = await db.brand.findUnique({ where: product.brandRecordId ? { id: product.brandRecordId } : { name: product.brand },
    select: { id: true, name: true, isActive: true, defaultDiscountRate: true, supplierQuoteRequiredAbove: true } });
  if (!brand?.isActive) fail('BRAND_NOT_ACTIVE');
  if (brand.supplierQuoteRequiredAbove == null) fail('SUPPLIER_QUOTE_NOT_REQUIRED');
  const cataloguePrice = variant ? variant.originalPrice : product.originalPrice;
  if (cataloguePrice == null || !Number.isFinite(cataloguePrice) || cataloguePrice <= 0) fail('BRAND_CATALOG_PRICE_REQUIRED');
  if (!requiresWrittenSupplierQuote(cataloguePrice, brand.supplierQuoteRequiredAbove)) fail('SUPPLIER_QUOTE_NOT_REQUIRED');
  const customer = await db.user.findFirst({ where: inquiry.userId ? { id: inquiry.userId } : { email: inquiry.email },
    select: { id: true, email: true, tier: true, discountRate: true, brandDiscounts: true, isFrozen: true } });
  const eligible = customer && !customer.isFrozen;
  const customerPricing = calculatePrice({ discountPolicy: 'brand_priority', basePrice: cataloguePrice,
    brandDefaultDiscountRate: brand.defaultDiscountRate, tier: eligible ? customer.tier : undefined,
    personalDiscountRate: eligible ? customer.discountRate : null,
    brandDiscountRate: eligible ? explicitBrandDiscount(customer.brandDiscounts, product.brand, product.subBrand, true) : null,
  });
  const scope = { version: 2, customerPricing, customerPricingSource: { customer, tiers: CONFIRMED_TIER_DISCOUNT_RATES }, inquiryId, inquiryItemId, userId: inquiry.userId, customerEmail: inquiry.email,
    productId: product.id, variantId, catalogNumber: variant?.catalogNumber ?? product.catalogNumber,
    name: product.name, brand: product.brand, subBrand: product.subBrand, specification: variant?.spec ?? null,
    inquiryQuantity: item.quantity, quantity: requestedQuantity, cataloguePrice, currency: 'CNY', brandPolicy: brand };
  if (!Number.isInteger(scope.quantity) || scope.quantity <= 0) fail('SUPPLIER_QUOTE_QUANTITY_INVALID');
  return { scope, requestHash: pricingContentHash(scope), item };
}

export async function prepareSupplierQuoteReview(db: Db, input: {
  inquiryId: string; inquiryItemId: string; quantity?: number; actor: Actor; renewalReason?: string;
  quantityChange?: { quoteId: string; quoteHash: string; fromQuantity: number; channel: string; reference: string };
}) {
  if (input.quantityChange) {
    const change = input.quantityChange;
    const latest = await db.quote.findFirst({ where: { inquiryId: input.inquiryId }, orderBy: { version: 'desc' },
      include: { items: { orderBy: { position: 'asc' } } } });
    const lines = latest?.items.filter(line => line.inquiryItemId === input.inquiryItemId
      && !object(line.metadata).repricingOrderId && line.quantity > line.orderedQty) ?? [];
    if (!latest || !['draft', 'sent'].includes(latest.status) || latest.id !== change.quoteId
      || quoteContentHash(latest) !== change.quoteHash || lines.length !== 1
      || lines[0].quantity - lines[0].orderedQty !== change.fromQuantity
      || input.quantity === change.fromQuantity || !change.channel?.trim() || !change.reference?.trim()
      || change.channel.length > 200 || change.reference.length > 2000) fail('SUPPLIER_QUOTE_QUANTITY_CHANGE_INVALID');
  }
  const current = await loadSupplierQuoteScope(db, input.inquiryId, input.inquiryItemId, input.quantity, !input.quantityChange);
  const metadata = object(current.item.metadata);
  const requests = references(metadata, 'supplierQuoteRequests');
  const currentId = requests[String(current.scope.quantity)];
  const previous = typeof currentId === 'string' ? await db.backgroundTask.findUnique({ where: { id: currentId } }) : null;
  const previousPayload = object(previous?.payload);
  const previousReply = object(previous?.result).reply as { validUntil?: string } | undefined;
  const expired = previous?.status === 'succeeded' && typeof previousReply?.validUntil === 'string'
    && new Date(previousReply.validUntil) <= new Date();
  if (previous?.type === TASK_TYPE && previousPayload.sourceHash === current.requestHash && !input.renewalReason && !input.quantityChange && !expired) {
    return { reviewId: previous.id, requestHash: previousPayload.requestHash as string, status: previous.status, scope: current.scope };
  }
  const requestHash = pricingContentHash({ sourceHash: current.requestHash, previousReviewId: previous?.id ?? null,
    renewalReason: input.renewalReason?.trim() || (expired ? '前次供应商报价已失效' : null), quantityChange: input.quantityChange ?? null });
  const dedupeKey = `supplier-written-quote:${requestHash}`;
  const prior = await db.backgroundTask.findUnique({ where: { dedupeKey } });
  if (prior) return { reviewId: prior.id, requestHash, status: prior.status, scope: current.scope };
  const task = await db.backgroundTask.create({ data: { type: TASK_TYPE, status: 'awaiting_human', dedupeKey,
    payload: JSON.stringify({ requestHash, sourceHash: current.requestHash, scope: current.scope, previousReviewId: previous?.id ?? null,
      renewalReason: input.renewalReason?.trim() || (expired ? '前次供应商报价已失效' : null),
      quantityChange: input.quantityChange ?? null, ownerId: input.actor.id, ownerEmail: input.actor.email, requestedAt: new Date().toISOString(),
      action: '人工发函询价；回填供应商书面回复并确认本次客户报价，系统核对后接续原询价',
      outboundSent: false }), maxAttempts: 1 } });
  await db.inquiryItem.update({ where: { id: current.item.id }, data: {
    metadata: JSON.stringify({ ...metadata, supplierQuoteRequests: { ...requests, [String(current.scope.quantity)]: task.id } }),
  } });
  await db.inquiry.update({ where: { id: input.inquiryId }, data: { status: '待人工审核', hasUnresolvedPricing: true } });
  return { reviewId: task.id, requestHash, status: task.status, scope: current.scope };
}

export type SupplierQuoteReply = {
  supplier: string; channel: string; reference: string; supplierUnitPrice: number;
  customerUnitPrice: number; currency: 'CNY'; taxBasis: 'included' | 'excluded';
  leadTime: string; validUntil: string; conditions: string; customerConditions: string;
};
export function validateSupplierQuoteReply(value: unknown): SupplierQuoteReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SUPPLIER_QUOTE_REPLY_INVALID');
  const raw = value as Record<string, unknown>;
  const reply = Object.fromEntries(['supplier', 'channel', 'reference', 'leadTime', 'conditions', 'customerConditions', 'validUntil']
    .map(key => [key, typeof raw[key] === 'string' ? raw[key].trim() : ''])) as Pick<SupplierQuoteReply, 'supplier' | 'channel' | 'reference' | 'leadTime' | 'conditions' | 'customerConditions' | 'validUntil'>;
  if (Object.values(reply).some(entry => !entry || entry.length > 2000)
    || raw.currency !== 'CNY' || !['included', 'excluded'].includes(String(raw.taxBasis))) fail('SUPPLIER_QUOTE_REPLY_INVALID');
  for (const key of ['supplierUnitPrice', 'customerUnitPrice']) {
    const amount = raw[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000
      || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) fail('SUPPLIER_QUOTE_REPLY_INVALID');
  }
  const validUntil = new Date(reply.validUntil);
  if (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date()) fail('SUPPLIER_QUOTE_REPLY_EXPIRED');
  return { ...reply, validUntil: validUntil.toISOString(), currency: 'CNY', taxBasis: raw.taxBasis as SupplierQuoteReply['taxBasis'],
    supplierUnitPrice: raw.supplierUnitPrice as number, customerUnitPrice: raw.customerUnitPrice as number };
}

/** Called only after the route has verified the real admin and this exact human-confirmed reply. */
export async function recordSupplierQuoteReply(db: Db, input: {
  reviewId: string; inquiryId: string; requestHash: string; reply: unknown; actor: Actor;
}) {
  const task = await db.backgroundTask.findUnique({ where: { id: input.reviewId } });
  if (!task || task.type !== TASK_TYPE) fail('SUPPLIER_QUOTE_REVIEW_NOT_FOUND');
  const request = object(task.payload);
  const original = request.scope as { inquiryId?: string; inquiryItemId?: string; quantity?: number } | undefined;
  if (original?.inquiryId !== input.inquiryId || typeof original.inquiryItemId !== 'string'
    || request.requestHash !== input.requestHash) fail('SUPPLIER_QUOTE_REVIEW_CHANGED');
  const current = await loadSupplierQuoteScope(db, input.inquiryId, original.inquiryItemId, original.quantity, true);
  const currentMetadata = object(current.item.metadata);
  if (current.requestHash !== request.sourceHash || references(currentMetadata, 'supplierQuoteRequests')[String(current.scope.quantity)] !== task.id) fail('SUPPLIER_QUOTE_REVIEW_CHANGED');
  const reply = validateSupplierQuoteReply(input.reply);
  if (reply.customerUnitPrice !== current.scope.customerPricing.finalPrice) fail('SUPPLIER_QUOTE_CUSTOMER_PRICE_CHANGED');
  const replyHash = pricingContentHash({ requestHash: input.requestHash, reply });
  if (task.status === 'succeeded') {
    const previous = object(task.result);
    if (previous.replyHash !== replyHash) fail('SUPPLIER_QUOTE_ALREADY_RECORDED');
    return { reviewId: task.id, replyHash, inquiryItemId: original.inquiryItemId, recorded: false };
  }
  if (task.status !== 'awaiting_human') fail('SUPPLIER_QUOTE_REVIEW_CHANGED');
  const changed = await db.backgroundTask.updateMany({ where: { id: task.id, type: TASK_TYPE, status: 'awaiting_human', payload: task.payload },
    data: { status: 'succeeded', completedAt: new Date(), result: JSON.stringify({ requestHash: input.requestHash,
      replyHash, reply, confirmedBy: input.actor.id, confirmedByEmail: input.actor.email, confirmedAt: new Date().toISOString(),
      meaning: 'Supplier reply checked; customer price follows the current approved discount priority. No purchase, payment or customer send.' }) } });
  if (changed.count !== 1) fail('SUPPLIER_QUOTE_REVIEW_CHANGED');
  await db.inquiryItem.update({ where: { id: current.item.id }, data: {
    ...(current.scope.quantity === current.item.quantity ? { productId: current.scope.productId, unitPrice: reply.customerUnitPrice,
      lineTotal: Math.round(reply.customerUnitPrice * current.scope.quantity * 100) / 100,
      leadTime: reply.leadTime, pricingSource: 'supplier_written_reply' } : {}),
    metadata: JSON.stringify({ ...currentMetadata, supplierQuoteReviews: {
      ...references(currentMetadata, 'supplierQuoteReviews'), [String(current.scope.quantity)]: task.id,
    } }),
  } });
  const remaining = await db.inquiryItem.count({ where: { inquiryId: input.inquiryId,
    OR: [{ unitPrice: null }, { unitPrice: { lte: 0 } }] } });
  await db.inquiry.update({ where: { id: input.inquiryId }, data: {
    hasUnresolvedPricing: remaining > 0, status: '待人工审核',
  } });
  return { reviewId: task.id, replyHash, inquiryItemId: original.inquiryItemId, recorded: true };
}

export async function supplierQuoteReviewView(db: Db, inquiryId: string) {
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId }, select: {
    id: true, inquiryItems: { orderBy: { position: 'asc' }, select: { id: true, name: true, quantity: true, metadata: true } },
  } });
  if (!inquiry) fail('SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE');
  const latest = await db.quote.findFirst({ where: { inquiryId }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
  const entries = [];
  for (const item of inquiry.inquiryItems) {
    const quoteQuantities = latest && ['draft', 'sent'].includes(latest.status)
      ? latest.items.filter(line => line.inquiryItemId === item.id && line.quantity > line.orderedQty).map(line => line.quantity - line.orderedQty) : [];
    const quantities = [...new Set(quoteQuantities.length ? quoteQuantities : [item.quantity])];
    for (const quantity of quantities) {
    try {
      const current = await loadSupplierQuoteScope(db, inquiryId, item.id, quantity);
      const reviewId = references(object(item.metadata), 'supplierQuoteRequests')[String(quantity)];
      const task = typeof reviewId === 'string' ? await db.backgroundTask.findUnique({ where: { id: reviewId } }) : null;
      const request = object(task?.payload); const result = object(task?.result);
      const currentRequest = task?.type === TASK_TYPE && request.sourceHash === current.requestHash;
      const reply = result.reply as SupplierQuoteReply | undefined;
      const expired = task?.status === 'succeeded' && (!reply?.validUntil || new Date(reply.validUntil) <= new Date());
      const changeable = latest && ['draft', 'sent'].includes(latest.status)
        && latest.items.filter(line => line.inquiryItemId === item.id && !object(line.metadata).repricingOrderId
          && line.quantity > line.orderedQty && line.quantity - line.orderedQty === quantity).length === 1;
      entries.push({ inquiryItemId: item.id, name: item.name,
        quantityChangeSource: changeable ? { quoteId: latest.id, quoteHash: quoteContentHash(latest) } : null,
        scope: { catalogNumber: current.scope.catalogNumber, brand: current.scope.brand,
          quantity: current.scope.quantity, cataloguePrice: current.scope.cataloguePrice, currency: current.scope.currency, customerPricing: current.scope.customerPricing },
        reviewId: task?.id ?? null, requestHash: currentRequest ? request.requestHash as string : null,
        status: currentRequest ? expired ? 'expired' : task!.status : task ? 'source_changed' : 'not_prepared',
        owner: typeof request.ownerEmail === 'string' ? request.ownerEmail : null,
        reply: currentRequest && task?.status === 'succeeded' ? result.reply as SupplierQuoteReply : null,
        continuation: currentRequest && task?.status === 'succeeded' ? result.continuation ?? null : null,
      });
    } catch (error) {
      if (error instanceof Error && ['SUPPLIER_QUOTE_NOT_REQUIRED', 'SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE'].includes(error.message)) continue;
      entries.push({ inquiryItemId: item.id, name: item.name, error: supplierQuoteErrorMessage(error) });
    }
    }
  }
  return entries;
}

export function supplierQuoteErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE: '原询价已归档、放弃或完成，请核对当前业务状态',
    SUPPLIER_QUOTE_ITEM_NOT_ACTIVE: '原询价商品行已变化，请刷新后核对',
    SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED: '商品或销售包装尚未准确对应，请先核对原询价商品',
    BRAND_CATALOG_PRICE_REQUIRED: '请先核对并确认该销售包装的目录价，再判断供应商询价条件',
    BRAND_NOT_ACTIVE: '品牌资料未启用，请先核对品牌资料',
    SUPPLIER_QUOTE_NOT_REQUIRED: '当前商品不符合已确认的金额门槛，无需创建这项供应商询价',
    SUPPLIER_QUOTE_QUANTITY_CHANGE_INVALID: '数量变更必须对应当前报价，并登记客户提出新数量的实际依据，请刷新核对',
    SUPPLIER_QUOTE_QUANTITY_INVALID: '原询价数量无效，请先核对数量',
    SUPPLIER_QUOTE_CUSTOMER_PRICE_CHANGED: '客户售价必须按当前目录价与既定折扣核算，请刷新后重新核对',
    SUPPLIER_QUOTE_REPLY_INVALID: '请完整填写供应商、联系渠道、回复依据、采购价、含税口径、货期、有效期及对客户的供货条件',
    SUPPLIER_QUOTE_REPLY_EXPIRED: '供应商报价有效期已过或无效，请重新询价取得有效回复',
    SUPPLIER_QUOTE_REVIEW_NOT_FOUND: '未找到原供应商询价记录，请先准备询价',
    SUPPLIER_QUOTE_REVIEW_CHANGED: '商品、数量、目录价或适用规则已变化，请重新准备询价并核对回复',
    SUPPLIER_QUOTE_ALREADY_RECORDED: '这版回复已经登记；如条件变化，请重新准备询价，保留原回复',
  };
  return messages[code] ?? '供应商询价处理未完成，请核对资料后重试';
}

export async function readApprovedSupplierQuote(db: Db, input: {
  inquiryId?: string; inquiryItemId?: string | null; productId: string; variantId?: string | null;
  quantity: number; userId?: string | null; customerEmail?: string | null;
}) {
  if (!input.inquiryId || !input.inquiryItemId) return null;
  const current = await loadSupplierQuoteScope(db, input.inquiryId, input.inquiryItemId, input.quantity);
  if (current.scope.productId !== input.productId || current.scope.variantId !== (input.variantId ?? null)
    || current.scope.quantity !== input.quantity
    || (input.userId ? current.scope.userId !== input.userId : current.scope.customerEmail !== input.customerEmail)) return null;
  const metadata = object(current.item.metadata);
  const reviewId = references(metadata, 'supplierQuoteReviews')[String(input.quantity)];
  if (typeof reviewId !== 'string' || references(metadata, 'supplierQuoteRequests')[String(input.quantity)] !== reviewId) return null;
  const task = await db.backgroundTask.findUnique({ where: { id: reviewId } });
  if (!task || task.type !== TASK_TYPE || task.status !== 'succeeded') return null;
  const request = object(task.payload); const result = object(task.result);
  if (request.sourceHash !== current.requestHash || result.requestHash !== request.requestHash || typeof result.confirmedBy !== 'string') return null;
  let reply: SupplierQuoteReply;
  try { reply = validateSupplierQuoteReply(result.reply); } catch { return null; }
  if (result.replyHash !== pricingContentHash({ requestHash: request.requestHash, reply })) return null;
  return { reviewId, requestHash: request.requestHash as string, replyHash: result.replyHash as string, reply };
}
