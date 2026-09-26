'use client';

import { useState, useEffect } from 'react';
import { useCart, getCartItemKey, ProductCartItem, QuickOrderItem } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { CheckCircle, MapPin, Plus, CreditCard, Package, X, AlertTriangle, Coins } from 'lucide-react';
import type { Product } from '@/types/Product';
import Breadcrumb from '@/components/Breadcrumb';
import LegalConsentModal from '@/components/legal/LegalConsentModal';
import { getEffectiveProductPrice, isPricedProduct } from '@/lib/product-pricing';
import { ORDER_PAYMENT_METHODS } from '@/data/payment-methods';
import PricingBreakdown from '@/components/order/PricingBreakdown';
import OrganizationContextSelect from '@/components/account/OrganizationContextSelect';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface Address {
  id: string;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
  label: string | null;
  isDefault: boolean | number;
}

function isDefaultAddress(address: Address): boolean {
  return address.isDefault === true || address.isDefault === 1;
}

interface InquiryProduct {
  name: string;
  brand: string;
  catalogNumber: string;
  price: number | null;
  quantity: number;
  isQuickOrder?: boolean;
}

interface PaymentMethod {
  value: string;
  label: string;
  icon?: string;
  image?: string;
}

interface PricingPreviewItem {
  productId: string | null;
  catalogNumber: string | null;
  unitPrice: number;
  finalUnitPrice?: number;
  quantity: number;
  lineTotal: number;
  finalLineTotal: number;
  promotionDiscount?: number;
  promotionLabels?: string[];
  pricingSnapshot: string;
}

interface PricingPreview {
  subtotal: number;
  adjustmentTotal?: number;
  promotionDiscount: number;
  promotionAdjustments: { label: string; amount: number }[];
  adjustments: { type: string; amount: number }[];
  totalBeforePoints?: number;
  total?: number;
  coupon?: {
    type: string;
    label: string;
    amount: number;
    reason: string | null;
  } | null;
  couponError?: string | null;
  points?: {
    personalPoints: number;
    groupPoints: number;
    groupId: string | null;
    pointsDiscount: number;
    payableBeforePoints: number;
    payableAfterPoints: number;
  } | null;
  items: PricingPreviewItem[];
}

interface PointsBalance {
  rate: number;
  personalPoints: number;
  group: {
    id: string;
    name: string;
    points: number;
    role: string;
    status: string;
    locked: boolean;
    usable: boolean;
  } | null;
}

const PAYMENT_METHODS: PaymentMethod[] = ORDER_PAYMENT_METHODS.map((method) => ({
  value: method.value,
  label: method.label,
  image: method.value === 'alipay' ? '/images/payments/alipay-payment.png' : undefined,
}));

export default function OrderCheckoutPage() {
  const { items, removeItem, syncFromDb } = useCart();
  const router = useRouter();
  const [cartReady, setCartReady] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ name: '', phone: '', address: '', institution: '' });
  const [paymentMethod, setPaymentMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState<'spot' | 'mixed' | null>(null);
  const [checkoutAcceptedLegalIds, setCheckoutAcceptedLegalIds] = useState<string[]>([]);
  const [inquiryItems, setInquiryItems] = useState<InquiryProduct[]>([]);
  const [spotItems, setSpotItems] = useState<ProductCartItem[]>([]);
  const [pricingPreview, setPricingPreview] = useState<PricingPreview | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [pointsBalance, setPointsBalance] = useState<PointsBalance | null>(null);
  const [personalPointsInput, setPersonalPointsInput] = useState(0);
  const [groupPointsInput, setGroupPointsInput] = useState(0);
  const [pointsError, setPointsError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [organizationId, setOrganizationId] = useState('');

  useEffect(() => {
    let active = true;
    syncFromDb().finally(() => {
      if (active) setCartReady(true);
    });
    return () => {
      active = false;
    };
  }, [syncFromDb]);

  useEffect(() => {
    const allProductItems = items.filter((i): i is ProductCartItem => !i.isQuickOrder);
    const allQuickOrderItems = items.filter(i => i.isQuickOrder) as QuickOrderItem[];

    const spot = allProductItems.filter(i => isPricedProduct(i.product));
    const inquiry: InquiryProduct[] = [
      ...allProductItems.filter(i => !isPricedProduct(i.product)).map(i => ({
        name: i.product.name,
        brand: i.product.brand,
        catalogNumber: i.product.catalogNumber,
        price: getEffectiveProductPrice(i.product) || null,
        quantity: i.quantity,
        isQuickOrder: false,
      })),
      ...allQuickOrderItems.map(q => ({
        name: q.name,
        brand: q.brand,
        catalogNumber: q.catalogNumber,
        price: null as number | null,
        quantity: q.quantity,
        isQuickOrder: true,
      })),
    ];
    setSpotItems(spot);
    setInquiryItems(inquiry);
  }, [items]);

  useEffect(() => {
    if (spotItems.length === 0) {
      setPricingPreview(null);
      setPricingError('');
      return;
    }

    const controller = new AbortController();
    setPricingLoading(true);
    setPricingPreview(null);
    setPricingError('');
    setPointsError('');
    setCouponError('');

    const previewItems = spotItems.map((item) => {
      const product = (item as { product: import('@/types/Product').Product }).product;
      return {
        productId: product.id,
        variantId: product.variantId || null,
        catalogNumber: product.catalogNumber,
        brand: product.brand,
        name: product.name,
        price: getEffectiveProductPrice(product),
        quantity: item.quantity,
        // 换购/赠品行促销标记（服务端定价预览据此按原价计价并计算活动优惠）
        promoMark: !item.isQuickOrder && item.addon ? { ruleId: item.addon.ruleId, price: item.addon.addonPrice } : null,
      };
    });

    fetch('/api/orders/pricing-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: previewItems,
        paymentMethod: paymentMethod || undefined,
        personalPoints: personalPointsInput,
        groupPoints: groupPointsInput,
        groupId: pointsBalance?.group?.usable ? pointsBalance.group.id : undefined,
        organizationId: organizationId || undefined,
        couponCode: couponCode.trim() || undefined,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if (personalPointsInput > 0 || groupPointsInput > 0) {
            setPointsError(data.error || '积分抵扣无效');
          }
          if (couponCode.trim()) {
            setCouponError(data.error || '优惠券不可用');
          }
          throw new Error(data.error || '价格计算失败');
        }
        if (controller.signal.aborted) return;
        setPointsError('');
        setCouponError(data.couponError || '');
        setPricingPreview(data as PricingPreview);
      })
      .catch((previewError: unknown) => {
        if (controller.signal.aborted) return;
        setPricingPreview(null);
        setPricingError(previewError instanceof Error ? previewError.message : '价格计算失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });

    return () => controller.abort();
  }, [spotItems, paymentMethod, personalPointsInput, groupPointsInput, pointsBalance?.group?.id, pointsBalance?.group?.usable, couponCode, organizationId]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/points/balance')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setPointsBalance(data as PointsBalance);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cartReady && items.filter(i => !i.isQuickOrder).length === 0) {
      router.replace('/cart');
    }
  }, [cartReady, items, router]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/addresses')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: unknown) => {
        if (cancelled || !Array.isArray(data)) return;
        const list = data as Address[];
        setAddresses(list);
        const defaultAddr = list.find(isDefaultAddress) || list[0];
        if (defaultAddr) setSelectedAddressId(defaultAddr.id);
      })
      .catch((status) => {
        if (cancelled) return;
        if (status === 401) {
          router.replace('/login?callbackUrl=/order');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const cartSubtotal = spotItems.reduce((sum, item) => {
    if (item.isQuickOrder) return sum;
    const p = item as { product: import('@/types/Product').Product };
    return sum + getEffectiveProductPrice(p.product) * item.quantity;
  }, 0);
  const spotSubtotal = pricingPreview?.subtotal ?? cartSubtotal;

  const promoDiscount = pricingPreview?.promotionDiscount ?? 0;
  const isPlatformPayment = paymentMethod === 'rjmart' || paymentMethod === 'casmart';
  const platformFee = pricingPreview?.adjustments.find((entry) => entry.type === 'platform_fee')?.amount ?? 0;
  const transferFee = pricingPreview?.adjustments.find((entry) => entry.type === 'transfer_fee')?.amount ?? 0;
  const pointsDiscount = pricingPreview?.points?.pointsDiscount ?? 0;
  // 服务端 total 包含活动、优惠券、费用和积分，展示时保持原值。
  const total = pricingPreview?.total ?? spotSubtotal;

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  const getFulfillmentStatus = (product: Product) => {
    const leadTime = product.leadTime?.trim();
    if (!product.inStock) {
      return {
        label: '暂时缺货',
        detail: leadTime ? `预计 ${leadTime}` : '需确认交期',
        className: 'text-amber-700 dark:text-amber-800',
      };
    }
    return {
      label: leadTime === '现货' || !leadTime ? '现货' : '可订购',
      detail: leadTime && leadTime !== '现货' ? `货期 ${leadTime}` : '',
      className: 'text-emerald-700 dark:text-emerald-800',
    };
  };

  const handleSaveNewAddress = async () => {
    if (!newAddress.name || !newAddress.phone || !newAddress.address) {
      setError('请填写收货人、手机和收货地址');
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newAddress, isDefault: addresses.length === 0 }),
      });
      const addr = await res.json();
      if (!res.ok) throw new Error(addr.error);
      setAddresses(prev => [addr, ...prev]);
      setSelectedAddressId(addr.id);
      setShowNewAddress(false);
      setNewAddress({ name: '', phone: '', address: '', institution: '' });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存地址失败');
    }
  };

  const handleSubmit = async () => {
    if (!selectedAddressId && !showNewAddress) {
      setError('请选择或添加收货地址');
      return;
    }
    if (!paymentMethod) {
      setError('请选择付款方式');
      return;
    }

    const hasSpot = spotItems.length > 0;
    const hasInquiry = inquiryItems.length > 0;

    if (hasSpot && hasInquiry) {
      setPendingCheckoutAction('mixed');
      setShowLegalModal(true);
      return;
    }

    if (hasSpot) {
      setPendingCheckoutAction('spot');
      setShowLegalModal(true);
      return;
    } else if (hasInquiry) {
      router.push('/inquiry');
    }
  };

  const handleLegalConfirm = async (acceptedLegalIds: string[]) => {
    if (pendingCheckoutAction === 'mixed') {
      setCheckoutAcceptedLegalIds(acceptedLegalIds);
      setShowLegalModal(false);
      setShowInquiryModal(true);
      return;
    }
    setShowLegalModal(false);
    await createSpotOrder(acceptedLegalIds);
  };

  const createSpotOrder = async (acceptedLegalIds: string[] = []) => {
    if (!selectedAddressId && !showNewAddress) {
      setError('请选择或添加收货地址');
      return;
    }
    if (!paymentMethod) {
      setError('请选择付款方式');
      return;
    }

    const addrToUse = showNewAddress
      ? newAddress
      : addresses.find(a => a.id === selectedAddressId);

    if (!addrToUse) {
      setError('请选择收货地址');
      return;
    }

    let addressId = selectedAddressId;
    if (showNewAddress) {
      try {
        const res = await fetch('/api/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...newAddress, isDefault: false }),
        });
        const savedAddr = await res.json();
        if (!res.ok) throw new Error(savedAddr.error);
        addressId = savedAddr.id;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : '保存地址失败';
        setError(message);
        return;
      }
    }

    setSubmitting(true);
    setError('');

    try {
      const orderItems = spotItems.map(item => ({
        productId: item.product.id,
        variantId: item.product.variantId || null,
        name: item.product.name,
        brand: item.product.brand,
        catalogNumber: item.product.catalogNumber,
        spec: item.product.spec || null,
        price: getEffectiveProductPrice(item.product),
        quantity: item.quantity,
        shippedQty: 0,
        leadTime: null,
        status: 'pending',
        // 换购/赠品行促销标记（服务端据此校验额度并按原价计价）
        promoMark: item.addon
          ? { ruleId: item.addon.ruleId, price: item.addon.addonPrice }
          : null,
      }));

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: orderItems,
          paymentMethod,
          addressId,
          addressName: addrToUse.name,
          addressPhone: addrToUse.phone,
          addressText: addrToUse.address,
          addressInstitution: addrToUse.institution || null,
          acceptedLegalIds,
          personalPoints: personalPointsInput,
          groupPoints: groupPointsInput,
          groupId: pointsBalance?.group?.usable ? pointsBalance.group.id : undefined,
          couponCode: couponCode.trim() || undefined,
          organizationId: organizationId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '创建订单失败');
      }

      const data = await res.json();

      if (paymentMethod === 'alipay') {
        const paymentRes = await fetch(`/api/orders/${encodeURIComponent(data.orderId)}/alipay`, { method: 'POST' });
        const paymentData = await paymentRes.json();
        if (!paymentRes.ok || typeof paymentData.redirectUrl !== 'string') {
          throw new Error(paymentData.error || '支付宝支付创建失败');
        }
        window.location.assign(paymentData.redirectUrl);
        return;
      }

      spotItems.forEach(item => removeItem(getCartItemKey(item)));
      await new Promise(resolve => setTimeout(resolve, 600));

      if (inquiryItems.length > 0) {
        router.push('/inquiry');
      } else {
        router.push(`/account/orders?new=${data.orderId}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '创建订单失败，请重试';
      setError(message);
      setSubmitting(false);
    }
  };

  const handleConfirmWithInquiry = async () => {
    setShowInquiryModal(false);
    await createSpotOrder(checkoutAcceptedLegalIds);
  };

  const productItems = items.filter(i => !i.isQuickOrder) as Array<{ product: import('@/types/Product').Product; quantity: number }>;
  const promotionReviewRows = spotItems.map((item, index) => {
    const product = item.product;
    const previewItem = pricingPreview?.items[index];
    return {
      product,
      quantity: item.quantity,
      isAddon: Boolean(item.addon),
      addonPrice: item.addon?.addonPrice,
      promotionDiscount: previewItem?.promotionDiscount ?? 0,
      promotionLabels: previewItem?.promotionLabels ?? [],
      finalLineTotal: previewItem?.finalLineTotal,
    };
  }).filter((row) => row.isAddon || row.promotionDiscount > 0);

  if ((!cartReady || productItems.length === 0) && !showInquiryModal) {
    return null; // Will redirect
  }

  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <Breadcrumb items={[
          { label: '首页', href: '/' },
          { label: '购物车', href: '/cart' },
          { label: '确认订单' }
        ]} />

        <h1 className="mb-8 text-2xl font-bold text-gray-900 dark:text-slate-900">确认订单</h1>

        <div className="mb-6">
          <OrganizationContextSelect value={organizationId} onChange={setOrganizationId} />
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-300 dark:bg-red-100/80 dark:text-red-700">
            {error}
          </div>
        )}

        {/* Product list */}
        <div className={`mb-6 rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
            <Package className="w-5 h-5 text-brand-600" />
            已选产品 {spotItems.length > 0 && inquiryItems.length > 0 && <span className="text-xs text-amber-600 font-normal">（部分产品需询价）</span>}
          </h2>
          <div className="space-y-3">
            {spotItems.map((item, index) => {
              const product = (item as { product: import('@/types/Product').Product }).product;
              const previewItem = pricingPreview?.items[index];
              const fallbackUnitPrice = getEffectiveProductPrice(product);
              const finalLineTotal = previewItem?.finalLineTotal ?? fallbackUnitPrice * item.quantity;
              const finalUnitPrice = previewItem?.finalUnitPrice ?? finalLineTotal / item.quantity;
              const prePromotionUnitPrice = previewItem?.unitPrice ?? fallbackUnitPrice;
              const promotionDiscount = previewItem?.promotionDiscount ?? 0;
              const promotionLabels = previewItem?.promotionLabels ?? [];
              return (
                <div key={product.id} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0 dark:border-slate-400/70">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="break-words text-sm font-medium text-gray-900 dark:text-slate-900">{product.name}</p>
                      <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-700">
                        {product.brand} · {product.catalogNumber}
                        {product.spec && <span className="ml-1">· {product.spec}</span>}
                      </p>
                      {(() => {
                        const fulfillment = getFulfillmentStatus(product);
                        return (
                          <p className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${fulfillment.className}`}>
                            <span className="font-medium">{fulfillment.label}</span>
                            {fulfillment.detail ? <span>{fulfillment.detail}</span> : null}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="shrink-0 text-right">
                      {promotionDiscount > 0 && item.quantity === 1 ? (
                        <p className="text-brand-600 font-semibold tabular-nums">
                          <span className="mr-1 text-gray-500 line-through dark:text-slate-600">{formatPrice(prePromotionUnitPrice)}</span>
                          <span className="mr-1 text-sm font-normal text-gray-600 dark:text-slate-700">活动价</span>
                          {formatPrice(finalLineTotal)}
                        </p>
                      ) : (
                        <>
                          <p className="text-brand-600 font-semibold tabular-nums">
                            {formatPrice(finalLineTotal)}
                          </p>
                          {item.quantity > 1 && (
                            <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-700 tabular-nums">
                              {promotionDiscount > 0 && (
                                <span className="mr-1 text-gray-500 line-through dark:text-slate-600">
                                  {formatPrice(prePromotionUnitPrice)}
                                </span>
                              )}
                              {promotionDiscount > 0 && <span className="mr-1">活动价</span>}
                              {formatPrice(finalUnitPrice)} × {item.quantity}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {promotionDiscount > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-100/75 dark:text-brand-900">
                      <span>
                        已享「{promotionLabels.length > 0 ? promotionLabels.join('、') : '活动优惠'}」
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">优惠 {formatPrice(promotionDiscount)}</span>
                    </div>
                  )}
                  <PricingBreakdown snapshot={previewItem?.pricingSnapshot} quantity={item.quantity} compact />
                </div>
              );
            })}
            {pricingLoading && <p className="text-sm text-gray-700 dark:text-slate-800">正在计算会员、品牌和活动价格...</p>}
            {pricingError && <p className="text-sm text-red-600 dark:text-red-700">{pricingError}</p>}
          </div>
          {spotItems.length === 0 && (
            <p className="text-sm text-gray-600 dark:text-slate-700">无现货产品</p>
          )}
          <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 dark:border-slate-400/70">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-700 dark:text-slate-800">商品金额</span>
              <span className="text-gray-900 dark:text-slate-900">{formatPrice(spotSubtotal)}</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 dark:text-slate-800">活动优惠</span>
                <span className="text-brand-700">- {formatPrice(promoDiscount)}</span>
              </div>
            )}
            {/* 优惠券 */}
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="优惠券码（可选）"
                className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none dark:border-slate-400/70 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            {couponError && (
              <div className="mb-2 text-xs text-red-600 dark:text-red-400">{couponError}</div>
            )}
            {pricingPreview?.coupon && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 dark:text-slate-800">{pricingPreview.coupon.label}</span>
                <span className="text-brand-700">- {formatPrice(Math.abs(pricingPreview.coupon.amount))}</span>
              </div>
            )}
            {platformFee > 0 && (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-700 dark:text-slate-800">支付服务费</span>
                  <span className="text-gray-900 dark:text-slate-900">+ {formatPrice(platformFee)}</span>
                </div>
                {transferFee > 0 && <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-700 dark:text-slate-800">其他服务费</span>
                  <span className="text-gray-900 dark:text-slate-900">+ {formatPrice(transferFee)}</span>
                </div>}
              </>
            )}
            {pointsDiscount > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 dark:text-slate-800">积分抵扣</span>
                <span className="text-brand-700">- {formatPrice(pointsDiscount)}</span>
              </div>
            )}
            {(pricingPreview?.promotionAdjustments.length ?? 0) > 0 && (
              <details className="border-t border-dashed pt-2">
                <summary className="cursor-pointer text-xs text-gray-500 dark:text-slate-600">
                  查看 {pricingPreview?.promotionAdjustments.length} 项活动优惠
                </summary>
                <ul className="mt-2 space-y-1">
                  {pricingPreview?.promotionAdjustments.map((l, idx) => (
                    <li key={idx} className="flex justify-between items-center text-xs text-gray-500 dark:text-slate-600">
                      <span className="truncate pr-2">{l.label}</span>
                      <span className="shrink-0">- {formatPrice(-l.amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2 dark:border-slate-400/70">
              <span className="font-semibold text-gray-700 dark:text-slate-900">应付总额</span>
              <span className="text-xl font-bold text-brand-600">{formatPrice(total)}</span>
            </div>
          </div>
        </div>

        {/* Promotion and fulfillment review */}
        <section aria-label="活动与履约复核" className={`mb-6 rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-slate-900">活动与履约复核</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-700">提交前确认活动价格、加购品收费方式与可交付状态</p>
            </div>
            {pricingLoading ? (
              <span className="text-xs text-gray-600 dark:text-slate-700">正在核对</span>
            ) : pricingError ? (
              <span className="text-xs text-red-600 dark:text-red-700">待重新核验</span>
            ) : (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-100/75 dark:text-brand-900">
                {promotionReviewRows.length > 0 ? '已核对活动' : '无适用活动'}
              </span>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {promotionReviewRows.map((row) => {
              const fulfillment = getFulfillmentStatus(row.product);
              const label = row.promotionLabels.length > 0
                ? row.promotionLabels.join('、')
                : row.isAddon ? '付费加购活动' : '活动优惠';
              return (
                <div key={`${row.product.id}:${row.product.variantId ?? ''}:${row.isAddon ? 'addon' : 'regular'}`} className={`rounded-lg border p-3 ${uiSurfaces.border}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-medium text-gray-900 dark:text-slate-900">{row.product.name}</p>
                        {row.isAddon && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-100/75 dark:text-amber-900">付费加购</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-slate-700">
                        {row.product.brand} · {row.product.catalogNumber}{row.product.spec ? ` · ${row.product.spec}` : ''} · 数量 {row.quantity}
                      </p>
                      <p className={`mt-1 text-xs ${fulfillment.className}`}>{fulfillment.label}{fulfillment.detail ? ` · ${fulfillment.detail}` : ''}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      {row.isAddon && row.addonPrice !== undefined && (
                        <p className="font-semibold text-brand-700">加购价 {formatPrice(row.addonPrice)} / 件</p>
                      )}
                      {row.finalLineTotal !== undefined && (
                        <p className="mt-0.5 text-gray-700 dark:text-slate-800">计入订单 {formatPrice(row.finalLineTotal)}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-dashed pt-2 text-xs text-gray-600 dark:border-slate-400/70 dark:text-slate-700">
                    <span>{label}</span>
                    {row.promotionDiscount > 0 && <span className="font-semibold text-brand-700">已优惠 {formatPrice(row.promotionDiscount)}</span>}
                    {row.isAddon && row.promotionDiscount === 0 && pricingError && <span className="text-red-600 dark:text-red-700">活动价格待核验</span>}
                  </div>
                </div>
              );
            })}
            {!pricingLoading && !pricingError && promotionReviewRows.length === 0 && (
              <p className="text-sm text-gray-600 dark:text-slate-700">本单没有需要单独复核的促销价格。</p>
            )}
            {inquiryItems.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-300/70 dark:bg-amber-100/75 dark:text-amber-900">
                <p className="font-medium">{inquiryItems.length} 项产品需询价</p>
                <p className="mt-1 text-xs">询价产品不计入现货订单金额，确认后将同时保留询价清单。</p>
              </div>
            )}
          </div>
        </section>

        {/* Address section */}
        <div className={`mb-6 rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
            <MapPin className="w-5 h-5 text-brand-600" />
            收货地址
          </h2>

          {!showNewAddress ? (
            <>
              {/* Saved addresses */}
              {addresses.length > 0 ? (
                <div className="space-y-3 mb-4">
                  {addresses.map(addr => (
                    <label
                      key={addr.id}
                      className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                        selectedAddressId === addr.id
                          ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-100/75'
                          : 'border-gray-200 hover:border-brand-200 hover:bg-gray-50 dark:border-slate-400 dark:bg-slate-200/55 dark:hover:border-brand-500 dark:hover:bg-slate-200/80'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        value={addr.id}
                        checked={selectedAddressId === addr.id}
                        onChange={() => setSelectedAddressId(addr.id)}
                        className="mt-1 accent-brand-600"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-slate-900">{addr.name}</span>
                          <span className="text-sm text-gray-700 dark:text-slate-800">{addr.phone}</span>
                          {isDefaultAddress(addr) && (
                            <span className="text-xs px-2 py-0.5 bg-brand-100 text-brand-700 rounded">默认</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-700">
                          {addr.institution && <span className="text-gray-700 dark:text-slate-800">{addr.institution} · </span>}
                          {addr.address}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mb-4 text-sm text-gray-600 dark:text-slate-700">暂无保存的收货地址</p>
              )}

              <button
                onClick={() => setShowNewAddress(true)}
                className="flex items-center gap-2 text-brand-600 hover:text-brand-700 text-sm font-medium"
              >
                <Plus className="w-4 h-4" />使用新地址
              </button>
            </>
          ) : (
            <>
              {/* New address form */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-800">收货人 <span className="text-red-500">*</span></label>
                    <input
                      value={newAddress.name}
                      onChange={e => setNewAddress(newAddress => ({...newAddress, name: e.target.value }))}
                      placeholder="姓名"
                      className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-800">手机 <span className="text-red-500">*</span></label>
                    <input
                      value={newAddress.phone}
                      onChange={e => setNewAddress(newAddress => ({...newAddress, phone: e.target.value }))}
                      placeholder="手机号码"
                      className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-800">收货地址 <span className="text-red-500">*</span></label>
                  <input
                    value={newAddress.address}
                    onChange={e => setNewAddress(newAddress => ({...newAddress, address: e.target.value }))}
                    placeholder="详细收货地址"
                    className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-800">单位/实验室 <span className="text-sm text-gray-600 dark:text-slate-700">(选填)</span></label>
                  <input
                    value={newAddress.institution}
                    onChange={e => setNewAddress(newAddress => ({...newAddress, institution: e.target.value }))}
                    placeholder="单位名称或实验室名称"
                    className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleSaveNewAddress}
                  className="px-4 py-2 bg-brand-100 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-200 transition-colors"
                >
                  保存此地址
                </button>
                {addresses.length > 0 && (
                  <button
                    onClick={() => { setShowNewAddress(false); setNewAddress({ name: '', phone: '', address: '', institution: '' }); }}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-slate-200/75 dark:text-slate-800 dark:hover:bg-slate-200"
                  >
                    取消
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Points redeem */}
        <div className={`mb-8 rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
            <Coins className="w-5 h-5 text-brand-600" />
            积分抵扣
          </h2>
          <p className="mb-4 text-sm text-gray-600 dark:text-slate-700">1 积分 = 1 元，可与个人积分、课题组积分合用，数量自行分配。</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-slate-400 dark:bg-slate-100/70">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800 dark:text-slate-900">个人积分</span>
                <span className="tabular-nums text-gray-600 dark:text-slate-700">
                  可用 {pointsBalance?.personalPoints ?? 0}
                </span>
              </div>
              <input
                type="number"
                min={0}
                max={pointsBalance?.personalPoints ?? 0}
                value={personalPointsInput}
                onChange={(e) => {
                  const next = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setPersonalPointsInput(next);
                }}
                className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
                placeholder="输入抵扣积分"
              />
            </div>
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-slate-400 dark:bg-slate-100/70">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800 dark:text-slate-900">
                  课题组积分{pointsBalance?.group ? ` · ${pointsBalance.group.name}` : ''}
                </span>
                <span className="tabular-nums text-gray-600 dark:text-slate-700">
                  可用 {pointsBalance?.group?.usable ? (pointsBalance.group.points ?? 0) : 0}
                </span>
              </div>
              <input
                type="number"
                min={0}
                max={pointsBalance?.group?.usable ? (pointsBalance.group.points ?? 0) : 0}
                value={groupPointsInput}
                disabled={!pointsBalance?.group?.usable}
                onChange={(e) => {
                  const next = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setGroupPointsInput(next);
                }}
                className={`w-full px-3 py-2.5 text-sm disabled:opacity-50 ${uiSurfaces.input}`}
                placeholder={
                  pointsBalance?.group?.status === 'pending'
                    ? '课题组待审核'
                    : pointsBalance?.group?.usable
                      ? '输入抵扣积分'
                      : '未加入课题组'
                }
              />
            </div>
          </div>
          {pointsError && (
            <p className="mt-3 text-sm text-red-600">{pointsError}</p>
          )}
          {pointsDiscount > 0 && !pointsError && (
            <p className="mt-3 text-sm text-brand-700">
              本单抵扣 {formatPrice(pointsDiscount)}
              {paymentMethod === 'alipay' ? '（支付宝到账后扣减）' : '（下单后立即扣减）'}
            </p>
          )}
        </div>

        {/* Payment method */}
        <div className={`mb-8 rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
            <CreditCard className="w-5 h-5 text-brand-600" />
            付款方式
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PAYMENT_METHODS.map(method => (
              <label
                key={method.value}
                className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethod === method.value
                    ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-100/75'
                    : 'border-gray-200 hover:border-brand-200 hover:bg-gray-50 dark:border-slate-400 dark:bg-slate-200/55 dark:hover:border-brand-500 dark:hover:bg-slate-200/80'
                }`}
              >
                <input
                  type="radio"
                  name="payment"
                  value={method.value}
                  checked={paymentMethod === method.value}
                  onChange={() => setPaymentMethod(method.value)}
                  className="accent-brand-600"
                />
                {method.image ? (
                  <Image src={method.image} alt={method.label} width={210} height={39} className="h-auto w-full max-w-[210px]" />
                ) : (
                  <span className="text-sm font-medium text-gray-800 dark:text-slate-900">{method.label}</span>
                )}
              </label>
            ))}
          </div>
          {isPlatformPayment && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-400/70 dark:bg-amber-100/75">
              <p className="text-sm text-amber-700 dark:text-amber-900">
                如有支付服务费，将在确认订单前显示。
              </p>
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || pricingLoading || (spotItems.length > 0 && !pricingPreview) || (!selectedAddressId && !showNewAddress) || !paymentMethod}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white py-4 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><span className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> 处理中...</>
          ) : (
            <><CheckCircle className="w-5 h-5" /> 确认下单</>
          )}
        </button>
      </main>

      <SiteFooter />
      <MobileBottomNav />

      {/* Inquiry Confirmation Modal */}
      {showInquiryModal && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
          <div className={`flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-xl ${uiSurfaces.panelStrong}`}>
            <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-slate-400/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-slate-900">以下产品需要询价</h3>
                  <p className="text-sm text-gray-700 dark:text-slate-700">将同时创建现货订单和询价单</p>
                </div>
              </div>
              <button onClick={() => setShowInquiryModal(false)} className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-slate-200/80">
                <X className="w-5 h-5 text-gray-600 dark:text-slate-700" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-3">
                {inquiryItems.map((item, idx) => (
                  <div key={idx} className="rounded-xl bg-gray-50 p-4 dark:bg-slate-200/65">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-900">{item.name}</p>
                        <p className="mt-0.5 text-sm text-gray-700 dark:text-slate-700">{item.brand} · {item.catalogNumber}</p>
                        <p className="mt-0.5 text-sm text-gray-700 dark:text-slate-700">数量: {item.quantity}</p>
                      </div>
                      <span className="text-sm text-amber-600 font-medium">
                        {item.price === null ? '待报价' : item.price === 0 ? '¥0' : `¥${item.price}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 bg-gray-50 p-5 dark:border-slate-400/70 dark:bg-slate-200/55">
              <div className="flex gap-3">
                <button
                  onClick={() => setShowInquiryModal(false)}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-3 font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-slate-400 dark:text-slate-800 dark:hover:bg-slate-200/80"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmWithInquiry}
                  className="flex-1 px-4 py-3 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition-colors"
                >
                  确认下单
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <LegalConsentModal
        open={showLegalModal}
        onClose={() => {
          setShowLegalModal(false);
          setPendingCheckoutAction(null);
        }}
        onConfirm={handleLegalConfirm}
        submitting={submitting}
      />
    </div>
  );
}
