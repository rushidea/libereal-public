import type { Prisma } from '@prisma/client';
import { creditLimitForAccount } from '@/lib/customer-credit';
import { TIERS } from '@/lib/discount';
import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { calculateOrderPoints } from '@/lib/points';
import { assertVariantCheckoutStock, variantIdFromOrderLine } from '@/lib/inventory';

type GuardDb = Prisma.TransactionClient;

export async function assertQuoteAcceptanceStock(
  db: GuardDb,
  lines: Array<{ productId: string | null; quantity: number; variantId?: string | null; metadata?: string | null }>,
) {
  const requested = new Map<string, number>();
  const variantLines: Array<{ productId: string; quantity: number; variantId: string; metadata?: string | null }> = [];
  for (const line of lines) {
    if (!line.productId) continue;
    const variantId = variantIdFromOrderLine(line);
    if (variantId) {
      variantLines.push({ productId: line.productId, quantity: line.quantity, variantId, metadata: line.metadata });
      continue;
    }
    requested.set(line.productId, (requested.get(line.productId) ?? 0) + line.quantity);
  }
  // 有规格的行在事务内按规格账户校验，不足抛出 VARIANT_INSUFFICIENT_STOCK（下单接口返回 400）。
  await assertVariantCheckoutStock(db, variantLines);
  for (const [productId, quantity] of requested) {
    // 没有规格的行保持商品级库存账户（variantId 为空），数量用本次接受数量。
    const account = await db.inventoryAccount.findFirst({ where: { productId, variantId: null } });
    const available = account
      ? account.availableQuantity
      : (await db.product.findUnique({ where: { id: productId }, select: { stockQuantity: true } }))?.stockQuantity;
    if (available == null || available < 0) continue;
    if (available < quantity) throw new Error('INSUFFICIENT_STOCK');
  }
}

export async function assertQuoteAcceptanceCredit(
  db: GuardDb,
  input: { userId: string | null; email: string; paymentMethod: string | null; total: number },
) {
  if (!isPostDeliveryPaymentMethod(input.paymentMethod)) return;
  const user = input.userId
    ? await db.user.findUnique({ where: { id: input.userId }, select: { id: true, tier: true } })
    : await db.user.findUnique({ where: { email: input.email }, select: { id: true, tier: true } });
  if (!user) return;
  const account = await db.creditAccount.findUnique({ where: { userId: user.id } });
  if (account && !['active', 'credit_limited'].includes(account.status)) throw new Error('CREDIT_ACCOUNT_SUSPENDED');
  const tierLimit = TIERS.find((tier) => tier.name === user.tier)?.creditLimit ?? TIERS[TIERS.length - 1].creditLimit;
  const limit = account ? creditLimitForAccount(account) : tierLimit;
  const used = account?.usedAmount ?? 0;
  if (used + input.total > limit) throw new Error('CREDIT_LIMIT_EXCEEDED');
}

/** 回款积分按接受后的订单金额计算，不按报价原数量。接受时不抵扣积分。 */
export function quoteAcceptancePointsAudit(total: number) {
  return {
    pointsBasisAmount: total,
    earnablePoints: calculateOrderPoints(total),
    pointsRedeemed: 0,
  };
}
