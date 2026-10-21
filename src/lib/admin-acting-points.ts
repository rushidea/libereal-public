import { normalizePointsIntent } from '@/lib/points-checkout';

/** 只用于管理员代客接受报价。代客下单 POST /api/admin/orders 不走这里。 */
export const ADMIN_ACTING_POINTS_ERROR =
  '管理员代客接受报价不能使用客户积分，请由客户在结算时自行选择积分抵扣';

/**
 * 大于 0 的个人积分或课题组积分视为抵扣请求，返回 400 文案。
 * 未传、0 或无法解析为正整数的值不抵扣，返回 null。
 */
export function adminActingPointsError(input: {
  personalPoints?: unknown;
  groupPoints?: unknown;
  groupId?: unknown;
}): string | null {
  const intent = normalizePointsIntent(input);
  if (intent.personalPoints > 0 || intent.groupPoints > 0) return ADMIN_ACTING_POINTS_ERROR;
  return null;
}

export type QuoteConfirmSettlementFields = {
  paymentMethod: string;
  personalPoints: number;
  groupPoints: number;
  groupId?: string;
};

/** 报价确认请求里的结算字段。管理员会话强制不带积分。 */
export function quoteConfirmSettlementFields(input: {
  actorRole: string | null | undefined;
  paymentMethod: string;
  personalPoints: number;
  groupPoints: number;
  groupId?: string;
}): QuoteConfirmSettlementFields {
  if (input.actorRole === 'admin') {
    return {
      paymentMethod: input.paymentMethod,
      personalPoints: 0,
      groupPoints: 0,
    };
  }
  return {
    paymentMethod: input.paymentMethod,
    personalPoints: input.personalPoints,
    groupPoints: input.groupPoints,
    ...(input.groupId ? { groupId: input.groupId } : {}),
  };
}
