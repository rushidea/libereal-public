'use client';

import { Fragment, use } from 'react';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Package, CheckCircle, Clock, Truck, XCircle, RotateCcw,
  User, MapPin, CreditCard
} from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import AlipayPaymentButton from '@/components/account/AlipayPaymentButton';
import { formatOrderPaymentMethod } from '@/data/payment-methods';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';
import PricingBreakdown from '@/components/order/PricingBreakdown';
import { canCustomerCancelOrder, canReorderFromOrderStatus, displayedOrderStatus } from '@/lib/order-domain';

function translatePaymentMethod(method: string): string {
  return formatOrderPaymentMethod(method);
}

type OrderItem = {
  id?: string;
  productId?: string;
  catalogNumber?: string;
  variantId?: string | null;
  spec?: string | null;
  unit?: string | null;
  name?: string;
  price?: number;
  quantity?: number;
  shippedQty?: number;
  leadTime?: string;
  status?: string;
  pricingSnapshot?: string | null;
};

type Order = {
  id: string;
  inquiryId: string;
  ownerScope?: 'personal' | 'organization';
  email: string;
  items: OrderItem[];
  subtotal: number;
  adjustmentTotal: number;
  total: number;
  status: string;
  paymentMethod?: string;
  paidAt?: string | null;
  payment?: AlipayPaymentSummary | null;
  adjustments: Array<{ id: string; label: string; amount: number; reason?: string | null }>;
  addressSnapshot?: { name: string; phone: string; address: string; institution?: string };
  shipments: Array<{
    id: string; method: string; status: string; carrier?: string; trackingNumber?: string;
    pickupPoint?: string; contactName?: string; contactPhone?: string; shippedAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  inquiry?: {
    id: string;
    name: string;
    institution: string;
    department?: string;
    address?: string;
    phone?: string;
  };
  quoteOrigin?: { inquiryId: string; quoteId: string; quoteVersion: number; acceptedAt?: string | null } | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  'unpaid': { label: '未付款', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-900/50', icon: Clock },
  'pending': { label: '待确认', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/50', icon: Clock },
  'confirmed': { label: '已确认', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/50', icon: CheckCircle },
  'partially_shipped': { label: '部分发货', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-900/50', icon: Truck },
  'shipped': { label: '已发货', color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-900/50', icon: Truck },
  'completed': { label: '已完成', color: 'text-brand-700 dark:text-brand-300', bg: 'bg-brand-50 dark:bg-brand-900/50', icon: Package },
  'cancelled': { label: '已取消', color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', icon: XCircle },
  'closed': { label: '关闭', color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700', icon: XCircle },
};

const SHIPPING_LABELS: Record<string, string> = { logistics: '物流', self_pickup: '自提', dedicated_delivery: '专送' };

const formatPrice = (price: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session, status } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [parsedItems, setParsedItems] = useState<OrderItem[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/account/orders');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !id) return;
    fetch(`/api/orders/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { router.replace('/account/orders'); return; }
        setOrder(data);
        setParsedItems(data.items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, id, router]);

  const canCancel = Boolean(order && canCustomerCancelOrder(order));
  const canReorder = Boolean(order && canReorderFromOrderStatus(order.status) && order.items.length > 0);

  const cancelOrder = async () => {
    if (!order || !canCancel || actionLoading) return;
    if (!window.confirm(`确定取消订单 ${order.id} 吗？`)) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', reason: '用户取消订单' }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        window.alert(data.error === 'PAID_ORDER_REFUND_REQUIRED' ? '已付款订单需要退款审核，暂时不能自助取消。' : data.error || '取消订单失败，请稍后重试。');
        return;
      }
      setOrder((current) => current ? { ...current, status: 'cancelled' } : current);
    } catch {
      window.alert('网络错误，请稍后重试。');
    } finally {
      setActionLoading(false);
    }
  };

  const reorderOrder = async () => {
    if (!order || !canReorder || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/reorder`, { method: 'POST' });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        window.alert(data.error || '再次下单失败，请稍后重试。');
        return;
      }
      router.push('/cart');
    } catch {
      window.alert('网络错误，请稍后重试。');
    } finally {
      setActionLoading(false);
    }
  };


  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-500">订单不存在</div>
      </div>
    );
  }

  const s = STATUS_CONFIG[displayedOrderStatus(order)] || STATUS_CONFIG['pending'];

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-5">

        {/* Status + Shipping */}
        <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-slate-900 mb-1">订单详情</h1>
              <p className="text-xs font-mono text-gray-400 dark:text-gray-500">{order.id}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {new Date(order.createdAt).toLocaleString('zh-CN')}
              </p>
              {order.ownerScope === 'organization' && <p className="mt-1 text-xs text-gray-500 dark:text-slate-600">组织采购记录 · {order.inquiry?.institution || '当前组织'}</p>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${s.bg} ${s.color}`}>
                <s.icon size={14} />
                {s.label}
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                {canCancel && (
                  <button type="button" onClick={() => void cancelOrder()} disabled={actionLoading} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <XCircle className="h-3.5 w-3.5" />取消订单
                  </button>
                )}
                {canReorder && (
                  <button type="button" onClick={() => void reorderOrder()} disabled={actionLoading} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                    <RotateCcw className="h-3.5 w-3.5" />再来一单
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-400 pt-4 space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-500">发货记录</p>
            {order.shipments.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">暂未发货</p>
            ) : order.shipments.map((shipment) => (
              <div key={shipment.id} className="flex items-start gap-3 text-sm">
                <Truck className="w-4 h-4 mt-0.5 text-brand-600" />
                <div>
                  <p className="font-medium text-gray-800 dark:text-slate-900">{SHIPPING_LABELS[shipment.method] || shipment.method}</p>
                  {shipment.trackingNumber && <p className="text-gray-600 dark:text-gray-400">{shipment.carrier || '物流'} · {shipment.trackingNumber}</p>}
                  {shipment.pickupPoint && <p className="text-gray-600 dark:text-gray-400">{shipment.pickupPoint}</p>}
                  {shipment.contactName && <p className="text-gray-600 dark:text-gray-400">{shipment.contactName} {shipment.contactPhone || ''}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left: Contact + Shipping */}
          <div className="lg:col-span-1 space-y-5">
            {order.inquiry && (
              <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
                <h2 className="font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
                  <User className="w-4 h-4 text-brand-600 dark:text-brand-500" /> 采购信息
                </h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-500">姓名</span>
                    <span className="text-gray-800 dark:text-slate-900 font-medium text-right">{order.inquiry.name}</span>
                  </div>
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-500">邮箱</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{order.email}</span>
                  </div>
                  {order.inquiry.phone && (
                    <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                      <span className="text-gray-500 dark:text-gray-500">电话</span>
                      <span className="text-gray-800 dark:text-slate-900 text-right">{order.inquiry.phone}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-500">单位</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right">{order.inquiry.institution}</span>
                  </div>
                  {order.inquiry.department && (
                    <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                      <span className="text-gray-500 dark:text-gray-500">部门</span>
                      <span className="text-gray-800 dark:text-slate-900 text-right">{order.inquiry.department}</span>
                    </div>
                  )}
                  {order.inquiry.address && (
                    <div className="flex items-start gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-gray-500 dark:text-gray-500 text-xs block">通讯地址</span>
                        <p className="text-gray-800 dark:text-slate-900 font-medium">{order.inquiry.address}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 p-5">
              <h2 className="font-semibold text-gray-800 dark:text-slate-900 mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-brand-600 dark:text-brand-500" /> 订单信息
              </h2>
              <div className="space-y-3 text-sm">
                {order.quoteOrigin && (
                  <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
                    <p className="text-xs font-semibold text-brand-700 dark:text-brand-500">报价来源追溯</p>
                    <Link href={`/account/inquiries/${encodeURIComponent(order.quoteOrigin.inquiryId)}?quoteId=${encodeURIComponent(order.quoteOrigin.quoteId)}&version=${order.quoteOrigin.quoteVersion}`} className="mt-2 block text-xs leading-5 text-gray-700 underline decoration-brand-300 underline-offset-2 dark:text-slate-700">
                      询价 {order.quoteOrigin.inquiryId} → 报价 {order.quoteOrigin.quoteId} · v{order.quoteOrigin.quoteVersion} → 订单 {order.id}
                    </Link>
                  </div>
                )}
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-500">付款方式</span>
                  <span className="text-gray-800 dark:text-slate-900 text-right font-medium">{translatePaymentMethod(order.paymentMethod || '') || '-'}</span>
                </div>
                <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                  <span className="text-gray-500 dark:text-gray-500">下单时间</span>
                  <span className="text-gray-800 dark:text-slate-900 text-right">{new Date(order.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                {order.inquiryId && (
                  <div className="flex justify-between items-start border-b border-gray-50 dark:border-slate-400 pb-2">
                    <span className="text-gray-500 dark:text-gray-500">关联询价</span>
                    <span className="text-gray-800 dark:text-slate-900 text-right font-mono text-xs">{order.inquiryId.slice(0, 16)}...</span>
                  </div>
                )}
                <AlipayPaymentButton order={order} payment={order.payment} className="pt-1" />
              </div>
            </div>
          </div>

          {/* Right: Product List */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-slate-200/65 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-400 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-400 bg-gray-50/50 dark:bg-slate-200/55">
                <h2 className="font-semibold text-gray-800 dark:text-slate-900">订单产品明细</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 dark:bg-slate-200/55 text-gray-500 dark:text-slate-600 border-b border-gray-100 dark:border-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">产品</th>
                      <th className="px-4 py-3 font-medium text-center">单价</th>
                      <th className="px-4 py-3 font-medium text-center">数量</th>
                      <th className="px-4 py-3 font-medium text-center">已发货</th>
                      <th className="px-4 py-3 font-medium text-right">小计</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-400">
                    {parsedItems.map((item, i) => {
                      const qty = item.quantity || 1;
                      const shipped = item.shippedQty || 0;

                      return (
                        <Fragment key={item.id || `${item.catalogNumber || item.productId || 'item'}-${i}`}>
                        <tr className="hover:bg-gray-50/30 dark:hover:bg-slate-200/45">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800 dark:text-slate-900">{item.name || '未知产品'}</div>
                            {(item.spec || item.unit) && <div className="text-xs text-gray-500 dark:text-gray-400">规格：{item.spec || '-'} · 单位：{item.unit || '-'}</div>}
                            {item.productId && (
                              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">SKU: {item.productId}</div>
                            )}
                            {item.leadTime && (
                              <div className="text-xs text-gray-400 dark:text-gray-500">货期: {item.leadTime}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-brand-600 dark:text-brand-500 font-medium">
                            {formatPrice(item.price || 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-6 bg-gray-100 dark:bg-slate-200 rounded text-gray-700 dark:text-slate-700 font-medium text-xs">
                              × {qty}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {shipped > 0 ? (
                              <span className="text-xs text-purple-600 dark:text-orange-400 font-medium">{shipped}</span>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-brand-600 dark:text-brand-500">
                            {formatPrice((item.price || 0) * qty)}
                          </td>
                        </tr>
                        {item.pricingSnapshot && (
                          <tr>
                            <td colSpan={5} className="px-4 pb-4 pt-0">
                              <PricingBreakdown snapshot={item.pricingSnapshot} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-4 bg-gray-50 dark:bg-slate-200/55 border-t border-gray-100 dark:border-slate-400">
                <div className="ml-auto max-w-sm space-y-2">
                  <div className="flex justify-between gap-8 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">商品合计</span>
                    <span className="tabular-nums text-gray-800 dark:text-slate-900">{formatPrice(order.subtotal)}</span>
                  </div>
                  {order.adjustments.map((adjustment) => (
                    <div key={adjustment.id} className="flex justify-between gap-8 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{adjustment.label}{adjustment.reason ? ` · ${adjustment.reason}` : ''}</span>
                      <span className="tabular-nums text-gray-800 dark:text-slate-900">{adjustment.amount >= 0 ? '+' : '−'} {formatPrice(Math.abs(adjustment.amount))}</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-8 border-t border-gray-200 pt-2 dark:border-slate-400">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">订单合计</span>
                    <span className="text-xl font-bold tabular-nums text-brand-600 dark:text-brand-500">{formatPrice(order.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </main>

      <MobileBottomNav />
      <SiteFooter />

    </div>
  );
}
