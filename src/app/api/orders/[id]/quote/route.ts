import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertOrderPricingResolved } from '@/lib/order-catalog-repricing';
import { authorizeAdminOrderMutation, consumeAdminOrderStepUp, extractStepUpToken } from '@/lib/admin-order-step-up';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { reserveOrderInventory } from '@/lib/inventory';
import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { canEnterOrderQuoteFlow, orderQuoteStatusRejectionMessage, UNPAID_ORDER_QUOTE_CONFIRM_REJECTION } from '@/lib/order-domain';
import {
  merchantAcceptanceMetadata,
  merchantOrderQuoteAction,
  ORDER_APPROVAL_INCLUDE,
  orderApprovalConflict,
  verifyMerchantOrderApproval,
} from '@/lib/order-approval';

const CONFIRMATION_CONFLICTS = [
  'QUOTE_REPRICE_REQUIRED',
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_ACCOUNT_SUSPENDED',
  'CREDIT_USER_NOT_FOUND',
  'RECEIVABLE_NOT_FOUND',
  'INSUFFICIENT_AVAILABLE_INVENTORY',
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const stepUpToken = extractStepUpToken(body);
  const user = await authorizeAdminOrderMutation('orders.write', stepUpToken);
  if (user instanceof NextResponse) return user;

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (!canEnterOrderQuoteFlow(order.status)) {
      return NextResponse.json({ error: orderQuoteStatusRejectionMessage(order.status) }, { status: 409 });
    }

    const action = merchantOrderQuoteAction(order);
    if (body?.action !== undefined && body.action !== action) throw new Error('ORDER_APPROVAL_CHANGED');
    const shouldConfirm = action === 'accept_order';
    if (shouldConfirm && order.status !== 'pending') {
      return NextResponse.json({ error: UNPAID_ORDER_QUOTE_CONFIRM_REJECTION }, { status: 409 });
    }

    const stepUpFailure = await consumeAdminOrderStepUp(user, stepUpToken);
    if (stepUpFailure) return stepUpFailure;
    await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id }, include: ORDER_APPROVAL_INCLUDE });
      if (!current || current.archivedAt || current.status !== order.status || merchantOrderQuoteAction(current) !== action) {
        throw new Error('ORDER_APPROVAL_CHANGED');
      }

      await assertOrderPricingResolved(tx, id);
      // Legacy clients can still send a quote. A state change can never turn that
      // request into acceptance without the applicable preview.
      const preview = shouldConfirm || body?.action !== undefined || body?.approvalVersion !== undefined
        ? await verifyMerchantOrderApproval(tx, current, action, body?.approvalVersion) : null;
      if (!shouldConfirm && current.quoteSent) return;

      const claimed = await tx.order.updateMany({
        where: { id, status: current.status, archivedAt: null },
        data: {
          quoteSent: true,
          quoteSentAt: current.quoteSentAt ?? new Date(),
          ...(shouldConfirm ? { status: 'confirmed', autoCloseAt: null } : {}),
        },
      });
      if (claimed.count !== 1) throw new Error('ORDER_APPROVAL_CHANGED');

      if (preview?.action === 'accept_order') {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id, fromStatus: current.status, toStatus: 'confirmed', actorId: user.id, actorEmail: user.email,
            reason: 'quote_sent', metadata: merchantAcceptanceMetadata(preview),
          },
        });
        if (isPostDeliveryPaymentMethod(current.paymentMethod)) await reserveOrderCredit(tx, id, user.id);
        await reserveOrderInventory(tx, id, user.id);
      }
      const title = shouldConfirm ? '订单确认' : '报价通知';
      const message = shouldConfirm ? '订单已确认，请查看订单详情。' : '报价已发送，请在订单详情中完成支付宝付款。';
      await enqueueBackgroundTask('email.send', {
        kind: 'quote', to: current.email, subject: `LIBEREAL · ${title}`, message, path: '/account/orders',
      }, {
        priority: 5,
        dedupeKey: shouldConfirm ? `order-acceptance-email:${id}` : `order-quote-email:${id}`,
      }, tx);
      await tx.notification.create({
        data: {
          email: current.email, role: 'customer', type: 'quote_received', title,
          content: message, linkUrl: '/account/orders', metadata: JSON.stringify({ orderId: id }),
        },
      });
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[orders/[id]/quote POST] error:', err);
    const conflict = orderApprovalConflict(err);
    if (conflict) return NextResponse.json(conflict, { status: 409 });
    const message = err instanceof Error ? err.message : '';
    if (CONFIRMATION_CONFLICTS.includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
