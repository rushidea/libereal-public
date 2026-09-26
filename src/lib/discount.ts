import { lookupBrandDiscountRate } from '@/lib/discount-brand-catalog';

export type TierPolicy = { level: number; min: number; name: string; creditLimit: number; discountRate: number };
/** Merchant tier policy is supplied by deployment configuration. The public snapshot includes none. */
export const DEFAULT_TIER: TierPolicy = { level: 0, min: 0, name: 'standard', creditLimit: 0, discountRate: 1 };
export const TIERS: TierPolicy[] = [DEFAULT_TIER, ...Array.from({ length: 7 }, (_, index) => ({ level: index + 2, min: 0, name: `tier-${index + 2}`, creditLimit: 0, discountRate: 1 }))];
export const TIER_DISCOUNT_RATES: Record<string, number> = Object.fromEntries(TIERS.map((tier) => [tier.name, 1]));

export function getTierByRollingSpend(amount: number, tiers: readonly TierPolicy[] = TIERS): TierPolicy {
  return [...tiers].sort((a, b) => b.min - a.min).find((tier) => amount >= tier.min) ?? DEFAULT_TIER;
}

export function getUserBrandDiscount(user: { discountRate?: number | null; brandDiscounts?: string | null; tier?: string }, brand: string, subBrand?: string | null): number {
  let brandMap: Record<string, number> | null = null;
  if (user.brandDiscounts) { try { brandMap = typeof user.brandDiscounts === 'string' ? JSON.parse(user.brandDiscounts) : user.brandDiscounts; } catch { brandMap = null; } }
  if (brandMap) { const lookedUp = lookupBrandDiscountRate(brandMap, brand, subBrand); if (lookedUp != null) return lookedUp; }
  if (user.discountRate != null) return user.discountRate;
  return TIER_DISCOUNT_RATES[user.tier ?? ''] ?? 1;
}
export function getUserDisplayDiscount(user: { discountRate?: number | null; tier?: string }): number {
  return user.discountRate ?? TIER_DISCOUNT_RATES[user.tier ?? ''] ?? 1;
}
export function applyDiscount(price: number, rate: number): number { return Math.round(price * rate * 100) / 100; }
