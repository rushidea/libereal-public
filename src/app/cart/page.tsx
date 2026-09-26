'use client';

import { useState } from 'react';
import { useCart, getCartItemKey, type ProductCartItem } from '@/context/CartContext';
import Link from 'next/link';
import { ShoppingCart, Plus, Minus, Trash2, Package, CheckCircle, ArrowRight as ArrowRightIcon, Zap, History, Save, X, Clock } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import WhyChooseUs from '@/components/WhyChooseUs';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import Breadcrumb from '@/components/Breadcrumb';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { QuickOrderItem } from '@/context/CartContext';
import { getEffectiveProductPrice, isPricedProduct } from '@/lib/product-pricing';
import { canIncreasePromotionItem as legacyCanIncreasePromotionItem } from '@/lib/cart-promotions/detect';
import { usePromotionPreview } from '@/components/promotions/usePromotionPreview';
import CartPromotionPanel from '@/components/promotions/CartPromotionPanel';

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, totalItems, saveCartHistory, getCartHistory, restoreFromHistory, forceSync } = useCart();
  const router = useRouter();
  const { data: session } = useSession();
  const [touchState, setTouchState] = useState<{ id: string; startX: number } | null>(null);  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ReturnType<typeof getCartHistory>>([]);

  const productItems = items.filter(i => !i.isQuickOrder) as ProductCartItem[];
  const quickItems = items.filter(i => i.isQuickOrder) as QuickOrderItem[];

  // 有价格产品（直接购买）
  const pricedItems = productItems.filter(i => isPricedProduct(i.product));
  // 无价格产品（走询价流程）
  const unpricedItems = [...productItems.filter(i => !isPricedProduct(i.product)), ...quickItems];

  const promotion = usePromotionPreview(pricedItems);
  const canIncreasePromotionItem = (item: ProductCartItem, evaluations: typeof promotion.evals) =>
    promotion.statuses !== undefined || legacyCanIncreasePromotionItem(item, evaluations);
  const hasInvalidPromotionQualification = promotion.evals.some((entry) =>
    ['addon', 'gift'].includes(entry.rule.type)
    && pricedItems.some((item) => item.addon?.ruleId === entry.rule.id)
    && !entry.triggered,
  );
  const subtotal = pricedItems.reduce((sum, item) => sum + getEffectiveProductPrice(item.product) * item.quantity, 0);
  const estimatedTotal = Math.max(0, subtotal - promotion.discountTotal);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  // Direct purchase: create order for priced products only
  if (items.length === 0) {
    return (
      <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
        <AdaptiveHeader showNav={true} />
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
          <div className={`mb-6 flex h-24 w-24 items-center justify-center rounded-full ${uiSurfaces.panel}`}>
            <ShoppingCart className="w-12 h-12 text-gray-500" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">购物车是空的</h2>
          <p className="text-gray-600 mb-8 text-center">还没找到合适的试剂？去逛逛产品列表吧。</p>
          <Link href="/products" className={`${uiSurfaces.primaryButton} px-8 py-3`}>
            浏览产品 <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
        <MobileBottomNav />
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showNav={true} />

      {!session && items.length > 0 && (
        <div className="border-b border-[var(--brand-color-border)] bg-[var(--brand-color-info-bg)] py-3 px-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--brand-color-text)]">您还没有登录，登录后可保存购物车数据</p>
            <Link
              href="/login?callbackUrl=/cart"
              className="shrink-0 text-sm font-semibold text-[var(--brand-color-link)] hover:text-[var(--brand-color-link-hover)]"
            >
              登录
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-8">
        <Breadcrumb items={[
          { label: '首页', href: '/' },
          { label: '购物车' }
        ]} />

        <div className="flex items-center gap-3 mb-8">
          <ShoppingCart className="w-7 h-7 text-brand-600" />
          <h1 className="text-2xl font-bold text-gray-900">购物车</h1>
          <span className="text-sm text-gray-600">({totalItems} 件商品)</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">

{/* Priced products - direct purchase */}
            {pricedItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-brand-500" /> 直接购买
                  </h2>
                </div>
                <div className={`libereal-cart-product-list overflow-x-auto rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panel}`}>
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className={`border-b text-xs ${uiSurfaces.border} ${uiSurfaces.textSecondary}`}>
                      <tr><th className="w-12 px-3 py-2.5 text-center font-medium">序号</th><th className="px-3 py-2.5 font-medium">商品</th><th className="px-3 py-2.5 font-medium">单价</th><th className="px-3 py-2.5 text-center font-medium">数量</th><th className="px-3 py-2.5 text-right font-medium">小计</th><th className="w-12 px-3 py-2.5" /></tr>
                    </thead>
                    <tbody className={`divide-y ${uiSurfaces.border}`}>
                      {pricedItems.map((item, index) => {
                        const basePrice = getEffectiveProductPrice(item.product);
                        const lineDiscount = promotion.lineDiscounts[String(index)] ?? 0;
                        const salePrice = basePrice - lineDiscount / item.quantity;
                        return <tr key={getCartItemKey(item)}>
                          <td className={`px-3 py-3 text-center tabular-nums ${uiSurfaces.textSecondary}`}>{index + 1}</td>
                          <td className="px-3 py-3"><Link href={`/products/${item.product.id}`} className={`block font-medium hover:text-brand-600 ${uiSurfaces.titleText}`}>{item.product.name}</Link><p className={`mt-0.5 text-xs ${uiSurfaces.textSecondary}`}>{item.product.catalogNumber}{item.product.spec ? ` · ${item.product.spec}` : ''}</p></td>
                          <td className="px-3 py-3 whitespace-nowrap"><span className="font-semibold text-brand-600">{lineDiscount > 0 ? (item.addon ? '加购价 ' : '活动价 ') : item.addon ? '原价 ' : ''}{formatPrice(salePrice)}</span></td>
                          <td className="px-3 py-3"><div className={`mx-auto flex w-fit items-center rounded-lg border ${uiSurfaces.border}`}><button aria-label="减少数量" onClick={() => updateQuantity(getCartItemKey(item), item.quantity - 1)} className="p-1.5"><Minus className="h-3.5 w-3.5" /></button><span className="min-w-8 text-center tabular-nums">{item.quantity}</span><button aria-label="增加数量" disabled={!canIncreasePromotionItem(item, promotion.evals)} onClick={() => updateQuantity(getCartItemKey(item), item.quantity + 1)} className="p-1.5 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button></div></td>
                          <td className="px-3 py-3 text-right font-semibold text-brand-600 whitespace-nowrap">{formatPrice(basePrice * item.quantity - lineDiscount)}</td>
                          <td className="px-3 py-3 text-right"><button aria-label={`移除 ${item.product.name}`} onClick={() => removeItem(getCartItemKey(item))} className="p-1.5 text-gray-500 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <CartPromotionPanel items={pricedItems} preview={promotion} />
              </div>
            )}

            {/* Unpriced products - inquiry flow */}
            {unpricedItems.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Package className="w-4 h-4 text-amber-500" /> 询价产品
                  </h2>
                </div>
                {unpricedItems.map((item) => (
                  'product' in item ? (
                    <div key={getCartItemKey(item)} className={`relative mb-3 flex gap-4 overflow-hidden rounded-xl p-4 sm:p-5 ${uiSurfaces.panel}`}
                      onTouchStart={(e) => setTouchState({ id: getCartItemKey(item), startX: e.touches[0].clientX })}
                      onTouchMove={(e) => {
                        if (!touchState || touchState.id !== getCartItemKey(item)) return;
                        const diff = e.touches[0].clientX - touchState.startX;
                        if (diff < -80) setSwipedId(getCartItemKey(item));
                        else if (diff > 40) setSwipedId(null);
                      }}
                      onTouchEnd={() => setTouchState(null)}
                    >
                      <button onClick={() => removeItem(getCartItemKey(item))} className={`absolute left-0 top-0 bottom-0 w-20 bg-red-500 text-white flex items-center justify-center transition-transform ${swipedId === getCartItemKey(item) ? 'translate-x-0' : '-translate-x-full'}`}>
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <span className="absolute right-3 top-3 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">待报价</span>
                      <div className={`flex-1 min-w-0 transition-transform ${swipedId === getCartItemKey(item) ? '-translate-x-20' : 'translate-x-0'}`}>
                        <div className="flex items-start gap-3 mb-2">
                          <div className="bg-amber-50 rounded p-2 flex-shrink-0">
                            <Package className="w-5 h-5 text-amber-600" />
                          </div>
                          <div className="min-w-0 pr-20 sm:pr-0">
                            <Link href={`/products/${item.product.id}`} className="block hover:text-brand-600">
                              <h3 className="font-semibold text-gray-900 text-sm sm:text-base leading-snug">{item.product.name}</h3>
                              <p className="text-xs text-gray-600 mt-0.5">{item.product.brand} · {item.product.catalogNumber}</p>
                            </Link>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-amber-600 font-semibold">待报价</span>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center border border-gray-200 rounded-lg">
                              <button aria-label="减少数量" onClick={() => updateQuantity(getCartItemKey(item), item.quantity - 1)} className="px-2.5 py-1.5 hover:bg-gray-50 text-gray-500 transition-colors"><Minus className="w-4 h-4" /></button>
                              <span className="px-3 py-1.5 text-sm font-medium min-w-[2.5rem] text-center">{item.quantity}</span>
                              <button aria-label="增加数量" disabled={!canIncreasePromotionItem(item, promotion.evals)} onClick={() => updateQuantity(getCartItemKey(item), item.quantity + 1)} className="px-2.5 py-1.5 hover:bg-gray-50 text-gray-500 transition-colors"><Plus className="w-4 h-4" /></button>
                            </div>
                            <button onClick={() => removeItem(getCartItemKey(item))} className="p-2 text-gray-500 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={item.quickId} className={`relative mb-3 flex gap-4 overflow-hidden rounded-xl p-4 sm:p-5 ${uiSurfaces.panel}`}
                      onTouchStart={(e) => setTouchState({ id: item.quickId, startX: e.touches[0].clientX })}
                      onTouchMove={(e) => {
                        if (!touchState || touchState.id !== item.quickId) return;
                        const diff = e.touches[0].clientX - touchState.startX;
                        if (diff < -80) setSwipedId(item.quickId);
                        else if (diff > 40) setSwipedId(null);
                      }}
                      onTouchEnd={() => setTouchState(null)}
                    >
                      <button onClick={() => removeItem(item.quickId)} className={`absolute left-0 top-0 bottom-0 w-20 bg-red-500 text-white flex items-center justify-center transition-transform ${swipedId === item.quickId ? 'translate-x-0' : '-translate-x-full'}`}>
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <span className="absolute right-3 top-3 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">快速询价</span>
                      <div className={`flex-1 min-w-0 transition-transform ${swipedId === item.quickId ? '-translate-x-20' : 'translate-x-0'}`}>
                        <div className="flex items-start gap-3 mb-2">
                          <div className="bg-amber-50 rounded p-2 flex-shrink-0">
                            <Package className="w-5 h-5 text-amber-600" />
                          </div>
                          <div className="min-w-0 pr-20 sm:pr-0">
                            <h3 className="font-semibold text-gray-900 text-sm sm:text-base leading-snug">{item.name}</h3>
                            <p className="text-xs text-gray-600 mt-0.5">{item.brand} · {item.catalogNumber}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-amber-600 font-semibold">{item.quantity} × {item.unit}</span>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center border border-gray-200 rounded-lg">
                              <button onClick={() => updateQuantity(item.quickId, item.quantity - 1)} className="px-2.5 py-1.5 hover:bg-gray-50 text-gray-500 transition-colors"><Minus className="w-4 h-4" /></button>
                              <span className="px-3 py-1.5 text-sm font-medium min-w-[2.5rem] text-center">{item.quantity}</span>
                              <button onClick={() => updateQuantity(item.quickId, item.quantity + 1)} className="px-2.5 py-1.5 hover:bg-gray-50 text-gray-500 transition-colors"><Plus className="w-4 h-4" /></button>
                            </div>
                            <button onClick={() => removeItem(item.quickId)} className="p-2 text-gray-500 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}



          </div>
          {/* Action summary */}
          <div className="lg:col-span-1">
            <div className={`sticky top-20 rounded-[1.15rem] p-5 ${uiSurfaces.panelStrong}`}>
              <h2 className="font-semibold text-gray-900 mb-4">订单操作</h2>

              {pricedItems.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm text-gray-500 mb-2">商品预估金额</div>
                  {promotion.discountTotal > 0 && <p className="mb-2 text-sm">活动优惠 −{formatPrice(promotion.discountTotal)}</p>}
                  {hasInvalidPromotionQualification && <p role="alert" className="mb-3 text-sm text-[var(--brand-color-error-text)]">活动条件不满足，请补足主品或移除加购商品</p>}
                  {promotion.issues.map((issue) => <p key={issue.ruleId} role="alert" className="mb-3 text-sm text-[var(--brand-color-error-text)]">{issue.message}</p>)}
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-gray-600">{pricedItems.reduce((s, i) => s + i.quantity, 0)} 件商品</span>
                    <span className="font-bold text-brand-600">{formatPrice(estimatedTotal)}</span>
                  </div>
                  <button
                    onClick={() => {
                      if (!session) {
                        router.push('/login?callbackUrl=/cart');
                      } else {
                        router.push('/order');
                      }
                    }}
                    disabled={promotion.loading || promotion.issues.length > 0 || hasInvalidPromotionQualification}
                    className={`${uiSurfaces.primaryButton} w-full py-3 disabled:opacity-50`}
                  >
                    <Zap className="w-4 h-4" /> 立即下单
                  </button>
                </div>
              )}

              {pricedItems.length > 0 && unpricedItems.length > 0 && (
                <div className="border-t border-gray-100 my-4" />
              )}

              {unpricedItems.length > 0 && (
                <div>
                  <div className="text-sm text-gray-500 mb-2">询价产品</div>
                  <button
                    onClick={() => {
                      if (!session) {
                        router.push('/login?callbackUrl=/cart');
                      } else {
                        router.push('/inquiry');
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-amber-500 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(245,158,11,0.22)] transition hover:-translate-y-px hover:bg-amber-600 active:translate-y-0"
                  >
                    <CheckCircle className="w-4 h-4" />提交询价
                  </button>
                </div>
              )}

              {pricedItems.length === 0 && unpricedItems.length === 0 && (
                <div className="text-center text-gray-600 text-sm py-4">购物车是空的</div>
              )}

              <div className="mt-5 pt-4 border-t border-gray-200 space-y-2">
                <button
                  onClick={() => {
                    setHistory(getCartHistory());
                    setShowHistory(true);
                  }}
                  className={`${uiSurfaces.linkButton} w-full py-2.5`}
                >
                  <History className="w-4 h-4" /> 购物车历史
                </button>
                <button
                  onClick={() => {
                    const name = `购物车历史 ${new Date().toLocaleString('zh-CN')}`;
                    forceSync();
                    setTimeout(() => {
                      saveCartHistory(name);
                      router.push('/cart');
                    }, 700);
                  }}
                  className={`${uiSurfaces.linkButton} w-full py-2.5`}
                >
                  <Save className="w-4 h-4" /> 保存当前购物车
                </button>
                <button
                  onClick={() => {
                    if (confirm('确定要清空购物车吗？此操作不可恢复。')) {
                      clearCart();
                    }
                  }}
                  className="w-full border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 text-red-600 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Trash2 className="w-4 h-4" /> 清空购物车
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <WhyChooseUs />

      {showHistory && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]" onClick={() => setShowHistory(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-100" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-brand-500" /> 购物车历史
              </h3>
              <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="text-center text-gray-600 py-12 text-sm">暂无保存的历史记录</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {history.map((record, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        restoreFromHistory(idx);
                        setShowHistory(false);
                        router.push('/cart');
                      }}
                      className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="font-medium text-gray-800 text-sm mb-1">{record.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(record.savedAt).toLocaleString('zh-CN')}
                        <span className="text-gray-500 mx-1">·</span>
                        <span>{record.items.length} 件商品</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
