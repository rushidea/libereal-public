import type { Prisma } from '@prisma/client';

/**
 * Work-queue statuses for the admin inquiries badge (`todo.inquiries` / `kpi.pendingInquiries`).
 * `declined` and `quote_sent` are intentionally absent: a declined quote is finished customer
 * work, and a sent quote is waiting on the customer rather than on an admin quote.
 */
export const PENDING_INQUIRY_STATUSES = ['pending_quote', '待确认', '待人工审核'] as const;

export function pendingInquiryWhere(): Prisma.InquiryWhereInput {
  return { status: { in: [...PENDING_INQUIRY_STATUSES] }, archivedAt: null };
}

export function overdueInquiryWhere(slaThreshold: Date): Prisma.InquiryWhereInput {
  return { ...pendingInquiryWhere(), createdAt: { lt: slaThreshold } };
}
