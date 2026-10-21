import type { Prisma, PrismaClient } from '@prisma/client';
import {
  buildPointsRedeemBreakdown,
  calculateCumulativePointsRefund,
  normalizePointsIntent,
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

/** 扣减失败时写回的流水原因。补偿任务用它把失败回滚从真实退款里区分出来。 */
export const POINTS_DEDUCTION_ROLLBACK_REASON = '课题组扣减失败回滚';

/** 付款前改选积分时退回已占用积分。占用净额要把这笔退回抵消，避免再次扣减时漏扣或重扣。 */
export const PREPAY_POINTS_RELEASE_REASON = '付款前调整积分退回';

const POINTS_HOLD_REFUND_REASONS = [POINTS_DEDUCTION_ROLLBACK_REASON, PREPAY_POINTS_RELEASE_REASON] as const;

/** 另一笔结算已经占住订单。调用方应稍后重试，不要把它记成永久失败。 */
export const POINTS_SETTLEMENT_BUSY_ERROR = '积分结算进行中，请稍后重试';

type PointsSettlementOrder = {
  id: string;
  customerId: string | null;
  pointsPersonal: number;
  pointsGroup: number;
  pointsGroupId: string | null;
  pointsApplied: boolean;
};

async function heldOrderRedeemPoints(tx: Tx, order: PointsSettlementOrder) {
  let personal = 0;
  if (order.pointsPersonal > 0 && order.customerId) {
    const logs = await tx.pointsLog.findMany({
      where: {
        relatedId: order.id,
        userId: order.customerId,
        OR: [
          { type: 'order_redeem' },
          { type: 'order_redeem_refund', reason: { in: [...POINTS_HOLD_REFUND_REASONS] } },
        ],
      },
      select: { delta: true },
    });
    personal = Math.max(0, -logs.reduce((sum, log) => sum + log.delta, 0));
  }

  let group = 0;
  if (order.pointsGroup > 0 && order.pointsGroupId) {
    const logs = await tx.groupPointsLog.findMany({
      where: {
        relatedId: order.id,
        groupId: order.pointsGroupId,
        OR: [
          { type: 'order_redeem' },
          { type: 'order_redeem_refund', reason: { in: [...POINTS_HOLD_REFUND_REASONS] } },
        ],
      },
      select: { delta: true },
    });
    group = Math.max(0, -logs.reduce((sum, log) => sum + log.delta, 0));
  }

  return { personal, group };
}

function sqliteTimestamp(date: Date) {
  return date.toISOString().replace('Z', '+00:00');
}

async function claimOrderPointsSettlement(tx: Tx, order: PointsSettlementOrder) {
  if (!order.pointsApplied) {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, pointsApplied: false },
      data: { pointsApplied: true, pointsAppliedAt: new Date() },
    });
    return claimed.count === 1;
  }

  // Prisma 写入的时间文本是 +00:00，历史或测试数据可能是 Z。按文本比较才能锁住同一行。
  const rows = await tx.$queryRaw<Array<{ stamp: string | null }>>`
    SELECT CAST(pointsAppliedAt AS TEXT) AS stamp
    FROM "Order"
    WHERE id = ${order.id}
  `;
  const stamp = rows[0]?.stamp ?? null;
  const claimed = await tx.$executeRaw`
    UPDATE "Order"
    SET pointsAppliedAt = ${sqliteTimestamp(new Date())}
    WHERE id = ${order.id}
      AND pointsApplied = 1
      AND (
        (${stamp} IS NULL AND pointsAppliedAt IS NULL)
        OR CAST(pointsAppliedAt AS TEXT) = ${stamp}
      )
  `;
  return Number(claimed) === 1;
}

async function personalPointsAvailable(tx: Tx, userId: string, points: number) {
  if (points <= 0) return true;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } });
  return !!user && user.points >= points;
}

async function groupPointsAvailable(tx: Tx, groupId: string, points: number) {
  if (points <= 0) return true;
  const group = await tx.researchGroup.findUnique({
    where: { id: groupId },
    select: { points: true, status: true },
  });
  if (!group || group.points < points) return false;
  return group.status === 'active' || group.status === 'archived';
}

/** 没有任何已生效扣减时，失败必须把占用标记放开，补偿任务才能再次选中。 */
async function releasePointsClaimIfUnheld(
  tx: Tx,
  orderId: string,
  held: { personal: number; group: number },
) {
  if (held.personal > 0 || held.group > 0) return;
  await tx.order.updateMany({
    where: { id: orderId },
    data: { pointsApplied: false, pointsAppliedAt: null },
  });
}

/**
 * 把未支付订单上已占用的积分原路退回，并放开 `pointsApplied`。
 * 必须在改写订单积分字段之前调用：占用净额按当前课题组和个人积分流水计算。
 * 退款流水使用付款前调整原因，随后的扣减才能把净占用看成 0。
 */
export async function releaseUnpaidOrderPointsHold(
  tx: Tx,
  orderId: string,
  actorUserId?: string | null,
): Promise<{ ok: true; personal: number; group: number } | { ok: false; error: string }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      paidAt: true,
      status: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsGroupId: true,
      pointsApplied: true,
      pointsRefundedPersonal: true,
      pointsRefundedGroup: true,
    },
  });
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.paidAt || isInactiveOrderStatus(order.status) || (order.status !== 'unpaid' && order.status !== 'pending')) {
    return { ok: false, error: '订单已不能调整积分' };
  }
  if (order.pointsRefundedPersonal > 0 || order.pointsRefundedGroup > 0) {
    return { ok: false, error: '订单积分已发生退回，不能再调整抵扣' };
  }

  const held = await heldOrderRedeemPoints(tx, order);
  if (held.group > 0 && !order.pointsGroupId) return { ok: false, error: '订单缺少课题组' };
  if ((held.personal > 0 || held.group > 0) && !order.customerId) return { ok: false, error: '订单缺少客户' };
  if (held.personal === 0 && held.group === 0 && !order.pointsApplied) {
    return { ok: true, personal: 0, group: 0 };
  }

  const claimed = await claimOrderPointsSettlement(tx, order);
  if (!claimed) return { ok: false, error: POINTS_SETTLEMENT_BUSY_ERROR };

  if (held.personal > 0 && order.customerId) {
    await creditPersonalPoints(tx, {
      userId: order.customerId,
      points: held.personal,
      relatedId: order.id,
      reason: PREPAY_POINTS_RELEASE_REASON,
    });
  }
  if (held.group > 0 && order.pointsGroupId) {
    await creditGroupPoints(tx, {
      groupId: order.pointsGroupId,
      points: held.group,
      relatedId: order.id,
      actorUserId: actorUserId ?? order.customerId,
      reason: PREPAY_POINTS_RELEASE_REASON,
    });
  }

  await tx.order.update({
    where: { id: order.id },
    data: { pointsApplied: false, pointsAppliedAt: null },
  });
  return { ok: true, personal: held.personal, group: held.group };
}

/**
 * 对订单执行积分扣减。
 * 没有任何已生效扣减时，失败会把 `pointsApplied` 改回 false，调用方即使提交事务，补偿任务仍能扫到。
 * 已经扣过一部分时保留标记，只补差额，避免把已扣积分再扣一次，也避免退款漏掉已扣部分。
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
  if (!order.customerId) return { ok: false, error: '订单缺少客户' };
  if (isInactiveOrderStatus(order.status)) return { ok: false, error: '订单已取消' };

  if (order.pointsPersonal <= 0 && order.pointsGroup <= 0) {
    if (!order.pointsApplied) {
      await tx.order.updateMany({
        where: { id: orderId, pointsApplied: false },
        data: { pointsApplied: true, pointsAppliedAt: new Date() },
      });
    }
    return { ok: true };
  }

  const held = await heldOrderRedeemPoints(tx, order);
  const personalShort = Math.max(0, order.pointsPersonal - held.personal);
  const groupShort = Math.max(0, order.pointsGroup - held.group);
  if (personalShort === 0 && groupShort === 0) {
    if (!order.pointsApplied) {
      await tx.order.updateMany({
        where: { id: orderId, pointsApplied: false },
        data: { pointsApplied: true, pointsAppliedAt: new Date() },
      });
    }
    return { ok: true };
  }

  const claimed = await claimOrderPointsSettlement(tx, order);
  if (!claimed) return { ok: false, error: POINTS_SETTLEMENT_BUSY_ERROR };

  // 先看余额。长期不足时不要扣下一边再写回滚流水，否则补偿任务会每轮留下一对流水。
  if (!(await personalPointsAvailable(tx, order.customerId, personalShort))) {
    await releasePointsClaimIfUnheld(tx, order.id, held);
    return { ok: false, error: '个人积分不足' };
  }
  if (groupShort > 0 && !order.pointsGroupId) {
    await releasePointsClaimIfUnheld(tx, order.id, held);
    return { ok: false, error: '缺少课题组' };
  }
  if (groupShort > 0 && order.pointsGroupId && !(await groupPointsAvailable(tx, order.pointsGroupId, groupShort))) {
    await releasePointsClaimIfUnheld(tx, order.id, held);
    return { ok: false, error: '课题组积分不足' };
  }

  if (personalShort > 0) {
    const ok = await deductPersonalPoints(tx, {
      userId: order.customerId,
      points: personalShort,
      relatedId: order.id,
    });
    if (!ok) {
      await releasePointsClaimIfUnheld(tx, order.id, held);
      return { ok: false, error: '个人积分不足' };
    }
  }

  if (groupShort > 0 && order.pointsGroupId) {
    const ok = await deductGroupPoints(tx, {
      groupId: order.pointsGroupId,
      points: groupShort,
      relatedId: order.id,
      actorUserId: order.customerId,
      // 订单创建时已校验下单人是该课题组成员；到账阶段按订单保存的积分意图结算，成员后续退出不改变已接受的订单。
      allowArchived: true,
    });
    if (!ok) {
      if (personalShort > 0) {
        await creditPersonalPoints(tx, {
          userId: order.customerId,
          points: personalShort,
          relatedId: order.id,
          reason: POINTS_DEDUCTION_ROLLBACK_REASON,
        });
      }
      await releasePointsClaimIfUnheld(tx, order.id, held);
      return { ok: false, error: '课题组积分不足' };
    }
  }

  return { ok: true };
}

export const POINTS_REFUND_FAILED = 'POINTS_REFUND_FAILED';

export function requirePointsRefund(
  result: { ok: true; personal: number; group: number } | { ok: false; error: string },
) {
  if (!result.ok) throw new Error(POINTS_REFUND_FAILED, { cause: result.error });
  return result;
}

/**
 * 按累计已退现金占原应付的比例退回积分（原路：个人 / 课题组）。
 * 多次部分退款用原抵扣减去已退积分，现金退满时退光剩余。失败返回 ok: false，调用方必须中止事务。
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
      pointsRefundedCash: true,
    },
  });
  if (!order) return { ok: false, error: '订单不存在' };
  if (!order.pointsApplied) return { ok: true, personal: 0, group: 0 };
  if (!order.customerId) return { ok: false, error: '订单缺少客户' };
  if (order.pointsGroup > 0 && !order.pointsGroupId) return { ok: false, error: '订单缺少课题组' };

  const remainingPersonal = Math.max(0, order.pointsPersonal - order.pointsRefundedPersonal);
  const remainingGroup = Math.max(0, order.pointsGroup - order.pointsRefundedGroup);
  if (remainingPersonal + remainingGroup <= 0) return { ok: true, personal: 0, group: 0 };

  const refundedCashYuan = order.pointsRefundedCash ?? 0;
  const plan = calculateCumulativePointsRefund({
    originalPersonal: order.pointsPersonal,
    originalGroup: order.pointsGroup,
    refundedPersonal: order.pointsRefundedPersonal,
    refundedGroup: order.pointsRefundedGroup,
    refundedCashYuan,
    refundYuan: args.refundYuan,
    originalPaidYuan: args.originalPaidYuan,
  });
  if (!plan.ok) return plan;

  const personal = plan.personal;
  const group = plan.group;
  const cashUnchanged = Math.round(plan.nextCashYuan * 100) === Math.round(refundedCashYuan * 100);
  if (personal === 0 && group === 0 && cashUnchanged) return { ok: true, personal: 0, group: 0 };

  const claimed = await tx.order.updateMany({
    where: {
      id: order.id,
      pointsRefundedPersonal: order.pointsRefundedPersonal,
      pointsRefundedGroup: order.pointsRefundedGroup,
      pointsRefundedCash: order.pointsRefundedCash,
    },
    data: {
      pointsRefundedPersonal: { increment: personal },
      pointsRefundedGroup: { increment: group },
      pointsRefundedCash: plan.nextCashYuan,
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
