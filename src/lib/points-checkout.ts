/** 结账积分抵扣：1 分 = 1 元 */

export const POINTS_YUAN_RATE = 1; // 1 point = 1 CNY

export type PointsRedeemIntent = {
  personalPoints: number;
  groupPoints: number;
  groupId?: string | null;
};

export type PointsRedeemBreakdown = {
  personalPoints: number;
  groupPoints: number;
  groupId: string | null;
  pointsDiscount: number;
  payableBeforePoints: number;
  payableAfterPoints: number;
};

export function pointsToYuan(points: number): number {
  return Math.round(points * POINTS_YUAN_RATE * 100) / 100;
}

export function yuanToPoints(yuan: number): number {
  return Math.floor(yuan / POINTS_YUAN_RATE);
}

export function normalizePointsIntent(input: {
  personalPoints?: unknown;
  groupPoints?: unknown;
  groupId?: unknown;
}): PointsRedeemIntent {
  const personalPoints = Number(input.personalPoints ?? 0);
  const groupPoints = Number(input.groupPoints ?? 0);
  const groupId = typeof input.groupId === 'string' && input.groupId.trim()
    ? input.groupId.trim()
    : null;

  return {
    personalPoints: Number.isFinite(personalPoints) ? Math.max(0, Math.floor(personalPoints)) : 0,
    groupPoints: Number.isFinite(groupPoints) ? Math.max(0, Math.floor(groupPoints)) : 0,
    groupId,
  };
}

/**
 * 校验并计算抵扣明细。无比例上限；不可超过应付与各账户余额。
 */
export function buildPointsRedeemBreakdown(args: {
  payableBeforePoints: number;
  personalBalance: number;
  groupBalance: number;
  intent: PointsRedeemIntent;
  membershipGroupId?: string | null;
}): { ok: true; breakdown: PointsRedeemBreakdown } | { ok: false; error: string } {
  const payable = Math.round((args.payableBeforePoints + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(payable) || payable < 0) {
    return { ok: false, error: '订单金额无效' };
  }

  const { personalPoints, groupPoints, groupId } = args.intent;

  if (personalPoints < 0 || groupPoints < 0) {
    return { ok: false, error: '积分数量不能为负数' };
  }
  if (!Number.isInteger(personalPoints) || !Number.isInteger(groupPoints)) {
    return { ok: false, error: '积分必须为整数' };
  }

  if (groupPoints > 0) {
    if (!groupId) return { ok: false, error: '使用课题组积分时需指定课题组' };
    if (!args.membershipGroupId || args.membershipGroupId !== groupId) {
      return { ok: false, error: '当前账号不属于该课题组' };
    }
  }

  if (personalPoints > args.personalBalance) {
    return { ok: false, error: '个人积分不足' };
  }
  if (groupPoints > args.groupBalance) {
    return { ok: false, error: '课题组积分不足' };
  }

  const maxPoints = yuanToPoints(payable);
  const totalPoints = personalPoints + groupPoints;
  if (totalPoints > maxPoints) {
    return { ok: false, error: `积分抵扣不能超过应付金额（最多 ${maxPoints} 分）` };
  }

  const pointsDiscount = pointsToYuan(totalPoints);
  const payableAfterPoints = Math.round((payable - pointsDiscount + Number.EPSILON) * 100) / 100;

  return {
    ok: true,
    breakdown: {
      personalPoints,
      groupPoints,
      groupId: groupPoints > 0 ? groupId ?? null : null,
      pointsDiscount,
      payableBeforePoints: payable,
      payableAfterPoints: Math.max(0, payableAfterPoints),
    },
  };
}

/** 按支付比例计算应退积分（向下取整分） */
export function calculateProportionalPointsRefund(args: {
  originalPoints: number;
  refundYuan: number;
  originalPaidYuan: number;
}): number {
  if (args.originalPoints <= 0 || args.originalPaidYuan <= 0 || args.refundYuan <= 0) return 0;
  const ratio = Math.min(1, args.refundYuan / args.originalPaidYuan);
  return Math.min(args.originalPoints, Math.floor(args.originalPoints * ratio));
}

export function splitProportionalRefund(args: {
  personalPoints: number;
  groupPoints: number;
  refundYuan: number;
  originalPaidYuan: number;
}): { personal: number; group: number } {
  const total = args.personalPoints + args.groupPoints;
  if (total <= 0) return { personal: 0, group: 0 };
  const totalRefund = calculateProportionalPointsRefund({
    originalPoints: total,
    refundYuan: args.refundYuan,
    originalPaidYuan: args.originalPaidYuan,
  });
  // 按原抵扣比例拆分，余数优先退个人
  const personal = Math.min(
    args.personalPoints,
    Math.round((totalRefund * args.personalPoints) / total),
  );
  const group = Math.min(args.groupPoints, totalRefund - personal);
  return { personal, group };
}
