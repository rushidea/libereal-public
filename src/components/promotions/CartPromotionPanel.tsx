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

type AddonProduct = Product & { addonOption?: { catalogNumber: string; price: number; quantity: number } };
type AddonProductsResponse = { products?: AddonProduct[]; error?: string };

function formatAddonPrice(price: number): string {
  return Number.isInteger(price) ? `¥${price}` : `¥${price.toFixed(2)}`;
}

/** 在对应购物车商品下展示资格进度，并提供经过库存接口筛选的付费加购品。 */
export default function CartPromotionPanel({ items, preview }: { items: ProductCartItem[]; preview?: CartPromotionPreview }) {
  const cart = useOptionalCart();
  const addAddonItem = cart?.addAddonItem;
  const [addonProducts, setAddonProducts] = useState<Record<string, AddonProduct[]>>({});
  const [addonLoading, setAddonLoading] = useState<Record<string, boolean>>({});
  const [addonErrors, setAddonErrors] = useState<Record<string, string>>({});
  const [addonRefreshKey, setAddonRefreshKey] = useState(0);
  const [serverSelectionPending, setServerSelectionPending] = useState(false);
  const [addonScopeKey, setAddonScopeKey] = useState('');
  const pendingCartKey = useRef<string | null>(null);
  const cartKey = JSON.stringify(items.map((item) => [item.product.id, item.product.variantId ?? null, item.quantity, item.addon?.ruleId ?? null]));

  const selectedRuleIds = new Set(items.flatMap((item) => item.addon ? [item.addon.ruleId] : []));
  const promotion = preview ?? computePromoAdjustments(toCartLines(items));
  const evaluations = promotion.evals.filter((entry) => selectedRuleIds.has(entry.rule.id)
    || Number(entry.details?.mainCount ?? entry.details?.totalQty ?? entry.details?.hitCount ?? 0) > 0
    || entry.adjustments.length > 0
    || (Array.isArray(entry.details?.counts) && entry.details.counts.some((count) => Number(count.actual) > 0)));
  const addonEvaluations = evaluations.filter((entry) => entry.rule.type === 'addon'
    && (Number(entry.details?.mainCount ?? 0) > 0 || selectedRuleIds.has(entry.rule.id)));
  const qualifications = preview?.qualifications?.filter((entry) => (entry.qualification?.currentQuantity ?? 0) > 0 || (entry.qualification?.selectedQuantity ?? 0) > 0) ?? [];
  const serverRuleIds = qualifications.filter((entry) => entry.canChooseAddon).map((entry) => entry.ruleId);
  const addonRequestKey = [...addonEvaluations.filter((entry) => entry.triggered && Number(entry.details?.remainingQuota ?? 0) > 0)
    .map((entry) => entry.rule.id), ...serverRuleIds].join('|');

  const hasLoadIssue = promotion.issues.some((issue) => issue.ruleId === 'load');
  const scopeKey = JSON.stringify([preview?.viewKey ?? 'legacy', cartKey, addonRequestKey, preview?.qualifications ?? null, addonRefreshKey]);
  const displayedProducts = addonScopeKey === scopeKey ? addonProducts : {};
  const displayedLoading = addonScopeKey === scopeKey ? addonLoading : {};
  const displayedErrors = addonScopeKey === scopeKey ? addonErrors : {};

  useEffect(() => {
    if (!addAddonItem || !addonRequestKey || preview?.loading || hasLoadIssue) return;
    const controller = new AbortController(); let disposed = false;
    const ids = [...new Set(addonRequestKey.split('|').filter(Boolean))];
    void Promise.resolve().then(() => {
      if (disposed) return;
      setAddonScopeKey(scopeKey); setAddonProducts({}); setAddonErrors({});
      setAddonLoading(Object.fromEntries(ids.map((id) => [id, true])));
      for (const ruleId of ids) {
        void fetch(`/api/cart-promotions/addon-products?ruleId=${encodeURIComponent(ruleId)}`, { signal: controller.signal })
          .then(async (response) => {
            const data = await response.json() as AddonProductsResponse;
            if (!response.ok) throw new Error(data.error || '可选加购品暂时不可用');
            if (!disposed) setAddonProducts((current) => ({ ...current, [ruleId]: data.products ?? [] }));
          })
          .catch((error) => { if (!disposed && !controller.signal.aborted) setAddonErrors((current) => ({ ...current, [ruleId]: error instanceof Error ? error.message : '可选加购品暂时不可用' })); })
          .finally(() => { if (!disposed) setAddonLoading((current) => ({ ...current, [ruleId]: false })); });
      }
    });
    return () => { disposed = true; controller.abort(); };
  }, [addAddonItem, addonRequestKey, scopeKey, preview?.loading, hasLoadIssue]);

  useEffect(() => {
    let active = true;
    if (!preview?.loading && pendingCartKey.current !== null && pendingCartKey.current !== cartKey) {
      queueMicrotask(() => { if (active) { pendingCartKey.current = null; setServerSelectionPending(false); } });
    }
    return () => { active = false; };
  }, [preview?.loading, cartKey]);

  const retryAddons = () => {
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

  if (!evaluations.length && !preview?.statuses?.length && !qualifications.length) return null;

  return (
    <section aria-label="已选促销活动" className={`space-y-2 border-t pt-4 ${uiSurfaces.border}`}>
      {preview?.statuses?.map((status) => <p key={status.id} className={`text-sm ${uiSurfaces.textSecondary}`}>
        <span className={`font-medium ${uiSurfaces.titleText}`}>{status.name}</span> · {status.message}
      </p>)}
      {qualifications.map((view) => <div key={view.ruleId}>
        <p className={`text-sm ${uiSurfaces.textSecondary}`}><span className={`font-medium ${uiSurfaces.titleText}`}>{view.name}</span> ·
          {view.status === 'not-qualified' ? ` 还需 ${view.qualification?.remainingQuantity ?? 0} 件主品` : ` 剩余 ${view.qualification?.remainingQuota ?? 0} 次加购额度`}</p>
        {view.canChooseAddon && <div className={`ml-4 mt-2 rounded-lg border p-3 ${uiSurfaces.border} ${uiSurfaces.panel}`}>
          {serverSelectionPending && !preview?.loading && <button type="button" onClick={() => { pendingCartKey.current = null; setServerSelectionPending(false); preview?.retry(); }}>重新核对资格</button>}
          {displayedLoading[view.ruleId] ? <p role="status">正在查询库存</p> : null}
          {displayedErrors[view.ruleId] ? <div><p role="alert">{displayedErrors[view.ruleId]}</p><button type="button" onClick={retryAddons}>重新加载</button></div> : null}
          {!displayedLoading[view.ruleId] && !displayedErrors[view.ruleId] && displayedProducts[view.ruleId]?.length === 0 ? <p>当前暂无可用库存</p> : null}
          {displayedProducts[view.ruleId]?.map((product) => {
            const option = product.addonOption; const price = option?.price ?? view.benefit.amount; const count = option?.quantity ?? 1;
            return <div key={`${product.id}:${product.variantId ?? ''}`} className="flex items-center justify-between gap-3 py-2">
              <span>{product.name} · {product.catalogNumber}{product.spec ? ` · ${product.spec}` : ''}</span>
              <div><span>加购价 {formatAddonPrice(price)}{count > 1 ? ` / ${count} 件` : ''}</span>
                <button type="button" disabled={!addAddonItem || !product.inStock || serverSelectionPending || preview?.loading} onClick={() => {
                  pendingCartKey.current = cartKey; setServerSelectionPending(true); addAddonItem?.(product, view.ruleId, price, true);
                }}>加入购物车</button></div>
            </div>;
          })}
        </div>}
      </div>)}
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
              {displayedLoading[entry.rule.id] ? <p role="status" className={`mt-2 text-sm ${uiSurfaces.textSecondary}`}>正在查询库存</p> : null}
              {displayedErrors[entry.rule.id] ? <div className="mt-2 flex items-center justify-between gap-3"><p className="text-sm text-[var(--brand-color-error-text)]">{displayedErrors[entry.rule.id]}</p><button type="button" onClick={retryAddons} className={`${uiSurfaces.linkButton} shrink-0 px-2 py-1 text-xs`}>重新加载</button></div> : null}
              {!displayedLoading[entry.rule.id] && !displayedErrors[entry.rule.id] && displayedProducts[entry.rule.id] !== undefined && displayedProducts[entry.rule.id].length === 0 ? <p className={`mt-2 text-sm ${uiSurfaces.textSecondary}`}>当前暂无可用库存，请稍后再试</p> : null}
              <div className="mt-2 space-y-2">
                {displayedProducts[entry.rule.id]?.map((product) => {
                  const selectedPrice = product.addonOption?.price ?? addonPrice;
                  const selectedQuantity = product.addonOption?.quantity ?? 1;
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
                      <p className="text-sm font-semibold text-brand-600">加购价 {formatAddonPrice(selectedPrice)}{selectedQuantity > 1 ? ` / ${selectedQuantity} 件` : ''}</p>
                      <p className={`text-xs ${uiSurfaces.textSecondary}`}>原价 {formatAddonPrice(getEffectiveProductPrice(product))}</p>
                      <button type="button" title={`${product.catalogNumber} · ${selected ? '已加入购物车' : product.inStock && available ? `按 ${formatAddonPrice(selectedPrice)} 加购` : '暂时不可加购'}`} disabled={!addAddonItem || !available || !product.inStock} onClick={() => addAddonItem?.(product, entry.rule.id, selectedPrice)} className={`${uiSurfaces.primaryButton} mt-1 px-2.5 py-1.5 text-xs disabled:opacity-50`}>{selected ? '已加入' : '加入购物车'}</button>
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
