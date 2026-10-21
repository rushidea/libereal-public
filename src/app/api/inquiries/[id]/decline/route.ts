import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';
import { DECLINABLE_INQUIRY_STATUSES, DECLINABLE_QUOTE_STATUSES } from '@/lib/quote-expiry';
import { parseQuoteDeclineInput, quoteDeclineReasonLabel } from '@/lib/quote-decline';
import { emailKeyedAccess } from '@/lib/verified-email-access';

class DeclineRejected extends Error {
  status: 409;
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeclineRejected';
    this.status = 409;
    this.code = code;
  }
}

// permission: POST /api/inquiries/[id]/decline
// Logged-in active session required. No MFA.
// Personal inquiry: inquiry.userId matches the session user, or verified mailbox matches inquiry.email (case-insensitive). Admin role alone is not enough.
// Organization inquiry: organization.orders.create on that organization (same permission as accepting the quote).
// Admin read of the stored decline uses existing GET /api/inquiries and GET /api/inquiries/[id] (inquiries.read).
// A quote that is already expired, or still sent but past validUntil, can be declined. Accepting it stays rejected.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionUser = await requireActiveSession();
  if (sessionUser instanceof NextResponse) return sessionUser;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效', code: 'INVALID_BODY' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求格式无效', code: 'INVALID_BODY' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const parsed = parseQuoteDeclineInput(record.reasonCode, record.note);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, code: 'INVALID_DECLINE' }, { status: 400 });
  }
  const requestedQuoteId = record.quoteId;
  if (requestedQuoteId != null && (typeof requestedQuoteId !== 'string' || requestedQuoteId.trim() === '')) {
    return NextResponse.json({ error: '报价编号无效', code: 'INVALID_QUOTE' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true, isBlacklisted: true, isFrozen: true, approvalStatus: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.isFrozen || user.isBlacklisted || user.approvalStatus === 'rejected') {
      return NextResponse.json({ error: '账户当前无法拒绝报价。', code: 'ACCOUNT_BLOCKED' }, { status: 403 });
    }

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      select: { id: true, userId: true, email: true, name: true, status: true, ownerScope: true, organizationId: true },
    });
    if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });

    if (inquiry.ownerScope === 'organization') {
      if (!inquiry.organizationId) {
        return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
      }
      try {
        await requireOrganizationPermission(user.id, inquiry.organizationId, 'organization.orders.create');
      } catch (error) {
        if (error instanceof OrganizationRbacError) {
          return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
        }
        throw error;
      }
    } else {
      const allowed = inquiry.userId === user.id || await emailKeyedAccess(user.id, inquiry.email);
      if (!allowed) {
        return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    const declinedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      if (!DECLINABLE_INQUIRY_STATUSES.includes(inquiry.status as (typeof DECLINABLE_INQUIRY_STATUSES)[number])) {
        throw new DeclineRejected('QUOTE_NOT_ACTIONABLE', '当前询价不能拒绝报价');
      }
      const quote = await tx.quote.findFirst({
        where: { inquiryId: id },
        orderBy: { version: 'desc' },
        include: { items: { select: { orderedQty: true } } },
      });
      if (!quote || !DECLINABLE_QUOTE_STATUSES.includes(quote.status as (typeof DECLINABLE_QUOTE_STATUSES)[number])) {
        throw new DeclineRejected('QUOTE_NOT_ACTIONABLE', '没有可拒绝的已发送报价');
      }
      if (typeof requestedQuoteId === 'string' && quote.id !== requestedQuoteId) {
        throw new DeclineRejected('QUOTE_VERSION_CONFLICT', '报价版本已变化，请刷新后重试');
      }
      if (quote.items.some((item) => item.orderedQty > 0)) {
        throw new DeclineRejected('QUOTE_CONVERTED', '报价已有商品转为订单，不能再拒绝');
      }
      const orderCount = await tx.order.count({ where: { inquiryId: id } });
      if (orderCount > 0) {
        throw new DeclineRejected('QUOTE_CONVERTED', '报价已转为订单，不能再拒绝');
      }

      const quoteUpdate = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: [...DECLINABLE_QUOTE_STATUSES] } },
        data: {
          status: 'declined',
          declineReasonCode: parsed.reasonCode,
          declineNote: parsed.note,
          declinedAt,
          declinedByUserId: user.id,
          declinedByEmail: user.email,
        },
      });
      if (quoteUpdate.count !== 1) throw new DeclineRejected('QUOTE_NOT_ACTIONABLE', '报价状态已变化，请刷新后重试');

      const inquiryUpdate = await tx.inquiry.updateMany({
        where: { id, status: { in: [...DECLINABLE_INQUIRY_STATUSES] } },
        data: { status: 'declined' },
      });
      if (inquiryUpdate.count !== 1) throw new DeclineRejected('QUOTE_NOT_ACTIONABLE', '询价状态已变化，请刷新后重试');

      await tx.quoteConfirmation.create({
        data: {
          quoteId: quote.id,
          userId: user.id,
          email: user.email,
          action: 'decline',
          details: JSON.stringify({ reasonCode: parsed.reasonCode, note: parsed.note }),
          ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
          userAgent: req.headers.get('user-agent'),
        },
      });

      const reasonLabel = quoteDeclineReasonLabel(parsed.reasonCode);
      await tx.notification.create({
        data: {
          email: 'admin',
          role: 'admin',
          type: 'quote_declined',
          title: '客户已放弃报价',
          content: `${inquiry.name} 已放弃报价：${reasonLabel}${parsed.note ? `（${parsed.note}）` : ''}`,
          linkUrl: '/admin/inquiries',
          metadata: JSON.stringify({
            inquiryId: id,
            quoteId: quote.id,
            reasonCode: parsed.reasonCode,
            note: parsed.note,
            declinedByUserId: user.id,
            declinedByEmail: user.email,
          }),
        },
      });

      return { quoteId: quote.id };
    });

    return NextResponse.json({
      success: true,
      inquiryStatus: 'declined',
      quoteStatus: 'declined',
      quoteId: result.quoteId,
      reasonCode: parsed.reasonCode,
      note: parsed.note,
    });
  } catch (err) {
    if (err instanceof DeclineRejected) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[inquiries/[id]/decline POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
