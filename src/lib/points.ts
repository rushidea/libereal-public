// 积分系统工具函数

export type PointsLogType =
  | 'admin_adjust'
  | 'order_credit'
  | 'redemption'
  | 'admin_undo'
  | 'order_redeem'
  | 'order_redeem_refund'
  | 'topup_alipay'
  | 'admin_inject';

export const POINTS_LOG_TYPE_LABELS: Record<PointsLogType, string> = {
  admin_adjust: '管理员调整',
  order_credit: '订单获得',
  redemption: '商品兑换',
  admin_undo: '撤销调整',
  order_redeem: '订单抵扣',
  order_redeem_refund: '抵扣退回',
  topup_alipay: '支付宝充值',
  admin_inject: '管理员注入',
};

export const POINTS_LOG_TYPE_COLORS: Record<PointsLogType, string> = {
  admin_adjust: 'bg-amber-100 text-amber-700',
  order_credit: 'bg-green-100 text-green-700',
  redemption: 'bg-purple-100 text-purple-700',
  admin_undo: 'bg-rose-100 text-rose-700',
  order_redeem: 'bg-blue-100 text-blue-700',
  order_redeem_refund: 'bg-sky-100 text-sky-700',
  topup_alipay: 'bg-emerald-100 text-emerald-700',
  admin_inject: 'bg-indigo-100 text-indigo-700',
};

/**
 * 计算订单完成时应获得的积分（基于金额）
 * @param amount 订单金额（元）
 */
export function calculateOrderPoints(amount: number, _pointsPerYuan = 0.001, active = true): number {
  if (!active) return 0;
  if (amount <= 0) return 0;
  return Math.floor(amount / 1000);
}

/**
 * 检查用户积分是否足够兑换
 */
export function canRedeem(userPoints: number, cost: number): boolean {
  return userPoints >= cost && cost > 0;
}

/**
 * 验证积分变动值
 */
export function validatePointsDelta(delta: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(delta)) {
    return { valid: false, error: '积分变动必须为整数' };
  }
  if (delta === 0) {
    return { valid: false, error: '积分变动不能为 0' };
  }
  if (Math.abs(delta) > 1000000) {
    return { valid: false, error: '单次变动不能超过 1,000,000' };
  }
  return { valid: true };
}

/** 验证设置后的积分余额；允许设置为 0，但限制单次操作范围。 */
export function validatePointsTarget(points: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(points)) {
    return { valid: false, error: '目标积分必须为整数' };
  }
  if (points < 0) {
    return { valid: false, error: '目标积分不能为负' };
  }
  if (points > 1000000) {
    return { valid: false, error: '目标积分不能超过 1,000,000' };
  }
  return { valid: true };
}

/**
 * 格式化积分显示
 */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat('zh-CN').format(points);
}

/**
 * 根据积分获取推荐分类
 */
export type ProductCategory = 'tool' | 'digital' | 'physical';

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  tool: '实用工具',
  digital: '数字商品',
  physical: '实物商品',
};

export const PRODUCT_CATEGORY_COLORS: Record<ProductCategory, string> = {
  tool: 'bg-blue-100 text-blue-700',
  digital: 'bg-cyan-100 text-cyan-700',
  physical: 'bg-orange-100 text-orange-700',
};
