/**
 * 优惠券服务（落地 5）：查询可用券 + 下单核销（服务端权威）。
 *
 * 职责：
 * - getUsableCoupons(userId)：列出用户可用券（active、未过期、二次授权通过、未使用）；
 * - redeemCoupon(tx, code, userId, orderId, subtotal)：下单事务内核销——
 *   校验券有效/授权/未用/未过期 → 生成订单级 coupon 调整 → 标记实例 used + 模板 usedCount+1。
 *
 * 二次授权（无门槛券安全红线）：
 * - 模板级：Coupon.requiresApproval=true 时 approvalStatus 须 approved 才可发放/核销；
 * - 实例级：CouponInstance.issueApprovalStatus 须 approved/auto 才可核销；
 * - 两关都过才允许用券，杜绝未授权生成/发放的券被消费。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type CouponView = {
  id: string;
  instanceId: string;
  code: string;
  name: string;
  type: 'threshold' | 'unrestricted';
  threshold: number;
  discount: number;
  stackable: boolean;
  expiresAt: string | null;
};

type Tx = Prisma.TransactionClient;

/** 是否可核销（模板 + 实例双重授权通过 + 有效期含 validFrom） */
function isRedeemable(
  templateApproval: string,
  issueApproval: string,
  status: string,
  now: Date,
  expiresAt: Date | null,
  validFrom: Date | null,
  validUntil: Date | null,
): boolean {
  if (status !== 'active') return false;
  if (!['auto', 'approved'].includes(templateApproval)) return false;
  if (!['auto', 'approved'].includes(issueApproval)) return false;
  if (validFrom && validFrom > now) return false;
  if (validUntil && validUntil < now) return false;
  if (expiresAt && expiresAt < now) return false;
  return true;
}

/** 查询用户可用券列表（购物车/结算页展示用）。含通用券（userId=null）与定向券。 */
export async function getUsableCoupons(userId: string): Promise<CouponView[]> {
  const now = new Date();
  const instances = await prisma.couponInstance.findMany({
    where: {
      status: 'active',
      OR: [{ userId }, { userId: null }],
      AND: { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    },
    include: { coupon: true },
    orderBy: { createdAt: 'desc' },
  });
  return instances
    .filter((i) =>
      isRedeemable(
        i.coupon.approvalStatus,
        i.issueApprovalStatus,
        i.status,
        now,
        i.expiresAt,
        i.coupon.validFrom,
        i.coupon.validUntil,
      ),
    )
    .map((i) => ({
      id: i.coupon.id,
      instanceId: i.id,
      code: i.code,
      name: i.coupon.name,
      type: i.coupon.type as 'threshold' | 'unrestricted',
      threshold: i.coupon.threshold,
      discount: i.coupon.discount,
      stackable: i.coupon.stackable,
      expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    }));
}

export type CouponRedeemResult =
  | { ok: true; adjustment: { type: string; label: string; amount: number; reason: string | null }; instanceId: string; code: string }
  | { ok: false; error: string };

/**
 * 下单事务内核销一张券。
 * 校验顺序：实例存在 → 属于该用户（定向）→ 双重授权 → 未使用 → 未过期（实例+模板）→
 * 未到生效期 → 模板未超量 → 门槛。
 * 核销时绑定订单（redeemedOrderId），便于退款与审计追溯。
 * 返回订单级负调整（amount 为负），由调用方并入 adjustments。
 */
export async function redeemCoupon(
  tx: Tx,
  code: string,
  userId: string,
  subtotal: number,
  orderId?: string,
): Promise<CouponRedeemResult> {
  const instance = await tx.couponInstance.findUnique({
    where: { code },
    include: { coupon: true },
  });
  if (!instance) return { ok: false, error: '优惠券不存在' };
  if (instance.userId && instance.userId !== userId) {
    return { ok: false, error: '该优惠券不属于当前账户' };
  }
  // 先查授权状态（无门槛券安全红线：未授权必须给出明确提示，而非笼统"已作废"）
  if (!['auto', 'approved'].includes(instance.coupon.approvalStatus)) {
    return { ok: false, error: '优惠券尚未生效（模板待授权）' };
  }
  if (!['auto', 'approved'].includes(instance.issueApprovalStatus)) {
    return { ok: false, error: '优惠券尚未生效（发放待授权）' };
  }
  if (instance.status !== 'active') {
    return { ok: false, error: '优惠券不可用（已使用/已作废）' };
  }
  const now = new Date();
  if (instance.expiresAt && instance.expiresAt < now) {
    return { ok: false, error: '优惠券已过期' };
  }
  if (instance.coupon.validUntil && instance.coupon.validUntil < now) {
    return { ok: false, error: '优惠券已过有效期' };
  }
  if (instance.coupon.validFrom && instance.coupon.validFrom > now) {
    return { ok: false, error: '优惠券尚未到生效日期' };
  }
  if (instance.coupon.maxUses > 0 && instance.coupon.usedCount >= instance.coupon.maxUses) {
    return { ok: false, error: '该券已发放完毕' };
  }
  // 满减门槛（threshold=0 无门槛）
  if (instance.coupon.threshold > 0 && subtotal < instance.coupon.threshold) {
    const shortfall = Math.round((instance.coupon.threshold - subtotal) * 100) / 100;
    return { ok: false, error: `未达满减门槛，还差 ¥${shortfall.toFixed(2)}` };
  }

  const discount = Math.min(instance.coupon.discount, Math.round(subtotal * 100) / 100);
  if (discount <= 0) return { ok: false, error: '优惠券金额无效' };

  await tx.couponInstance.update({
    where: { id: instance.id },
    data: { status: 'used', redeemedAt: now, redeemedOrderId: orderId ?? null },
  });
  await tx.coupon.update({
    where: { id: instance.coupon.id },
    data: { usedCount: { increment: 1 } },
  });

  return {
    ok: true,
    instanceId: instance.id,
    code: instance.code,
    adjustment: {
      type: 'coupon',
      label: instance.coupon.name,
      amount: -discount,
      reason: `券码 ${instance.code}${instance.coupon.stackable ? '（可叠加）' : ''}`,
    },
  };
}

/** 供服务端构建促销引擎 CouponRuleConfig（下单重评估用）。
 * 仅当实例可用（active、未过期、未到生效期、授权通过）时返回配置；
 * 已使用/已作废/已过期/未生效的券返回 null，价格预览与下单预评估均不会展示其优惠。 */
export async function buildCouponRule(code: string): Promise<{
  config: import('@/lib/cart-promotions/types').CouponRuleConfig;
} | null> {
  const instance = await prisma.couponInstance.findUnique({
    where: { code },
    include: { coupon: true },
  });
  if (!instance) return null;
  const now = new Date();
  if (instance.status !== 'active') return null;
  if (!['auto', 'approved'].includes(instance.coupon.approvalStatus)) return null;
  if (!['auto', 'approved'].includes(instance.issueApprovalStatus)) return null;
  if (instance.expiresAt && instance.expiresAt < now) return null;
  if (instance.coupon.validUntil && instance.coupon.validUntil < now) return null;
  if (instance.coupon.validFrom && instance.coupon.validFrom > now) return null;
  if (instance.coupon.maxUses > 0 && instance.coupon.usedCount >= instance.coupon.maxUses) return null;
  return {
    config: {
      id: `coupon:${code}`,
      type: 'coupon',
      couponId: instance.coupon.id,
      code: instance.code,
      name: instance.coupon.name,
      enabled: true,
      threshold: instance.coupon.threshold,
      discount: instance.coupon.discount,
      stackable: instance.coupon.stackable,
      approvalStatus: instance.coupon.approvalStatus as 'auto' | 'pending' | 'approved' | 'rejected',
      issueApprovalStatus: instance.issueApprovalStatus as 'auto' | 'pending' | 'approved' | 'rejected',
      description: instance.coupon.description ?? instance.coupon.name,
    },
  };
}
