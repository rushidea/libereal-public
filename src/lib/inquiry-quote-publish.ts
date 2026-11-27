import { Prisma, type PrismaClient } from '@prisma/client';
import { jsonObject, pendingOrderRepricing } from '@/lib/order-catalog-repricing';
import { quoteContentHash } from '@/lib/quote-records';
import {
  QUOTABLE_INQUIRY_STATUSES,
  inquiryQuotePublishBlock,
  type InquiryQuotePublishBlock,
} from '@/lib/inquiry-status';

type Db = Prisma.TransactionClient | PrismaClient;

export async function currentCatalogRepricingDraft(db: Db, inquiryId: string) {
  const latest = await db.quote.findFirst({ where: { inquiryId }, orderBy: { version: 'desc' }, include: {
    items: { orderBy: { position: 'asc' } }, confirmations: { where: { action: 'catalog_repricing_prepared' } },
  } });
  return latest?.status === 'draft' && latest.confirmations.length === 1 ? latest : null;
}

async function readyCatalogRepricingDraft(db: Db, inquiryId: string) {
  const draft = await currentCatalogRepricingDraft(db, inquiryId);
  if (!draft) return null;
  if (draft.items.some(line => jsonObject(line.metadata).supplierQuotePending)) return null;
  for (const line of draft.items) {
    const orderId = jsonObject(line.metadata).repricingOrderId;
    if (typeof orderId === 'string' && await pendingOrderRepricing(db, orderId)) return null;
  }
  return draft.items.some((line) => !jsonObject(line.metadata).repricingOrderId && line.quantity > line.orderedQty && line.available) ? draft : null;
}

export class InquiryQuotePublishRejected extends Error {
  status: number;
  code: string;

  constructor(decision: { status: number; code: string; error: string }) {
    super(decision.error);
    this.name = 'InquiryQuotePublishRejected';
    this.status = decision.status;
    this.code = decision.code;
  }
}

export type InquiryQuotePublishDecision =
  | { ok: true }
  | ({ ok: false } & InquiryQuotePublishBlock)
  | { ok: false; status: 404; code: 'INQUIRY_NOT_FOUND'; error: string };

/**
 * Read the inquiry, archive flag, orders, and accepted/ordered quote lines.
 * Callers that publish must still claim the row in the same transaction.
 */
export async function assessInquiryQuotePublish(db: Db, inquiryId: string): Promise<InquiryQuotePublishDecision> {
  const inquiry = await db.inquiry.findUnique({
    where: { id: inquiryId },
    select: { status: true, archivedAt: true },
  });
  if (!inquiry) {
    return { ok: false, status: 404, code: 'INQUIRY_NOT_FOUND', error: 'Inquiry not found' };
  }
  const draft = await currentCatalogRepricingDraft(db, inquiryId);
  if (draft?.items.some(line => jsonObject(line.metadata).supplierQuotePending)) {
    return { ok: false, status: 409, code: 'INQUIRY_NOT_QUOTABLE', error: '请先取得并核对供应商书面报价，系统接续重算后再发送' };
  }
  if (!inquiry.archivedAt && inquiry.status !== 'declined' && await readyCatalogRepricingDraft(db, inquiryId)) return { ok: true };
  const orderCount = await db.order.count({ where: { inquiryId } });
  const acceptedQuoteCount = await db.quote.count({ where: { inquiryId, status: 'accepted' } });
  const orderedLineCount = await db.quoteItem.count({
    where: { orderedQty: { gt: 0 }, quote: { inquiryId } },
  });
  const block = inquiryQuotePublishBlock({
    status: inquiry.status,
    archivedAt: inquiry.archivedAt,
    orderCount,
    acceptedQuoteCount,
    orderedLineCount,
  });
  return block ? { ok: false, ...block } : { ok: true };
}

/**
 * Atomically move a still-quotable, unarchived inquiry to `quote_sent`.
 * Orders, accepted quotes, and lines with orderedQty are excluded in the same UPDATE.
 * Returns the number of rows updated (1 when the publish may continue).
 */
export async function claimInquiryForQuotePublish(tx: Prisma.TransactionClient, inquiryId: string, expectedDraft?: { id: string; hash: string }): Promise<number> {
  const draft = await readyCatalogRepricingDraft(tx, inquiryId);
  if (draft) {
    if (!expectedDraft || draft.id !== expectedDraft.id || quoteContentHash(draft) !== expectedDraft.hash) return 0;
    const claimed = await tx.inquiry.updateMany({ where: { id: inquiryId, archivedAt: null, status: { in: [...QUOTABLE_INQUIRY_STATUSES] } },
      data: { status: 'quote_sent', hasUnresolvedPricing: false } });
    return claimed.count;
  }
  if (expectedDraft) return 0;
  const currentDraft = await currentCatalogRepricingDraft(tx, inquiryId);
  if (currentDraft?.items.some(line => jsonObject(line.metadata).supplierQuotePending)) return 0;
  const updated = await tx.$executeRaw`
    UPDATE "Inquiry"
    SET "status" = 'quote_sent',
        "has_unresolved_pricing" = 0
    WHERE "id" = ${inquiryId}
      AND "archivedAt" IS NULL
      AND "status" IN (${Prisma.join([...QUOTABLE_INQUIRY_STATUSES])})
      AND NOT EXISTS (
        SELECT 1 FROM "Order" WHERE "inquiryId" = "Inquiry"."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Quote" WHERE "inquiryId" = "Inquiry"."id" AND "status" = 'accepted'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "QuoteItem" AS qi
        INNER JOIN "Quote" AS q ON q."id" = qi."quoteId"
        WHERE q."inquiryId" = "Inquiry"."id" AND qi."orderedQty" > 0
      )
  `;
  return Number(updated);
}
