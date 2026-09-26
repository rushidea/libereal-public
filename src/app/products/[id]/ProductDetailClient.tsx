'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getProductCartKey, useCart } from '@/context/CartContext';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Package, ShoppingCart, Check,
  Tag, FlaskConical, Target, Activity, Box, Info, AlertTriangle,
} from 'lucide-react';


import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { Product } from '@/types/Product';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { productCategories } from '@/data/categories';
import { getProductImageAlt, getProductImageUrl } from '@/lib/productImage';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { getEffectiveProductPrice } from '@/lib/product-pricing';
import { getVariantOptionCopy, mergeProductPackageOptions } from '@/lib/product-variants';
import { acquireChatwaySuppression } from '@/lib/suppress-chatway';
import type { ProductVariant } from '@/types/Product';
import { getCartPromotionQualificationViews } from '@/lib/cart-promotions/detect';
import { isEligibleMainProduct } from '@/lib/cart-promotions/matching';
import { PROMOTION_RULES } from '@/lib/cart-promotions/rules';
import { getRuleLifecycle } from '@/lib/cart-promotions/lifecycle';
import type { AddonRuleConfig } from '@/lib/cart-promotions/types';
import { getProductFulfillmentPresentation } from '@/lib/product-fulfillment';

interface ProductDetailClientProps {
  product: Product;
  variants: Product[];
  related: Product[];
}

/**
 * Smart label fallback: if the variant's spec is informative, prefer it over the suffix-derived label.
 */
function variantLabel(v: Product): string {
  return getVariantOptionCopy(v).title;
}

export default function ProductDetailClient({ product, variants, related }: ProductDetailClientProps) {
  const { addItem, removeItem, isInCart, items } = useCart();
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverL2Open, setHoverL2Open] = useState(false);

  const cat = product.category ?? '';
  const l1Index = productCategories.findIndex((c) => c.name === cat);
  const currentL1 = l1Index !== -1 ? productCategories[l1Index] : null;
  const l2Index = currentL1 ? currentL1.sub.findIndex((s) => s.name === product.subcategory) : -1;
  const currentL2 = currentL1 && l2Index !== -1 ? currentL1.sub[l2Index] : null;
  const l1IndexNav = l1Index !== -1 ? l1Index : null;
  const l2IndexNav = l2Index !== -1 ? l2Index : null;

  const packagingVariants = variants.filter((variant) => Boolean(variant.variantId));
  const packageOptions = packagingVariants.map((variant) => ({
    id: variant.variantId,
    catalogNumber: variant.catalogNumber,
    spec: variant.spec || variantLabel(variant),
    price: getEffectiveProductPrice(variant),
    salesUnit: variant.salesUnit,
    stockQuantity: variant.stockQuantity,
    leadTime: variant.leadTime,
    inStock: variant.inStock,
  }));
  const mergedPackageOptions = mergeProductPackageOptions(product, packageOptions);
  const usePackageOptions = mergedPackageOptions.length > 0;

  const resolveProductOption = (option: ProductVariant): Product => {
    if (option.id) {
      const matched = packagingVariants.find((variant) => variant.variantId === option.id);
      if (matched) {
        return {
          ...matched,
          variantId: option.id,
          catalogNumber: option.catalogNumber,
          price: option.price,
          spec: option.spec,
        };
      }
    }
    return {
      ...product,
      variantId: undefined,
      catalogNumber: option.catalogNumber,
      price: option.price,
      spec: option.spec,
    };
  };

  const allVariants = (
    usePackageOptions
      ? mergedPackageOptions.map(resolveProductOption)
      : [product, ...variants]
  ).filter((variant) => variant.catalogNumber);
  const hasVariants = allVariants.length > 1;

  const [selectedVariant, setSelectedVariant] = useState<Product>(() => {
    if (!usePackageOptions) return product;
    return (
      allVariants.find((item) =>
        (item.spec || '').trim() === (product.spec || '').trim()
        && getEffectiveProductPrice(item) === getEffectiveProductPrice(product)
      )
      || allVariants[0]
      || product
    );
  });
  const selectedCartKey = getProductCartKey(selectedVariant);
  const inCart = isInCart(selectedCartKey);
  // 方案③：展示价由服务端预计算（displayPrice）；非正式会员的变体无价格时回退到主商品展示价
  const selectedDisplay =
    selectedVariant.displayPrice ??
    product.displayPrice ??
    { salePrice: 0, showGuestDiscount: false, isPromo: false, hasPrice: false };
  const selectedPrice = selectedDisplay.salePrice;
  const selectedHasPrice = selectedDisplay.hasPrice;
  const inventory = getProductFulfillmentPresentation(selectedVariant);

  const selectedPromotionViews = useMemo(() => {
    const rules = PROMOTION_RULES.filter((rule): rule is AddonRuleConfig =>
      rule.type === 'addon'
      && getRuleLifecycle(rule) === 'active'
      && isEligibleMainProduct(rule, selectedVariant),
    );
    const cartViews = getCartPromotionQualificationViews(items);
    return rules.map((rule) => ({
      rule,
      view: cartViews.find((view) => view.ruleId === rule.id),
    }));
  }, [items, selectedVariant]);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (q.trim()) {
      router.push(`/products?q=${encodeURIComponent(q)}`);
    }
  }, [router]);

  const handleVariantChange = (variant: Product) => {
    setSelectedVariant(variant);
  };

  const handleL1Click = (idx: number) => {
    const category = productCategories[idx];
    setMenuOpen(false);
    router.push(`/products/catalog?cat=${encodeURIComponent(category.name)}`);
  };

  const handleL2Click = (l1: typeof productCategories[0], l2Idx: number) => {
    const subcategory = l1.sub[l2Idx];
    setMenuOpen(false);
    router.push(`/products/catalog?cat=${encodeURIComponent(l1.name)}&sub=${encodeURIComponent(subcategory.name)}`);
  };

  const handleL3Click = (child: string) => {
    setMenuOpen(false);
    if (l1IndexNav === null || l2IndexNav === null) return;
    const l1 = productCategories[l1IndexNav];
    const l2 = l1.sub[l2IndexNav];
    router.push(`/products/catalog?cat=${encodeURIComponent(l1.name)}&sub=${encodeURIComponent(l2.name)}&type=${encodeURIComponent(child)}`);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!document.getElementById('products-nav')?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!hasVariants) return;
    // Chatway 气泡层级极高；有页内规格选择时在手机端临时隐藏，避免挡住加购区。
    return acquireChatwaySuppression();
  }, [hasVariants]);

  const handleToggleCart = () => {
    if (inCart) {
      removeItem(selectedCartKey);
      return;
    }
    // 详情页已展示规格选择，直接加入当前选型，不再弹出规格对话框。
    addItem(selectedVariant);
  };

  const specs = [
    { label: '品牌', value: selectedVariant.brand, icon: Tag },
    { label: '货号', value: selectedVariant.catalogNumber, icon: Box },
    { label: '规格', value: selectedVariant.spec, icon: Package },
    { label: '类型', value: selectedVariant.type, icon: FlaskConical },
    { label: '靶点', value: selectedVariant.target, icon: Target },
    { label: '宿主', value: selectedVariant.host, icon: Activity },
    // === P2-1: 生物医药专业字段 ===
    { label: '货期', value: selectedVariant.leadTime, icon: Package },
    { label: '储存温度', value: product.storageTemp, icon: Activity },
    { label: '克隆号', value: product.cloneNumber, icon: Info },
    { label: '纯度', value: product.purity, icon: Check },
    ...(product.molecularWeight ? [{ label: '分子量', value: `${product.molecularWeight} kDa`, icon: Activity }] : []),
    ...(product.concentration ? [{ label: '浓度', value: product.concentration, icon: Activity }] : []),
  ].filter(s => s.value);

  return (
    <>
      <AdaptiveHeader
        showNav={false}
        onSearch={handleSearch}
        showQuickOrder
        showProductNav
        productCategories={productCategories}
        onL1Click={handleL1Click}
        onL2Click={handleL2Click}
        onL3Click={handleL3Click}
        l1Index={l1IndexNav}
        l2Index={l2IndexNav}
        l3Type={product.type && currentL2?.child?.includes(product.type) ? product.type : ''}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        hoverL2Open={hoverL2Open}
        onHoverL2OpenChange={setHoverL2Open}
      />

      <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-8">
        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Image + Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Product card */}
            <div className={`overflow-hidden rounded-3xl ${uiSurfaces.panelStrong}`}>
              {/* Image */}
              <div className="relative flex h-56 w-full items-center justify-center overflow-hidden bg-gradient-to-br from-white/70 to-white/30 backdrop-blur-sm dark:from-slate-100/80 dark:to-slate-200/40">
                {getProductImageUrl(product) ? (
                  <Image
                    src={getProductImageUrl(product)!}
                    alt={getProductImageAlt(product)}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <Package size={64} className="text-gray-300" />
                )}
                <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none" aria-hidden="true">
                  <div
                    className="absolute left-1/2 top-1/2 w-[170%] h-[170%] -translate-x-1/2 -translate-y-1/2 rotate-[-28deg] grid gap-x-3 gap-y-1 justify-items-center content-center"
                    style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
                  >
                    {Array.from({ length: 50 }).map((_, i) => (
                      <span
                        key={i}
                        className="text-[8px] sm:text-[9px] font-semibold font-library tracking-[0.12em] text-brand-500/10 dark:text-brand-400/12 whitespace-nowrap"
                      >
                        LIBEREAL
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Basic info */}
              <div className="p-6">
                <div className="flex items-start gap-3 mb-4">
                  <div className="bg-brand-100/70 backdrop-blur-sm rounded-xl p-2.5 flex-shrink-0 border border-brand-200/50">
                    <Tag className="w-5 h-5 text-brand-600" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 leading-snug">{selectedVariant.name}</h1>
                    <p className="text-gray-500 text-sm mt-1">
                      {product.brand === 'Thermo Fisher' && product.subBrand
                        ? `${product.subBrand} · `
                        : ''}
                      {selectedVariant.brand} · Cat# {selectedVariant.catalogNumber}
                    </p>
                  </div>
                </div>

                {/* Stock badge */}
                <div className="flex items-center gap-2 mb-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur-sm ${
 inventory.tone === 'success'
 ? 'bg-green-100/70 text-green-700 border border-green-200/50'
 : inventory.tone === 'warning'
 ? 'bg-amber-100/70 text-amber-700 border border-amber-200/50'
 : 'bg-red-100/70 text-red-600 border border-red-200/50'
 }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
 inventory.tone === 'success' ? 'bg-green-500' : inventory.tone === 'warning' ? 'bg-amber-500' : 'bg-red-500'
 }`} />
                    {inventory.label}
                  </span>
                  {inventory.detail ? <span className="text-xs text-gray-500">{inventory.detail}</span> : null}
                  {product.hazardous && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100/70 backdrop-blur-sm text-red-700 border border-red-200/50">
                      ⚠️ 危险化学品 · 暂不可订购
                    </span>
                  )}
                  {selectedDisplay.isPromo && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-100/70 backdrop-blur-sm text-brand-700 border border-brand-200/50">
                      🔥 促销中
                    </span>
                  )}
                </div>

                {/* Specs table */}
                <div className="border-t border-white/30 pt-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4 text-brand-500" />
                    产品信息
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {specs.map(({ label, value, icon: Icon }) => (
                      <div key={label} className="flex items-start gap-2.5 rounded-xl border border-white/60 bg-white/60 px-3 py-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                        <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400">{label}</p>
                          <p className="text-sm font-medium text-gray-800">{value || '-'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Description */}
                {product.description && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">产品描述</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{product.description}</p>
                  </div>
                )}

                {(product.specificity || product.productUsage || product.speciesReactivity || product.speciesPredicted) && (
                  <div className="mt-5 border-t border-white/30 pt-5">
                    <h3 className="mb-3 text-sm font-semibold text-gray-800">抗体资料</h3>
                    <dl className="space-y-3 text-sm">
                      {product.specificity && (
                        <div>
                          <dt className="text-xs font-medium text-gray-500">特异性</dt>
                          <dd className="mt-1 leading-6 text-gray-700">{product.specificity}</dd>
                        </div>
                      )}
                      {product.productUsage && (
                        <div>
                          <dt className="text-xs font-medium text-gray-500">推荐用途</dt>
                          <dd className="mt-1 leading-6 text-gray-700">{product.productUsage}</dd>
                        </div>
                      )}
                      {product.speciesReactivity && (
                        <div>
                          <dt className="text-xs font-medium text-gray-500">已验证物种</dt>
                          <dd className="mt-1 leading-6 text-gray-700">{product.speciesReactivity}</dd>
                        </div>
                      )}
                      {product.speciesPredicted && (
                        <div>
                          <dt className="text-xs font-medium text-gray-500">预测反应物种</dt>
                          <dd className="mt-1 leading-6 text-gray-700">{product.speciesPredicted}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

                {/* Applications */}
                {product.applications && product.applications.length > 0 && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">应用</h3>
                    <div className="flex flex-wrap gap-2">
                      {product.applications.map((app, i) => (
                        <span key={i} className="px-2.5 py-1 bg-white/60 backdrop-blur-sm text-gray-600 text-xs rounded-full border border-white/50 dark:border-slate-300/70 dark:bg-slate-100/58 dark:text-slate-600">{app}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reactivity */}
                {product.reactivity && product.reactivity.length > 0 && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">反应性</h3>
                    <div className="flex flex-wrap gap-2">
                      {product.reactivity.map((r, i) => (
                        <span key={i} className="px-2.5 py-1 bg-white/60 backdrop-blur-sm text-gray-600 text-xs rounded-full border border-white/50 dark:border-slate-300/70 dark:bg-slate-100/58 dark:text-slate-600">{r}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* === P2-1: 生物医药专业信息 === */}
                {(product.storageTemp || product.storageBuffer || product.lotNumber || product.expiryDate || product.cloneNumber || product.purity) && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <Info className="w-4 h-4 text-brand-600" />
                      储存与质量信息
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {product.storageTemp && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">储存温度</div>
                          <div className="text-gray-800 font-medium">{product.storageTemp}</div>
                        </div>
                      )}
                      {product.storageBuffer && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">储存缓冲液</div>
                          <div className="text-gray-800 font-medium">{product.storageBuffer}</div>
                        </div>
                      )}
                      {product.lotNumber && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">批号 / Lot</div>
                          <div className="text-gray-800 font-medium font-mono">{product.lotNumber}</div>
                        </div>
                      )}
                      {product.expiryDate && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">有效期</div>
                          <div className="text-gray-800 font-medium">{product.expiryDate}</div>
                        </div>
                      )}
                      {product.cloneNumber && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">克隆号</div>
                          <div className="text-gray-800 font-medium font-mono">{product.cloneNumber}</div>
                        </div>
                      )}
                      {product.purity && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">纯度</div>
                          <div className="text-gray-800 font-medium">{product.purity}</div>
                        </div>
                      )}
                      {product.molecularWeight != null && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">分子量</div>
                          <div className="text-gray-800 font-medium">{product.molecularWeight} kDa</div>
                        </div>
                      )}
                      {product.isoelectricPoint != null && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">等电点 (pI)</div>
                          <div className="text-gray-800 font-medium">{product.isoelectricPoint}</div>
                        </div>
                      )}
                      {product.concentration && (
                        <div className="rounded-lg border border-white/50 bg-white/60 p-2.5 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                          <div className="text-gray-500 mb-0.5">浓度</div>
                          <div className="text-gray-800 font-medium">{product.concentration}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* CoA / SDS / PMIDs 下载和引用 */}
                {(product.cofaUrl || product.sdsUrl || (product.pmids && product.pmids.length > 0)) && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">证书与文献</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {product.cofaUrl && (
                        <a
                          href={product.cofaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/70 hover:bg-white border border-gray-200 text-gray-700 text-xs rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                          CoA 证书 (PDF)
                        </a>
                      )}
                      {product.sdsUrl && (
                        <a
                          href={product.sdsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/70 hover:bg-white border border-gray-200 text-gray-700 text-xs rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                          SDS 安全表
                        </a>
                      )}
                    </div>
                    {product.pmids && product.pmids.length > 0 && (
                      <div className="rounded-lg border border-white/50 bg-white/60 p-3 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                        <div className="text-xs text-gray-500 mb-2">引用文献 (PubMed)</div>
                        <div className="flex flex-wrap gap-1.5">
                          {product.pmids.map((pmid) => (
                            <a
                              key={pmid}
                              href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-0.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs rounded border border-brand-200 transition-colors font-mono"
                            >
                              PMID: {pmid}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Hazardous product warning */}
                {product.hazardous && (
                  <div className="border-t border-white/30 mt-5 pt-5">
                    <div className="bg-red-50/80 backdrop-blur-sm border border-red-200/50 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        危险化学品安全提示
                      </h3>
                      <ul className="text-xs text-red-600/80 space-y-1">
                        <li>• 请在通风良好的环境下操作</li>
                        <li>• 佩戴防护手套、护目镜和实验服</li>
                        <li>• 远离火源和热源，避免阳光直射</li>
                        <li>• 详情请参阅产品安全数据表 (SDS)</li>
                      </ul>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Right: Price + Cart */}
          <div className="lg:col-span-1">
            <div className={`sticky top-28 rounded-3xl p-6 ${uiSurfaces.panelStrong}`}>
              {/* Variant selector for CST products with multiple sizes */}
                {hasVariants && (
                  <div
                    data-product-variant-panel
                    className="relative z-20 mb-5 rounded-xl border border-white/50 bg-white/60 p-4 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58"
                  >
                    <h3 className={`mb-3 text-sm font-medium ${uiSurfaces.text}`}>选择规格</h3>
                    <div className="flex flex-wrap gap-2">
                      {allVariants.map((v) => {
                        const { title, subtitle } = getVariantOptionCopy(v);
                        const optionKey = getProductCartKey(v);
                        const isSelected = optionKey === selectedCartKey;
                        return (
                          <button
                            key={optionKey}
                            type="button"
                            onClick={() => handleVariantChange(v)}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
 isSelected
 ? 'bg-brand-500/90 backdrop-blur-sm text-white shadow-md'
 : 'border border-white/50 bg-white/80 text-gray-700 backdrop-blur-sm hover:border-brand-300 hover:text-brand-600 dark:border-slate-300/70 dark:bg-slate-100/64 dark:text-slate-700'
 }`}
                          >
                            <div className="flex flex-col items-center">
                              <span>{title}</span>
                              {subtitle ? (
                                <span className={`text-xs ${isSelected ? 'text-white/80' : uiSurfaces.mutedText}`}>
                                  {subtitle}
                                </span>
                              ) : null}
                              <span className="mt-1">
                                {(() => {
                                  // 非正式会员的变体无价格 → "登录查看"
                                  const display = v.displayPrice;
                                  return display ? (display.hasPrice ? formatPrice(display.salePrice) : '待报价') : '登录查看';
                                })()}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Price */}
                <div className="mb-5">
                  <div className="flex items-baseline gap-2 mb-1">
                    {!selectedHasPrice ? (
                      <span className="text-2xl font-bold text-amber-600">待报价</span>
                    ) : (
                      <>
                        <span className={`text-2xl font-bold ${selectedDisplay.showGuestDiscount || selectedVariant.promotion ? 'text-brand-600' : 'text-gray-900'}`}>
                          {formatPrice(selectedPrice)}
                        </span>
                        {selectedDisplay.strikethroughPrice ? (
                          <span className="text-sm text-gray-400 line-through">
                            {formatPrice(selectedDisplay.strikethroughPrice)}
                          </span>
                        ) : null}
                        {selectedVariant.salesUnit ? <span className="text-xs text-gray-400">/{selectedVariant.salesUnit}</span> : null}
                      </>
                    )}
                  </div>
                  {selectedHasPrice && selectedDisplay.strikethroughPrice && selectedDisplay.strikethroughPrice > selectedPrice ? (
                    <p className="text-xs text-gray-400">
                      节省 {formatPrice(selectedDisplay.strikethroughPrice - selectedPrice)}
                    </p>
                  ) : null}
                </div>

                {selectedPromotionViews.length > 0 && (
                  <section aria-label="促销活动" className="mb-5 rounded-xl border border-brand-200/60 bg-brand-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-brand-800">促销活动</h3>
                        <p className="mt-1 text-xs text-brand-700/75">加入购物车后，系统会实时核对活动条件</p>
                      </div>
                      <Tag className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    </div>
                    <div className="mt-3 space-y-3">
                      {selectedPromotionViews.map(({ rule, view }) => {
                        const qualification = view?.qualification;
                        const currentQuantity = qualification?.currentQuantity ?? 0;
                        const thresholdQuantity = qualification?.thresholdQuantity ?? rule.minQuantity;
                        const remainingQuantity = Math.max(0, thresholdQuantity - currentQuantity);
                        const progress = qualification?.progressPercent ?? 0;
                        const message = currentQuantity >= thresholdQuantity
                          ? qualification && qualification.remainingQuota > 0
                            ? `当前购物车已满足 ${currentQuantity}/${thresholdQuantity} 件，可选择付费加购商品`
                            : '本次活动加购额度已用完'
                          : currentQuantity > 0
                            ? `当前购物车已计入 ${currentQuantity}/${thresholdQuantity} 件 · 还差 ${remainingQuantity} 件`
                            : `再加入 ${thresholdQuantity} 件，满足活动条件后可选择付费加购商品`;
                        return (
                          <div key={rule.id}>
                            <p className="text-sm font-medium text-brand-900">{rule.name}</p>
                            <p className="mt-1 text-xs leading-5 text-brand-800/75">{rule.description}</p>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100" role="progressbar" aria-label={`${rule.name}活动进度`} aria-valuemin={0} aria-valuemax={thresholdQuantity} aria-valuenow={Math.min(currentQuantity, thresholdQuantity)}>
                              <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-brand-800/80">
                              <span>{message}</span>
                              <span className="shrink-0 font-medium">付费加购价 {formatPrice(rule.addonPrice)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

              {/* Add to cart */}
              <button
                onClick={handleToggleCart}
                disabled={!selectedVariant.inStock || selectedVariant.hazardous}
                className={`w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all ${
 inCart
 ? 'bg-green-100/80 backdrop-blur-sm text-green-700 hover:bg-green-200 border border-green-200/50'
 : selectedVariant.hazardous
 ? 'bg-gray-200/80 backdrop-blur-sm text-gray-400 cursor-not-allowed border border-gray-200/50'
 : selectedVariant.inStock
 ? 'bg-brand-500/90 backdrop-blur-sm text-white hover:bg-brand-600 shadow-md'
 : 'bg-gray-200/80 backdrop-blur-sm text-gray-400 cursor-not-allowed border border-gray-200/50'
 }`}
              >
                {inCart ? (
                  <><Check className="w-5 h-5" /> {selectedHasPrice ? '已加入购物车' : '已加入询价清单'}</>
                ) : selectedVariant.hazardous ? (
                  <><AlertTriangle className="w-5 h-5" /> 危险化学品暂不可订购</>
                ) : (
                  <><ShoppingCart className="w-5 h-5" /> {!selectedHasPrice ? '加入询价清单' : selectedVariant.inStock ? '加入购物车' : '缺货'}</>
                )}
              </button>

              {inCart && (
                <button
                  onClick={() => router.push('/cart')}
                  className="w-full mt-2 py-2.5 rounded-xl font-medium text-sm text-brand-600 border border-brand-200/50 hover:bg-brand-50/80 backdrop-blur-sm transition-colors"
                >
                  查看购物车 →
                </button>
              )}

            </div>
          </div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-bold text-gray-900 mb-5">同类产品推荐</h2>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
              {related.map((p: Product) => (
                <Link key={p.id} href={`/products/${encodeURIComponent(p.catalogNumber)}?brand=${encodeURIComponent(p.brand)}`} className="group">
                  <div className={`rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg ${uiSurfaces.panel}`}>
                    <div className="relative mb-3 flex h-20 w-full items-center justify-center overflow-hidden rounded-xl border border-white/50 bg-white/60 backdrop-blur-sm dark:border-slate-300/70 dark:bg-slate-100/58">
                      {getProductImageUrl(p) ? (
                        <Image
                          src={getProductImageUrl(p)!}
                          alt={getProductImageAlt(p)}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <Package className="w-8 h-8 text-gray-300" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-1">{p.brand}</p>
                    <p className="text-sm font-medium text-gray-800 line-clamp-2 mb-2 group-hover:text-brand-600 transition-colors">
                      {p.name}
                    </p>
                    <p className="text-sm font-bold text-gray-900">
                      {(() => {
                        const display = p.displayPrice;
                        return display?.hasPrice ? formatPrice(display.salePrice) : '待报价';
                      })()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
      </div>

      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}
