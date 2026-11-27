'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProductCartItem } from '@/context/CartContext';
import { getEffectiveProductPrice, isPricedProduct } from '@/lib/product-pricing';
import { computePromoAdjustments, type PromoComputation } from '@/lib/cart-promotions/service';
import { toCartLines } from '@/lib/cart-promotions/detect';
import { calculateBoundPromotions, type BoundPromotion, type PromotionStatus } from '@/data/promotion-calculation';
import type { PromotionQualificationView } from '@/lib/cart-promotions/qualification';

export type AddonQualification = PromotionQualificationView & { name: string; options: Array<{ catalogNumber: string; price: number; quantity: number }> };

type BindingResponse = { enabled: boolean; unified?: boolean; lineTotals?: Array<number | null>; lineBands?: Array<Array<{ quantity: number; unitPriceCents: number }> | null>; ordinaryLineTotals?: Array<number | null>; total?: number; statuses?: PromotionStatus[]; qualifications?: AddonQualification[];
  campaigns?: BoundPromotion[]; resolved?: Array<{ id: string; productId: string; variantId: string | null }> };
export type CartPromotionPreview = PromoComputation & {
  loading: boolean;
  statuses?: PromotionStatus[];
  retry: () => void;
  serverLineTotals?: Array<number | null>;
  serverLineBands?: Array<Array<{ quantity: number; unitPrice: number }> | null>;
  serverOrdinaryLineTotals?: Array<number | null>;
  serverTotal?: number;
  qualifications?: AddonQualification[];
  viewKey?: string;
};

export function usePromotionPreview(items: ProductCartItem[], viewerKey?: string | null): CartPromotionPreview {
  const payload = JSON.stringify(items.map(({ product, quantity, addon }) => ({ productId: product.id, variantId: product.variantId,
    catalogNumber: product.catalogNumber, brand: product.brand, quantity,
    ...(addon ? { promoMark: { ruleId: addon.ruleId, price: addon.addonPrice, choice: product.catalogNumber } } : {}) })));
  const requestKey = JSON.stringify([payload, viewerKey ?? null]);
  const [state, setState] = useState<{ key: string; data?: BindingResponse; error?: string; refreshId?: number } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  useEffect(() => {
    if (!items.length) return;
    let current: AbortController | null = null;
    let sequence = 0; let disposed = false;
    const refresh = async () => {
      current?.abort();
      const controller = new AbortController(); current = controller;
      const requestSequence = ++sequence;
      setState({ key: requestKey });
      try {
        const response = await fetch('/api/promotions/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: payload, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '活动信息暂时不可用');
        if (!disposed && !controller.signal.aborted && requestSequence === sequence) setState({ key: requestKey, data, refreshId: requestSequence });
      } catch (error) {
        if (!disposed && !controller.signal.aborted && requestSequence === sequence) setState({ key: requestKey, error: error instanceof Error ? error.message : '活动信息暂时不可用' });
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60000);
    return () => { disposed = true; current?.abort(); clearInterval(interval); };
  }, [items.length, payload, requestKey, retryCount]);
  const empty: CartPromotionPreview = {
    loading: false,
    evals: [],
    issues: [],
    adjustments: [],
    discountTotal: 0,
    lineDiscounts: {},
    linePromotionLabels: {},
    retry,
  };
  if (!state || state.key !== requestKey || (!state.data && !state.error)) return { ...empty, loading: items.length > 0 };
  if (state.error) return { ...empty, issues: [{ ruleId: 'load', message: `${state.error}，请刷新后重试` }] };
  const viewKey = JSON.stringify([requestKey, retryCount, state.refreshId]);
  if (!state.data?.enabled) return { ...computePromoAdjustments(toCartLines(items.filter((item) => isPricedProduct(item.product)))), loading: false, retry, viewKey };
  if (state.data.unified) {
    const { lineTotals, lineBands, ordinaryLineTotals, total, statuses, qualifications } = state.data;
    if (!Array.isArray(lineTotals) || !Array.isArray(lineBands) || !Array.isArray(ordinaryLineTotals) || lineTotals.length !== items.length
      || lineBands.length !== items.length || lineBands.some((bands, index) => bands === null ? lineTotals[index] !== null : !Array.isArray(bands) || lineTotals[index] === null || bands.some((band) => !Number.isSafeInteger(band.quantity) || band.quantity <= 0 || !Number.isSafeInteger(band.unitPriceCents) || band.unitPriceCents < 0)
        || bands.reduce((sum, band) => sum + band.quantity, 0) !== items[index].quantity
        || bands.reduce((sum, band) => sum + band.quantity * band.unitPriceCents, 0) !== lineTotals[index])
      || ordinaryLineTotals.length !== items.length || !Number.isSafeInteger(total) || total! < 0
      || lineTotals.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))
      || ordinaryLineTotals.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))
      || lineTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== total) {
      return { ...empty, issues: [{ ruleId: 'load', message: '活动价格暂时不可用，请刷新后重试' }] };
    }
    const discounts = lineTotals.map((value, index) => value === null ? 0 : Math.max(0, (ordinaryLineTotals[index] ?? value) - value));
    return { ...empty, viewKey, statuses: Array.isArray(statuses) ? statuses : [], qualifications: Array.isArray(qualifications) ? qualifications : [],
      discountTotal: discounts.reduce((sum, value) => sum + value, 0) / 100,
      lineDiscounts: Object.fromEntries(discounts.map((value, index) => [String(index), value / 100])),
      serverLineTotals: lineTotals.map((value) => value === null ? null : value / 100),
      serverLineBands: lineBands.map((bands) => bands?.map((band) => ({ quantity: band.quantity, unitPrice: band.unitPriceCents / 100 })) ?? null),
      serverOrdinaryLineTotals: ordinaryLineTotals.map((value) => value === null ? null : value / 100), serverTotal: total! / 100 };
  }
  try {
    const lines = (state.data.resolved ?? []).flatMap((identity) => {
      const item = items[Number(identity.id)];
      if (!item || !identity.productId || !isPricedProduct(item.product)) return [];
      const price = Math.round(getEffectiveProductPrice(item.product) * 100);
      const pricedIndex = items.filter((entry) => isPricedProduct(entry.product)).indexOf(item);
      return [{ ...identity, id: String(pricedIndex), quantity: item.quantity, unitPriceCents: price, basePriceCents: price }];
    });
    const campaigns = (state.data.campaigns ?? []).map((campaign) => ({ ...campaign, startsAt: new Date(campaign.startsAt), endsAt: new Date(campaign.endsAt) }));
    const calculated = calculateBoundPromotions(lines, campaigns);
    const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
    return {
      ...empty,
      viewKey,
      statuses: calculated.statuses,
      discountTotal: calculated.discountCents / 100,
      lineDiscounts: Object.fromEntries(Object.entries(calculated.lineDiscounts).map(([id, cents]) => [id, cents / 100])),
      linePromotionLabels: Object.fromEntries(Object.entries(calculated.lineRules).map(([id, rule]) => [
        id,
        [campaignNames.get(rule.id) ?? rule.id],
      ])),
    };
  } catch {
    return { ...empty, issues: [{ ruleId: 'invalid', message: '活动配置需要重新确认，请稍后重试' }] };
  }
}
