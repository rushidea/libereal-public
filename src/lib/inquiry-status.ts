import type { Prisma } from '@prisma/client';

/**
 * Work-queue statuses for the admin inquiries badge (`todo.inquiries` / `kpi.pendingInquiries`).
 * `declined`, `quote_sent`, and `quote_expired` are intentionally absent: a declined quote is
 * finished customer work, a sent quote is waiting on the customer, and an expired quote is not
 * an unquoted todo. Admins can still open that inquiry and send a new quote.
 */
export const PENDING_INQUIRY_STATUSES = ['pending_quote', '待确认', '待人工审核'] as const;

/**
 * Statuses that may receive a newly published quote.
 * `quote_sent` and `quote_expired` stay quotable so an admin can republish
 * (new version, previous draft/sent quote superseded). Expiry moves the inquiry
 * to `quote_expired`; publishing again returns it to `quote_sent`.
 * `declined` (已放弃) and `closed` (已关闭 / 全部接受) are terminal.
 * Archive (`archivedAt`), linked orders (已下单), and accepted quotes are
 * enforced separately because they are not inquiry status strings.
 */
export const QUOTABLE_INQUIRY_STATUSES = [...PENDING_INQUIRY_STATUSES, 'quote_sent', 'quote_expired'] as const;

export type QuotableInquiryStatus = (typeof QUOTABLE_INQUIRY_STATUSES)[number];

export function isQuotableInquiryStatus(status: string): status is QuotableInquiryStatus {
  return (QUOTABLE_INQUIRY_STATUSES as readonly string[]).includes(status);
}

export type InquiryQuotePublishBlock = {
  status: 409;
  code: 'INQUIRY_ARCHIVED' | 'INQUIRY_DECLINED' | 'INQUIRY_CLOSED' | 'INQUIRY_ORDERED' | 'QUOTE_ACCEPTED' | 'INQUIRY_NOT_QUOTABLE';
  error: string;
};

/** Facts that must be read in the same transaction as the quote write. */
export type InquiryQuotePublishFacts = {
  status: string;
  archivedAt: Date | string | null;
  orderCount: number;
  acceptedQuoteCount: number;
  orderedLineCount: number;
};

/**
 * Chinese 409 when this snapshot cannot be quoted.
 * Returns null for pre-quote statuses and for `quote_sent` / `quote_expired` with no order and no accepted quote.
 */
export function inquiryQuotePublishBlock(facts: InquiryQuotePublishFacts): InquiryQuotePublishBlock | null {
  if (facts.archivedAt != null) {
    return { status: 409, code: 'INQUIRY_ARCHIVED', error: '询价已归档，不能发布报价' };
  }
  if (facts.status === 'declined') {
    return { status: 409, code: 'INQUIRY_DECLINED', error: '询价已放弃，不能发布报价' };
  }
  if (facts.status === 'closed') {
    return { status: 409, code: 'INQUIRY_CLOSED', error: '询价已关闭，不能发布报价' };
  }
  if (facts.orderCount > 0 || facts.orderedLineCount > 0) {
    return { status: 409, code: 'INQUIRY_ORDERED', error: '询价已下单，不能发布报价' };
  }
  if (facts.acceptedQuoteCount > 0) {
    return { status: 409, code: 'QUOTE_ACCEPTED', error: '报价已接受，不能发布报价' };
  }
  if (!isQuotableInquiryStatus(facts.status)) {
    return { status: 409, code: 'INQUIRY_NOT_QUOTABLE', error: '当前询价状态不能发布报价' };
  }
  return null;
}

export function pendingInquiryWhere(): Prisma.InquiryWhereInput {
  return { status: { in: [...PENDING_INQUIRY_STATUSES] }, archivedAt: null };
}

export function overdueInquiryWhere(slaThreshold: Date): Prisma.InquiryWhereInput {
  return { ...pendingInquiryWhere(), createdAt: { lt: slaThreshold } };
}
