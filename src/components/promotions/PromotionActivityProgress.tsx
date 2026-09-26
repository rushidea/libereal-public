'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, CircleAlert } from 'lucide-react';
import { getCartItemKey, useCart } from '@/context/CartContext';
import { getCartPromotionQualificationViews, isEligibleMainProduct } from '@/lib/cart-promotions/detect';
import { CART_ADDON_RULES } from '@/lib/cart-promotions/rules';
import { getRuleLifecycle } from '@/lib/cart-promotions/lifecycle';
import type { AddonRuleConfig } from '@/lib/cart-promotions/types';
import { getEffectiveProductPrice } from '@/lib/product-pricing';
import { getProductFulfillmentPresentation } from '@/lib/product-fulfillment';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { Product } from '@/types/Product';

type AddonProductsResponse = {
  products?: Product[];
  error?: string;
};

type PromotionActivityProgressProps = {
  primaryProducts: readonly Product[];
  rules?: readonly AddonRuleConfig[];
};

function formatPrice(price: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
}

function getRuleMessage(currentQuantity: number, thresholdQuantity: number, remainingQuota: number): string {
  if (currentQuantity >= thresholdQuantity) {
    return remainingQuota > 0
      ? `已满足 ${currentQuantity}/${thresholdQuantity} 件，可选择换购商品`
      : '本次活动换购额度已用完';
  }
  if (currentQuantity > 0) return `已计入 ${currentQuantity}/${thresholdQuantity} 件 · 还需 ${thresholdQuantity - currentQuantity} 件主品`;
  return `加入 ${thresholdQuantity} 件主品后，可选择换购商品`;
}

function ActivityAddonOptions({ rule, remainingQuota, hasSelection }: { rule: AddonRuleConfig; remainingQuota: number; hasSelection: boolean }) {
  const { addAddonItem, items, removeItem } = useCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [isExpanded, setIsExpanded] = useState(remainingQuota > 0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cart-promotions/addon-products?ruleId=${encodeURIComponent(rule.id)}`)
      .then(async (response) => {
        const data = await response.json() as AddonProductsResponse;
        if (!response.ok) throw new Error(data.error || '可选加购品暂时不可用');
        if (!cancelled) setProducts(data.products ?? []);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : '可选加购品暂时不可用');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, rule.id]);

  return (
    <div id={`promotion-activity-options-${rule.id}`} className={`mt-3 rounded-xl border p-3 sm:p-4 ${uiSurfaces.border} ${uiSurfaces.bgContainer}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>{hasSelection && remainingQuota === 0 ? '已选换购商品' : '可选换购商品'}</p>
          <p className={`mt-0.5 text-xs ${uiSurfaces.textSecondary}`}>活动价 {formatPrice(rule.addonPrice)} / 件{remainingQuota > 0 ? ` · 还可选择 ${remainingQuota} 件` : ' · 可展开修改'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${uiSurfaces.badgeInfo} px-2 py-0.5 text-[11px]`}>实际换购价</span>
          <button type="button" onClick={() => setIsExpanded((value) => !value)} aria-expanded={isExpanded} className={`${uiSurfaces.linkButton} px-2 py-1 text-xs`}>
            {isExpanded ? '收起清单' : '展开清单'}
          </button>
        </div>
      </div>

      {isExpanded && loading ? <p role="status" className={`mt-3 text-sm ${uiSurfaces.textSecondary}`}>正在查询可选商品库存</p> : null}
      {isExpanded && error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-[var(--brand-color-error-text)]">{error}</p>
          <button type="button" onClick={() => {
            setProducts([]);
            setError('');
            setLoading(true);
            setReloadKey((value) => value + 1);
          }} className={`${uiSurfaces.linkButton} px-2 py-1 text-xs`}>重新加载</button>
        </div>
      ) : null}
      {isExpanded && !loading && !error && products.length === 0 ? <p className={`mt-3 text-sm ${uiSurfaces.textSecondary}`}>当前暂无可用库存，请稍后再试。</p> : null}

      {isExpanded ? <div className="mt-3 space-y-2">
        {products.map((product) => {
          const selectedItem = items.find((item) => !item.isQuickOrder
            && item.addon?.ruleId === rule.id
            && item.product.id === product.id
            && item.product.variantId === product.variantId);
          const selected = Boolean(selectedItem);
          const fulfillment = getProductFulfillmentPresentation(product);
          return (
            <div key={`${product.id}:${product.variantId ?? ''}`} className="flex flex-col gap-3 rounded-lg border border-[var(--brand-color-border)] bg-[var(--surface-input)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/products/${encodeURIComponent(product.catalogNumber)}?brand=${encodeURIComponent(product.brand)}`} className={`block truncate text-sm font-medium ${uiSurfaces.text} ${uiSurfaces.focusRing}`}>
                  {product.name}
                </Link>
                <p className={`mt-1 truncate text-xs ${uiSurfaces.textSecondary}`}>{product.brand} · Cat# {product.catalogNumber}{product.spec ? ` · ${product.spec}` : ''}</p>
                <p className={`mt-1 text-xs ${fulfillment.tone === 'success' ? 'text-emerald-700' : fulfillment.tone === 'warning' ? 'text-amber-700' : 'text-red-700'}`}>
                  {fulfillment.label}{fulfillment.detail ? ` · ${fulfillment.detail}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--brand-color-primary)]">{formatPrice(rule.addonPrice)}</p>
                  <p className={`text-xs tabular-nums line-through ${uiSurfaces.textQuaternary}`}>原价 {formatPrice(getEffectiveProductPrice(product))}</p>
                </div>
                <button
                  type="button"
                  disabled={!selected && (!product.inStock || remainingQuota <= 0)}
                  onClick={() => {
                    if (selectedItem) {
                      removeItem(getCartItemKey(selectedItem));
                      return;
                    }
                    addAddonItem(product, rule.id, rule.addonPrice);
                    if (remainingQuota === 1) setIsExpanded(false);
                  }}
                  aria-label={selected
                    ? `取消换购 ${product.catalogNumber}`
                    : product.inStock
                      ? remainingQuota > 0
                        ? `按 ${formatPrice(rule.addonPrice)} 换购 ${product.catalogNumber}`
                        : `${product.catalogNumber} 换购额度已用完`
                      : `${product.catalogNumber} 暂时缺货`}
                  className={`${selected ? uiSurfaces.buttonSecondary : uiSurfaces.buttonPrimary} min-h-10 shrink-0 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {selected ? '取消换购' : product.inStock && remainingQuota > 0 ? '加入换购' : product.inStock ? '额度已用完' : '暂时缺货'}
                </button>
              </div>
            </div>
          );
        })}
      </div> : null}
    </div>
  );
}

export default function PromotionActivityProgress({ primaryProducts, rules = CART_ADDON_RULES }: PromotionActivityProgressProps) {
  const { items } = useCart();
  const activeRules = useMemo(
    () => rules.filter((rule) => getRuleLifecycle(rule) === 'active' && primaryProducts.some((product) => isEligibleMainProduct(rule, product))),
    [primaryProducts, rules],
  );
  const views = useMemo(() => {
    const allViews = getCartPromotionQualificationViews(items);
    return activeRules.map((rule) => ({ rule, view: allViews.find((view) => view.ruleId === rule.id) }));
  }, [activeRules, items]);

  if (activeRules.length === 0) return null;

  const selectedActivity = views.find(({ view }) => (view?.selectedAddons.length ?? 0) > 0);
  const qualifiedActivity = views.find(({ view }) => view?.canChooseAddon && (view.qualification?.remainingQuota ?? 0) > 0);
  const shortfallActivity = views.find(({ view }) => (view?.qualification?.remainingQuantity ?? 0) > 0);
  const mobileAction = selectedActivity
    ? { label: '查看订单摘要', href: '/cart' }
    : qualifiedActivity
      ? { label: '选择换购商品', href: '#promotion-activity-status' }
      : shortfallActivity
        ? { label: `还需 ${shortfallActivity.view?.qualification?.remainingQuantity ?? 0} 件主品`, href: '#promotion-products' }
        : { label: '加入活动主品', href: '#promotion-products' };

  return (
    <>
      <section id="promotion-activity-status" aria-label="本单活动进度" className={`mb-8 overflow-hidden rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panel}`}>
        <div className="border-b px-5 py-3 sm:px-6">
          <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${uiSurfaces.textInteractive}`}>活动进度</p>
        </div>
        <div className="space-y-4 px-5 py-5 sm:px-6">
          {views.map(({ rule, view }) => {
            const qualification = view?.qualification;
            const currentQuantity = qualification?.currentQuantity ?? 0;
            const thresholdQuantity = qualification?.thresholdQuantity ?? rule.minQuantity;
            const remainingQuantity = qualification?.remainingQuantity ?? Math.max(0, thresholdQuantity - currentQuantity);
            const remainingQuota = qualification?.remainingQuota ?? 0;
            const progress = qualification?.progressPercent ?? 0;
            const selectedCount = view?.selectedAddons.reduce((total, addon) => total + addon.quantity, 0) ?? 0;
            return (
              <div key={rule.id} className={`rounded-xl border p-4 ${uiSurfaces.border} ${uiSurfaces.bgContainer}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={`text-sm font-semibold ${uiSurfaces.titleText}`}>{rule.name}</h3>
                    <p className={`mt-1 text-xs leading-5 ${uiSurfaces.textSecondary}`}>{rule.description}</p>
                  </div>
                  <span className={`${uiSurfaces.badgeInfo} shrink-0 px-2 py-0.5 text-xs`}>加购价 {formatPrice(rule.addonPrice)} / 件</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--brand-color-bg-muted)]" role="progressbar" aria-label={`${rule.name}活动进度`} aria-valuemin={0} aria-valuemax={thresholdQuantity} aria-valuenow={Math.min(currentQuantity, thresholdQuantity)}>
                  <div className="h-full rounded-full bg-[var(--brand-color-primary)] transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span aria-live="polite" className={currentQuantity >= thresholdQuantity ? 'font-medium text-emerald-700' : uiSurfaces.textSecondary}>
                    {getRuleMessage(currentQuantity, thresholdQuantity, remainingQuota)}
                    {selectedCount > 0 ? ` · 已选 ${selectedCount} 件换购商品` : ''}
                  </span>
                  {remainingQuantity > 0 ? <Link href="#promotion-products" className={`${uiSurfaces.linkButton} ${uiSurfaces.focusRing}`}>选择活动主品 <ArrowRight size={13} /></Link> : null}
                </div>
                {(view?.canChooseAddon || selectedCount > 0) ? <ActivityAddonOptions rule={rule} remainingQuota={remainingQuota} hasSelection={selectedCount > 0} /> : null}
                {view?.issues.length ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--brand-color-error-text)]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{view.issues[0].message}</p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={`flex items-start gap-2 border-t px-5 py-4 text-xs leading-5 ${uiSurfaces.border} ${uiSurfaces.textSecondary}`}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p>换购商品按活动价计入订单；最终价格、库存和货期以结算时服务端复核结果为准。</p>
        </div>
      </section>

      <nav aria-label="移动端活动操作" className="fixed inset-x-0 bottom-16 z-40 border-t border-[var(--brand-color-border)] bg-[var(--surface-container)]/95 px-4 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 pb-[env(safe-area-inset-bottom)]">
          <div className="min-w-0">
            <p className={`truncate text-xs font-medium ${uiSurfaces.titleText}`}>本单活动</p>
            <p className={`truncate text-[11px] ${uiSurfaces.textSecondary}`}>活动条件与加购价实时核对</p>
          </div>
          {mobileAction.href.startsWith('#') ? (
            <a href={mobileAction.href} className={`${uiSurfaces.buttonPrimary} mr-16 min-h-10 shrink-0 px-4 py-2 text-xs ${uiSurfaces.focusRing}`}>{mobileAction.label}</a>
          ) : (
            <Link href={mobileAction.href} className={`${uiSurfaces.buttonPrimary} mr-16 min-h-10 shrink-0 px-4 py-2 text-xs ${uiSurfaces.focusRing}`}>{mobileAction.label}</Link>
          )}
        </div>
      </nav>
    </>
  );
}
