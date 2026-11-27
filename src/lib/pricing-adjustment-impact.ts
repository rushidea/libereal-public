import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type PricingQuoteImpact = {
  quoteIds: string[];
  pendingOrderIds: string[];
  contents: unknown[];
};

/** Only products mentioned by business records; a brand change need not load its entire catalogue. */
export async function brandDiscountImpactProducts(brandId: string, brand: string, db: Prisma.TransactionClient = prisma) {
  return db.$queryRaw<Array<{ productId: string; catalogNumber: string; brand: string }>>(Prisma.sql`
    WITH catalog AS (
      SELECT p.id AS productId, p.catalogNumber, p.brand FROM Product p
      WHERE p.deletedAt IS NULL AND (p.brandRecordId = ${brandId} OR (p.brandRecordId IS NULL AND p.brand = ${brand}))
      UNION ALL
      SELECT p.id AS productId, v.catalogNumber, p.brand FROM Product p JOIN ProductVariant v ON v.productId = p.id
      WHERE p.deletedAt IS NULL AND (p.brandRecordId = ${brandId} OR (p.brandRecordId IS NULL AND p.brand = ${brand}))
    )
    SELECT DISTINCT c.productId, c.catalogNumber, c.brand FROM catalog c
    WHERE EXISTS (SELECT 1 FROM QuoteItem qi WHERE qi.productId = c.productId
        OR (qi.productId IS NULL AND LOWER(TRIM(qi.catalogNumber)) = LOWER(TRIM(c.catalogNumber))))
      OR EXISTS (SELECT 1 FROM OrderItem oi WHERE oi.productId = c.productId
        OR (oi.productId IS NULL AND LOWER(TRIM(oi.catalogNumber)) = LOWER(TRIM(c.catalogNumber))))
    ORDER BY c.productId, c.catalogNumber
  `);
}

type ImpactChange = { productId: string; catalogNumber: string; brand?: string };
type ImpactScope = { inquiryId: string; orderIds: readonly string[] };

/** Potential repricing targets. This never changes quotes or locked order prices. */
export async function findPricingQuoteImpactTargets(
  changes: ImpactChange[],
  db: Prisma.TransactionClient,
  scope?: ImpactScope,
) {
  const allowedQuote = scope ? Prisma.sql`AND q.inquiryId = ${scope.inquiryId}` : Prisma.empty;
  const allowedQuoteLine = scope ? Prisma.sql`AND (
    json_extract(CASE WHEN json_valid(qi.metadata) THEN qi.metadata ELSE '{}' END, '$.repricingOrderId') IS NULL
    OR json_extract(CASE WHEN json_valid(qi.metadata) THEN qi.metadata ELSE '{}' END, '$.repricingOrderId')
      IN (SELECT value FROM json_each(${JSON.stringify(scope.orderIds)}))
  )` : Prisma.empty;
  const allowedOrder = !scope ? Prisma.empty : scope.orderIds.length
    ? Prisma.sql`AND o.inquiryId = ${scope.inquiryId} AND o.id IN (SELECT value FROM json_each(${JSON.stringify(scope.orderIds)}))`
    : Prisma.sql`AND 1 = 0`;
  const quoteIds = new Set<string>();
  const pendingOrderIds = new Set<string>();
  // Bound SQLite parameters even for large imported catalogues.
  for (let offset = 0; offset < changes.length; offset += 200) {
    const group = changes.slice(offset, offset + 200);
    const products = [...new Set(group.map((change) => change.productId))];
    const productBrands = new Map((await db.product.findMany({
      where: { id: { in: products } }, select: { id: true, brand: true },
    })).map((product) => [product.id, product.brand]));
    const quoteCatalogs = Prisma.join(group.map((change) => Prisma.sql`(
      LOWER(TRIM(qi.catalogNumber)) = ${change.catalogNumber.trim().toLowerCase()}
      AND json_extract(CASE WHEN json_valid(qi.metadata) THEN qi.metadata ELSE '{}' END, '$.brand')
        = ${change.brand ?? productBrands.get(change.productId) ?? ''}
    )`), ' OR ');
    const orderCatalogs = Prisma.join(group.map((change) => Prisma.sql`(
      LOWER(TRIM(oi.catalogNumber)) = ${change.catalogNumber.trim().toLowerCase()}
      AND json_extract(CASE WHEN json_valid(oi.metadata) THEN oi.metadata ELSE '{}' END, '$.brand')
        = ${change.brand ?? productBrands.get(change.productId) ?? ''}
    )`), ' OR ');
    const quotes = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT q.id FROM Quote q
      JOIN QuoteItem qi ON qi.quoteId = q.id
      JOIN Inquiry i ON i.id = q.inquiryId
      WHERE q.status IN ('draft', 'sent', 'accepted', 'expired') AND i.archivedAt IS NULL
        AND i.status != 'declined'
        ${allowedQuote}
        ${allowedQuoteLine}
        AND NOT EXISTS (SELECT 1 FROM Quote newer WHERE newer.inquiryId = q.inquiryId AND newer.version > q.version)
        AND (qi.quantity > qi.orderedQty OR EXISTS (
          SELECT 1 FROM "Order" o JOIN OrderItem oi ON oi.orderId = o.id
          WHERE o.inquiryId = q.inquiryId AND o.status IN ('pending', 'unpaid')
            AND o.archivedAt IS NULL
            ${allowedOrder}
            AND (oi.productId = qi.productId OR (oi.productId IS NULL
              AND LOWER(TRIM(oi.catalogNumber)) = LOWER(TRIM(qi.catalogNumber))))
        ))
        AND (qi.productId IN (${Prisma.join(products)})
          OR (qi.productId IS NULL AND (${quoteCatalogs})))
    `);
    const orders = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT o.id FROM "Order" o
      JOIN OrderItem oi ON oi.orderId = o.id
      WHERE o.status IN ('pending', 'unpaid') AND o.archivedAt IS NULL AND o.inquiryId IS NOT NULL
        ${allowedOrder}
        AND EXISTS (SELECT 1 FROM Inquiry i WHERE i.id = o.inquiryId AND i.archivedAt IS NULL AND i.status != 'declined')
        AND (oi.productId IN (${Prisma.join(products)})
          OR (oi.productId IS NULL AND (${orderCatalogs})))
    `);
    for (const row of quotes) quoteIds.add(row.id);
    for (const row of orders) pendingOrderIds.add(row.id);
  }
  // A customer's acceptance creates a pending/unpaid order. It does not lock prices.
  // Include the current quote for that inquiry even when every quoted unit was accepted.
  for (const orderId of pendingOrderIds) {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { inquiryId: true } });
    const latest = order?.inquiryId ? await db.quote.findFirst({ where: { inquiryId: order.inquiryId }, orderBy: { version: 'desc' } }) : null;
    if (latest && ['draft', 'sent', 'accepted', 'expired'].includes(latest.status)) quoteIds.add(latest.id);
    else pendingOrderIds.delete(orderId);
  }
  return { quoteIds: [...quoteIds].sort(), pendingOrderIds: [...pendingOrderIds].sort() };
}

export async function findPricingQuoteImpact(
  changes: ImpactChange[],
  db: Prisma.TransactionClient = prisma,
): Promise<PricingQuoteImpact> {
  const targets = await findPricingQuoteImpactTargets(changes, db);
  const contents = [];
  for (const quoteId of targets.quoteIds) {
    const quote = await db.quote.findUnique({ where: { id: quoteId }, include: {
      items: { orderBy: { position: 'asc' } },
      inquiry: { include: { orders: { where: { status: { in: ['pending', 'unpaid'] }, archivedAt: null },
        orderBy: { id: 'asc' }, include: { orderItems: { orderBy: { position: 'asc' } }, adjustments: true, paymentAttempts: true } } } },
    } });
    const customer = quote ? await db.user.findFirst({
      where: quote.inquiry.userId ? { id: quote.inquiry.userId } : { email: quote.inquiry.email },
      select: { id: true, email: true, tier: true, discountRate: true, brandDiscounts: true, isFrozen: true },
    }) : null;
    contents.push({ quote, customer });
  }
  return { ...targets, contents };
}
