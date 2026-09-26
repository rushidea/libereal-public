'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProductCartItem } from '@/context/CartContext';
import { useOptionalCart } from '@/context/CartContext';
import { toCartLines } from '@/lib/cart-promotions/detect';
import { computePromoAdjustments } from '@/lib/cart-promotions/service';
import { getEffectiveProductPrice } from '@/lib/product-pricing';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { CartPromotionPreview } from './usePromotionPreview';
import type { Product } from '@/types/Product';

type AddonProductsResponse = { products?: Product[]; error?: string };

function formatAddonPrice(price: number): string {
  return Number.isInteger(price) ? `¥${price}` : `¥${price.toFixed(2)}`;
}

/** 在对应购物车商品下展示资格进度，并提供经过库存接口筛选的付费加购品。 */
export default function CartPromotionPanel({ items, preview }: { items: ProductCartItem[]; preview?: CartPromotionPreview }) {
  const cart = useOptionalCart();
  const addAddonItem = cart?.addAddonItem;
  const [addonProducts, setAddonProducts] = useState<Record<string, Product[]>>({});
  const [addonLoading, setAddonLoading] = useState<Record<string, boolean>>({});
  const [addonErrors, setAddonErrors] = useState<Record<string, string>>({});
  const [addonRefreshKey, setAddonRefreshKey] = useState(0);
  const requestedRules = useRef(new Set<string>());

  const selectedRuleIds = new Set(items.flatMap((item) => item.addon ? [item.addon.ruleId] : []));
  const promotion = preview ?? computePromoAdjustments(toCartLines(items));
  const evaluations = promotion.evals.filter((entry) => selectedRuleIds.has(entry.rule.id)
    || Number(entry.details?.mainCount ?? entry.details?.totalQty ?? entry.details?.hitCount ?? 0) > 0
    || entry.adjustments.length > 0
    || (Array.isArray(entry.details?.counts) && entry.details.counts.some((count) => Number(count.actual) > 0)));
  const addonEvaluations = evaluations.filter((entry) => entry.rule.type === 'addon'
    && (Number(entry.details?.mainCount ?? 0) > 0 || selectedRuleIds.has(entry.rule.id)));
  const addonRequestKey = addonEvaluations
    .filter((entry) => entry.triggered && Number(entry.details?.remainingQuota ?? 0) > 0)
    .map((entry) => entry.rule.id)
    .join('|');

  useEffect(() => {
    if (!addAddonItem || !addonRequestKey || promotion.issues.some((issue) => issue.ruleId === 'load')) return;
    const rules = addonEvaluations.filter((entry) => entry.triggered && Number(entry.details?.remainingQuota ?? 0) > 0);
    for (const entry of rules) {
      const ruleId = entry.rule.id;
      if (requestedRules.current.has(ruleId)) continue;
      requestedRules.current.add(ruleId);
      void Promise.resolve()
        .then(() => {
          setAddonLoading((current) => ({ ...current, [ruleId]: true }));
          return fetch(`/api/cart-promotions/addon-products?ruleId=${encodeURIComponent(ruleId)}`);
        })
        .then(async (response) => {
          const data = await response.json() as AddonProductsResponse;
          if (!response.ok) throw new Error(data.error || '可选加购品暂时不可用');
          setAddonProducts((current) => ({ ...current, [ruleId]: data.products ?? [] }));
          setAddonErrors((current) => {
            const next = { ...current };
            delete next[ruleId];
            return next;
          });
        })
        .catch((error) => {
          requestedRules.current.delete(ruleId);
          setAddonErrors((current) => ({ ...current, [ruleId]: error instanceof Error ? error.message : '可选加购品暂时不可用' }));
        })
        .finally(() => setAddonLoading((current) => ({ ...current, [ruleId]: false })));
    }
  }, [addAddonItem, addonRequestKey, addonRefreshKey, addonEvaluations, promotion.issues]);

  const retryAddons = () => {
    requestedRules.current.clear();
    setAddonRefreshKey((value) => value + 1);
  };

  if (preview?.loading) return <p role="status" className={`py-3 text-sm ${uiSurfaces.textSecondary}`}>正在核对活动规则</p>;

  if (preview?.issues.some((issue) => issue.ruleId === 'load')) {
    const issue = preview.issues.find((entry) => entry.ruleId === 'load');
    return (
      <section aria-label="促销活动状态" className={`space-y-2 border-t pt-4 ${uiSurfaces.border}`}>
        <p className="text-sm text-[var(--brand-color-error-text)]">{issue?.message ?? '活动信息暂时不可用'}</p>
        <button type="button" onClick={preview.retry} className={`${uiSurfaces.linkButton} px-3 py-1.5 text-sm`}>重新加载</button>
      </section>
    );
  }

  if (!evaluations.length && !preview?.statuses?.length) return null;

  return (
    <section aria-label="已选促销活动" className={`space-y-2 border-t pt-4 ${uiSurfaces.border}`}>
      {preview?.statuses?.map((status) => <p key={status.id} className={`text-sm ${uiSurfaces.textSecondary}`}>
        <span className={`font-medium ${uiSurfaces.titleText}`}>{status.name}</span> · {status.message}
      </p>)}
      {evaluations.map((entry) => {
        const issue = promotion.issues.find((item) => item.ruleId === entry.rule.id);
        const addonPrice = entry.rule.type === 'addon' ? entry.rule.addonPrice : 0;
        const qualificationIssue = selectedRuleIds.has(entry.rule.id) && !entry.triggered
          ? '活动条件不满足，请补足主品或移除加购商品'
          : undefined;
        const selectedCount = Number(entry.details?.[entry.rule.type === 'gift' ? 'usedGifts' : 'usedQuota'] ?? 0);
        const quota = Number(entry.details?.[entry.rule.type === 'gift' ? 'giftQuota' : 'quota'] ?? 0);
        const discountedCount = Math.min(selectedCount, quota);
        const applied = promotion.adjustments.find((adjustment) => adjustment.label === entry.rule.name);
        const message = issue?.message
          ?? (entry.rule.type !== 'addon' && entry.rule.type !== 'gift' ? entry.summary : undefined)
          ?? (!entry.triggered
            ? `${entry.summary}，已选附属品按原价计算`
            : selectedCount > quota
              ? `${entry.summary}，超出额度的 ${selectedCount - quota} 件按原价计算`
              : applied ? '已按活动价计算' : '主品满足条件，当前未产生附属品优惠');
        return (
          <div key={entry.rule.id}>
          <p className={`text-sm ${issue || qualificationIssue ? 'text-[var(--brand-color-error-text)]' : uiSurfaces.textSecondary}`}>
            <span className={`font-medium ${uiSurfaces.titleText}`}>{entry.rule.name}</span>
            <span className="mx-1">·</span>
            {qualificationIssue ?? issue?.message ?? message}
            {applied && discountedCount > 0 ? <span className="ml-1">已优惠 {discountedCount} 件</span> : null}
          </p>
          {entry.rule.type === 'addon' && !entry.triggered ? <p className={`mt-1 text-sm ${uiSurfaces.textSecondary}`}>
            还需 {Number(entry.details?.shortfall ?? 0)} 件主品，可按 {formatAddonPrice(entry.rule.addonPrice)} 加购
          </p> : null}
          {entry.rule.type === 'addon' && entry.triggered && Number(entry.details?.remainingQuota ?? 0) > 0 ? (
            <div className={`ml-4 mt-2 rounded-lg border p-3 ${uiSurfaces.border} ${uiSurfaces.panel}`}>
              <p className={`text-xs font-medium ${uiSurfaces.textSecondary}`}>可选加购品 · 按活动价计入</p>
              {addonLoading[entry.rule.id] ? <p role="status" className={`mt-2 text-sm ${uiSurfaces.textSecondary}`}>正在查询库存</p> : null}
              {addonErrors[entry.rule.id] ? <div className="mt-2 flex items-center justify-between gap-3"><p className="text-sm text-[var(--brand-color-error-text)]">{addonErrors[entry.rule.id]}</p><button type="button" onClick={retryAddons} className={`${uiSurfaces.linkButton} shrink-0 px-2 py-1 text-xs`}>重新加载</button></div> : null}
              {!addonLoading[entry.rule.id] && !addonErrors[entry.rule.id] && addonProducts[entry.rule.id] !== undefined && addonProducts[entry.rule.id].length === 0 ? <p className={`mt-2 text-sm ${uiSurfaces.textSecondary}`}>当前暂无可用库存，请稍后再试</p> : null}
              <div className="mt-2 space-y-2">
                {addonProducts[entry.rule.id]?.map((product) => {
                  const selected = items.find((item) => item.addon?.ruleId === entry.rule.id
                    && item.product.id === product.id
                    && item.product.variantId === product.variantId);
                  const available = Number(entry.details?.remainingQuota ?? 0) > 0;
                  return <div key={`${product.id}:${product.variantId ?? ''}`} className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{product.name}</p>
                      <p className={`mt-0.5 text-xs ${uiSurfaces.textSecondary}`}>{product.brand} · {product.catalogNumber}{product.spec ? ` · ${product.spec}` : ''}</p>
                      <p className={`mt-0.5 text-xs ${product.inStock ? 'text-emerald-700' : 'text-amber-700'}`}>{product.inStock ? (product.leadTime || '现货') : '暂时缺货'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-brand-600">加购价 {formatAddonPrice(addonPrice)}</p>
                      <p className={`text-xs ${uiSurfaces.textSecondary}`}>原价 {formatAddonPrice(getEffectiveProductPrice(product))}</p>
                      <button type="button" title={`${product.catalogNumber} · ${selected ? '已加入购物车' : product.inStock && available ? `按 ${formatAddonPrice(addonPrice)} 加购` : '暂时不可加购'}`} disabled={!addAddonItem || !available || !product.inStock} onClick={() => addAddonItem?.(product, entry.rule.id, addonPrice)} className={`${uiSurfaces.primaryButton} mt-1 px-2.5 py-1.5 text-xs disabled:opacity-50`}>{selected ? '已加入' : '加入购物车'}</button>
                    </div>
                  </div>;
                })}
              </div>
            </div>
          ) : null}
          </div>
        );
      })}
    </section>
  );
}
