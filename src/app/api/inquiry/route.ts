import { generateId } from '@/lib/id';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, CustomerUnavailableProductError, verifyAndPriceItems, type PriceLookupItem } from '@/lib/pricing';
import { reportError } from '@/lib/errorReporting';
import { auth } from '@/lib/auth';
import { requireActiveSession } from '@/lib/session';
import { sendAdminOperationalEmail } from '@/lib/mail';
import { toInquiryItemCreates } from '@/lib/commerce-records';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';
import { resolveRecordOwnership } from '@/lib/organization-record-access';
import { organizationRbacErrorStatus, OrganizationRbacError } from '@/lib/organization-service';
import { buildCheckoutRequestFingerprint, isUniqueConstraintError, validCheckoutAttemptId } from '@/lib/checkout-idempotency';

const HIGH_VALUE_INQUIRY_THRESHOLD = Number(process.env.HIGH_VALUE_INQUIRY_THRESHOLD ?? 5000);
const BATCH_INQUIRY_ITEM_THRESHOLD = Number(process.env.BATCH_INQUIRY_ITEM_THRESHOLD ?? 5);

type InquiryBody = {
  name?: string; email?: string; phone?: string; institution?: string;
  department?: string | null; address?: string | null; notes?: string | null;
  items?: PriceLookupItem[]; paymentMethod?: string | null; identity?: string | null;
  advisorName?: string | null; advisorPhone?: string | null; organizationId?: string | null;
  honeypot?: string; checkoutAttemptId?: unknown; [key: string]: unknown;
};

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip') ?? 'unknown';

  const { allowed, remaining, resetIn } = await rateLimitAsync(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试。', retryAfter: Math.ceil(resetIn / 1000) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(resetIn / 1000)) } }
    );
  }

  try {
    const session = await auth();
    let sessionUserId = session?.user?.id ?? null;
    if (sessionUserId) {
      const activeUser = await requireActiveSession();
      if (activeUser instanceof NextResponse) return activeUser;
      sessionUserId = activeUser.id;
    }

    const body = await req.json() as InquiryBody;
    const { name, email, phone, institution, department, address, notes, items, paymentMethod, identity, advisorName, advisorPhone, organizationId, honeypot } = body;
    const headerAttemptId = req.headers.get('idempotency-key');
    const bodyAttemptId = body.checkoutAttemptId;
    if (headerAttemptId !== null && bodyAttemptId !== undefined && headerAttemptId !== bodyAttemptId) return NextResponse.json({ error: '幂等键不一致' }, { status: 400 });
    const checkoutAttemptId = bodyAttemptId ?? headerAttemptId ?? undefined;
    if (checkoutAttemptId !== undefined && !validCheckoutAttemptId(checkoutAttemptId)) return NextResponse.json({ error: '幂等键格式无效' }, { status: 400 });
    if (checkoutAttemptId !== undefined && !sessionUserId) return NextResponse.json({ error: '询价幂等重试需要登录' }, { status: 401 });

    // Honeypot check
    if (honeypot) {
      console.log('[Honeypot triggered] IP:', ip);
      return NextResponse.json({ success: true, message: 'Inquiry received' });
    }

    // Validate required fields
    if (!name || !email || !phone || !institution) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '邮箱格式无效' }, { status: 400 });
    }

    // Validate items: must be array with at least one entry
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '询价单至少包含一个商品' }, { status: 400 });
    }

    // Commerce restrictions are checked before an existing keyed request can replay.
    if (sessionUserId) {
      const actor = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { isFrozen: true, isBlacklisted: true, approvalStatus: true, creditAccount: { select: { status: true } } } });
      if (actor?.isFrozen || actor?.isBlacklisted || actor?.approvalStatus === 'rejected' || actor?.creditAccount?.status === 'paused' || actor?.creditAccount?.status === 'overdue_hold') {
        return NextResponse.json({ error: '账户当前无法提交采购订单或询价。' }, { status: 403 });
      }
    }

    // Resolve the actor and idempotency key before pricing or any other volatile work.
    let ownership: { organizationId: string | null; ownerScope: 'personal' | 'organization' };
    try {
      ownership = await resolveRecordOwnership(sessionUserId, organizationId, 'organization.inquiries.create');
    } catch (error) {
      if (error instanceof OrganizationRbacError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
      }
      throw error;
    }
    const requestFingerprint = checkoutAttemptId
      ? buildCheckoutRequestFingerprint({ operation: 'inquiry', actorId: sessionUserId, organizationId: ownership.organizationId, ownerScope: ownership.ownerScope, request: body })
      : null;
    if (checkoutAttemptId) {
      const existing = await prisma.inquiry.findUnique({ where: { checkoutAttemptId } });
      if (existing) {
        if (existing.userId !== sessionUserId || existing.organizationId !== ownership.organizationId || existing.ownerScope !== ownership.ownerScope || existing.checkoutRequestFingerprint !== requestFingerprint) {
          return NextResponse.json({ error: '幂等键已用于其他请求' }, { status: 409 });
        }
        return NextResponse.json({ success: true, id: existing.id, message: 'Inquiry received', status: existing.status, replayed: true });
      }
    }

    const id = generateId();
    const itemsArray = Array.isArray(items) ? items : [];
    // Server-side price verification: never trust client-submitted prices
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = await verifyAndPriceItems(itemsArray, { userId: sessionUserId, allowQuoteRequired: true });
    if (mismatchedCount > 0) {
      console.warn(`[inquiry POST] ${mismatchedCount} item(s) missing DB price; using client price`);
    }
    const pricedItems = verifiedItems.map((item, index) => {
      const original = itemsArray[index] as unknown as Record<string, unknown> | undefined;
      return {
        ...(original ?? {}),
        productId: item.productId,
        catalogNumber: item.catalogNumber,
        name: item.name,
        price: item.quoteRequired ? null : item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.quoteRequired ? null : item.lineTotal,
        clientPrice: item.clientPrice,
        priceMismatch: item.priceMismatch,
        pricingSource: item.source,
        pricingSnapshot: item.pricingSnapshot,
        quoteRequired: item.quoteRequired === true,
      };
    });
    const ua = req.headers.get('user-agent') ?? null;

    const requiresVerifiedAccount =
      verifiedSubtotal >= HIGH_VALUE_INQUIRY_THRESHOLD ||
      pricedItems.length >= BATCH_INQUIRY_ITEM_THRESHOLD;

    // Determine initial status and check order limit for new users
    let initialStatus = '待确认';
    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { isNewUser: true, phone: true, phoneVerifiedAt: true, approvalStatus: true, isBlacklisted: true, isFrozen: true, role: true, creditAccount: { select: { status: true } } },
      });
      const forcedAckBlock = await assertNoPendingForcedAck(sessionUserId, user?.role);
      if (forcedAckBlock) return forcedAckBlock;
      if (user?.isFrozen) {
        return NextResponse.json({ error: '账户已冻结，暂时无法提交订单或询价。' }, { status: 403 });
      }
      if (user?.isBlacklisted) {
        return NextResponse.json({ error: '账户限制已生效，暂时无法提交订单或询价。' }, { status: 403 });
      }
      if (user?.approvalStatus === 'rejected') {
        return NextResponse.json({ error: '账户审核未通过，暂时无法提交订单或询价。' }, { status: 403 });
      }
      if (user?.creditAccount?.status === 'paused' || user?.creditAccount?.status === 'overdue_hold') {
        return NextResponse.json({ error: '授信账户当前暂停采购，请联系管理员处理。' }, { status: 403 });
      }
      if (requiresVerifiedAccount && (!user?.phone || !user.phoneVerifiedAt)) {
        return NextResponse.json(
          { error: '高价值或批量询价需使用已验证手机号的注册账户提交。请先到账户设置完成手机号验证。' },
          { status: 403 }
        );
      }
      if (user?.isNewUser) {
        const orderCount = await prisma.inquiry.count({ where: { userId: sessionUserId } });
        if (orderCount >= 3) {
          return NextResponse.json(
            { error: '您的新用户额度已用完（3单），请等待管理员审核开通更多下单权限。' },
            { status: 403 }
          );
        }
        initialStatus = '待人工审核';
      }
    } else if (requiresVerifiedAccount) {
      return NextResponse.json(
        { error: '高价值或批量询价需登录并完成手机号验证后提交。' },
        { status: 401 }
      );
    }

    try {
      await prisma.inquiry.create({
      data: {
        id,
        name,
        email,
        phone,
        institution,
        department: department || null,
        address: address || null,
        notes: notes || null,
        subtotal: pricedItems.some((item) => item.quoteRequired) ? 0 : verifiedSubtotal,
        paymentMethod: paymentMethod || null,
        identity: identity || null,
        advisorName: advisorName || null,
        advisorPhone: advisorPhone || null,
        status: initialStatus,
        ip,
        userAgent: ua,
        userId: sessionUserId,
        organizationId: ownership.organizationId,
        ownerScope: ownership.ownerScope,
        checkoutAttemptId: checkoutAttemptId ?? null,
        checkoutRequestFingerprint: requestFingerprint,
        hasUnresolvedPricing: pricedItems.some((item) => item.quoteRequired),
        inquiryItems: {
          create: toInquiryItemCreates(pricedItems),
        },
      },
      });
    } catch (error) {
      if (isUniqueConstraintError(error) && checkoutAttemptId) {
        const winner = await prisma.inquiry.findUnique({ where: { checkoutAttemptId } });
        if (winner) {
          if (winner.userId !== sessionUserId || winner.organizationId !== ownership.organizationId || winner.ownerScope !== ownership.ownerScope || winner.checkoutRequestFingerprint !== requestFingerprint) {
            return NextResponse.json({ error: '幂等键已用于其他请求' }, { status: 409 });
          }
          return NextResponse.json({ success: true, id: winner.id, message: 'Inquiry received', status: winner.status, replayed: true });
        }
      }
      throw error;
    }

    // Notify admin of new inquiry
    await prisma.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'inquiry_received',
        title: '新询价单',
        content: `新询价单 ${id}，客户：${name}（${institution || email}）`,
        linkUrl: '/admin/inquiries',
        metadata: JSON.stringify({ inquiryId: id }),
      },
    });

    sendAdminOperationalEmail({
      subject: 'LIBEREAL · 新询价单',
      message: `新询价单 ${id}，客户：${name}（${institution || email}）`,
      path: '/admin/inquiries',
    });

    console.log(`=== New Inquiry #${id} ===`);
    console.log(`IP: ${ip} | UserId: ${sessionUserId ?? 'anonymous'} | Remaining: ${remaining} | Status: ${initialStatus}`);
    console.log(`From: ${name} <${email}> | ${phone} | ${institution}`);
    console.log(`Items: ${itemsArray.length}`);
    console.log('============================');

    return NextResponse.json({ success: true, id, message: 'Inquiry received', status: initialStatus });
  } catch (err) {
    if (err instanceof CustomerUnavailableProductError) {
      return NextResponse.json(
        { error: `${err.productName} 已下架，无法提交询价`, catalogNumber: err.catalogNumber },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品需要确认品牌后再提交询价。' }, { status: 400 });
    }
    reportError(err, { tags: { route: 'inquiry' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
