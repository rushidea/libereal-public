import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeOrderPaymentMethod, type OrderPaymentMethod } from '@/data/payment-methods';
import {
  paymentMethodAdjustments,
  pointsRedeemAdjustment,
  type CheckoutAdjustment,
} from '@/lib/checkout-payment';
import { calculateOrderAmounts } from '@/lib/order-domain';
import { normalizePointsIntent, type PointsRedeemBreakdown, type PointsRedeemIntent } from '@/lib/points-checkout';
import { previewPointsRedeem } from '@/lib/points-checkout-service';

type Db = Prisma.TransactionClient | PrismaClient;

export async function settleCheckoutPayment(
  db: Db,
  userId: string,
  input: {
    paymentMethod: unknown;
    lineItems: Array<{ unitPrice: number; quantity: number }>;
    merchandiseAdjustments?: CheckoutAdjustment[];
    platformFeeBase: number;
    personalPoints?: unknown;
    groupPoints?: unknown;
    groupId?: unknown;
  },
): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      paymentMethod: OrderPaymentMethod;
      intent: PointsRedeemIntent;
      pointsBreakdown: PointsRedeemBreakdown | null;
      adjustments: CheckoutAdjustment[];
      amountsBeforePoints: { subtotal: number; adjustmentTotal: number; total: number };
      amounts: { subtotal: number; adjustmentTotal: number; total: number };
    }
> {
  const paymentMethod = normalizeOrderPaymentMethod(input.paymentMethod);
  if (!paymentMethod) return { ok: false, error: '请选择有效的付款方式' };

  const merchandiseAdjustments = input.merchandiseAdjustments ?? [];
  const prePointsAdjustments = [
    ...paymentMethodAdjustments(paymentMethod, input.platformFeeBase),
    ...merchandiseAdjustments,
  ];
  const amountsBeforePoints = calculateOrderAmounts(input.lineItems, prePointsAdjustments);
  const intent = normalizePointsIntent({
    personalPoints: input.personalPoints,
    groupPoints: input.groupPoints,
    groupId: input.groupId,
  });

  let pointsBreakdown: PointsRedeemBreakdown | null = null;
  if (intent.personalPoints > 0 || intent.groupPoints > 0) {
    const preview = await previewPointsRedeem(db, userId, amountsBeforePoints.total, intent);
    if (!preview.ok) return { ok: false, error: preview.error };
    pointsBreakdown = preview.breakdown;
  }

  const pointsAdjustment = pointsRedeemAdjustment(pointsBreakdown);
  const adjustments = pointsAdjustment ? [...prePointsAdjustments, pointsAdjustment] : prePointsAdjustments;
  const amounts = calculateOrderAmounts(input.lineItems, adjustments);
  return { ok: true, paymentMethod, intent, pointsBreakdown, adjustments, amountsBeforePoints, amounts };
}

export async function assertCheckoutPointsAvailable(
  db: Db,
  userId: string,
  payableBeforePoints: number,
  intent: PointsRedeemIntent,
) {
  if (intent.personalPoints <= 0 && intent.groupPoints <= 0) return;
  const recheck = await previewPointsRedeem(db, userId, payableBeforePoints, intent);
  if (!recheck.ok) throw new Error(`POINTS_PRECHECK:${recheck.error}`);
}
