import type { Prisma, PrismaClient } from '@prisma/client';
import {
  buildPointsRedeemBreakdown,
  normalizePointsIntent,
  splitProportionalRefund,
  type PointsRedeemBreakdown,
  type PointsRedeemIntent,
} from '@/lib/points-checkout';
import { isInactiveOrderStatus } from '@/lib/order-domain';

type Tx = Prisma.TransactionClient | PrismaClient;

export async function getUserPointsBalance(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      points: true,
      researchGroupMembership: {
        select: {
          groupId: true,
          role: true,
          group: {
            select: {
              id: true,
              name: true,
              points: true,
              status: true,
              locked: true,
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const membership = user.researchGroupMembership;
  const raw = membership?.group;
  // 归档课题组不返回；pending / active 均返回以便前端展示审核状态
  const group = raw && raw.status !== 'archived'
    ? {
        id: raw.id,
        name: raw.name,
        points: raw.points,
        status: raw.status,
        locked: raw.locked,
        role: membership!.role,
        usable: raw.status === 'active',
      }
    : null;

  return {
    personalPoints: user.points,
    group,
  };
}

export async function previewPointsRedeem(
  tx: Tx,
  userId: string,
  payableBeforePoints: number,
  intentRaw: Partial<PointsRedeemIntent>,
): Promise<{ ok: true; breakdown: PointsRedeemBreakdown } | { ok: false; error: string }> {
  const balance = await getUserPointsBalance(tx, userId);
  if (!balance) return { ok: false, error: '用户不存在' };

  const intent = normalizePointsIntent(intentRaw);
  const usable = balance.group?.usable === true;
  return buildPointsRedeemBreakdown({
    payableBeforePoints,
    personalBalance: balance.personalPoints,
    groupBalance: usable ? (balance.group?.points ?? 0) : 0,
    intent: {
      ...intent,
      groupId: intent.groupId ?? (usable ? balance.group?.id ?? null : null),
    },
    membershipGroupId: usable ? (balance.group?.id ?? null) : null,
  });
}

/** 条件扣减个人积分；余额不足返回 false */
async function deductPersonalPoints(
  tx: Tx,
  args: { userId: string; points: number; relatedId: string; reason?: string },
): Promise<boolean> {
  if (args.points <= 0) return true;
  const updated = await tx.user.updateMany({
    where: { id: args.userId, points: { gte: args.points } },
    data: { points: { decrement: args.points } },
  });
  if (updated.count !== 1) return false;
  await tx.pointsLog.create({
    data: {
      userId: args.userId,
      delta: -args.points,
      type: 'order_redeem',
      reason: args.reason ?? '订单积分抵扣',
      relatedId: args.relatedId,
    },
  });
  return true;
}

async function deductGroupPoints(
  tx: Tx,
  args: { groupId: string; points: number; relatedId: string; actorUserId: string; allowArchived?: boolean; reason?: string },
): Promise<boolean> {
  if (args.points <= 0) return true;
  const updated = await tx.researchGroup.updateMany({
    where: {
      id: args.groupId,
      points: { gte: args.points },
      status: args.allowArchived ? { in: ['active', 'archived'] } : 'active',
    },
    data: { points: { decrement: args.points } },
  });
  if (updated.count !== 1) return false;
  await tx.groupPointsLog.create({
    data: {
      groupId: args.groupId,
      delta: -args.points,
      type: 'order_redeem',
      reason: args.reason ?? '订单积分抵扣',
      relatedId: args.relatedId,
      actorUserId: args.actorUserId,
    },
  });
  return true;
}

async function creditPersonalPoints(
  tx: Tx,
  args: { userId: string; points: number; relatedId: string; reason?: string },
) {
  if (args.points <= 0) return;
  await tx.user.update({
    where: { id: args.userId },
    data: { points: { increment: args.points } },
  });
  await tx.pointsLog.create({
    data: {
      userId: args.userId,
      delta: args.points,
      type: 'order_redeem_refund',
      reason: args.reason ?? '订单积分退回',
      relatedId: args.relatedId,
    },
  });
}

async function creditGroupPoints(
  tx: Tx,
  args: { groupId: string; points: number; relatedId: string; actorUserId?: string | null; reason?: string },
) {
  if (args.points <= 0) return;
  await tx.researchGroup.update({
    where: { id: args.groupId },
    data: { points: { increment: args.points } },
  });
  await tx.groupPointsLog.create({
    data: {
      groupId: args.groupId,
      delta: args.points,
      type: 'order_redeem_refund',
      reason: args.reason ?? '订单积分退回',
      relatedId: args.relatedId,
      actorUserId: args.actorUserId ?? null,
    },
  });
}

/**
 * 对订单执行积分扣减（幂等：已 applied 则跳过）。
 * 下单时调用并记录积分占用；历史支付宝订单在到账通知中继续调用以完成补偿结算。
 */
export async function applyOrderPointsDeduction(
  tx: Tx,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsGroupId: true,
      pointsDiscount: true,
      pointsApplied: true,
      status: true,
    },
  });
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.pointsApplied) return { ok: true };
  if (!order.customerId) return { ok: false, error: '订单缺少客户' };
  if (isInactiveOrderStatus(order.status)) return { ok: false, error: '订单已取消' };

  const claimed = await tx.order.updateMany({
    where: { id: orderId, pointsApplied: false },
    data: { pointsApplied: true, pointsAppliedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: true };
  if (order.pointsPersonal <= 0 && order.pointsGroup <= 0) return { ok: true };

  if (order.pointsPersonal > 0) {
    const ok = await deductPersonalPoints(tx, {
      userId: order.customerId,
      points: order.pointsPersonal,
      relatedId: order.id,
    });
    if (!ok) throw new Error('POINTS_APPLY:个人积分不足');
  }

  if (order.pointsGroup > 0) {
    if (!order.pointsGroupId) throw new Error('POINTS_APPLY:缺少课题组');
    const ok = await deductGroupPoints(tx, {
      groupId: order.pointsGroupId,
      points: order.pointsGroup,
      relatedId: order.id,
      actorUserId: order.customerId,
      // 订单创建时已校验下单人是该课题组成员；到账阶段按订单保存的积分意图结算，成员后续退出不改变已接受的订单。
      allowArchived: true,
    });
    if (!ok) {
      // 回滚已扣个人分
      if (order.pointsPersonal > 0) {
        await creditPersonalPoints(tx, {
          userId: order.customerId,
          points: order.pointsPersonal,
          relatedId: order.id,
          reason: '课题组扣减失败回滚',
        });
      }
      throw new Error('POINTS_APPLY:课题组积分不足');
    }
  }

  return { ok: true };
}

/**
 * 按退款金额比例退回积分（原路：个人 / 课题组）。
 * refundYuan / originalPaidYuan 决定比例；可多次调用，累计不超过原抵扣。
 */
export async function refundOrderPointsProportionally(
  tx: Tx,
  args: {
    orderId: string;
    refundYuan: number;
    originalPaidYuan: number;
    actorUserId?: string | null;
    reason?: string;
  },
): Promise<{ ok: true; personal: number; group: number } | { ok: false; error: string }> {
  const order = await tx.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      customerId: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsGroupId: true,
      pointsApplied: true,
      pointsRefundedPersonal: true,
      pointsRefundedGroup: true,
    },
  });
  if (!order) return { ok: false, error: '订单不存在' };
  if (!order.pointsApplied) return { ok: true, personal: 0, group: 0 };
  if (!order.customerId) return { ok: false, error: '订单缺少客户' };
  if (order.pointsGroup > 0 && !order.pointsGroupId) return { ok: false, error: '订单缺少课题组' };

  const remainingPersonal = Math.max(0, order.pointsPersonal - order.pointsRefundedPersonal);
  const remainingGroup = Math.max(0, order.pointsGroup - order.pointsRefundedGroup);
  const split = splitProportionalRefund({
    personalPoints: remainingPersonal,
    groupPoints: remainingGroup,
    refundYuan: args.refundYuan,
    originalPaidYuan: args.originalPaidYuan,
  });

  // 若整单取消，退回全部剩余
  const isFull = args.refundYuan >= args.originalPaidYuan - 1e-6;
  const personal = isFull ? remainingPersonal : split.personal;
  const group = isFull ? remainingGroup : split.group;

  const claimed = await tx.order.updateMany({
    where: {
      id: order.id,
      pointsRefundedPersonal: order.pointsRefundedPersonal,
      pointsRefundedGroup: order.pointsRefundedGroup,
    },
    data: {
      pointsRefundedPersonal: { increment: personal },
      pointsRefundedGroup: { increment: group },
    },
  });
  if (claimed.count !== 1) return { ok: false, error: '退款状态已改变，请刷新后重试' };

  await creditPersonalPoints(tx, {
    userId: order.customerId,
    points: personal,
    relatedId: order.id,
    reason: args.reason ?? '订单退款退回积分',
  });
  if (order.pointsGroupId) {
    await creditGroupPoints(tx, {
      groupId: order.pointsGroupId,
      points: group,
      relatedId: order.id,
      actorUserId: args.actorUserId ?? order.customerId,
      reason: args.reason ?? '订单退款退回积分',
    });
  }

  return { ok: true, personal, group };
}

export async function injectPersonalPoints(
  tx: Tx,
  args: { userId: string; points: number; adminEmail: string; reason?: string },
) : Promise<boolean> {
  const updated = await tx.user.updateMany({
    where: { id: args.userId, points: { lte: 1_000_000 - args.points } },
    data: { points: { increment: args.points } },
  });
  if (updated.count !== 1) return false;
  await tx.pointsLog.create({
    data: {
      userId: args.userId,
      delta: args.points,
      type: 'admin_inject',
      reason: args.reason ?? '管理员注入积分',
      adminEmail: args.adminEmail,
    },
  });
  return true;
}

export async function injectGroupPoints(
  tx: Tx,
  args: { groupId: string; points: number; adminEmail: string; actorUserId?: string; reason?: string },
) : Promise<boolean> {
  const updated = await tx.researchGroup.updateMany({
    where: { id: args.groupId, points: { lte: 1_000_000 - args.points } },
    data: { points: { increment: args.points } },
  });
  if (updated.count !== 1) return false;
  await tx.groupPointsLog.create({
    data: {
      groupId: args.groupId,
      delta: args.points,
      type: 'admin_inject',
      reason: args.reason ?? '管理员注入课题组积分',
      adminEmail: args.adminEmail,
      actorUserId: args.actorUserId ?? null,
    },
  });
  return true;
}
