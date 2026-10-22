import type { Prisma } from '@prisma/client';

/**
 * Work-queue statuses for the admin inquiries badge (`todo.inquiries` / `kpi.pendingInquiries`).
 * `declined`, `quote_sent`, and `quote_expired` are intentionally absent: a declined quote is
 * finished customer work, a sent quote is waiting on the customer, and an expired quote is not
 * an unquoted todo. Admins can still open that inquiry and send a new quote.
 */
export const PENDING_INQUIRY_STATUSES = ['pending_quote', '待确认', '待人工审核'] as const;

/**
 * Inquiry statuses the product actually writes.
 * Intake values come from creation (`待确认` / `待人工审核`) and the schema default
 * (`pending_quote`). Later values follow the quote, expiry, decline, and accept flows.
 * `expired` stays a quote status; the inquiry status for that outcome is `quote_expired`.
 */
export const INQUIRY_STATUSES = [
  ...PENDING_INQUIRY_STATUSES,
  'quote_sent',
  'quote_expired',
  'declined',
  'closed',
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  pending_quote: '待报价',
  待确认: '待确认',
  待人工审核: '待人工审核',
  quote_sent: '已发报价',
  quote_expired: '已过期',
  declined: '已放弃',
  closed: '已关闭',
};

const INQUIRY_STATUS_LIST = INQUIRY_STATUSES.map((status) => {
  const label = INQUIRY_STATUS_LABELS[status];
  return label === status ? status : `${status}（${label}）`;
}).join('、');

/**
 * Admin PATCH transitions.
 * - Intake statuses may be reclassified among themselves.
 * - 报价: intake → quote_sent, and quote_expired → quote_sent, only when the latest quote is `sent`.
 * - 过期: quote_sent → quote_expired, only when the latest quote is `expired`.
 * - 放弃: quote_sent or quote_expired → declined, only when the latest quote is `declined`.
 * - 接受并关闭: quote_sent → closed, only when the latest quote is `accepted`.
 * - declined and closed are terminal. Expiry does not return the inquiry to intake.
 */
const INQUIRY_STATUS_TRANSITIONS: Record<InquiryStatus, readonly InquiryStatus[]> = {
  pending_quote: ['待确认', '待人工审核', 'quote_sent'],
  待确认: ['pending_quote', '待人工审核', 'quote_sent'],
  待人工审核: ['pending_quote', '待确认', 'quote_sent'],
  quote_sent: ['quote_expired', 'declined', 'closed'],
  quote_expired: ['quote_sent', 'declined'],
  declined: [],
  closed: [],
};

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === 'string' && (INQUIRY_STATUSES as readonly string[]).includes(value);
}

/**
 * Chinese error for an admin inquiry status change, or null when the change is allowed.
 * `latestQuoteStatus` is the highest-version quote, or null when the inquiry has no quote.
 * A same-status update of a legal status does not consult the quote.
 */
export function inquiryStatusTransitionError(
  from: string,
  to: unknown,
  latestQuoteStatus: string | null,
): string | null {
  if (!isInquiryStatus(to)) {
    return `询价状态无效。可用状态：${INQUIRY_STATUS_LIST}。`;
  }
  if (!isInquiryStatus(from)) {
    return '当前询价状态不在可流转范围内，不能修改状态。';
  }
  if (from === to) return null;
  if (!INQUIRY_STATUS_TRANSITIONS[from].includes(to)) {
    return `询价不能从「${INQUIRY_STATUS_LABELS[from]}」改为「${INQUIRY_STATUS_LABELS[to]}」。`;
  }
  if (to === 'quote_sent' && latestQuoteStatus !== 'sent') {
    return '当前没有已发送的报价，不能改为已发报价。';
  }
  if (to === 'quote_expired' && latestQuoteStatus !== 'expired') {
    return '报价尚未过期，不能把询价改为已过期。';
  }
  if (to === 'declined' && latestQuoteStatus !== 'declined') {
    return '报价尚未放弃，不能把询价改为已放弃。';
  }
  if (to === 'closed' && latestQuoteStatus !== 'accepted') {
    return '报价尚未接受，不能关闭询价。';
  }
  return null;
}

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
