/**
 * Admin sidebar badge for 询价管理.
 *
 * Counts unarchived inquiries that still need a quote. A sent/accepted quote
 * clears the inquiry, and so does a completed staff submission that only wrote
 * operationLogs (the admin 提交报价 button used to do that without changing
 * status). Pending review statuses stay in the count until that happens.
 *
 * AI Ops permission matrix (no new ADMIN_PERMISSION_KEYS):
 * - GET /api/admin/analytics — session + admin.access. `todo.inquiries` is
 *   included only when the caller has inquiries.read. The count definition
 *   changed; the response shape did not.
 * - POST /api/inquiries/[id]/quote — inquiries.write. The admin 提交报价 action
 *   calls this existing route, then asks the sidebar to refetch immediately.
 */

import type { Prisma } from '@prisma/client';

export const ADMIN_INQUIRY_TODO_STATUSES = ['pending_quote', '待确认', '待人工审核'] as const;

const SENT_QUOTE_STATUSES = ['sent', 'accepted'] as const;

export const ADMIN_TODO_REFRESH_EVENT = 'libereal:admin-todo-refresh';

export function adminInquiryTodoWhere(createdBefore?: Date): Prisma.InquiryWhereInput {
  return {
    archivedAt: null,
    status: { in: [...ADMIN_INQUIRY_TODO_STATUSES] },
    quotes: { none: { status: { in: [...SENT_QUOTE_STATUSES] } } },
    OR: [
      { hasUnresolvedPricing: true },
      { operationLogs: { in: ['[]', ''] } },
    ],
    ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
  };
}

export function notifyAdminInquiryTodoChanged(inquiriesDelta?: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ADMIN_TODO_REFRESH_EVENT, {
    detail: typeof inquiriesDelta === 'number' ? { inquiriesDelta } : {},
  }));
}
