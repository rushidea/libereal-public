import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { requireOrganizationPermission } from '@/lib/organization-service';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { initialOrderStatus } from '@/lib/order-domain';
import { buildCheckoutRequestFingerprint, isUniqueConstraintError, validCheckoutAttemptId } from '@/lib/checkout-idempotency';
import { isInquiryLinkedOrderConflict, withAllocatedInquiryOrderNumber } from '@/data/inquiry-order-number';
import { ORDER_NUMBER_BUSY_ERROR } from '@/data/order-number';
import { inquiryQuoteAcceptBlock } from '@/lib/inquiry-status';
import { verifiedEmailMatches } from '@/lib/verified-email-access';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { adminActingPointsError } from '@/lib/admin-acting-points';
import { normalizePointsIntent } from '@/lib/points-checkout';
import { assertCheckoutPointsAvailable, settleCheckoutPayment } from '@/lib/checkout-payment-settlement';
import { applyOrderPointsDeduction } from '@/lib/points-checkout-service';
import { assertQuoteAcceptanceCredit, assertQuoteAcceptanceStock, quoteAcceptancePointsAudit } from '@/lib/quote-acceptance-guards';
import {
  isVariantStockInsufficientError,
  reserveOrderInventory,
  VARIANT_STOCK_INSUFFICIENT,
  VARIANT_STOCK_INSUFFICIENT_MESSAGE,
} from '@/lib/inventory';
import { acceptanceQuantityError, lineTotalForAcceptedQuantity, quoteLineFulfillment, requestedQuantityFromBody, validateAcceptedQuantity } from '@/lib/quote-acceptance';
import { quoteIsExpired, quoteValidUntilPassed } from '@/lib/quote-expiry';
import { settleExpiredQuotes } from '@/lib/quote-expiry-settle';

class InquiryAcceptRejected extends Error {
  code: 'INQUIRY_DECLINED' | 'INQUIRY_CLOSED' | 'INQUIRY_ARCHIVED' | 'INQUIRY_NOT_ACCEPTABLE';

  constructor(code: InquiryAcceptRejected['code'], message: string) {
    super(message);
    this.name = 'InquiryAcceptRejected';
    this.code = code;
  }
}

interface OrderItem {
  productId?: string | null;
  name: string;
  price: number;
  quantity: number;
  quotedQuantity?: number | null;
  shippedQty: number;
  leadTime?: string | null;
  status: string;
  pricingSnapshot?: string | null;
  metadata?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  if (activeUser.role === 'admin') {
    const admin = await requireAdmin('orders.write');
    if (admin instanceof NextResponse) return admin;
  }
  const session = { user: activeUser };

  try {
    const body = await req.json() as Record<string, unknown>;
    const { itemIndices, quantities, quoteId, quoteVersion, acceptanceAttemptId, paymentMethod, personalPoints, groupPoints, groupId } = body as {
      itemIndices?: unknown; quantities?: unknown; quoteId?: unknown; quoteVersion?: unknown; acceptanceAttemptId?: unknown;
      paymentMethod?: unknown; personalPoints?: unknown; groupPoints?: unknown; groupId?: unknown;
    };
    if (!Array.isArray(itemIndices) || itemIndices.length === 0) {
      return NextResponse.json({ error: 'itemIndices must be a non-empty array' }, { status: 400 });
    }
    if (itemIndices.some((idx) => !Number.isInteger(idx) || idx < 0) || new Set(itemIndices).size !== itemIndices.length) {
      return NextResponse.json({ error: '商品索引必须是唯一非负整数' }, { status: 400 });
    }
    const headerAttemptId = req.headers.get('idempotency-key');
    if (headerAttemptId !== null && acceptanceAttemptId !== undefined && headerAttemptId !== acceptanceAttemptId) return NextResponse.json({ error: '幂等键不一致' }, { status: 400 });
    const attemptId = acceptanceAttemptId ?? headerAttemptId ?? undefined;
    if (attemptId !== undefined && !validCheckoutAttemptId(attemptId)) return NextResponse.json({ error: '报价确认幂等键格式无效' }, { status: 400 });
    const explicitPayment = typeof paymentMethod === 'string' && paymentMethod.trim() !== '';
    const normalizedPayment = explicitPayment ? normalizeOrderPaymentMethod(paymentMethod) : null;
    if (explicitPayment && !normalizedPayment) {
      return NextResponse.json({ error: '请选择有效的付款方式' }, { status: 400 });
    }
    const pointsIntent = normalizePointsIntent({ personalPoints, groupPoints, groupId });
    if ((pointsIntent.personalPoints > 0 || pointsIntent.groupPoints > 0) && !normalizedPayment) {
      return NextResponse.json({ error: '请选择有效的付款方式' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, role: true, email: true, emailVerified: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';
    // 管理员代客接受报价不能代扣客户积分。未传或 0 仍可接受。不新增权限。
    // 代接受生成且尚未支付的订单，由客户本人在付款前调用 POST /api/orders/:orderId/prepay-settlement 选择积分和优惠券。管理员不能代选。
    // 已过期报价（status 为 expired，或 sent 且 validUntil 已到）不能接受，返回 QUOTE_EXPIRED，并把询价标为 quote_expired。不新增权限。
    // 报价有效期内可以分批确认：每次确认新建一张订单，询价保持 quote_sent，直到可下单的报价行全部完成才把报价标为 accepted、询价标为 closed。
    // 询价已放弃、已关闭、已归档，或不是 quote_sent 时不能继续确认。不新增权限。
    // 由此生成的订单号是「询价号-随机短后缀」，并在同一事务内写入 inquiryOrderSeq。购物车和后台代客下单仍用上海日序号。不新增权限。
    if (isAdmin) {
      const pointsError = adminActingPointsError({ personalPoints, groupPoints, groupId });
      if (pointsError) return NextResponse.json({ error: pointsError }, { status: 400 });
    }

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: {
        quotes: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { items: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    if (!isAdmin) {
      if (inquiry.ownerScope === 'organization') {
        if (!inquiry.organizationId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        try {
          await requireOrganizationPermission(user.id, inquiry.organizationId, 'organization.orders.create');
        } catch {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      } else if (inquiry.userId !== user.id && !verifiedEmailMatches(user, inquiry.email)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const fingerprint = attemptId ? buildCheckoutRequestFingerprint({ operation: 'quote-confirmation', actorId: user.id, organizationId: inquiry.organizationId, ownerScope: inquiry.ownerScope, request: { ...body, inquiryId: id, quoteId: quoteId ?? null, quoteVersion: quoteVersion ?? null } }) : null;
    const scopedAttemptId = attemptId ? `quote:${attemptId}` : null;
    const existing = scopedAttemptId ? await prisma.order.findUnique({ where: { checkoutAttemptId: scopedAttemptId } }) : null;
    if (existing && scopedAttemptId) {
      if (existing.inquiryId !== id || existing.organizationId !== inquiry.organizationId || existing.ownerScope !== inquiry.ownerScope || existing.checkoutRequestFingerprint !== fingerprint) return NextResponse.json({ error: '幂等键已用于其他报价确认', code: 'QUOTE_STALE' }, { status: 409 });
      return NextResponse.json({ order: existing, orderId: existing.id, replayed: true });
    }

    const quote = inquiry.quotes[0];
    if (!quote) {
      return NextResponse.json({ error: 'Quote not sent yet' }, { status: 400 });
    }
    if (quoteId !== undefined && (typeof quoteId !== 'string' || quote.id !== quoteId || (quoteVersion !== undefined && quote.version !== quoteVersion))) {
      return NextResponse.json({ error: '报价版本已变化，请刷新后重新确认。', code: 'QUOTE_VERSION_CONFLICT' }, { status: 409 });
    }
    if (quote.status !== 'sent' || quoteIsExpired(quote)) {
      if (quote.status === 'expired' || quoteIsExpired(quote)) {
        await settleExpiredQuotes(prisma, [id]);
        return NextResponse.json({ error: '报价已过期，请刷新后重新确认。', code: 'QUOTE_EXPIRED' }, { status: 400 });
      }
      return NextResponse.json({ error: '报价版本已变化，请刷新后重新确认。', code: 'QUOTE_VERSION_CONFLICT' }, { status: 409 });
    }
    const acceptBlock = inquiryQuoteAcceptBlock(inquiry);
    if (acceptBlock) return NextResponse.json({ error: acceptBlock.error, code: acceptBlock.code }, { status: 409 });

    try {
      const orderItems: OrderItem[] = [];
      const accepted: Array<{ quoteItemId: string; quantity: number; previousOrderedQty: number; nextOrderedQty: number; quotedQuantity: number }> = [];
      for (const idx of itemIndices) {
        const item = quote.items[idx];
        if (!item) return NextResponse.json({ error: '商品索引不存在' }, { status: 400 });
        if (!item.available || item.orderedQty >= item.quantity) throw new Error('QUOTE_CONFLICT');
        const remaining = item.quantity - item.orderedQty;
        const requested = requestedQuantityFromBody(quantities, idx, remaining);
        if (requested == null) return NextResponse.json({ error: '报价商品数量必须是正整数' }, { status: 400 });
        const validated = validateAcceptedQuantity({
          quotedQuantity: item.quantity,
          orderedQty: item.orderedQty,
          requested,
          metadata: item.metadata,
        });
        if (!validated.ok) return NextResponse.json({ error: acceptanceQuantityError(validated.code) }, { status: 400 });
        const qty = validated.quantity;
        const fulfillment = quoteLineFulfillment({
          quotedQuantity: item.quantity,
          orderedQty: item.orderedQty,
          acceptedQuantity: qty,
        });

        orderItems.push({
          productId: item.productId || null,
          name: item.name,
          price: item.unitPrice,
          quantity: qty,
          quotedQuantity: item.quantity,
          shippedQty: 0,
          leadTime: item.leadTime || null,
          status: 'pending',
          metadata: item.metadata || null,
          pricingSnapshot: item.pricingSnapshot,
        });
        accepted.push({
          quoteItemId: item.id,
          quantity: qty,
          previousOrderedQty: item.orderedQty,
          nextOrderedQty: fulfillment.orderedQty,
          quotedQuantity: item.quantity,
        });
      }

      if (orderItems.length === 0) {
        return NextResponse.json({ error: 'No valid items to order' }, { status: 400 });
      }

      const subtotal = orderItems.reduce((sum, item) => sum + lineTotalForAcceptedQuantity(item.price, item.quantity), 0);
      const pointsUserId = inquiry.userId ?? (isAdmin ? null : user.id);
      if ((pointsIntent.personalPoints > 0 || pointsIntent.groupPoints > 0) && !pointsUserId) {
        return NextResponse.json({ error: '订单缺少客户，不能使用积分抵扣' }, { status: 400 });
      }
      const settlement = normalizedPayment
        ? await settleCheckoutPayment(prisma, pointsUserId ?? user.id, {
            paymentMethod: normalizedPayment,
            lineItems: orderItems.map((item) => ({ unitPrice: item.price, quantity: item.quantity })),
            platformFeeBase: subtotal,
            personalPoints: pointsIntent.personalPoints,
            groupPoints: pointsIntent.groupPoints,
            groupId: pointsIntent.groupId,
          })
        : null;
      if (settlement && !settlement.ok) {
        return NextResponse.json({ error: settlement.error }, { status: 400 });
      }
      const settled = settlement && settlement.ok ? settlement : null;
      const orderPaymentMethod = settled?.paymentMethod ?? inquiry.paymentMethod;
      const orderTotal = settled?.amounts.total ?? subtotal;
      const orderSubtotal = settled?.amounts.subtotal ?? subtotal;
      const orderAdjustmentTotal = settled?.amounts.adjustmentTotal ?? 0;

      const orderStatus = initialOrderStatus(orderPaymentMethod);
      const pointsAudit = {
        ...quoteAcceptancePointsAudit(orderTotal),
        pointsRedeemed: (settled?.pointsBreakdown?.personalPoints ?? 0) + (settled?.pointsBreakdown?.groupPoints ?? 0),
      };
      const { orderId, allOrdered } = await withAllocatedInquiryOrderNumber(prisma, id, async (tx, orderId, inquiryOrderSeq) => {
        let allOrdered = false;
        const current = await tx.quote.findFirst({ where: { inquiryId: id }, orderBy: { version: 'desc' }, include: { items: true } });
        if (current && (current.status === 'expired' || quoteValidUntilPassed(current.validUntil))) {
          throw new Error('QUOTE_EXPIRED');
        }
        if (!current || current.id !== quote.id || current.version !== quote.version || current.status !== 'sent') {
          throw new Error('QUOTE_CONFLICT');
        }
        const currentInquiry = await tx.inquiry.findUnique({
          where: { id },
          select: { status: true, archivedAt: true },
        });
        const blocked = currentInquiry
          ? inquiryQuoteAcceptBlock(currentInquiry)
          : { code: 'INQUIRY_NOT_ACCEPTABLE' as const, error: '当前询价不能确认报价' };
        if (blocked) throw new InquiryAcceptRejected(blocked.code, blocked.error);
        if (settled?.pointsBreakdown && pointsUserId) {
          await assertCheckoutPointsAvailable(tx, pointsUserId, settled.amountsBeforePoints.total, settled.intent);
        }
        await assertQuoteAcceptanceStock(tx, orderItems.map((item) => ({
          productId: item.productId ?? null,
          quantity: item.quantity,
          metadata: item.metadata ?? null,
        })));
        await assertQuoteAcceptanceCredit(tx, {
          userId: inquiry.userId,
          email: inquiry.email,
          paymentMethod: orderPaymentMethod,
          total: orderTotal,
        });
        for (const item of accepted) {
          const claimed = await tx.quoteItem.updateMany({
            where: { id: item.quoteItemId, quoteId: quote.id, available: true, orderedQty: item.previousOrderedQty, quantity: { gte: item.nextOrderedQty } },
            data: { orderedQty: item.nextOrderedQty },
          });
          if (claimed.count !== 1) throw new Error('QUOTE_CONFLICT');
        }
        const remainingItems = await tx.quoteItem.findMany({ where: { quoteId: quote.id } });
        allOrdered = remainingItems.every((item) => !item.available || item.orderedQty >= item.quantity);
        const created = await tx.order.create({ data: {
          id: orderId,
          inquiryId: id,
          inquiryOrderSeq,
          email: inquiry.email,
          customerId: inquiry.userId,
          organizationId: inquiry.organizationId,
          ownerScope: inquiry.ownerScope,
          subtotal: orderSubtotal,
          adjustmentTotal: orderAdjustmentTotal,
          total: orderTotal,
          status: orderStatus,
          ...(scopedAttemptId ? { checkoutAttemptId: scopedAttemptId, checkoutRequestFingerprint: fingerprint } : {}),
          autoCloseAt: orderAutoCloseAt(orderPaymentMethod),
          paymentMethod: orderPaymentMethod,
          pointsPersonal: settled?.pointsBreakdown?.personalPoints ?? 0,
          pointsGroup: settled?.pointsBreakdown?.groupPoints ?? 0,
          pointsGroupId: settled?.pointsBreakdown?.groupId ?? null,
          pointsDiscount: settled?.pointsBreakdown?.pointsDiscount ?? 0,
          ...(settled && settled.adjustments.length ? {
            adjustments: {
              create: settled.adjustments.map((adjustment) => ({
                type: adjustment.type,
                label: adjustment.label,
                amount: adjustment.amount,
                reason: adjustment.reason ?? null,
              })),
            },
          } : {}),
          orderItems: {
            create: toOrderItemCreates(orderItems as unknown as Array<Record<string, unknown>>),
          },
          statusHistory: {
            create: {
              toStatus: orderStatus,
              actorId: session.user.id as string,
              actorEmail: user.email,
              reason: 'inquiry_items_confirmed',
            },
          },
          events: { create: {
            type: 'order_created',
            actorId: session.user.id as string,
            actorEmail: user.email,
            message: '客户确认报价商品并生成订单',
            metadata: JSON.stringify({
              ...pointsAudit,
              items: accepted.map((item) => ({
                quoteItemId: item.quoteItemId,
                quotedQuantity: item.quotedQuantity,
                orderedQuantity: item.quantity,
                quantity: item.quantity,
              })),
            }),
          } },
        } });
        await reserveOrderInventory(tx, created.id, session.user.id as string, '询价转订单预占规格库存', { variantLinesOnly: true });
        if (settled?.pointsBreakdown) {
          const applied = await applyOrderPointsDeduction(tx, created.id);
          if (!applied.ok) throw new Error(`POINTS_APPLY:${applied.error}`);
        }
        await tx.quoteConfirmation.create({
          data: {
            quoteId: quote.id,
            userId: session.user.id as string,
            email: user.email,
            action: allOrdered ? 'accept' : 'partial_accept',
            details: JSON.stringify({
              orderId,
              items: accepted.map((item) => ({
                quoteItemId: item.quoteItemId,
                quotedQuantity: item.quotedQuantity,
                orderedQuantity: item.quantity,
                quantity: item.quantity,
              })),
            }),
            ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
            userAgent: req.headers.get('user-agent'),
          },
        });
        if (allOrdered) {
          await tx.quote.update({ where: { id: quote.id }, data: { status: 'accepted', acceptedAt: new Date() } });
          await tx.inquiry.update({ where: { id }, data: { status: 'closed' } });
        }
        return { orderId, allOrdered };
      });

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { orderItems: { orderBy: { position: 'asc' } } },
      });
      return NextResponse.json({
        order: order ? { ...order, items: order.orderItems.map(orderItemView), orderItems: undefined } : null,
        orderId,
        allOrdered,
      });
    } catch (e) {
      if (isVariantStockInsufficientError(e)) {
        return NextResponse.json({ error: VARIANT_STOCK_INSUFFICIENT_MESSAGE, code: VARIANT_STOCK_INSUFFICIENT }, { status: 400 });
      }
      if (e instanceof Error && e.message.startsWith('POINTS_')) {
        const message = e.message.replace(/^POINTS_(PRECHECK|APPLY):/, '');
        return NextResponse.json({ error: message }, { status: 400 });
      }
      if (e instanceof Error && e.message === 'INSUFFICIENT_STOCK') {
        return NextResponse.json({ error: '库存不足', code: 'INSUFFICIENT_STOCK' }, { status: 409 });
      }
      if (e instanceof Error && (e.message === 'CREDIT_LIMIT_EXCEEDED' || e.message === 'CREDIT_ACCOUNT_SUSPENDED')) {
        return NextResponse.json({ error: '授信额度不足或账户不可用', code: e.message }, { status: 403 });
      }
      if (e instanceof InquiryAcceptRejected) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
      }
      if (e instanceof Error && e.message === 'QUOTE_EXPIRED') {
        await settleExpiredQuotes(prisma, [id]);
        return NextResponse.json({ error: '报价已过期，请刷新后重新确认。', code: 'QUOTE_EXPIRED' }, { status: 400 });
      }
      if (e instanceof Error && e.message === 'QUOTE_CONFLICT') {
        if (scopedAttemptId) {
          const winner = await prisma.order.findUnique({ where: { checkoutAttemptId: scopedAttemptId } });
          if (winner && winner.inquiryId === id && winner.organizationId === inquiry.organizationId && winner.ownerScope === inquiry.ownerScope && winner.checkoutRequestFingerprint === fingerprint) {
            return NextResponse.json({ order: winner, orderId: winner.id, replayed: true });
          }
        }
        return NextResponse.json({ error: '报价或剩余数量已变化，请刷新后重新确认', code: 'QUOTE_VERSION_CONFLICT' }, { status: 409 });
      }
      if (isInquiryLinkedOrderConflict(e)) {
        console.error('[confirm-items POST] order number conflict', e);
        return NextResponse.json({ error: ORDER_NUMBER_BUSY_ERROR }, { status: 503 });
      }
      if (isUniqueConstraintError(e) && scopedAttemptId) {
        const winner = await prisma.order.findUnique({ where: { checkoutAttemptId: scopedAttemptId } });
        if (winner) {
          if (winner.inquiryId !== id || winner.organizationId !== inquiry.organizationId || winner.ownerScope !== inquiry.ownerScope || winner.checkoutRequestFingerprint !== fingerprint) return NextResponse.json({ error: '幂等键已用于其他报价确认', code: 'QUOTE_STALE' }, { status: 409 });
          return NextResponse.json({ order: winner, orderId: winner.id, replayed: true });
        }
      }
      console.error('[confirm-items parse error]', e);
      return NextResponse.json({ error: '订单处理失败，请稍后重试' }, { status: 500 });
    }
  } catch (err) {
    console.error('[confirm-items POST] error:', err);
    return NextResponse.json({ error: '订单处理失败，请稍后重试' }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  if (activeUser.role === 'admin') {
    const admin = await requireAdmin('orders.read');
    if (admin instanceof NextResponse) return admin;
  }
  const session = { user: activeUser };

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, role: true, email: true, emailVerified: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { quotes: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }
    if (!isAdmin) {
      const allowed = inquiry.ownerScope === 'organization'
        ? Boolean(inquiry.organizationId) && await canAccessOrganizationRecord(user.id, inquiry.organizationId as string)
        : inquiry.userId === user.id || verifiedEmailMatches(user, inquiry.email);
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const orders = await prisma.order.findMany({
      where: { inquiryId: id },
      orderBy: { createdAt: 'desc' },
      include: { orderItems: { orderBy: { position: 'asc' } } },
    });

    return NextResponse.json({
      orders: orders.map(({ orderItems, ...order }) => ({
        ...order,
        items: orderItems.map(orderItemView),
      })),
      inquiryStatus: inquiry.status,
      quoteStatus: inquiry.quotes[0]?.status ?? null,
    });
  } catch (err) {
    console.error('[confirm-items GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
