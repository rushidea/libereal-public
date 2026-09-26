import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { alipayAmountToCents, getAlipaySdk, parseAlipayAmountCents } from '@/lib/alipay';
import { writeAuditLog } from '@/lib/audit';
import { applyOrderPointsDeduction } from '@/lib/points-checkout-service';
import { AUTO_CLOSEABLE_ORDER_STATUSES, isInactiveOrderStatus } from '@/lib/order-domain';

const SUCCESS_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED']);

function amountsEqualInCents(left: number, right: number): boolean {
  const leftCents = alipayAmountToCents(left);
  const rightCents = alipayAmountToCents(right);
  return leftCents !== null && rightCents !== null && leftCents === rightCents;
}

async function handlePointsTopupNotify(data: Record<string, string>) {
  const topup = await prisma.pointsTopup.findUnique({ where: { outTradeNo: data.out_trade_no } });
  if (!topup) return new NextResponse('fail', { status: 400 });

  const notifiedAmountCents = parseAlipayAmountCents(data.total_amount || '');
  const topupAmountCents = alipayAmountToCents(topup.amount);
  if (notifiedAmountCents === null || topupAmountCents === null || notifiedAmountCents !== topupAmountCents) {
    return new NextResponse('fail', { status: 400 });
  }

  const isPaid = SUCCESS_STATUSES.has(data.trade_status);
  if (!isPaid) return new NextResponse('success');
  if (topup.status === 'paid') return new NextResponse('success');

  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.pointsTopup.updateMany({
      where: { id: topup.id, status: { not: 'paid' } },
      data: { status: 'paid', tradeNo: data.trade_no || null, paidAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    if (topup.targetType === 'group' && topup.groupId) {
      await tx.researchGroup.update({
        where: { id: topup.groupId },
        data: { points: { increment: topup.points } },
      });
      await tx.groupPointsLog.create({
        data: {
          groupId: topup.groupId,
          delta: topup.points,
          type: 'topup_alipay',
          reason: '支付宝充值课题组积分',
          relatedId: topup.id,
          actorUserId: topup.userId,
        },
      });
    } else {
      await tx.user.update({
        where: { id: topup.userId },
        data: { points: { increment: topup.points } },
      });
      await tx.pointsLog.create({
        data: {
          userId: topup.userId,
          delta: topup.points,
          type: 'topup_alipay',
          reason: '支付宝充值个人积分',
          relatedId: topup.id,
        },
      });
    }
    return true;
  });

  if (!applied) return new NextResponse('success');

  return new NextResponse('success');
}

export async function POST(req: Request) {
  const client = getAlipaySdk();
  if (!client) return new NextResponse('fail', { status: 503 });
  const formData = Object.fromEntries((await req.formData()).entries());
  const data = Object.fromEntries(Object.entries(formData).map(([key, value]) => [key, String(value)]));
  if (!client.sdk.checkNotifySign(data)) return new NextResponse('fail', { status: 400 });
  if (data.app_id !== client.config.appId || data.seller_id !== client.config.sellerId) {
    return new NextResponse('fail', { status: 400 });
  }

  // 积分充值单 outTradeNo 以 PT 开头
  if (data.out_trade_no?.startsWith('PT')) {
    return handlePointsTopupNotify(data);
  }

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { outTradeNo: data.out_trade_no },
    include: {
      order: {
        select: {
          id: true,
          total: true,
          paidAt: true,
          status: true,
          pointsPersonal: true,
          pointsGroup: true,
          pointsApplied: true,
        },
      },
    },
  });
  const notifiedAmountCents = parseAlipayAmountCents(data.total_amount || '');
  const attemptAmountCents = attempt ? alipayAmountToCents(attempt.amount) : null;
  if (
    !attempt
    || notifiedAmountCents === null
    || attemptAmountCents === null
    || notifiedAmountCents !== attemptAmountCents
  ) {
    return new NextResponse('fail', { status: 400 });
  }

  const isPaid = SUCCESS_STATUSES.has(data.trade_status);
  if (isPaid && (!amountsEqualInCents(attempt.amount, attempt.order.total) || isInactiveOrderStatus(attempt.order.status))) {
    const rejectedStatus = amountsEqualInCents(attempt.amount, attempt.order.total)
      ? 'rejected_order_cancelled'
      : 'rejected_amount_mismatch';
    await prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: rejectedStatus, tradeNo: data.trade_no || null, notifiedAt: new Date() },
      });
      await writeAuditLog({
        action: 'payment.alipay_rejected',
        resource: 'payments',
        targetType: 'Order',
        targetId: attempt.order.id,
        after: {
          outTradeNo: attempt.outTradeNo,
          tradeNo: data.trade_no || null,
          amount: attempt.amount,
          orderTotal: attempt.order.total,
          orderStatus: attempt.order.status,
          reason: rejectedStatus,
        },
      }, tx);
    });
    return new NextResponse('success');
  }

  try {
    await prisma.$transaction(async (tx) => {
      let firstPayment = false;
      let pointsSettlement: 'not_required' | 'applied' | 'pending' = 'not_required';
      let pointsSettlementError: string | null = null;
      if (isPaid) {
        const claimed = await tx.order.updateMany({
          where: {
            id: attempt.order.id,
            paidAt: null,
            status: { in: [...AUTO_CLOSEABLE_ORDER_STATUSES] },
          },
          data: { paidAt: new Date(), status: 'pending', autoCloseAt: null },
        });
        firstPayment = claimed.count === 1;
        if (!firstPayment) {
          const latest = await tx.order.findUnique({
            where: { id: attempt.order.id },
            select: { status: true, paidAt: true },
          });
          if (!latest?.paidAt) {
            await tx.paymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'rejected_order_cancelled',
                tradeNo: data.trade_no || null,
                notifiedAt: new Date(),
              },
            });
            await writeAuditLog({
              action: 'payment.alipay_rejected',
              resource: 'payments',
              targetType: 'Order',
              targetId: attempt.order.id,
              after: {
                outTradeNo: attempt.outTradeNo,
                tradeNo: data.trade_no || null,
                amount: attempt.amount,
                orderTotal: attempt.order.total,
                orderStatus: latest?.status ?? attempt.order.status,
                reason: 'rejected_order_cancelled',
              },
            }, tx);
            return;
          }
        }
      }
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: isPaid ? 'paid' : data.trade_status || 'notified',
          tradeNo: data.trade_no || null,
          notifiedAt: new Date(),
          ...(isPaid && !attempt.paidAt ? { paidAt: new Date() } : {}),
        },
      });
      if (isPaid && (firstPayment || !attempt.order.pointsApplied)) {
        if (!attempt.order.pointsApplied && (attempt.order.pointsPersonal > 0 || attempt.order.pointsGroup > 0)) {
          try {
            const applied = await applyOrderPointsDeduction(tx, attempt.order.id);
            if (applied.ok) {
              pointsSettlement = 'applied';
            } else {
              pointsSettlement = 'pending';
              pointsSettlementError = applied.error;
            }
          } catch (error) {
            pointsSettlement = 'pending';
            pointsSettlementError = error instanceof Error ? error.message : '积分结算失败';
          }
        }
      }
      if (isPaid && firstPayment) {
        await tx.order.update({
          where: { id: attempt.order.id },
          data: {
            ...(attempt.order.status === 'unpaid' ? {
              statusHistory: {
                create: {
                  fromStatus: 'unpaid',
                  toStatus: 'pending',
                  actorEmail: 'system',
                  reason: 'alipay_paid',
                },
              },
            } : {}),
            events: {
              create: {
                type: 'payment_received',
                message: pointsSettlement === 'pending' ? '支付宝支付成功，积分待处理' : '支付宝支付成功',
                metadata: JSON.stringify({
                  outTradeNo: attempt.outTradeNo,
                  tradeNo: data.trade_no || null,
                  pointsSettlement,
                  ...(pointsSettlementError ? { pointsSettlementError } : {}),
                }),
              },
            },
          },
        });
        await writeAuditLog({
          action: 'payment.alipay_paid',
          resource: 'payments',
          targetType: 'Order',
          targetId: attempt.order.id,
          after: { outTradeNo: attempt.outTradeNo, tradeNo: data.trade_no || null, amount: attempt.amount },
        }, tx);
      }
      if (isPaid && pointsSettlement === 'pending') {
        await tx.order.update({
          where: { id: attempt.order.id },
          data: {
            events: {
              create: {
                type: 'points_settlement_pending',
                message: '支付宝订单积分待处理',
                metadata: JSON.stringify({
                  outTradeNo: attempt.outTradeNo,
                  pointsSettlementError,
                }),
              },
            },
          },
        });
        await writeAuditLog({
          action: 'payment.alipay_points_pending',
          resource: 'payments',
          targetType: 'Order',
          targetId: attempt.order.id,
          after: {
            outTradeNo: attempt.outTradeNo,
            pointsApplied: false,
            reason: pointsSettlementError,
          },
        }, tx);
      }
    });
  } catch (error) {
    console.error('[alipay notify] notification processing failed', error);
    return new NextResponse('fail', { status: 500 });
  }
  return new NextResponse('success');
}
