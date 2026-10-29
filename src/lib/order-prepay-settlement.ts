import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { promotionEngine } from '@/lib/cart-promotions/engine';
import type { CartLine, CouponRuleConfig } from '@/lib/cart-promotions/types';
import {
  paymentMethodAdjustments,
  pointsRedeemAdjustment,
  type CheckoutAdjustment,
} from '@/lib/checkout-payment';
import { couponLineIsInScope, couponPromotionEvidenceForScope, formatCouponScopeLabel, parseCouponScope } from '@/lib/coupon-scope';
import type { CouponPromotionIdentity } from '@/lib/coupon-scope';
import type { CouponPromotionPricingEvidence } from '@/lib/pricing';
import { configuredCouponPromotionPolicy, redeemCoupon, restoreRedeemedOrderCoupons, type CouponPromotionValidationContext } from '@/lib/coupon-service';
import { syncUnsettledReceivableAmount } from '@/lib/customer-credit';
import { assertQuoteAcceptanceCredit } from '@/lib/quote-acceptance-guards';
import { calculateOrderAmounts } from '@/lib/order-domain';
import { writeAuditLog } from '@/lib/audit';
import { normalizePointsIntent, buildPointsRedeemBreakdown, type PointsRedeemBreakdown } from '@/lib/points-checkout';
import {
  applyOrderPointsDeduction,
  getUserPointsBalance,
  POINTS_SETTLEMENT_BUSY_ERROR,
  releaseUnpaidOrderPointsHold,
} from '@/lib/points-checkout-service';
import { OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';
import { prisma } from '@/lib/prisma';

type Db = Prisma.TransactionClient | PrismaClient;

const MUTABLE_ADJUSTMENT_TYPES = ['platform_fee', 'transfer_fee', 'coupon', 'points_redeem'] as const;
const MUTABLE_ADJUSTMENT_TYPE_SET = new Set<string>(MUTABLE_ADJUSTMENT_TYPES);
const ACTIVE_ALIPAY_ATTEMPT_STATUSES = ['created', 'redirected', 'WAIT_BUYER_PAY'];
const PAID_ATTEMPT_STATUSES = new Set([
  'paid',
  'paid_superseded_reconciliation_required',
  'paid_stock_shortfall_reconciliation_required',
]);

export class PrepaySettlementError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PrepaySettlementError';
    this.status = status;
    this.code = code;
  }
}

export type OwnerPrepaySettlementView = {
  eligible: boolean;
  couponCode: string | null;
  personalPoints: number;
  groupPoints: number;
  groupId: string | null;
};

export type PrepaySettlementInput = {
  personalSpecified: boolean;
  groupSpecified: boolean;
  groupIdSpecified: boolean;
  couponSpecified: boolean;
  personalPoints?: unknown;
  groupPoints?: unknown;
  groupId?: unknown;
  couponCode?: unknown;
  idempotencyKey: string | null;
};

export type PrepaySettlementActor = {
  id: string;
  role: string;
  email?: string | null;
};

type Selection = {
  personalPoints: number;
  groupPoints: number;
  groupId: string | null;
  couponCode: string;
};

type SettlementOrder = Prisma.OrderGetPayload<{
  include: {
    orderItems: true;
    adjustments: true;
    paymentAttempts: { select: { id: true; provider: true; amount: true; status: true } };
  };
}>;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amountCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

function orderIdFromDetails(details: string | null | undefined) {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { orderId?: unknown };
    return typeof parsed.orderId === 'string' && parsed.orderId ? parsed.orderId : null;
  } catch {
    return null;
  }
}

function variantIdFromMetadata(metadata: string | null | undefined) {
  if (!metadata) return undefined;
  try {
    const parsed = JSON.parse(metadata) as { variantId?: unknown };
    return typeof parsed.variantId === 'string' && parsed.variantId ? parsed.variantId : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCouponCode(value: unknown) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  return value.trim();
}

function selectionFingerprint(selection: Selection) {
  return createHash('sha256').update(JSON.stringify({
    personalPoints: selection.personalPoints,
    groupPoints: selection.groupPoints,
    groupId: selection.groupId,
    couponCode: selection.couponCode,
  })).digest('hex');
}

export function parsePrepaySettlementBody(
  body: unknown,
  idempotencyKey: string | null,
): { ok: true; value: PrepaySettlementInput } | { ok: false; error: string } {
  const record = body == null ? {} : body;
  if (typeof record !== 'object' || Array.isArray(record)) return { ok: false, error: '请求格式无效' };
  const fields = record as Record<string, unknown>;
  if (idempotencyKey != null && idempotencyKey !== '' && !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    return { ok: false, error: '幂等键格式无效' };
  }
  return {
    ok: true,
    value: {
      personalSpecified: Object.prototype.hasOwnProperty.call(fields, 'personalPoints'),
      groupSpecified: Object.prototype.hasOwnProperty.call(fields, 'groupPoints'),
      groupIdSpecified: Object.prototype.hasOwnProperty.call(fields, 'groupId'),
      couponSpecified: Object.prototype.hasOwnProperty.call(fields, 'couponCode'),
      personalPoints: fields.personalPoints,
      groupPoints: fields.groupPoints,
      groupId: fields.groupId,
      couponCode: fields.couponCode,
      idempotencyKey: idempotencyKey ? idempotencyKey : null,
    },
  };
}

async function loadProxyAcceptedOrderIds(
  db: Db,
  orders: Array<{ id: string; inquiryId: string | null; customerId: string | null }>,
) {
  const accepted = new Set<string>();
  const inquiryIds = [...new Set(orders.map((order) => order.inquiryId).filter((id): id is string => Boolean(id)))];
  if (inquiryIds.length === 0) return accepted;
  const confirmations = await db.quoteConfirmation.findMany({
    where: { quote: { inquiryId: { in: inquiryIds } } },
    select: { userId: true, details: true },
  });
  const actorIds = [...new Set(confirmations.map((confirmation) => confirmation.userId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length === 0
    ? []
    : await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, role: true } });
  const adminIds = new Set(actors.filter((actor) => actor.role === 'admin').map((actor) => actor.id));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  for (const confirmation of confirmations) {
    const orderId = orderIdFromDetails(confirmation.details);
    if (!orderId || !confirmation.userId || !adminIds.has(confirmation.userId)) continue;
    const order = ordersById.get(orderId);
    if (!order || confirmation.userId === order.customerId) continue;
    accepted.add(orderId);
  }
  return accepted;
}

function couponCodeFromInstances(codes: string[]) {
  return codes.length === 1 ? codes[0] : '';
}

export async function ownerPrepaySettlementViews(
  db: Db,
  orders: Array<{
    id: string;
    inquiryId: string | null;
    customerId: string | null;
    paidAt: Date | null;
    status: string;
    pointsPersonal: number;
    pointsGroup: number;
    pointsGroupId: string | null;
  }>,
): Promise<Map<string, OwnerPrepaySettlementView>> {
  const views = new Map<string, OwnerPrepaySettlementView>();
  if (orders.length === 0) return views;
  const [proxyIds, coupons] = await Promise.all([
    loadProxyAcceptedOrderIds(db, orders),
    db.couponInstance.findMany({
      where: { redeemedOrderId: { in: orders.map((order) => order.id) }, status: 'used' },
      select: { redeemedOrderId: true, code: true },
    }),
  ]);
  const codesByOrder = new Map<string, string[]>();
  for (const coupon of coupons) {
    if (!coupon.redeemedOrderId) continue;
    const codes = codesByOrder.get(coupon.redeemedOrderId) ?? [];
    codes.push(coupon.code);
    codesByOrder.set(coupon.redeemedOrderId, codes);
  }
  for (const order of orders) {
    const codes = codesByOrder.get(order.id) ?? [];
    views.set(order.id, {
      eligible: Boolean(order.customerId)
        && proxyIds.has(order.id)
        && !order.paidAt
        && (order.status === 'unpaid' || order.status === 'pending'),
      couponCode: codes.length === 1 ? codes[0] : null,
      personalPoints: order.pointsPersonal,
      groupPoints: order.pointsGroup,
      groupId: order.pointsGroupId,
    });
  }
  return views;
}

async function loadSettlementOrder(db: Db, orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: { orderBy: { position: 'asc' } },
      adjustments: { orderBy: { createdAt: 'asc' } },
      paymentAttempts: { select: { id: true, provider: true, amount: true, status: true } },
    },
  });
}

async function assertActorCanSettle(actor: PrepaySettlementActor, order: { customerId: string | null; ownerScope: string; organizationId: string | null }) {
  if (actor.role === 'admin') {
    throw new PrepaySettlementError('管理员不能在付款前替客户选择积分或优惠券', 403, 'ADMIN_PREPAY_SETTLEMENT_FORBIDDEN');
  }
  if (!order.customerId || order.customerId !== actor.id) {
    throw new PrepaySettlementError('只能由订单所属客户调整积分和优惠券', 403, 'ORDER_OWNER_REQUIRED');
  }
  if (order.ownerScope === 'organization') {
    if (!order.organizationId) {
      throw new PrepaySettlementError('只能由订单所属客户调整积分和优惠券', 403, 'ORDER_OWNER_REQUIRED');
    }
    try {
      await requireOrganizationPermission(actor.id, order.organizationId, 'organization.orders.create');
    } catch (error) {
      if (error instanceof OrganizationRbacError) {
        throw new PrepaySettlementError('只能由订单所属客户调整积分和优惠券', 403, 'ORDER_OWNER_REQUIRED');
      }
      throw error;
    }
  }
}

function assertOrderCanSettle(order: SettlementOrder, proxyAccepted: boolean) {
  if (order.paidAt || order.paymentAttempts.some((attempt) => PAID_ATTEMPT_STATUSES.has(attempt.status))) {
    throw new PrepaySettlementError('订单已支付，不能再调整积分或优惠券', 409, 'ORDER_ALREADY_PAID');
  }
  if (order.status === 'cancelled' || order.status === 'closed') {
    throw new PrepaySettlementError('订单已取消或已关闭，不能再调整积分或优惠券', 409, 'ORDER_INACTIVE');
  }
  if (order.status !== 'unpaid' && order.status !== 'pending') {
    throw new PrepaySettlementError('订单已进入履约，不能再调整积分或优惠券', 409, 'ORDER_IN_FULFILLMENT');
  }
  if (!proxyAccepted) {
    throw new PrepaySettlementError('只有管理员代接受且尚未支付的报价订单可以在付款前选择积分和优惠券', 409, 'ORDER_NOT_PROXY_ACCEPTED');
  }
  if (!order.customerId) {
    throw new PrepaySettlementError('订单缺少客户，不能调整积分或优惠券', 400, 'ORDER_MISSING_CUSTOMER');
  }
  if (order.pointsRefundedPersonal > 0 || order.pointsRefundedGroup > 0) {
    throw new PrepaySettlementError('订单积分已发生退回，不能再调整抵扣', 409, 'POINTS_ALREADY_REFUNDED');
  }
}

function selectionFrom(order: SettlementOrder, currentCouponCode: string, input: PrepaySettlementInput): Selection {
  const couponCode = input.couponSpecified ? normalizeCouponCode(input.couponCode) : currentCouponCode;
  if (couponCode == null) throw new PrepaySettlementError('优惠券码无效', 400, 'COUPON_INVALID');
  const intent = normalizePointsIntent({
    personalPoints: input.personalSpecified ? input.personalPoints : order.pointsPersonal,
    groupPoints: input.groupSpecified ? input.groupPoints : order.pointsGroup,
    groupId: input.groupIdSpecified ? input.groupId : (input.groupSpecified ? undefined : order.pointsGroupId),
  });
  return {
    personalPoints: intent.personalPoints,
    groupPoints: intent.groupPoints,
    groupId: intent.groupPoints > 0 ? (intent.groupId ?? null) : null,
    couponCode,
  };
}

function sameSelection(order: SettlementOrder, currentCouponCode: string, selection: Selection) {
  const pointsSettled = selection.personalPoints + selection.groupPoints === 0 || order.pointsApplied;
  return pointsSettled
    && order.pointsPersonal === selection.personalPoints
    && order.pointsGroup === selection.groupPoints
    && (order.pointsGroupId ?? null) === selection.groupId
    && currentCouponCode === selection.couponCode;
}

async function resolveGroup(db: Db, userId: string, selection: Selection): Promise<Selection> {
  if (selection.groupPoints <= 0 || selection.groupId) return selection;
  const balance = await getUserPointsBalance(db, userId);
  if (!balance?.group?.usable) return selection;
  return { ...selection, groupId: balance.group.id };
}

async function couponLines(db: Db, order: SettlementOrder): Promise<CartLine[]> {
  const productIds = [...new Set(order.orderItems.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  const products = productIds.length === 0
    ? []
    : await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, brand: true, category: true, subcategory: true, deletedAt: true },
    });
  const byId = new Map(products.map((product) => [product.id, product]));
  return order.orderItems.map((item, index) => {
    const product = item.productId ? byId.get(item.productId) : undefined;
    return {
      id: item.id,
      quantity: item.quantity,
      product: {
        id: item.productId || `line-${index}`,
        variantId: variantIdFromMetadata(item.metadata),
        brand: product?.brand || item.brand || '',
        catalogNumber: item.catalogNumber || '',
        price: item.unitPrice,
        name: item.name,
        category: product?.category ?? undefined,
        subcategory: product?.subcategory ?? undefined,
        delisted: Boolean(product?.deletedAt),
        promotionIdentity: promotionIdentityFromSnapshot(item.pricingSnapshot),
        promotionPricingEvidence: promotionEvidenceFromSnapshot(item.pricingSnapshot),
      },
    };
  });
}

function promotionIdentityFromSnapshot(value: string | null): CouponPromotionIdentity {
  if (!value) return { state: 'unknown' };
  try {
    const parsed = JSON.parse(value) as { couponPromotionIdentity?: unknown };
    const identity = parsed.couponPromotionIdentity;
    if (!identity || typeof identity !== 'object') return { state: 'unknown' };
    const record = identity as { state?: unknown; promotionId?: unknown };
    if (record.state === 'knownnone') return { state: 'knownnone' };
    if (record.state === 'restricted' && typeof record.promotionId === 'string' && record.promotionId.length > 0) {
      return { state: 'restricted', promotionId: record.promotionId };
    }
  } catch {
    // Legacy or malformed pricing evidence cannot establish coupon eligibility.
  }
  return { state: 'unknown' };
}

function promotionEvidenceFromSnapshot(value: string | null): CouponPromotionPricingEvidence | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { couponPromotionPricingEvidence?: unknown };
    const evidence = parsed.couponPromotionPricingEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return undefined;
    const candidate = evidence as Partial<CouponPromotionPricingEvidence>;
    if (typeof candidate.productId !== 'string' || typeof candidate.pricedAt !== 'string'
      || !Array.isArray(candidate.candidates) || !candidate.product || typeof candidate.product !== 'object'
      || !candidate.identity || typeof candidate.identity !== 'object') return undefined;
    return candidate as CouponPromotionPricingEvidence;
  } catch {
    return undefined;
  }
}

async function resolveCoupon(
  db: Db,
  args: { code: string; userId: string; orderId: string; lines: CartLine[]; heldHere: boolean },
) {
  if (!args.code) return { adjustment: null as CheckoutAdjustment | null, scopedSubtotal: 0, promotionValidation: undefined as CouponPromotionValidationContext | undefined };
  const instance = await db.couponInstance.findUnique({ where: { code: args.code }, include: { coupon: true } });
  if (!instance) throw new PrepaySettlementError('优惠券不存在', 400, 'COUPON_INVALID');
  if (instance.userId && instance.userId !== args.userId) {
    throw new PrepaySettlementError('该优惠券不属于当前账户', 400, 'COUPON_INVALID');
  }
  const heldHere = args.heldHere && instance.status === 'used' && instance.redeemedOrderId === args.orderId;
  if (!heldHere && instance.status !== 'active') {
    throw new PrepaySettlementError('优惠券不可用（已使用/已作废）', 400, 'COUPON_INVALID');
  }
  if (!['auto', 'approved'].includes(instance.coupon.approvalStatus)) {
    throw new PrepaySettlementError('优惠券尚未生效（模板待授权）', 400, 'COUPON_INVALID');
  }
  if (!['auto', 'approved'].includes(instance.issueApprovalStatus)) {
    throw new PrepaySettlementError('优惠券尚未生效（发放待授权）', 400, 'COUPON_INVALID');
  }
  const now = new Date();
  if (instance.expiresAt && instance.expiresAt < now) throw new PrepaySettlementError('优惠券已过期', 400, 'COUPON_INVALID');
  if (instance.coupon.validUntil && instance.coupon.validUntil < now) {
    throw new PrepaySettlementError('优惠券已过有效期', 400, 'COUPON_INVALID');
  }
  if (instance.coupon.validFrom && instance.coupon.validFrom > now) {
    throw new PrepaySettlementError('优惠券尚未到生效日期', 400, 'COUPON_INVALID');
  }
  if (!heldHere && instance.coupon.maxUses > 0 && instance.coupon.usedCount >= instance.coupon.maxUses) {
    throw new PrepaySettlementError('该券已发放完毕', 400, 'COUPON_INVALID');
  }

  const scope = parseCouponScope(instance.coupon.scopeType, instance.coupon.scopeTargets);
  const promotionPolicy = configuredCouponPromotionPolicy();
  const config: CouponRuleConfig = {
    id: `coupon:${instance.code}`,
    type: 'coupon',
    couponId: instance.coupon.id,
    couponType: instance.coupon.type as CouponRuleConfig['couponType'],
    code: instance.code,
    name: instance.coupon.name,
    enabled: true,
    threshold: instance.coupon.threshold,
    discount: instance.coupon.discount,
    stackable: instance.coupon.stackable,
    approvalStatus: instance.coupon.approvalStatus as CouponRuleConfig['approvalStatus'],
    issueApprovalStatus: instance.issueApprovalStatus as CouponRuleConfig['issueApprovalStatus'],
    description: instance.coupon.description ?? instance.coupon.name,
    scope,
    promotionPolicy,
  };
  const evaluation = promotionEngine.evaluateAll(args.lines, [config], now)[0];
  if (!evaluation?.triggered || !evaluation.adjustments[0]) {
    const summary = evaluation?.summary?.replace(/^.*?：/, '') || '优惠券暂不可用';
    throw new PrepaySettlementError(summary, 400, 'COUPON_INVALID');
  }
  const details = evaluation.details as { subtotal?: number } | undefined;
  return {
    adjustment: {
      type: 'coupon',
      label: instance.coupon.name,
      amount: -evaluation.adjustments[0].amount,
      reason: `券码 ${instance.code}${instance.coupon.stackable ? '（可叠加）' : ''} · ${formatCouponScopeLabel(scope)}`,
    } satisfies CheckoutAdjustment,
    scopedSubtotal: typeof details?.subtotal === 'number' ? details.subtotal : 0,
    promotionValidation: promotionPolicy ? {
      promotionPolicyFingerprint: JSON.stringify(promotionPolicy),
      policy: promotionPolicy,
      scope,
      couponId: instance.coupon.id,
      code: instance.code,
      promotionPricingEvidence: couponPromotionEvidenceForScope(args.lines, scope) as Array<CouponPromotionPricingEvidence | undefined>,
      scopedSubtotal: typeof details?.subtotal === 'number' ? details.subtotal : 0,
      previewedDiscount: evaluation.adjustments[0].amount,
      lineAudit: args.lines.map((line) => {
        const identity = line.product.promotionIdentity ?? { state: 'unknown' as const };
        const inScope = !line.isQuickOrder && !line.promoMark && couponLineIsInScope(line, scope);
        return {
          inScope,
          excludedByPolicy: Boolean(inScope && instance.coupon.type === 'threshold'
            && promotionPolicy.state === 'restricted'
            && identity.state === 'restricted'
            && promotionPolicy.promotionIds.includes(identity.promotionId)),
          identity,
        };
      }),
    } : undefined,
  };
}

function bookedCouponAdjustment(order: { adjustments: Array<{ type: string; label: string; amount: number; reason: string | null }> }): CheckoutAdjustment {
  const booked = order.adjustments.find((adjustment) => adjustment.type === 'coupon');
  if (!booked) throw new PrepaySettlementError('订单优惠券记录不完整，请联系管理员处理', 409, 'COUPON_SNAPSHOT_MISSING');
  return { type: 'coupon', label: booked.label, amount: booked.amount, reason: booked.reason };
}

async function quotePrepayAmounts(
  db: Db,
  order: SettlementOrder,
  selection: Selection,
  couponAdjustment: CheckoutAdjustment | null,
  creditHeldPoints: boolean,
) {
  const paymentMethod = normalizeOrderPaymentMethod(order.paymentMethod);
  if (!paymentMethod) throw new PrepaySettlementError('请选择有效的付款方式', 400, 'PAYMENT_METHOD_INVALID');
  const lineItems = order.orderItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity }));
  const preserved = order.adjustments
    .filter((adjustment) => !MUTABLE_ADJUSTMENT_TYPE_SET.has(adjustment.type))
    .map((adjustment) => ({
      type: adjustment.type,
      label: adjustment.label,
      amount: adjustment.amount,
      reason: adjustment.reason,
    }));
  const merchandise = couponAdjustment ? [...preserved, couponAdjustment] : preserved;
  const platformFeeBase = money(
    lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    + preserved.reduce((sum, adjustment) => sum + adjustment.amount, 0)
    + (couponAdjustment?.amount ?? 0),
  );
  const prePointsAdjustments = [...paymentMethodAdjustments(paymentMethod, platformFeeBase), ...merchandise];
  let amountsBeforePoints: { subtotal: number; adjustmentTotal: number; total: number };
  try {
    amountsBeforePoints = calculateOrderAmounts(lineItems, prePointsAdjustments);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ORDER_AMOUNT') {
      throw new PrepaySettlementError('优惠后应付金额无效', 400, 'INVALID_ORDER_AMOUNT');
    }
    throw error;
  }

  const balance = await getUserPointsBalance(db, order.customerId as string);
  if (!balance) throw new PrepaySettlementError('用户不存在', 400, 'USER_NOT_FOUND');
  const personalBalance = balance.personalPoints + (creditHeldPoints ? order.pointsPersonal : 0);
  const groupIsCurrent = Boolean(creditHeldPoints && order.pointsGroupId && balance.group?.id === order.pointsGroupId);
  const groupBalance = (balance.group?.usable ? balance.group.points : 0) + (groupIsCurrent ? order.pointsGroup : 0);
  let pointsBreakdown: PointsRedeemBreakdown | null = null;
  if (selection.personalPoints > 0 || selection.groupPoints > 0) {
    const preview = buildPointsRedeemBreakdown({
      payableBeforePoints: amountsBeforePoints.total,
      personalBalance,
      groupBalance,
      intent: {
        personalPoints: selection.personalPoints,
        groupPoints: selection.groupPoints,
        groupId: selection.groupId,
      },
      membershipGroupId: balance.group?.usable ? balance.group.id : null,
    });
    if (!preview.ok) throw new PrepaySettlementError(preview.error, 400, 'POINTS_INVALID');
    pointsBreakdown = preview.breakdown;
  }
  const pointsAdjustment = pointsRedeemAdjustment(pointsBreakdown);
  const adjustments = pointsAdjustment ? [...prePointsAdjustments, pointsAdjustment] : prePointsAdjustments;
  let amounts: { subtotal: number; adjustmentTotal: number; total: number };
  try {
    amounts = calculateOrderAmounts(lineItems, adjustments);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ORDER_AMOUNT') {
      throw new PrepaySettlementError('优惠后应付金额无效', 400, 'INVALID_ORDER_AMOUNT');
    }
    throw error;
  }
  return {
    amounts,
    adjustments,
    pointsBreakdown,
    scopedSelection: {
      ...selection,
      groupId: pointsBreakdown?.groupId ?? (selection.groupPoints > 0 ? selection.groupId : null),
    },
  };
}

function settlementPatch(order: SettlementOrder, couponCode: string, proxyAccepted: boolean) {
  return {
    id: order.id,
    subtotal: order.subtotal,
    adjustmentTotal: order.adjustmentTotal,
    total: order.total,
    pointsPersonal: order.pointsPersonal,
    pointsGroup: order.pointsGroup,
    pointsGroupId: order.pointsGroupId,
    pointsDiscount: order.pointsDiscount,
    pointsApplied: order.pointsApplied,
    adjustments: order.adjustments.map((adjustment) => ({
      id: adjustment.id,
      type: adjustment.type,
      label: adjustment.label,
      amount: adjustment.amount,
      reason: adjustment.reason,
    })),
    ownerPrepaySettlement: {
      eligible: Boolean(order.customerId)
        && proxyAccepted
        && !order.paidAt
        && (order.status === 'unpaid' || order.status === 'pending'),
      couponCode: couponCode || null,
      personalPoints: order.pointsPersonal,
      groupPoints: order.pointsGroup,
      groupId: order.pointsGroupId,
    } satisfies OwnerPrepaySettlementView,
  };
}

async function idempotentEvent(db: Db, orderId: string, key: string) {
  const events = await db.orderEvent.findMany({
    where: { orderId, type: 'prepay_settlement' },
    select: { metadata: true },
  });
  for (const event of events) {
    try {
      const parsed = JSON.parse(event.metadata || '{}') as { idempotencyKey?: string; fingerprint?: string };
      if (parsed.idempotencyKey === key) return parsed;
    } catch {
      // 旧记录无法解析时忽略，避免误把别的结算当成同一次请求。
    }
  }
  return null;
}

async function prepare(db: Db, actor: PrepaySettlementActor, orderId: string, input: PrepaySettlementInput) {
  const order = await loadSettlementOrder(db, orderId);
  if (!order) throw new PrepaySettlementError('订单不存在', 404, 'ORDER_NOT_FOUND');
  await assertActorCanSettle(actor, order);
  const proxyIds = await loadProxyAcceptedOrderIds(db, [order]);
  const proxyAccepted = proxyIds.has(order.id);
  assertOrderCanSettle(order, proxyAccepted);
  const coupons = await db.couponInstance.findMany({
    where: { redeemedOrderId: order.id, status: 'used' },
    select: { code: true },
  });
  const currentCouponCode = couponCodeFromInstances(coupons.map((coupon) => coupon.code));
  const selection = await resolveGroup(
    db,
    order.customerId as string,
    selectionFrom(order, currentCouponCode, input),
  );
  return { order, proxyAccepted, currentCouponCode, selection };
}

export async function previewOrderPrepaySettlement(actor: PrepaySettlementActor, orderId: string, input: PrepaySettlementInput) {
  const { order, selection, currentCouponCode } = await prepare(prisma, actor, orderId, input);
  const keepingCoupon = selection.couponCode !== '' && selection.couponCode === currentCouponCode;
  const coupon = keepingCoupon
    ? { adjustment: bookedCouponAdjustment(order), scopedSubtotal: 0 }
    : await resolveCoupon(prisma, {
      code: selection.couponCode,
      userId: order.customerId as string,
      orderId: order.id,
      lines: await couponLines(prisma, order),
      heldHere: false,
    });
  const quoted = await quotePrepayAmounts(prisma, order, selection, coupon.adjustment, order.pointsApplied);
  return {
    subtotal: quoted.amounts.subtotal,
    adjustmentTotal: quoted.amounts.adjustmentTotal,
    total: quoted.amounts.total,
    pointsPersonal: quoted.pointsBreakdown?.personalPoints ?? 0,
    pointsGroup: quoted.pointsBreakdown?.groupPoints ?? 0,
    pointsGroupId: quoted.pointsBreakdown?.groupId ?? null,
    pointsDiscount: quoted.pointsBreakdown?.pointsDiscount ?? 0,
    couponCode: quoted.scopedSelection.couponCode || null,
    coupon: coupon.adjustment,
    adjustments: quoted.adjustments.map((adjustment) => ({
      type: adjustment.type,
      label: adjustment.label,
      amount: adjustment.amount,
      reason: adjustment.reason ?? null,
    })),
  };
}

async function currentHeldCouponCode(db: Db, orderId: string) {
  const coupons = await db.couponInstance.findMany({
    where: { redeemedOrderId: orderId, status: 'used' },
    select: { code: true },
  });
  return couponCodeFromInstances(coupons.map((coupon) => coupon.code));
}

export async function applyOrderPrepaySettlement(actor: PrepaySettlementActor, orderId: string, input: PrepaySettlementInput) {
  await prepare(prisma, actor, orderId, input);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$executeRaw`
      UPDATE "Order"
      SET "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${orderId}
        AND "paidAt" IS NULL
        AND "status" IN ('unpaid', 'pending')
    `;
    if (Number(locked) !== 1) {
      throw new PrepaySettlementError('订单已不能调整积分或优惠券', 409, 'ORDER_NOT_SETTLEABLE');
    }

    const order = await loadSettlementOrder(tx, orderId);
    if (!order) throw new PrepaySettlementError('订单不存在', 404, 'ORDER_NOT_FOUND');
    if (order.customerId !== actor.id) {
      throw new PrepaySettlementError('只能由订单所属客户调整积分和优惠券', 403, 'ORDER_OWNER_REQUIRED');
    }
    const proxyAccepted = (await loadProxyAcceptedOrderIds(tx, [order])).has(order.id);
    assertOrderCanSettle(order, proxyAccepted);
    const currentCouponCode = await currentHeldCouponCode(tx, order.id);
    const selection = await resolveGroup(tx, order.customerId as string, selectionFrom(order, currentCouponCode, input));
    const fingerprint = selectionFingerprint(selection);
    if (input.idempotencyKey) {
      const existing = await idempotentEvent(tx, order.id, input.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new PrepaySettlementError('幂等键已用于其他结算', 409, 'IDEMPOTENCY_CONFLICT');
        }
        if (!sameSelection(order, currentCouponCode, selection)) {
          throw new PrepaySettlementError('幂等键已完成，但订单结算已再次变化', 409, 'IDEMPOTENCY_STALE');
        }
        return { replayed: true, unchanged: true, order: settlementPatch(order, currentCouponCode, proxyAccepted) };
      }
    }
    if (sameSelection(order, currentCouponCode, selection)) {
      return { replayed: false, unchanged: true, order: settlementPatch(order, currentCouponCode, proxyAccepted) };
    }

    const released = await releaseUnpaidOrderPointsHold(tx, order.id, actor.id);
    if (!released.ok) {
      const status = released.error === POINTS_SETTLEMENT_BUSY_ERROR ? 409 : 400;
      throw new PrepaySettlementError(released.error, status, 'POINTS_RELEASE_FAILED');
    }

    const releasedOrder = await loadSettlementOrder(tx, order.id);
    if (!releasedOrder) throw new PrepaySettlementError('订单不存在', 404, 'ORDER_NOT_FOUND');
    const heldCouponCode = await currentHeldCouponCode(tx, releasedOrder.id);
    const keepingCoupon = selection.couponCode !== '' && heldCouponCode === selection.couponCode;
    if (!keepingCoupon) await restoreRedeemedOrderCoupons(tx, releasedOrder.id);

    let coupon: { adjustment: CheckoutAdjustment | null; scopedSubtotal: number; promotionValidation?: CouponPromotionValidationContext };
    if (keepingCoupon) {
      coupon = {
        adjustment: bookedCouponAdjustment(releasedOrder),
        scopedSubtotal: 0,
      };
    } else {
      const lines = await couponLines(tx, releasedOrder);
      coupon = await resolveCoupon(tx, {
        code: selection.couponCode,
        userId: releasedOrder.customerId as string,
        orderId: releasedOrder.id,
        lines,
        heldHere: false,
      });
    }
    const quoted = await quotePrepayAmounts(tx, releasedOrder, selection, coupon.adjustment, false);
    const nextSelection = quoted.scopedSelection;

    const receivable = await tx.accountReceivable.findUnique({ where: { orderId: releasedOrder.id } });
    try {
      if (!receivable && isPostDeliveryPaymentMethod(releasedOrder.paymentMethod)) {
        await assertQuoteAcceptanceCredit(tx, {
          userId: releasedOrder.customerId,
          email: releasedOrder.email,
          paymentMethod: releasedOrder.paymentMethod,
          total: quoted.amounts.total,
        });
      }
      if (receivable) {
        await syncUnsettledReceivableAmount(tx, releasedOrder.id, quoted.amounts.total, actor.id);
      }
    } catch (error) {
      if (error instanceof PrepaySettlementError) throw error;
      if (error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED') {
        throw new PrepaySettlementError('授信额度不足以按调整后的应付金额结算', 403, 'CREDIT_LIMIT_EXCEEDED');
      }
      if (error instanceof Error && error.message === 'CREDIT_ACCOUNT_SUSPENDED') {
        throw new PrepaySettlementError('账户当前无法按调整后的应付金额结算', 403, 'CREDIT_ACCOUNT_SUSPENDED');
      }
      if (error instanceof Error && error.message === 'ORDER_AMOUNT_LOCKED') {
        throw new PrepaySettlementError('应收已结清或已取消，不能再调整应付金额', 409, 'RECEIVABLE_LOCKED');
      }
      throw error;
    }

    await tx.order.update({
      where: { id: releasedOrder.id },
      data: {
        subtotal: quoted.amounts.subtotal,
        adjustmentTotal: quoted.amounts.adjustmentTotal,
        total: quoted.amounts.total,
        pointsPersonal: quoted.pointsBreakdown?.personalPoints ?? 0,
        pointsGroup: quoted.pointsBreakdown?.groupPoints ?? 0,
        pointsGroupId: quoted.pointsBreakdown?.groupId ?? null,
        pointsDiscount: quoted.pointsBreakdown?.pointsDiscount ?? 0,
        pointsApplied: false,
        pointsAppliedAt: null,
      },
    });
    await tx.orderAdjustment.deleteMany({
      where: { orderId: releasedOrder.id, type: { in: [...MUTABLE_ADJUSTMENT_TYPES] } },
    });
    const mutableAdjustments = quoted.adjustments.filter((adjustment) => MUTABLE_ADJUSTMENT_TYPE_SET.has(adjustment.type));
    if (mutableAdjustments.length > 0) {
      await tx.orderAdjustment.createMany({
        data: mutableAdjustments.map((adjustment) => ({
          orderId: releasedOrder.id,
          type: adjustment.type,
          label: adjustment.label,
          amount: adjustment.amount,
          reason: adjustment.reason ?? null,
        })),
      });
    }
    if (nextSelection.couponCode && !keepingCoupon) {
      const redeemed = await redeemCoupon(
        tx,
        nextSelection.couponCode,
        releasedOrder.customerId as string,
        coupon.scopedSubtotal,
        releasedOrder.id,
        undefined,
        coupon.promotionValidation,
      );
      if (!redeemed.ok) throw new PrepaySettlementError(redeemed.error, 400, 'COUPON_INVALID');
      const validation = coupon.promotionValidation;
      if (validation) {
        for (const [index, item] of releasedOrder.orderItems.entries()) {
          let pricing: Record<string, unknown> = {};
          try { pricing = JSON.parse(item.pricingSnapshot || '{}') as Record<string, unknown>; } catch { /* Keep the policy audit even if legacy pricing JSON is malformed. */ }
          const priorAudits = Array.isArray(pricing.couponPolicyAudits) ? pricing.couponPolicyAudits : [];
          const lineAudit = validation.lineAudit?.[index] ?? { inScope: false, excludedByPolicy: false, identity: { state: 'unknown' } };
          await tx.orderItem.update({
            where: { id: item.id },
            data: { pricingSnapshot: JSON.stringify({
              ...pricing,
              couponPolicyAudits: [...priorAudits, {
                policyFingerprint: validation.promotionPolicyFingerprint,
                policy: validation.policy,
                scope: validation.scope,
                couponId: validation.couponId,
                code: validation.code,
                eligibleSubtotal: validation.scopedSubtotal,
                discount: validation.previewedDiscount,
                ...lineAudit,
              }],
            }) },
          });
        }
      }
    }
    const applied = await applyOrderPointsDeduction(tx, releasedOrder.id);
    if (!applied.ok) {
      const status = applied.error === POINTS_SETTLEMENT_BUSY_ERROR ? 409 : 400;
      throw new PrepaySettlementError(applied.error, status, 'POINTS_APPLY_FAILED');
    }

    const staleAttempts = releasedOrder.paymentAttempts.filter((attempt) => (
      attempt.provider === 'alipay'
      && ACTIVE_ALIPAY_ATTEMPT_STATUSES.includes(attempt.status)
      && amountCents(attempt.amount) !== amountCents(quoted.amounts.total)
    ));
    if (staleAttempts.length > 0) {
      const superseded = await tx.paymentAttempt.updateMany({
        where: { id: { in: staleAttempts.map((attempt) => attempt.id) }, status: { in: ACTIVE_ALIPAY_ATTEMPT_STATUSES } },
        data: { status: 'superseded' },
      });
      if (superseded.count !== staleAttempts.length) {
        throw new PrepaySettlementError('订单支付状态已变化，请刷新后重试', 409, 'PAYMENT_STATE_CHANGED');
      }
    }

    await tx.orderEvent.create({
      data: {
        orderId: releasedOrder.id,
        type: 'prepay_settlement',
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        message: '客户在付款前调整积分和优惠券',
        metadata: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          personalPoints: quoted.pointsBreakdown?.personalPoints ?? 0,
          groupPoints: quoted.pointsBreakdown?.groupPoints ?? 0,
          groupId: quoted.pointsBreakdown?.groupId ?? null,
          couponCode: nextSelection.couponCode,
          total: quoted.amounts.total,
          previousTotal: order.total,
        }),
      },
    });
    await writeAuditLog({
      actorId: actor.id,
      actorEmail: actor.email ?? null,
      action: 'order.prepay_settlement',
      resource: 'orders',
      targetType: 'Order',
      targetId: releasedOrder.id,
      before: { total: order.total, pointsPersonal: order.pointsPersonal, pointsGroup: order.pointsGroup, couponCode: currentCouponCode },
      after: {
        total: quoted.amounts.total,
        pointsPersonal: quoted.pointsBreakdown?.personalPoints ?? 0,
        pointsGroup: quoted.pointsBreakdown?.groupPoints ?? 0,
        couponCode: nextSelection.couponCode || null,
      },
    }, tx);

    const updated = await loadSettlementOrder(tx, releasedOrder.id);
    if (!updated) throw new PrepaySettlementError('订单不存在', 404, 'ORDER_NOT_FOUND');
    return {
      replayed: false,
      unchanged: false,
      order: settlementPatch(updated, nextSelection.couponCode, true),
    };
  }, { timeout: 20000 });
}
