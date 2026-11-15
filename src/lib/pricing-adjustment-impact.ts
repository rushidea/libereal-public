import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type PricingQuoteImpact = {
  quoteIds: string[];
  pendingOrderIds: string[];
  contents: unknown[];
};

/** Potential repricing work only. This never changes quotes or locked order prices. */
export async function findPricingQuoteImpact(
  changes: Array<{ productId: string; catalogNumber: string }>,
  db: Prisma.TransactionClient = prisma,
): Promise<PricingQuoteImpact> {
  const quoteIds = new Set<string>();
  const pendingOrderIds = new Set<string>();
  // Bound SQLite parameters even for large imported catalogues.
  for (let offset = 0; offset < changes.length; offset += 200) {
    const group = changes.slice(offset, offset + 200);
    const products = [...new Set(group.map((change) => change.productId))];
    const catalogs = [...new Set(group.map((change) => change.catalogNumber.trim().toLowerCase()))];
    const quotes = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT q.id FROM Quote q
      JOIN QuoteItem qi ON qi.quoteId = q.id
      JOIN Inquiry i ON i.id = q.inquiryId
      WHERE q.status IN ('draft', 'sent', 'accepted', 'expired') AND i.archivedAt IS NULL
        AND i.status != 'declined'
        AND NOT EXISTS (SELECT 1 FROM Quote newer WHERE newer.inquiryId = q.inquiryId AND newer.version > q.version)
        AND (qi.quantity > qi.orderedQty OR EXISTS (
          SELECT 1 FROM "Order" o JOIN OrderItem oi ON oi.orderId = o.id
          WHERE o.inquiryId = q.inquiryId AND o.status IN ('pending', 'unpaid')
            AND o.archivedAt IS NULL
            AND (oi.productId = qi.productId OR (oi.productId IS NULL
              AND LOWER(TRIM(oi.catalogNumber)) = LOWER(TRIM(qi.catalogNumber))))
        ))
        AND (qi.productId IN (${Prisma.join(products)})
          OR (qi.productId IS NULL AND LOWER(TRIM(qi.catalogNumber)) IN (${Prisma.join(catalogs)})))
    `);
    const orders = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT o.id FROM "Order" o
      JOIN OrderItem oi ON oi.orderId = o.id
      WHERE o.status IN ('pending', 'unpaid') AND o.archivedAt IS NULL AND o.inquiryId IS NOT NULL
        AND EXISTS (SELECT 1 FROM Inquiry i WHERE i.id = o.inquiryId AND i.archivedAt IS NULL AND i.status != 'declined')
        AND (oi.productId IN (${Prisma.join(products)})
          OR (oi.productId IS NULL AND LOWER(TRIM(oi.catalogNumber)) IN (${Prisma.join(catalogs)})))
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
  const contents = [];
  for (const quoteId of [...quoteIds].sort()) {
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
  return { quoteIds: [...quoteIds].sort(), pendingOrderIds: [...pendingOrderIds].sort(), contents };
}
