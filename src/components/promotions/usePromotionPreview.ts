'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProductCartItem } from '@/context/CartContext';
import { getEffectiveProductPrice } from '@/lib/product-pricing';
import { computePromoAdjustments, type PromoComputation } from '@/lib/cart-promotions/service';
import { toCartLines } from '@/lib/cart-promotions/detect';
import { calculateBoundPromotions, type BoundPromotion, type PromotionStatus } from '@/data/promotion-calculation';

type BindingResponse = { enabled: boolean; campaigns?: BoundPromotion[]; resolved?: Array<{ id: string; productId: string; variantId: string | null }> };
export type CartPromotionPreview = PromoComputation & {
  loading: boolean;
  statuses?: PromotionStatus[];
  retry: () => void;
};

export function usePromotionPreview(items: ProductCartItem[]): CartPromotionPreview {
  const payload = JSON.stringify(items.map(({ product }) => ({ productId: product.id, variantId: product.variantId,
    catalogNumber: product.catalogNumber, brand: product.brand })));
  const [state, setState] = useState<{ key: string; data?: BindingResponse; error?: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  useEffect(() => {
    if (!items.length) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/promotions/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: payload, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '活动信息暂时不可用');
        if (!controller.signal.aborted) setState({ key: payload, data });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key: payload, error: error instanceof Error ? error.message : '活动信息暂时不可用' });
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [items.length, payload, retryCount]);
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
  if (!state || state.key !== payload) return { ...empty, loading: items.length > 0 };
  if (state.error) return { ...empty, issues: [{ ruleId: 'load', message: `${state.error}，请刷新后重试` }] };
  if (!state.data?.enabled) return { ...computePromoAdjustments(toCartLines(items)), loading: false, retry };
  try {
    const lines = (state.data.resolved ?? []).flatMap((identity) => {
      const item = items[Number(identity.id)];
      if (!item || !identity.productId) return [];
      const price = Math.round(getEffectiveProductPrice(item.product) * 100);
      return [{ ...identity, quantity: item.quantity, unitPriceCents: price, basePriceCents: price }];
    });
    const campaigns = (state.data.campaigns ?? []).map((campaign) => ({ ...campaign, startsAt: new Date(campaign.startsAt), endsAt: new Date(campaign.endsAt) }));
    const calculated = calculateBoundPromotions(lines, campaigns);
    const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
    return {
      ...empty,
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
