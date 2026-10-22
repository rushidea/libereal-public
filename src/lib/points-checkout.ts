/** 结账积分抵扣：1 分 = 1 元 */

export const POINTS_YUAN_RATE = 1;

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

/** 单次退款相对原抵扣的应退积分（向下取整）。多次退款不要把剩余积分当作 originalPoints。 */
export function calculateProportionalPointsRefund(args: {
  originalPoints: number;
  refundYuan: number;
  originalPaidYuan: number;
}): number {
  if (args.originalPoints <= 0 || args.originalPaidYuan <= 0 || args.refundYuan <= 0) return 0;
  const ratio = Math.min(1, args.refundYuan / args.originalPaidYuan);
  return Math.min(args.originalPoints, Math.floor(args.originalPoints * ratio));
}

function toCents(yuan: number): number | null {
  if (!Number.isFinite(yuan)) return null;
  return Math.round(yuan * 100);
}

/** 按原抵扣比例分配目标积分，余数优先给个人。 */
export function allocatePointsRefund(personalOriginal: number, groupOriginal: number, targetTotal: number) {
  const personalBase = Math.max(0, Math.floor(personalOriginal));
  const groupBase = Math.max(0, Math.floor(groupOriginal));
  const total = personalBase + groupBase;
  const capped = Math.max(0, Math.min(total, Math.floor(targetTotal)));
  if (capped === 0 || total === 0) return { personal: 0, group: 0 };
  if (capped === total) return { personal: personalBase, group: groupBase };
  let personal = Math.min(personalBase, Math.round((capped * personalBase) / total));
  let group = capped - personal;
  if (group > groupBase) {
    group = groupBase;
    personal = capped - group;
  }
  return { personal, group };
}

export type CumulativePointsRefund =
  | { ok: true; personal: number; group: number; nextCashYuan: number }
  | { ok: false; error: string };

/**
 * 按累计已退现金占原应付的比例，计算本次应再退的积分。
 * 现金退满原应付时退光剩余积分，避免多次部分退款把余数乘比例后留下积分。
 * refundYuan 达到原应付时视为整单结清，不再叠加上一次已退现金。
 */
export function calculateCumulativePointsRefund(args: {
  originalPersonal: number;
  originalGroup: number;
  refundedPersonal: number;
  refundedGroup: number;
  refundedCashYuan: number;
  refundYuan: number;
  originalPaidYuan: number;
}): CumulativePointsRefund {
  const originalPersonal = Math.max(0, Math.floor(args.originalPersonal));
  const originalGroup = Math.max(0, Math.floor(args.originalGroup));
  const refundedPersonal = Math.min(originalPersonal, Math.max(0, Math.floor(args.refundedPersonal)));
  const refundedGroup = Math.min(originalGroup, Math.max(0, Math.floor(args.refundedGroup)));
  const remainingPersonal = originalPersonal - refundedPersonal;
  const remainingGroup = originalGroup - refundedGroup;
  const originalCents = toCents(args.originalPaidYuan);
  const refundCents = toCents(args.refundYuan);
  const alreadyCents = toCents(args.refundedCashYuan);
  if (originalCents === null || refundCents === null || alreadyCents === null) {
    return { ok: false, error: '退款金额无效' };
  }

  const finish = (personal: number, group: number, nextCents: number): CumulativePointsRefund => ({
    ok: true,
    personal,
    group,
    nextCashYuan: nextCents / 100,
  });

  if (originalCents <= 0) {
    if (refundCents < 0) return { ok: false, error: '退款金额无效' };
    return finish(remainingPersonal, remainingGroup, 0);
  }
  if (refundCents <= 0) return { ok: false, error: '退款金额无效' };
  if (refundCents > originalCents) return { ok: false, error: '退款金额不能超过原应付金额' };

  const settledCashCents = Math.min(originalCents, Math.max(0, alreadyCents));
  const settlesEntireOrder = refundCents >= originalCents;
  if (!settlesEntireOrder && settledCashCents + refundCents > originalCents) {
    return { ok: false, error: '退款金额超过剩余可退金额' };
  }
  const nextCents = settlesEntireOrder ? originalCents : settledCashCents + refundCents;
  const originalTotal = originalPersonal + originalGroup;
  const targetTotal = nextCents >= originalCents
    ? originalTotal
    : Math.floor((originalTotal * nextCents) / originalCents);
  const target = allocatePointsRefund(originalPersonal, originalGroup, targetTotal);
  let personal = Math.max(0, Math.min(remainingPersonal, target.personal - refundedPersonal));
  let group = Math.max(0, Math.min(remainingGroup, target.group - refundedGroup));
  const delta = Math.max(0, targetTotal - refundedPersonal - refundedGroup);
  if (personal + group > delta) {
    let excess = personal + group - delta;
    const cutGroup = Math.min(group, excess);
    group -= cutGroup;
    excess -= cutGroup;
    personal = Math.max(0, personal - excess);
  } else if (personal + group < delta) {
    let short = delta - personal - group;
    const addPersonal = Math.min(short, remainingPersonal - personal);
    personal += addPersonal;
    short -= addPersonal;
    group += Math.min(short, remainingGroup - group);
  }
  return finish(personal, group, nextCents);
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
