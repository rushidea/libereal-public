import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { listOrganizationIdsForPermission } from '@/lib/organization-service';
import { emailKeyedAccess } from '@/lib/verified-email-access';
import { settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import { quoteIsExpired } from '@/lib/quote-expiry';
import { isUniqueConstraintError } from '@/lib/checkout-idempotency';
import {
  INQUIRY_FEEDBACK_CHANNEL_REF_MAX,
  INQUIRY_FEEDBACK_CONTENT_MAX,
  INQUIRY_FEEDBACK_REQUEST_ID_MAX,
  INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX,
  QUOTE_BOUND_FEEDBACK_TYPES,
  inquiryFeedbackTypeLabel,
  isAdminProxyFeedbackChannel,
  isInquiryFeedbackHandlingStatus,
  isInquiryFeedbackType,
  toAdminFeedbackView,
  toCustomerFeedbackView,
} from '@/lib/inquiry-feedback';

function extractClientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')?.trim()
    ?? null;
}

async function hasOrgPermission(
  userId: string,
  organizationId: string,
  permission: 'organization.inquiries.create' | 'organization.orders.create',
): Promise<boolean> {
  const orgIds = await listOrganizationIdsForPermission(userId, permission);
  return orgIds.includes(organizationId);
}

function sameIdempotentPayload(
  existing: {
    actorType: string;
    actorUserId: string | null;
    feedbackType: string;
    channel: string;
    content: string;
    quoteId: string | null;
    quoteVersion: number | null;
    channelReference: string | null;
  },
  incoming: {
    actorType: string;
    actorUserId: string;
    feedbackType: string;
    channel: string;
    content: string;
    requestedQuoteId: string | null;
    requestedQuoteVersion: number | null;
    channelReference: string | null;
  },
): boolean {
  if (existing.actorType !== incoming.actorType) return false;
  if ((existing.actorUserId ?? null) !== incoming.actorUserId) return false;
  if (existing.feedbackType !== incoming.feedbackType) return false;
  if (existing.channel !== incoming.channel) return false;
  if (existing.content !== incoming.content) return false;
  if ((existing.channelReference ?? null) !== (incoming.channelReference ?? null)) return false;
  if (incoming.requestedQuoteId !== null && (existing.quoteId ?? null) !== incoming.requestedQuoteId) return false;
  if (incoming.requestedQuoteVersion !== null && (existing.quoteVersion ?? null) !== incoming.requestedQuoteVersion) return false;
  return true;
}

// permission: GET /api/inquiries/[id]/feedback
// Admin: inquiries.read (returns full admin view).
// Customer: active session + personal owner/verified-email or organization record read access (returns sanitized customer view).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionUser = await requireActiveSession();
  if (sessionUser instanceof NextResponse) return sessionUser;

  const isAdmin = sessionUser.role === 'admin';
  if (isAdmin) {
    const admin = await requireAdmin('inquiries.read');
    if (admin instanceof NextResponse) return admin;
  }

  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      select: { id: true, userId: true, email: true, ownerScope: true, organizationId: true },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    if (!isAdmin) {
      let allowed = false;
      if (inquiry.ownerScope === 'organization') {
        if (inquiry.organizationId) {
          const [canReadRecords, canCreateOrders, canCreateInquiries] = await Promise.all([
            canAccessOrganizationRecord(sessionUser.id, inquiry.organizationId),
            hasOrgPermission(sessionUser.id, inquiry.organizationId, 'organization.orders.create'),
            inquiry.userId === sessionUser.id
              ? hasOrgPermission(sessionUser.id, inquiry.organizationId, 'organization.inquiries.create')
              : Promise.resolve(false),
          ]);
          allowed = canReadRecords || canCreateOrders || canCreateInquiries;
        }
      } else {
        allowed = inquiry.userId === sessionUser.id || await emailKeyedAccess(sessionUser.id, inquiry.email);
      }
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const rows = await prisma.inquiryFeedback.findMany({
      where: { inquiryId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return NextResponse.json({
      feedbacks: isAdmin ? rows.map(toAdminFeedbackView) : rows.map(toCustomerFeedbackView),
    });
  } catch (err) {
    console.error('[inquiries/[id]/feedback GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// permission: POST /api/inquiries/[id]/feedback
// Customer (non-admin): active session, not frozen/blacklisted/rejected, no pending forced ack,
//   personal owner/verified-email or organization.inquiries.create / organization.orders.create.
//   Server locks actorType='customer', channel='website', channelReference=null.
// Admin: inquiries.write, locks actorType='admin_proxy', requires external channel (not 'website') + channelReference.
// Never creates Order / OrderItem / QuoteConfirmation.
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

  const isAdmin = sessionUser.role === 'admin';
  let actorType: 'customer' | 'admin_proxy';
  let actorUserId: string;
  let actorEmail: string;
  let actorName: string | null;
  let channel: string;
  let channelReference: string | null;

  if (isAdmin) {
    const admin = await requireAdmin('inquiries.write');
    if (admin instanceof NextResponse) return admin;

    if (record.actorType !== undefined && record.actorType !== 'admin_proxy') {
      return NextResponse.json({ error: '管理员代录反馈仅允许 admin_proxy 身份', code: 'INVALID_ACTOR_TYPE' }, { status: 400 });
    }
    if (!isAdminProxyFeedbackChannel(record.channel)) {
      return NextResponse.json({ error: '客服代录仅支持微信、邮件、电话、线下或其他外部渠道', code: 'INVALID_CHANNEL' }, { status: 400 });
    }
    if (typeof record.channelReference !== 'string') {
      return NextResponse.json({ error: '客服代录必须填写外部渠道来源依据', code: 'MISSING_CHANNEL_REFERENCE' }, { status: 400 });
    }
    const trimmedRef = record.channelReference.trim();
    if (trimmedRef.length === 0 || trimmedRef.length > INQUIRY_FEEDBACK_CHANNEL_REF_MAX) {
      return NextResponse.json(
        { error: `外部渠道来源依据需为 1~${INQUIRY_FEEDBACK_CHANNEL_REF_MAX} 字`, code: 'INVALID_CHANNEL_REFERENCE' },
        { status: 400 },
      );
    }

    actorType = 'admin_proxy';
    actorUserId = admin.id;
    actorEmail = admin.email;
    actorName = admin.name ?? null;
    channel = record.channel;
    channelReference = trimmedRef;
  } else {
    if (record.actorType !== undefined && record.actorType !== 'customer') {
      return NextResponse.json({ error: '客户反馈不允许指定代录身份', code: 'INVALID_ACTOR_TYPE' }, { status: 400 });
    }
    if (record.channel !== undefined && record.channel !== 'website') {
      return NextResponse.json({ error: '客户反馈仅允许站内渠道提交', code: 'INVALID_CHANNEL' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true, name: true, isBlacklisted: true, isFrozen: true, approvalStatus: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.isFrozen || user.isBlacklisted || user.approvalStatus === 'rejected') {
      return NextResponse.json({ error: '账户当前无法提交反馈。', code: 'ACCOUNT_BLOCKED' }, { status: 403 });
    }
    const forcedAckBlock = await assertNoPendingForcedAck(user.id, sessionUser.role);
    if (forcedAckBlock) return forcedAckBlock;

    actorType = 'customer';
    actorUserId = user.id;
    actorEmail = user.email;
    actorName = user.name ?? null;
    channel = 'website';
    channelReference = null;
  }

  // Common input validation
  if (!isInquiryFeedbackType(record.feedbackType)) {
    return NextResponse.json({ error: '反馈类型无效', code: 'INVALID_FEEDBACK_TYPE' }, { status: 400 });
  }
  const feedbackType = record.feedbackType;

  if (typeof record.content !== 'string') {
    return NextResponse.json({ error: '反馈内容不能为空', code: 'INVALID_CONTENT' }, { status: 400 });
  }
  const content = record.content.trim();
  if (content.length === 0 || content.length > INQUIRY_FEEDBACK_CONTENT_MAX) {
    return NextResponse.json(
      { error: `反馈内容需为 1~${INQUIRY_FEEDBACK_CONTENT_MAX} 字`, code: 'INVALID_CONTENT' },
      { status: 400 },
    );
  }

  // Idempotency key validation
  const headerRequestId = req.headers.get('idempotency-key');
  const bodyRequestId = record.clientRequestId;
  if (headerRequestId !== null && bodyRequestId !== undefined && headerRequestId !== bodyRequestId) {
    return NextResponse.json({ error: '幂等键不一致', code: 'IDEMPOTENCY_KEY_MISMATCH' }, { status: 400 });
  }
  const rawRequestId = bodyRequestId !== undefined ? bodyRequestId : headerRequestId;
  let clientRequestId: string | null = null;
  if (rawRequestId !== null && rawRequestId !== undefined) {
    if (typeof rawRequestId !== 'string') {
      return NextResponse.json({ error: '幂等键格式无效', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
    }
    const trimmedKey = rawRequestId.trim();
    if (trimmedKey.length === 0 || trimmedKey.length > INQUIRY_FEEDBACK_REQUEST_ID_MAX) {
      return NextResponse.json(
        { error: `幂等键长度需为 1~${INQUIRY_FEEDBACK_REQUEST_ID_MAX} 字符`, code: 'INVALID_IDEMPOTENCY_KEY' },
        { status: 400 },
      );
    }
    clientRequestId = trimmedKey;
  }

  const requestedQuoteId = record.quoteId;
  if (requestedQuoteId !== undefined && requestedQuoteId !== null && (typeof requestedQuoteId !== 'string' || requestedQuoteId.trim() === '')) {
    return NextResponse.json({ error: '报价编号无效', code: 'INVALID_QUOTE' }, { status: 400 });
  }
  const requestedQuoteVersion = record.quoteVersion;
  if (
    requestedQuoteVersion !== undefined
    && requestedQuoteVersion !== null
    && (typeof requestedQuoteVersion !== 'number' || !Number.isInteger(requestedQuoteVersion) || requestedQuoteVersion <= 0)
  ) {
    return NextResponse.json({ error: '报价版本号无效', code: 'INVALID_QUOTE_VERSION' }, { status: 400 });
  }

  const normalizedRequestedQuoteId = typeof requestedQuoteId === 'string' ? requestedQuoteId.trim() : null;
  const normalizedRequestedQuoteVersion = typeof requestedQuoteVersion === 'number' ? requestedQuoteVersion : null;

  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        status: true,
        archivedAt: true,
        ownerScope: true,
        organizationId: true,
      },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    if (!isAdmin) {
      if (inquiry.ownerScope === 'organization') {
        if (!inquiry.organizationId) {
          return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
        }
        const [canCreateOrder, canCreateInquiry, canReadRecords] = await Promise.all([
          hasOrgPermission(actorUserId, inquiry.organizationId, 'organization.orders.create'),
          hasOrgPermission(actorUserId, inquiry.organizationId, 'organization.inquiries.create'),
          canAccessOrganizationRecord(actorUserId, inquiry.organizationId),
        ]);
        const allowed = canCreateOrder
          || (canCreateInquiry && (inquiry.userId === actorUserId || canReadRecords));
        if (!allowed) {
          return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
        }
      } else {
        const allowed = inquiry.userId === actorUserId || await emailKeyedAccess(actorUserId, inquiry.email);
        if (!allowed) {
          return NextResponse.json({ error: '无权操作此询价', code: 'FORBIDDEN' }, { status: 403 });
        }
      }
    }

    const incomingSemanticPayload = {
      actorType,
      actorUserId,
      feedbackType,
      channel,
      content,
      requestedQuoteId: normalizedRequestedQuoteId,
      requestedQuoteVersion: normalizedRequestedQuoteVersion,
      channelReference,
    };

    // Idempotency replay check happens immediately after auth/account/inquiry-permission checks,
    // before expiry settlement, terminal inquiry checks, and quote version checks.
    if (clientRequestId) {
      const existing = await prisma.inquiryFeedback.findUnique({
        where: { inquiryId_clientRequestId: { inquiryId: id, clientRequestId } },
      });
      if (existing) {
        if (!sameIdempotentPayload(existing, incomingSemanticPayload)) {
          return NextResponse.json({ error: '幂等键已用于其他反馈请求', code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
        }
        return NextResponse.json(
          {
            success: true,
            feedback: isAdmin ? toAdminFeedbackView(existing) : toCustomerFeedbackView(existing),
            replayed: true,
          },
          { status: 200 },
        );
      }
    }

    await settleExpiredQuotes(prisma, [id]);

    if (inquiry.archivedAt != null) {
      return NextResponse.json({ error: '询价已归档，不能提交反馈', code: 'INQUIRY_ARCHIVED' }, { status: 409 });
    }
    if (inquiry.status === 'declined') {
      return NextResponse.json({ error: '询价已放弃，不能提交反馈', code: 'INQUIRY_DECLINED' }, { status: 409 });
    }
    if (inquiry.status === 'closed') {
      return NextResponse.json({ error: '询价已关闭，不能提交反馈', code: 'INQUIRY_CLOSED' }, { status: 409 });
    }

    const latestQuote = await prisma.quote.findFirst({
      where: { inquiryId: id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, validUntil: true },
    });

    const requiresQuoteBinding = QUOTE_BOUND_FEEDBACK_TYPES.has(feedbackType)
      || normalizedRequestedQuoteId !== null
      || normalizedRequestedQuoteVersion !== null;

    let boundQuoteId: string | null = null;
    let boundQuoteVersion: number | null = null;

    if (requiresQuoteBinding) {
      if (!latestQuote) {
        return NextResponse.json({ error: '当前没有可反馈的已发送报价', code: 'QUOTE_NOT_ACTIONABLE' }, { status: 409 });
      }
      if (
        (normalizedRequestedQuoteId !== null && normalizedRequestedQuoteId !== latestQuote.id)
        || (normalizedRequestedQuoteVersion !== null && normalizedRequestedQuoteVersion !== latestQuote.version)
      ) {
        return NextResponse.json({ error: '报价版本已变化，请刷新后重试', code: 'QUOTE_VERSION_CONFLICT' }, { status: 409 });
      }
      if (quoteIsExpired(latestQuote)) {
        return NextResponse.json({ error: '当前报价已过期，不能提交该类反馈', code: 'QUOTE_EXPIRED' }, { status: 409 });
      }
      if (latestQuote.status !== 'sent') {
        return NextResponse.json({ error: '当前没有有效的已发送报价', code: 'QUOTE_NOT_ACTIONABLE' }, { status: 409 });
      }
      boundQuoteId = latestQuote.id;
      boundQuoteVersion = latestQuote.version;
    } else if (latestQuote && latestQuote.status === 'sent' && !quoteIsExpired(latestQuote)) {
      boundQuoteId = latestQuote.id;
      boundQuoteVersion = latestQuote.version;
    }

    const ip = extractClientIp(req);
    const userAgent = req.headers.get('user-agent');

    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.inquiryFeedback.create({
          data: {
            inquiryId: id,
            quoteId: boundQuoteId,
            quoteVersion: boundQuoteVersion,
            actorType,
            actorUserId,
            actorEmail,
            actorName,
            channel,
            channelReference,
            feedbackType,
            content,
            handlingStatus: 'pending',
            clientRequestId,
            ip,
            userAgent,
          },
        });

        await writeAuditLog({
          actorId: actorUserId,
          actorEmail,
          action: isAdmin ? 'inquiry.feedback_recorded_by_staff' : 'inquiry.feedback_submitted',
          resource: 'inquiries',
          targetType: 'InquiryFeedback',
          targetId: row.id,
          after: {
            inquiryId: id,
            quoteId: boundQuoteId,
            quoteVersion: boundQuoteVersion,
            actorType,
            channel,
            channelReference,
            feedbackType,
          },
          metadata: { inquiryId: id, quoteId: boundQuoteId, quoteVersion: boundQuoteVersion },
        }, tx);

        if (!isAdmin) {
          const typeLabel = inquiryFeedbackTypeLabel(feedbackType);
          await tx.notification.create({
            data: {
              email: 'admin',
              role: 'admin',
              type: 'inquiry_feedback_received',
              title: '客户提交了询价反馈',
              content: `${inquiry.name} 就询价单提交了「${typeLabel}」反馈：${content.slice(0, 100)}`,
              linkUrl: `/admin/inquiries?inquiryId=${id}`,
              metadata: JSON.stringify({
                inquiryId: id,
                feedbackId: row.id,
                quoteId: boundQuoteId,
                quoteVersion: boundQuoteVersion,
                feedbackType,
              }),
            },
          });
        }

        return row;
      });

      return NextResponse.json(
        {
          success: true,
          feedback: isAdmin ? toAdminFeedbackView(created) : toCustomerFeedbackView(created),
        },
        { status: 201 },
      );
    } catch (txErr) {
      if (clientRequestId && isUniqueConstraintError(txErr)) {
        const existing = await prisma.inquiryFeedback.findUnique({
          where: { inquiryId_clientRequestId: { inquiryId: id, clientRequestId } },
        });
        if (existing) {
          if (!sameIdempotentPayload(existing, incomingSemanticPayload)) {
            return NextResponse.json({ error: '幂等键已用于其他反馈请求', code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
          }
          return NextResponse.json(
            {
              success: true,
              feedback: isAdmin ? toAdminFeedbackView(existing) : toCustomerFeedbackView(existing),
              replayed: true,
            },
            { status: 200 },
          );
        }
      }
      throw txErr;
    }
  } catch (err) {
    console.error('[inquiries/[id]/feedback POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// permission: PATCH /api/inquiries/[id]/feedback
// Admin: inquiries.write. Updates handlingStatus, resolutionNote, resolvedByQuoteId on a feedback item of this inquiry.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = await requireAdmin('inquiries.write');
  if (admin instanceof NextResponse) return admin;

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

  if (typeof record.feedbackId !== 'string' || record.feedbackId.trim() === '') {
    return NextResponse.json({ error: '缺少反馈编号', code: 'INVALID_FEEDBACK_ID' }, { status: 400 });
  }
  const feedbackId = record.feedbackId.trim();

  if (!isInquiryFeedbackHandlingStatus(record.handlingStatus)) {
    return NextResponse.json({ error: '处理状态无效', code: 'INVALID_HANDLING_STATUS' }, { status: 400 });
  }
  const handlingStatus = record.handlingStatus;

  const hasResolutionNote = 'resolutionNote' in record;
  let resolutionNote: string | null | undefined;
  if (hasResolutionNote) {
    if (record.resolutionNote === null || record.resolutionNote === undefined) {
      resolutionNote = null;
    } else if (typeof record.resolutionNote === 'string') {
      const trimmed = record.resolutionNote.trim();
      if (trimmed.length > INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX) {
        return NextResponse.json(
          { error: `处理备注不能超过 ${INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX} 字`, code: 'INVALID_RESOLUTION_NOTE' },
          { status: 400 },
        );
      }
      resolutionNote = trimmed || null;
    } else {
      return NextResponse.json({ error: '处理备注格式无效', code: 'INVALID_RESOLUTION_NOTE' }, { status: 400 });
    }
  }

  const hasResolvedByQuoteId = 'resolvedByQuoteId' in record;
  let resolvedByQuoteId: string | null | undefined;
  if (hasResolvedByQuoteId) {
    if (record.resolvedByQuoteId === null || record.resolvedByQuoteId === undefined || record.resolvedByQuoteId === '') {
      resolvedByQuoteId = null;
    } else if (typeof record.resolvedByQuoteId === 'string') {
      resolvedByQuoteId = record.resolvedByQuoteId.trim();
    } else {
      return NextResponse.json({ error: '关联报价编号格式无效', code: 'INVALID_QUOTE' }, { status: 400 });
    }
  }

  try {
    const existing = await prisma.inquiryFeedback.findFirst({
      where: { id: feedbackId, inquiryId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
    }

    if (resolvedByQuoteId) {
      const quote = await prisma.quote.findFirst({
        where: { id: resolvedByQuoteId, inquiryId: id },
        select: { id: true },
      });
      if (!quote) {
        return NextResponse.json({ error: '关联报价不属于该询价单', code: 'INVALID_QUOTE' }, { status: 400 });
      }
    }

    const handledAt = handlingStatus === 'pending' ? null : new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.inquiryFeedback.update({
        where: { id: existing.id },
        data: {
          handlingStatus,
          handledByAdminId: handlingStatus === 'pending' ? null : admin.id,
          handledByAdminEmail: handlingStatus === 'pending' ? null : admin.email,
          handledAt,
          ...(hasResolutionNote ? { resolutionNote } : {}),
          ...(hasResolvedByQuoteId ? { resolvedByQuoteId } : {}),
        },
      });

      await writeAuditLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'inquiry.feedback_handled',
        resource: 'inquiries',
        targetType: 'InquiryFeedback',
        targetId: row.id,
        before: {
          handlingStatus: existing.handlingStatus,
          resolutionNote: existing.resolutionNote,
          resolvedByQuoteId: existing.resolvedByQuoteId,
        },
        after: {
          handlingStatus: row.handlingStatus,
          resolutionNote: row.resolutionNote,
          resolvedByQuoteId: row.resolvedByQuoteId,
        },
        metadata: { inquiryId: id, feedbackId: row.id },
      }, tx);

      return row;
    });

    return NextResponse.json({
      success: true,
      feedback: toAdminFeedbackView(updated),
    });
  } catch (err) {
    console.error('[inquiries/[id]/feedback PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
