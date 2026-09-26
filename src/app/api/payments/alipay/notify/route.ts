import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { alipayAmountToCents, getAlipaySdk, parseAlipayAmountCents } from '@/lib/alipay';
import { writeAuditLog } from '@/lib/audit';
import { settlePaymentPoints } from '@/lib/payment-concurrency';
import { AUTO_CLOSEABLE_ORDER_STATUSES, isInactiveOrderStatus } from '@/lib/order-domain';

const SUCCESS_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED']);

function isTerminalAttemptStatus(status: string | null | undefined): boolean {
  return status === 'TRADE_CLOSED'
    || status === 'paid_terminal_reconciliation_required'
    || status === 'paid'
    || status === 'paid_superseded_reconciliation_required'
    || status === 'rejected_order_cancelled'
    || status === 'rejected_amount_mismatch';
}

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
  try {
    await prisma.$transaction(async (tx) => {
      const latestAttempt = await tx.paymentAttempt.findUnique({
        where: { id: attempt.id },
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
      if (!latestAttempt) return;

      // A newer attempt owns the order. Retain a late successful gateway
      // callback as a reconciliation fact, with a CAS so concurrent callbacks
      // produce one state transition and one audit entry.
      if (latestAttempt.status === 'superseded' || latestAttempt.status === 'paid_superseded_reconciliation_required') {
        if (latestAttempt.status === 'superseded' && isPaid) {
          const reconciled = await tx.paymentAttempt.updateMany({
            where: { id: latestAttempt.id, status: 'superseded' },
            data: {
              status: 'paid_superseded_reconciliation_required',
              tradeNo: data.trade_no || null,
              notifiedAt: new Date(),
              paidAt: latestAttempt.paidAt ?? new Date(),
            },
          });
          if (reconciled.count === 1) {
            await writeAuditLog({
              action: 'payment.alipay_superseded_paid_reconciliation_required',
              resource: 'payments',
              targetType: 'Order',
              targetId: latestAttempt.order.id,
              after: {
                outTradeNo: latestAttempt.outTradeNo,
                tradeNo: data.trade_no || null,
                amount: latestAttempt.amount,
                orderTotal: latestAttempt.order.total,
                reason: 'superseded_attempt_paid',
              },
            }, tx);
          }
        }
        return;
      }

      if (latestAttempt.status === 'TRADE_CLOSED' || latestAttempt.status === 'paid_terminal_reconciliation_required') {
        if (latestAttempt.status === 'TRADE_CLOSED' && isPaid) {
          const reconciled = await tx.paymentAttempt.updateMany({
            where: { id: latestAttempt.id, status: 'TRADE_CLOSED' },
            data: { status: 'paid_terminal_reconciliation_required', tradeNo: data.trade_no || null, notifiedAt: new Date(), paidAt: latestAttempt.paidAt ?? new Date() },
          });
          if (reconciled.count === 1) await writeAuditLog({
            action: 'payment.alipay_terminal_paid_reconciliation_required', resource: 'payments', targetType: 'Order', targetId: latestAttempt.order.id,
            after: { outTradeNo: latestAttempt.outTradeNo, tradeNo: data.trade_no || null, amount: latestAttempt.amount, reason: 'closed_attempt_paid' },
          }, tx);
        }
        return;
      }

      // A paid attempt may still have a failed points settlement from an
      // earlier callback. Retry that side effect without touching its terminal
      // payment state or the already-settled order.
      if (latestAttempt.status === 'paid') {
        const canRetryPoints = isPaid
          && Boolean(latestAttempt.order.paidAt)
          && !isInactiveOrderStatus(latestAttempt.order.status)
          && amountsEqualInCents(latestAttempt.amount, latestAttempt.order.total)
          && !latestAttempt.order.pointsApplied
          && (latestAttempt.order.pointsPersonal > 0 || latestAttempt.order.pointsGroup > 0);
        if (!canRetryPoints) return;
        let pointsSettlementError: string | null = null;
        const applied = await settlePaymentPoints(tx, latestAttempt.order.id);
        if (applied.ok) return;
        pointsSettlementError = applied.error;
        await tx.order.update({
          where: { id: latestAttempt.order.id },
          data: {
            events: {
              create: {
                type: 'points_settlement_pending',
                message: '支付宝订单积分待处理',
                metadata: JSON.stringify({
                  outTradeNo: latestAttempt.outTradeNo,
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
          targetId: latestAttempt.order.id,
          after: {
            outTradeNo: latestAttempt.outTradeNo,
            pointsApplied: false,
            reason: pointsSettlementError,
          },
        }, tx);
        return;
      }

      // Attempt state is monotonic. Delayed non-paid notifications and
      // duplicate paid notifications must not rewrite terminal outcomes.
      if (isTerminalAttemptStatus(latestAttempt.status)) return;

      const amountMatchesOrder = amountsEqualInCents(latestAttempt.amount, latestAttempt.order.total);
      if (isPaid && (!amountMatchesOrder || isInactiveOrderStatus(latestAttempt.order.status))) {
        const rejectedStatus = amountMatchesOrder
          ? 'rejected_order_cancelled'
          : 'rejected_amount_mismatch';
        const rejected = await tx.paymentAttempt.updateMany({
          where: {
            id: latestAttempt.id,
            status: { notIn: ['paid', 'rejected_order_cancelled', 'rejected_amount_mismatch'] },
          },
          data: { status: rejectedStatus, tradeNo: data.trade_no || null, notifiedAt: new Date() },
        });
        if (rejected.count !== 1) return;
        await writeAuditLog({
          action: 'payment.alipay_rejected',
          resource: 'payments',
          targetType: 'Order',
          targetId: latestAttempt.order.id,
          after: {
            outTradeNo: latestAttempt.outTradeNo,
            tradeNo: data.trade_no || null,
            amount: latestAttempt.amount,
            orderTotal: latestAttempt.order.total,
            orderStatus: latestAttempt.order.status,
            reason: rejectedStatus,
          },
        }, tx);
        return;
      }

      let firstPayment = false;
      let pointsSettlement: 'not_required' | 'applied' | 'pending' = 'not_required';
      let pointsSettlementError: string | null = null;
      if (isPaid) {
        const claimed = await tx.order.updateMany({
          where: {
            id: latestAttempt.order.id,
            total: latestAttempt.order.total,
            paidAt: null,
            status: { in: [...AUTO_CLOSEABLE_ORDER_STATUSES] },
          },
          data: { paidAt: new Date(), status: 'pending', autoCloseAt: null },
        });
        firstPayment = claimed.count === 1;
        if (!firstPayment) {
          const latest = await tx.order.findUnique({
            where: { id: latestAttempt.order.id },
            select: { status: true, paidAt: true },
          });
          if (!latest?.paidAt) {
            const rejected = await tx.paymentAttempt.updateMany({
              where: { id: latestAttempt.id, status: latestAttempt.status },
              data: {
                status: 'rejected_order_cancelled',
                tradeNo: data.trade_no || null,
                notifiedAt: new Date(),
              },
            });
            if (rejected.count !== 1) return;
            await writeAuditLog({
              action: 'payment.alipay_rejected',
              resource: 'payments',
              targetType: 'Order',
              targetId: latestAttempt.order.id,
              after: {
                outTradeNo: latestAttempt.outTradeNo,
                tradeNo: data.trade_no || null,
                amount: latestAttempt.amount,
                orderTotal: latestAttempt.order.total,
                orderStatus: latest?.status ?? latestAttempt.order.status,
                reason: 'rejected_order_cancelled',
              },
            }, tx);
            return;
          }
        }
      }
      await tx.paymentAttempt.update({
        where: { id: latestAttempt.id },
        data: {
          status: isPaid ? 'paid' : data.trade_status || 'notified',
          tradeNo: data.trade_no || null,
          notifiedAt: new Date(),
          ...(isPaid && !latestAttempt.paidAt ? { paidAt: new Date() } : {}),
        },
      });
      if (isPaid && (firstPayment || !latestAttempt.order.pointsApplied)) {
        if (!latestAttempt.order.pointsApplied && (latestAttempt.order.pointsPersonal > 0 || latestAttempt.order.pointsGroup > 0)) {
          const applied = await settlePaymentPoints(tx, latestAttempt.order.id);
          if (applied.ok) {
            pointsSettlement = 'applied';
          } else {
            pointsSettlement = 'pending';
            pointsSettlementError = applied.error;
          }
        }
      }
      if (isPaid && firstPayment) {
        await tx.order.update({
          where: { id: latestAttempt.order.id },
          data: {
            ...(latestAttempt.order.status === 'unpaid' ? {
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
                  outTradeNo: latestAttempt.outTradeNo,
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
          targetId: latestAttempt.order.id,
          after: { outTradeNo: latestAttempt.outTradeNo, tradeNo: data.trade_no || null, amount: latestAttempt.amount },
        }, tx);
      }
      if (isPaid && pointsSettlement === 'pending') {
        await tx.order.update({
          where: { id: latestAttempt.order.id },
          data: {
            events: {
              create: {
                type: 'points_settlement_pending',
                message: '支付宝订单积分待处理',
                metadata: JSON.stringify({
                  outTradeNo: latestAttempt.outTradeNo,
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
          targetId: latestAttempt.order.id,
          after: {
            outTradeNo: latestAttempt.outTradeNo,
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
