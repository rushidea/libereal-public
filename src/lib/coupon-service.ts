/**
 * 优惠券服务（落地 5）：查询可用券 + 下单核销（服务端权威）。
 *
 * 职责：
 * - getUsableCoupons(userId)：列出用户可用券（active、未过期、二次授权通过、未使用）；
 * - redeemCoupon(tx, code, userId, orderId, subtotal)：下单事务内核销——
 *   校验券有效/授权/未用/未过期 → 生成订单级 coupon 调整 →
 *   条件更新认领实例（仍为 active）并在剩余次数足够时增加模板 usedCount。
 * - restoreRedeemedOrderCoupons(tx, orderId)：取消或超时关单时退回该订单核销的券，同一实例只退一次。
 *
 * 二次授权（无门槛券安全红线）：
 * - 模板级：Coupon.requiresApproval=true 时 approvalStatus 须 approved 才可发放/核销；
 * - 实例级：CouponInstance.issueApprovalStatus 须 approved/auto 才可核销；
 * - 两关都过才允许用券，杜绝未授权生成/发放的券被消费。
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  formatCouponScopeLabel,
  normalizeCouponScopeInput,
  parseCouponScope,
  serializeCouponScope,
  type CouponScope,
  type CouponPromotionPolicy,
} from '@/lib/coupon-scope';
import { revalidateCouponPromotionEvidence, type CouponPromotionPricingEvidence } from '@/lib/pricing';

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
  scopeType: CouponScope['type'];
  scopeLabel: string;
};

type Tx = Prisma.TransactionClient;

function sameCouponMoney(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function sameCouponInstant(left: Date | null, right: Date | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  return left.getTime() === right.getTime();
}

/**
 * 无门槛券改优惠金额、发放上限、有效期或适用范围后，必须重新二次授权。
 * 满减券不走这条规则。名称和说明不算敏感字段。
 */
export function unrestrictedCouponUpdateNeedsReapproval(
  coupon: { type: string; discount: number; maxUses: number; validUntil: Date | null; scopeType: string; scopeTargets: string },
  next: { discount: number; maxUses: number; validUntil: Date | null; scopeType: string; scopeTargets: string },
): boolean {
  if (coupon.type !== 'unrestricted') return false;
  return !sameCouponMoney(coupon.discount, next.discount)
    || Math.floor(coupon.maxUses) !== Math.floor(next.maxUses)
    || !sameCouponInstant(coupon.validUntil, next.validUntil)
    || coupon.scopeType !== next.scopeType
    || coupon.scopeTargets !== next.scopeTargets;
}

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
      ...scopeView(i.coupon.scopeType, i.coupon.scopeTargets),
    }));
}

function scopeView(scopeType: string, scopeTargets: string): { scopeType: CouponScope['type']; scopeLabel: string } {
  const scope = parseCouponScope(scopeType, scopeTargets);
  return { scopeType: scope.type, scopeLabel: formatCouponScopeLabel(scope) };
}

export type CouponRedeemResult =
  | { ok: true; adjustment: { type: string; label: string; amount: number; reason: string | null }; instanceId: string; code: string }
  | { ok: false; error: string };

const COUPON_CLAIM_CONFLICT = '优惠券正在被其他订单使用，请重试';

/** 预评估时捕获的规则快照。只在服务端订单调用链内部传递。 */
export type CouponRedeemSnapshot = {
  instanceId: string;
  couponId: string;
  userId: string | null;
  instanceStatus: string;
  issueApprovalStatus: string;
  instanceExpiresAt: Date | null;
  type: string;
  threshold: number;
  discount: number;
  stackable: boolean;
  approvalStatus: string;
  validFrom: Date;
  validUntil: Date | null;
  maxUses: number;
  scopeType: string;
  scopeTargets: string;
  /** 预评估的范围小计和折扣，核销时必须逐项一致。 */
  scopedSubtotal?: number;
  previewedDiscount?: number;
  promotionPolicyFingerprint?: string;
  promotionPricingEvidence?: Array<CouponPromotionPricingEvidence | undefined>;
};

export type CouponPromotionValidationContext = {
  promotionPolicyFingerprint: string;
  policy: CouponPromotionPolicy;
  scope: CouponScope;
  couponId: string;
  code: string;
  promotionPricingEvidence?: Array<CouponPromotionPricingEvidence | undefined>;
  scopedSubtotal?: number;
  previewedDiscount?: number;
  lineAudit?: Array<{ inScope: boolean; excludedByPolicy: boolean; identity: import('@/lib/coupon-scope').CouponPromotionIdentity }>;
};

/** Optional generic server configuration. No setting means the legacy policy is disabled. */
export function configuredCouponPromotionPolicy(): CouponPromotionPolicy | undefined {
  const raw = process.env.COUPON_PROMOTION_POLICY;
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'unknown' };
    const record = value as { state?: unknown; promotionIds?: unknown };
    if (record.state === 'knownnone') return { state: 'knownnone' };
    if (record.state === 'restricted' && Array.isArray(record.promotionIds)
      && record.promotionIds.length > 0 && record.promotionIds.length <= 100
      && record.promotionIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return { state: 'restricted', promotionIds: [...new Set(record.promotionIds.map((id) => (id as string).trim()))].sort() };
    }
  } catch {
    // A configured but malformed policy must fail closed.
  }
  return { state: 'unknown' };
}

function couponPromotionPolicyFingerprint(): string {
  return JSON.stringify(configuredCouponPromotionPolicy() ?? null);
}

function sameCouponNumber(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function sameCouponSnapshot(instance: {
  id: string; couponId: string; userId: string | null; status: string;
  issueApprovalStatus: string; expiresAt: Date | null;
  coupon: { type: string; threshold: number; discount: number; stackable: boolean; approvalStatus: string;
    validFrom: Date | null; validUntil: Date | null; maxUses: number;
    scopeType: string; scopeTargets: string };
}, snapshot: CouponRedeemSnapshot): boolean {
  return instance.id === snapshot.instanceId
    && instance.couponId === snapshot.couponId
    && instance.userId === snapshot.userId
    && instance.status === snapshot.instanceStatus
    && instance.issueApprovalStatus === snapshot.issueApprovalStatus
    && sameCouponInstant(instance.expiresAt, snapshot.instanceExpiresAt)
    && instance.coupon.type === snapshot.type
    && sameCouponNumber(instance.coupon.threshold, snapshot.threshold)
    && sameCouponNumber(instance.coupon.discount, snapshot.discount)
    && instance.coupon.stackable === snapshot.stackable
    && instance.coupon.approvalStatus === snapshot.approvalStatus
    && sameCouponInstant(instance.coupon.validFrom, snapshot.validFrom)
    && sameCouponInstant(instance.coupon.validUntil, snapshot.validUntil)
    && Math.floor(instance.coupon.maxUses) === Math.floor(snapshot.maxUses)
    && instance.coupon.scopeType === snapshot.scopeType
    && instance.coupon.scopeTargets === snapshot.scopeTargets;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ['code', 'message', 'originalCode', 'originalMessage', 'kind']) {
      if (record[key] != null) parts.push(String(record[key]));
    }
    current = record.cause;
  }
  return parts.join('\n');
}

/**
 * 并发写冲突。better-sqlite3 适配器把 SQLITE_BUSY / SNAPSHOT 报成
 * P1008「Operation has timed out」；其他驱动可能是 P2034。
 * 此时本次认领没有落库，调用方抛错即可回滚整单。
 */
function isCouponWriteConflict(error: unknown): boolean {
  return /P2034|P1008|SQLITE_BUSY|database is locked|write conflict|deadlock|Operation has timed out|SocketTimeout/i.test(errorText(error));
}

async function claimCouponWrite(
  run: () => Promise<{ count: number }>,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const result = await run();
    return { ok: true, count: Number(result.count) };
  } catch (error) {
    if (isCouponWriteConflict(error)) return { ok: false, error: COUPON_CLAIM_CONFLICT };
    throw error;
  }
}

/**
 * 下单事务内核销一张券。
 * 校验顺序：实例存在 → 属于该用户（定向）→ 双重授权 → 未使用 → 未过期（实例+模板）→
 * 未到生效期 → 模板未超量 → 门槛。
 * 核销时绑定订单（redeemedOrderId），便于退款与审计追溯。
 * 实例与模板额度都用条件更新认领：并发下单只有一方 count=1。
 * 认领失败或写冲突时返回中文错误；调用方必须抛错，整单才会回滚。
 * 返回订单级负调整（amount 为负），由调用方并入 adjustments。
 * subtotal 必须是调用方传入的范围内商品小计（与算价策略同一口径）。模板 approvalStatus 须为 auto 或 approved。
 */
export async function redeemCoupon(
  tx: Tx,
  code: string,
  userId: string,
  subtotal: number,
  orderId?: string,
  snapshot?: CouponRedeemSnapshot,
  promotionValidation?: CouponPromotionValidationContext,
): Promise<CouponRedeemResult> {
  const instance = await tx.couponInstance.findUnique({
    where: { code },
    include: { coupon: true },
  });
  if (!instance) return { ok: false, error: '优惠券不存在' };
  const policyFingerprint = snapshot?.promotionPolicyFingerprint ?? promotionValidation?.promotionPolicyFingerprint;
  if (policyFingerprint !== undefined && policyFingerprint !== couponPromotionPolicyFingerprint()) {
    return { ok: false, error: '商品促销规则在结算期间发生变化，请重新确认' };
  }
  const promotionPolicy = configuredCouponPromotionPolicy();
  if (promotionPolicy && !(['threshold', 'unrestricted'].includes(instance.coupon.type)
    && (instance.coupon.type !== 'threshold' || instance.coupon.threshold > 0)
    && (instance.coupon.type !== 'unrestricted' || instance.coupon.threshold === 0))) {
    return { ok: false, error: '优惠券规则无效，请重新确认' };
  }
  if (promotionPolicy?.state === 'restricted' && instance.coupon.type === 'threshold') {
    const evidence = snapshot?.promotionPricingEvidence ?? promotionValidation?.promotionPricingEvidence;
    if (!evidence || evidence.length === 0 || evidence.some((entry) => !entry)) {
      return { ok: false, error: '商品促销信息无法确认，请重新确认订单' };
    }
    let stable = false;
    try {
      stable = await revalidateCouponPromotionEvidence(tx, evidence as CouponPromotionPricingEvidence[], new Date());
    } catch {
      return { ok: false, error: '商品促销信息无法确认，请重新确认订单' };
    }
    if (!stable) return { ok: false, error: '商品促销规则在结算期间发生变化，请重新确认' };
  }
  if (snapshot && !sameCouponSnapshot(instance, snapshot)) {
    return { ok: false, error: '优惠券规则在结算期间发生变化，请重新确认' };
  }
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
  if (snapshot || promotionValidation) {
    const scopedSubtotal = snapshot?.scopedSubtotal ?? promotionValidation?.scopedSubtotal;
    const previewedDiscount = snapshot?.previewedDiscount ?? promotionValidation?.previewedDiscount;
    if (scopedSubtotal !== undefined && !sameCouponNumber(scopedSubtotal, subtotal)) {
      return { ok: false, error: '优惠券适用范围在结算期间发生变化，请重新确认' };
    }
    if (previewedDiscount !== undefined && !sameCouponNumber(previewedDiscount, discount)) {
      return { ok: false, error: '优惠券金额在结算期间发生变化，请重新确认' };
    }
  }

  // 只有仍未使用的实例能被这次更新认领。另一笔并发事务已核销时 count=0。
  const claimed = await claimCouponWrite(() => tx.couponInstance.updateMany({
    where: { id: instance.id, status: 'active', ...(snapshot ? {
      couponId: snapshot.couponId, userId: snapshot.userId,
      issueApprovalStatus: snapshot.issueApprovalStatus, expiresAt: snapshot.instanceExpiresAt,
    } : {}) },
    data: { status: 'used', redeemedAt: now, redeemedOrderId: orderId ?? null },
  }));
  if (!claimed.ok) return claimed;
  if (claimed.count !== 1) {
    return { ok: false, error: '优惠券不可用（已使用/已作废）' };
  }

  // maxUses=0 表示不限；否则要求剩余次数大于 0。额度认领失败时，实例更新还在同一事务里，靠调用方抛错回滚。
  const counted = await claimCouponWrite(() => tx.coupon.updateMany({
    where: {
      id: instance.coupon.id,
      ...(snapshot ? {
        type: snapshot.type,
        threshold: snapshot.threshold,
        discount: snapshot.discount,
        stackable: snapshot.stackable,
        approvalStatus: snapshot.approvalStatus,
        validFrom: snapshot.validFrom,
        validUntil: snapshot.validUntil,
        maxUses: snapshot.maxUses,
        scopeType: snapshot.scopeType,
        scopeTargets: snapshot.scopeTargets,
      } : {}),
      OR: [
        { maxUses: 0 },
        { usedCount: { lt: instance.coupon.maxUses } },
      ],
    },
    data: { usedCount: { increment: 1 } },
  }));
  if (!counted.ok) return counted;
  if (counted.count !== 1) {
    return { ok: false, error: '该券已发放完毕' };
  }

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

/**
 * 取消、关闭或超时自动关单时退回该订单已核销的券。
 * 以「实例仍为 used 且仍绑定本订单」作为一次性认领；并发取消只会有一次把 usedCount 减 1。
 * 返回实际退回的实例数。未绑定订单的券不会被退回。
 */
export async function restoreRedeemedOrderCoupons(tx: Tx, orderId: string): Promise<number> {
  const instances = await tx.couponInstance.findMany({
    where: { redeemedOrderId: orderId, status: 'used' },
    select: { id: true, couponId: true },
  });
  let restored = 0;
  for (const instance of instances) {
    const claimed = await tx.couponInstance.updateMany({
      where: { id: instance.id, status: 'used', redeemedOrderId: orderId },
      data: { status: 'active', redeemedAt: null, redeemedOrderId: null },
    });
    if (claimed.count !== 1) continue;
    await tx.coupon.updateMany({
      where: { id: instance.couponId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    restored += 1;
  }
  return restored;
}

/** 供服务端构建促销引擎 CouponRuleConfig（下单重评估用）。
 * 仅当实例可用（active、未过期、未到生效期、授权通过）时返回配置；
 * 已使用/已作废/已过期/未生效的券返回 null，价格预览与下单预评估均不会展示其优惠。 */
export async function buildCouponRule(code: string): Promise<{
  config: import('@/lib/cart-promotions/types').CouponRuleConfig;
  snapshot: CouponRedeemSnapshot;
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
      couponType: instance.coupon.type as 'threshold' | 'unrestricted',
      code: instance.code,
      name: instance.coupon.name,
      enabled: true,
      threshold: instance.coupon.threshold,
      discount: instance.coupon.discount,
      stackable: instance.coupon.stackable,
      approvalStatus: instance.coupon.approvalStatus as 'auto' | 'pending' | 'approved' | 'rejected',
      issueApprovalStatus: instance.issueApprovalStatus as 'auto' | 'pending' | 'approved' | 'rejected',
      description: instance.coupon.description ?? instance.coupon.name,
      scope: parseCouponScope(instance.coupon.scopeType, instance.coupon.scopeTargets),
      promotionPolicy: configuredCouponPromotionPolicy(),
    },
    snapshot: {
      instanceId: instance.id,
      couponId: instance.coupon.id,
      userId: instance.userId,
      instanceStatus: instance.status,
      issueApprovalStatus: instance.issueApprovalStatus,
      instanceExpiresAt: instance.expiresAt,
      type: instance.coupon.type,
      threshold: instance.coupon.threshold,
      discount: instance.coupon.discount,
      stackable: instance.coupon.stackable,
      approvalStatus: instance.coupon.approvalStatus,
      validFrom: instance.coupon.validFrom,
      validUntil: instance.coupon.validUntil,
      maxUses: instance.coupon.maxUses,
      scopeType: instance.coupon.scopeType,
      scopeTargets: instance.coupon.scopeTargets,
      promotionPolicyFingerprint: couponPromotionPolicyFingerprint(),
    },
  };
}

/**
 * 把管理端提交的范围整理成可写入 Coupon 的字段。
 * 商品/规格会按数据库核对，已下架商品不能选入范围，展示名以库内货号和名称为准。
 */
export async function couponScopeWriteData(body: {
  scopeType?: unknown;
  scopeTargets?: unknown;
}): Promise<{ ok: true; scopeType: string; scopeTargets: string } | { ok: false; error: string }> {
  const normalized = normalizeCouponScopeInput(body);
  if (!normalized.ok) return normalized;
  if (normalized.scope.type !== 'product') {
    return { ok: true, scopeType: normalized.scopeType, scopeTargets: normalized.scopeTargets };
  }

  const products = [];
  for (const target of normalized.scope.products) {
    const product = await prisma.product.findUnique({
      where: { id: target.productId },
      select: {
        id: true,
        name: true,
        catalogNumber: true,
        deletedAt: true,
        variants: { select: { id: true, spec: true, catalogNumber: true } },
      },
    });
    if (!product || product.deletedAt) {
      return { ok: false, error: '适用范围包含不存在或已下架的商品' };
    }
    if (target.variantId) {
      const variant = product.variants.find((item) => item.id === target.variantId);
      if (!variant) return { ok: false, error: '适用范围包含无效的商品规格' };
      products.push({
        productId: product.id,
        variantId: variant.id,
        label: `${variant.catalogNumber} · ${product.name} · ${variant.spec}`,
      });
      continue;
    }
    products.push({
      productId: product.id,
      variantId: null,
      label: `${product.catalogNumber} · ${product.name}`,
    });
  }

  const stored = serializeCouponScope({ type: 'product', products });
  return { ok: true, scopeType: stored.scopeType, scopeTargets: stored.scopeTargets };
}
