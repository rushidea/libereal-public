import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { evaluatePostDeliveryCredit } from '@/lib/customer-credit';
import { previewOrderInventoryReservation } from '@/lib/inventory';
import { normalizeCatalogNumber } from '@/lib/pricing-adjustment-rules';
import { merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { assertOrderPricingResolved, jsonObject, orderRepricingFingerprint } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { findPricingQuoteImpactTargets } from '@/lib/pricing-adjustment-impact';
import { catalogRecordPriceSelect, previewCatalogRecordPrice } from '@/lib/pricing-adjustment-service';
import { prisma } from '@/lib/prisma';
import { assertBusinessVersion, businessObjectId, invalidBusinessInput } from './business-route';
import { HarnessServiceError } from './inquiry-tools-service';

type IdContext = { pilotOrderIds: readonly string[] };
type Fields = Record<string, unknown>;

const PRICEABLE_QUOTE_STATUSES = new Set(['draft', 'sent', 'accepted', 'expired']);

function missingBusinessObject(): never {
  throw new HarnessServiceError(404, 'not_found', 'OBJECT_NOT_FOUND', '未找到指定的业务单据');
}

function approvalFacts(blockers: string[]) {
  return { allowed: blockers.length === 0, blockers, humanActionRequired: true };
}

async function readPricingContext(tx: Prisma.TransactionClient, inquiryId: string, orderIds: readonly string[]) {
  const inquiry = await tx.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true, status: true, archivedAt: true,
      quotes: { orderBy: { version: 'desc' }, take: 1, select: {
        id: true, version: true, status: true, currency: true, updatedAt: true,
        items: { orderBy: { position: 'asc' }, select: {
          id: true, productId: true, metadata: true, pricingSnapshot: true, catalogNumber: true, updatedAt: true,
          unitPrice: true, quantity: true, orderedQty: true,
        } },
      } },
    },
  });
  if (!inquiry) missingBusinessObject();
  const latest = inquiry.quotes[0];
  const quote = latest && {
    ...latest,
    items: latest.items.filter(item => {
      const orderId = jsonObject(item.metadata).repricingOrderId;
      return !orderId || (typeof orderId === 'string' && orderIds.includes(orderId));
    }),
  };
  const productIds = [...new Set(quote?.items.flatMap(item => item.productId ? [item.productId] : []) ?? [])];
  const products = productIds.length ? await tx.product.findMany({
    where: { id: { in: productIds }, deletedAt: null }, select: catalogRecordPriceSelect,
  }) : [];
  const productsById = new Map(products.map(row => [row.id, row]));
  const selectedOrders = orderIds.length ? await tx.order.findMany({
    where: { inquiryId, id: { in: [...orderIds] }, archivedAt: null }, orderBy: { id: 'asc' },
    select: {
      id: true, status: true, updatedAt: true,
      orderItems: { orderBy: { id: 'asc' }, select: { id: true, productId: true, catalogNumber: true, metadata: true } },
    },
  }) : [];
  const lines = (quote?.items ?? []).map(item => {
    const variantId = jsonObject(item.metadata).variantId ?? jsonObject(item.pricingSnapshot).variantId ?? null;
    const product = item.productId ? productsById.get(item.productId) : undefined;
    const record = variantId === null ? product : product?.variants.find(variant => variant.id === variantId);
    const catalogMatches = Boolean(record && item.catalogNumber && normalizeCatalogNumber(record.catalogNumber) === normalizeCatalogNumber(item.catalogNumber));
    return { item, target: catalogMatches && product && record ? {
      product, record, variantId: typeof variantId === 'string' ? variantId : null,
    } : null };
  });
  const objectVersion = pricingContentHash({
    inquiryId, status: inquiry.status, archivedAt: inquiry.archivedAt, quote, selectedOrders,
    catalog: lines.map(({ item, target }) => ({
      quoteItemId: item.id, productId: target?.product.id, variantId: target?.variantId,
      catalogNumber: target?.record.catalogNumber, brand: target?.product.brand,
      pricingMode: target?.product.pricingMode, price: target?.record.price, floor: target?.record.minimumSalePrice,
    })),
  });
  const data = {
    inquiryId, status: inquiry.status, archived: Boolean(inquiry.archivedAt),
    quote: quote ? { id: quote.id, version: quote.version, status: quote.status, currency: quote.currency } : null,
    lines: lines.map(({ item, target }) => ({
      quoteItemId: item.id, catalogNumber: item.catalogNumber, quantity: item.quantity,
      orderedQuantity: item.orderedQty, quoteUnitPrice: item.unitPrice, currentCatalogPrice: target?.record.price ?? null,
    })),
  };
  return { objectVersion, data, lines, quote };
}

export function getPricingContextForHarness(inquiryId: string, { pilotOrderIds }: IdContext) {
  return prisma.$transaction(async tx => {
    const { objectVersion, data } = await readPricingContext(tx, inquiryId, pilotOrderIds);
    return { objectVersion, data };
  });
}

export function previewPricingImpactForHarness(inquiryId: string, { pilotOrderIds }: IdContext, input: Fields, expectedVersion: string) {
  const quoteItemId = businessObjectId(input.quoteItemId);
  const { newPrice } = input;
  if (typeof newPrice !== 'number' || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 1_000_000_000) invalidBusinessInput();
  return prisma.$transaction(async tx => {
    const context = await readPricingContext(tx, inquiryId, pilotOrderIds);
    assertBusinessVersion(context.objectVersion, expectedVersion);
    const found = context.lines.find(({ item }) => item.id === quoteItemId);
    if (!found) missingBusinessObject();
    const target = found.target;
    const blockers = [];
    if (context.data.archived || context.data.status === 'declined' || !context.quote || !PRICEABLE_QUOTE_STATUSES.has(context.quote.status)) {
      blockers.push('QUOTE_NOT_PRICEABLE');
    }
    if (!target) blockers.push('CATALOG_RECORD_NOT_RESOLVED');
    const price = blockers.length === 0 && target
      ? previewCatalogRecordPrice(target.product, target.variantId, newPrice)
      : null;
    const impact = price?.changed && target ? await findPricingQuoteImpactTargets([{
      productId: target.product.id, catalogNumber: target.record.catalogNumber, brand: target.product.brand,
    }], tx, { inquiryId, orderIds: pilotOrderIds }) : { quoteIds: [], pendingOrderIds: [] };
    return { objectVersion: context.objectVersion, data: {
      ...approvalFacts(blockers), inquiryId, quoteItemId, newPrice, price,
      affectedQuoteCount: impact.quoteIds.length, affectedPendingOrderCount: impact.pendingOrderIds.length,
      confirmedOrdersRepriced: false,
    } };
  });
}

async function readOrderContext(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: ORDER_APPROVAL_INCLUDE });
  if (!order) missingBusinessObject();
  const paymentMethod = normalizeOrderPaymentMethod(order.paymentMethod);
  const onCredit = isPostDeliveryPaymentMethod(order.paymentMethod);
  const credit = order.status === 'pending' && onCredit && !order.archivedAt ? await evaluatePostDeliveryCredit(tx, {
    userId: order.customerId, email: order.email, paymentMethod: order.paymentMethod, total: order.total,
  }) : null;
  const pending = order.status === 'pending' && !order.archivedAt;
  const preview = pending ? await merchantOrderApprovalPreview(tx, order, credit ?? undefined) : null;
  const blockers: string[] = [];
  if (!pending) blockers.push('ORDER_NOT_PENDING');
  if (!onCredit && paymentMethod !== 'alipay') blockers.push('PAYMENT_METHOD_REQUIRED');
  if (paymentMethod === 'alipay' && !order.paidAt) blockers.push('ALIPAY_PAYMENT_REQUIRED');
  if (onCredit && pending && !order.receivable) {
    if (!credit?.applicable) blockers.push('CREDIT_USER_NOT_FOUND');
    else {
      if (credit.suspended) blockers.push('CREDIT_ACCOUNT_SUSPENDED');
      if (credit.exceedsLimit) blockers.push('CREDIT_LIMIT_EXCEEDED');
    }
  }
  const stock = pending ? await previewOrderInventoryReservation(tx, order.orderItems) : null;
  if (stock?.some(line => line.available >= 0 && line.available < line.quantity)) {
    blockers.push('INSUFFICIENT_AVAILABLE_INVENTORY');
  }
  if (pending) {
    try {
      await assertOrderPricingResolved(tx, orderId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'QUOTE_REPRICE_REQUIRED') throw error;
      blockers.push('QUOTE_REPRICE_REQUIRED');
    }
  }
  const data = {
    orderId, status: order.status, archived: Boolean(order.archivedAt), total: order.total,
    paymentMethod, paid: Boolean(order.paidAt), receivablePosted: Boolean(order.receivable),
    credit: {
      applicable: onCredit,
      needsReview: blockers.some(code => code.startsWith('CREDIT_')),
      shortfall: credit?.applicable && !order.receivable ? credit.shortfall : null,
    },
    ...approvalFacts(blockers),
  };
  const objectVersion = pricingContentHash({
    data, stock, fingerprint: orderRepricingFingerprint(order), updatedAt: order.updatedAt, merchantPreview: preview?.version,
  });
  return { objectVersion, data };
}

export function getOrderContextForHarness(orderId: string) {
  return prisma.$transaction(tx => readOrderContext(tx, orderId));
}

export function previewMerchantApprovalForHarness(orderId: string, _context: IdContext, _input: Fields, expectedVersion: string) {
  return prisma.$transaction(async tx => {
    const result = await readOrderContext(tx, orderId);
    assertBusinessVersion(result.objectVersion, expectedVersion);
    return result;
  });
}
