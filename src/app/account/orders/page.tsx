'use client';

import React, { useEffect, useState, useRef, Suspense, startTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { Package, Search, Filter, Check, Truck, Eye, XCircle, RotateCcw } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

import Breadcrumb from '@/components/Breadcrumb';
import AlipayPaymentButton from '@/components/account/AlipayPaymentButton';
import AlipayPaymentStatusView from '@/components/payment/AlipayPaymentStatus';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';
import { formatOrderPaymentMethod } from '@/data/payment-methods';
import PricingBreakdown from '@/components/order/PricingBreakdown';
import {
  canCustomerCancelOrder,
  canReorderFromOrderStatus,
  displayedOrderStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
} from '@/lib/order-domain';

function translatePaymentMethod(method: string): string {
  return formatOrderPaymentMethod(method);
}

type OrderItem = {
  productId?: string;
  catalogNumber?: string;
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
  organizationId?: string | null;
  ownerScope?: 'personal' | 'organization';
  email: string;
  userName: string;
  userInstitution: string;
  userPhone: string;
  userDepartment: string;
  addressSnapshot?: { name: string; phone: string; address: string; institution?: string };
  items: OrderItem[];
  subtotal: number;
  adjustmentTotal: number;
  total: number;
  status: string;
  paymentMethod?: string;
  paidAt?: string | null;
  payment?: AlipayPaymentSummary | null;
  adjustments: Array<{ id: string; label: string; amount: number; reason?: string | null }>;
  shipments: Array<{
    id: string; method: string; carrier?: string; trackingNumber?: string; pickupPoint?: string;
    contactName?: string; contactPhone?: string; shippedAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  leadTime?: string;
  notes?: string;
};

const STATUS_OPTIONS = [...ORDER_STATUSES];
const STATUS_LABELS: Record<string, string> = ORDER_STATUS_LABELS;
const STATUS_COLORS: Record<string, string> = {
  'unpaid': 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  'pending': 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  'confirmed': 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  'partially_shipped': 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  'shipped': 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  'completed': 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300',
  'cancelled': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  'closed': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

const SHIPPING_LABELS: Record<string, string> = {
  'logistics': '物流',
  'self_pickup': '自提',
  'dedicated_delivery': '专送',
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

function parseItems(items: OrderItem[]): OrderItem[] { return items; }

function canCancelOrder(order: Order): boolean {
  return canCustomerCancelOrder(order);
}

function canReorderOrder(order: Order): boolean {
  return canReorderFromOrderStatus(order.status) && order.items.length > 0;
}

function orderActionErrorMessage(error: string | undefined): string {
  if (error === 'PAID_ORDER_REFUND_REQUIRED') return '已付款订单需要退款审核，暂时不能自助取消。';
  if (error === 'INVALID_ORDER_TRANSITION') return '订单当前状态不能取消。';
  if (error === 'REORDER_PRODUCT_UNAVAILABLE') return '订单中的部分商品已下架，暂时无法再次下单。';
  return error || '操作失败，请稍后重试。';
}

function OrdersContent() {

  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [newOrderId, setNewOrderId] = useState<string | null>(null);
  const [orderActionId, setOrderActionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const bannerDismissed = useRef(false);

  const newId = searchParams.get('new');
  const newIdInitialized = useRef(false);
  useEffect(() => {
    if (newId && !bannerDismissed.current && !newIdInitialized.current) {
      newIdInitialized.current = true;
      startTransition(() => {
        setNewOrderId(newId);
      });
      const timer = setTimeout(() => {
        startTransition(() => {
          setNewOrderId(null);
        });
        bannerDismissed.current = true;
        router.replace('/account/orders');
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [newId, router]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/account/orders');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/orders', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setOrders(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status]);

  const cancelOrder = async (order: Order) => {
    if (!canCancelOrder(order) || orderActionId) return;
    if (!window.confirm(`确定取消订单 ${order.id} 吗？`)) return;
    setOrderActionId(order.id);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', reason: '用户取消订单' }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        window.alert(orderActionErrorMessage(data.error));
        return;
      }
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: 'cancelled' } : item));
      setSelectedOrder((current) => current?.id === order.id ? { ...current, status: 'cancelled' } : current);
    } catch {
      window.alert('网络错误，请稍后重试。');
    } finally {
      setOrderActionId(null);
    }
  };

  const reorderOrder = async (order: Order) => {
    if (!canReorderOrder(order) || orderActionId) return;
    setOrderActionId(order.id);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/reorder`, { method: 'POST' });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        window.alert(orderActionErrorMessage(data.error));
        return;
      }
      router.push('/cart');
    } catch {
      window.alert('网络错误，请稍后重试。');
    } finally {
      setOrderActionId(null);
    }
  };

  const filtered = orders.filter(o => {
    const keyword = search.trim().toLocaleLowerCase();
    const productText = parseItems(o.items)
      .flatMap(item => [item.name, item.catalogNumber, item.productId])
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    const searchableText = [
      o.id,
      o.addressSnapshot?.name,
      o.addressSnapshot?.phone,
      o.addressSnapshot?.address,
      o.addressSnapshot?.institution,
      productText,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    const matchSearch = !keyword || searchableText.includes(keyword);
    const matchStatus = !statusFilter || displayedOrderStatus(o) === statusFilter;
    return matchSearch && matchStatus;
  });

  const paginatedOrders = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);


  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <div className="flex-1">
        <div className="max-w-6xl mx-auto px-4">
          <Breadcrumb items={[
            { label: '首页', href: '/' },
            { label: '我的账户', href: '/account' },
            { label: '我的订单' }
          ]} />

          <div className="mb-4 bg-white/70 backdrop-blur-md rounded-2xl shadow-xl border border-white/70 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Package className="text-brand-600" size={22} />
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-slate-900">我的订单</h1>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">管理您的订单</p>
                </div>
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400">共 {filtered.length} 条</span>
            </div>
          </div>

          {newOrderId && (
            <div className="bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-xl px-5 py-4 mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-brand-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-brand-800 dark:text-brand-200">订单已生成！</p>
                  <p className="text-sm text-brand-600 dark:text-brand-400">订单号：<span className="font-mono">{newOrderId}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setNewOrderId(null); bannerDismissed.current = true; router.replace('/account/orders'); }} className="text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-200 p-2">✕</button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-200/65 rounded-xl shadow-sm border border-gray-200 dark:border-slate-400 p-4 mb-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 dark:text-gray-400" />
              <input
                type="text"
                placeholder="搜索订单号/产品/收货人/地址..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-400 rounded-lg text-sm text-gray-800 dark:text-slate-900 focus:outline-none focus:border-brand-400 placeholder:text-gray-500 dark:placeholder:text-gray-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="border border-gray-200 dark:border-slate-400 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-slate-900 focus:outline-none focus:border-brand-400"
              >
                <option value="">全部状态</option>
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-200/65 rounded-xl shadow-sm border border-gray-200 dark:border-slate-400 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-200/65 border-b border-gray-200 dark:border-slate-400">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">订单号</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">收货人</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">收货地址</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">金额</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">状态</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900">时间</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-slate-900"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-gray-600 dark:text-gray-400">暂无订单</td></tr>
                  ) : paginatedOrders.map(order => (
                    <React.Fragment key={order.id}>
                      <tr
                        className={`border-b border-gray-100 dark:border-slate-400 cursor-pointer ${selectedOrder?.id === order.id ? 'bg-brand-100/50 hover:bg-brand-100/50' : 'hover:bg-gray-50/50 dark:hover:bg-gray-300/50'}`}
                        onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {order.id}
                          {order.ownerScope === 'organization' && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 font-sans text-[10px] text-blue-700">组织采购</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-slate-900">{order.addressSnapshot?.name || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-slate-900 truncate max-w-[180px]">{order.addressSnapshot?.address || '-'}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-slate-900">¥{order.total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[displayedOrderStatus(order)] || 'bg-gray-100 text-gray-600'}`}>
                              {STATUS_LABELS[displayedOrderStatus(order)] || order.status}
                            </span>
                            {order.payment && <AlipayPaymentStatusView payment={order.payment} compact />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">{new Date(order.createdAt).toLocaleDateString('zh-CN')}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                              className="text-brand-600 hover:text-brand-700 font-medium text-xs flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> {selectedOrder?.id === order.id ? '收起' : '详情'}
                            </button>
                            {canCancelOrder(order) && (
                              <button type="button" onClick={() => void cancelOrder(order)} disabled={orderActionId !== null} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                                <XCircle className="w-3.5 h-3.5" />取消订单
                              </button>
                            )}
                            {canReorderOrder(order) && (
                              <button type="button" onClick={() => void reorderOrder(order)} disabled={orderActionId !== null} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                                <RotateCcw className="w-3.5 h-3.5" />再来一单
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {selectedOrder?.id === order.id && (
                        <tr>
                          <td colSpan={7} className="bg-brand-100/70 dark:bg-brand-900/30 p-4 border-b border-brand-200 dark:border-brand-700">
                            <div className="bg-white dark:bg-slate-200/65 rounded-lg border border-brand-300 dark:border-brand-700 shadow-sm p-4 space-y-4">
                              {/* 配送信息 */}
                              <div className="space-y-2">
                                <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">发货记录</p>
                                {selectedOrder.shipments.length === 0 ? <p className="text-sm text-gray-500">暂未发货</p> : selectedOrder.shipments.map((shipment) => (
                                  <div key={shipment.id} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                                    <Truck className="w-4 h-4 mt-0.5" />
                                    <span>{SHIPPING_LABELS[shipment.method] || shipment.method}{shipment.carrier ? ` · ${shipment.carrier}` : ''}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}{shipment.pickupPoint ? ` · ${shipment.pickupPoint}` : ''}</span>
                                  </div>
                                ))}
                              </div>

                              {/* 产品清单 */}
                              <div>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">产品清单</p>
                                <div className="space-y-3">
                                  {parseItems(selectedOrder.items).map((item, i) => {
                                    const qty = item.quantity || 1;
                                    const shipped = item.shippedQty || 0;
                                    return (
                                      <div key={i} className="bg-gray-50 dark:bg-slate-200/65 rounded-xl p-4 border border-gray-100 dark:border-slate-400">
                                        <div className="flex items-start gap-3 mb-3">
                                          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 bg-brand-50 text-brand-600">
                                            <Package className="w-4 h-4" />
                                          </div>
                                          <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-900 dark:text-slate-900">{item.name || '未知产品'}</p>
                                            {item.productId && <p className="text-xs text-gray-500 dark:text-gray-500">SKU: {item.productId}</p>}
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 text-sm">
                                          <div>
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">单价</p>
                                            <p className="font-medium text-brand-600">{formatPrice(item.price || 0)}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">数量</p>
                                            <p className="font-medium text-gray-700 dark:text-gray-300">× {qty}
                                              {shipped > 0 && <span className="text-xs text-purple-600 ml-1">（已发 {shipped}）</span>}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">货期</p>
                                            <p className="font-medium text-gray-700 dark:text-gray-300 text-xs">{item.leadTime || '-'}</p>
                                          </div>
                                        </div>
                                        <div className="mt-2 text-right">
                                          <p className="text-sm font-semibold text-gray-800 dark:text-slate-900">小计：{formatPrice((item.price || 0) * qty)}</p>
                                        </div>
                                        <PricingBreakdown snapshot={item.pricingSnapshot} />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* 总计 + 付款方式 */}
                              <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-slate-400">
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400">商品合计</span>
                                  <span className="tabular-nums text-gray-800 dark:text-slate-900">{formatPrice(selectedOrder.subtotal)}</span>
                                </div>
                                {selectedOrder.adjustments.map((adjustment) => (
                                  <div key={adjustment.id} className="flex justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-400">{adjustment.label}{adjustment.reason ? ` · ${adjustment.reason}` : ''}</span>
                                    <span className="tabular-nums text-gray-800 dark:text-slate-900">{adjustment.amount >= 0 ? '+' : '−'} {formatPrice(Math.abs(adjustment.amount))}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between items-center border-t border-gray-100 pt-2 dark:border-slate-400">
                                  <span className="font-medium text-gray-700 dark:text-gray-300">订单总计</span>
                                  <span className="text-xl font-bold tabular-nums text-brand-600">{formatPrice(selectedOrder.total)}</span>
                                </div>
                              </div>
                              {selectedOrder.paymentMethod && (
                                <div className="text-right text-sm text-gray-600 dark:text-gray-400">
                                  付款方式：<span className="font-bold text-orange-600">{translatePaymentMethod(selectedOrder.paymentMethod)}</span>
                                </div>
                              )}
                              <AlipayPaymentButton order={selectedOrder} payment={selectedOrder.payment} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-600 dark:text-gray-400">暂无订单</div>
              ) : paginatedOrders.map(order => (
                <div key={order.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-mono text-xs text-gray-500 dark:text-gray-500 mb-1">{order.id}</p>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[displayedOrderStatus(order)] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[displayedOrderStatus(order)] || order.status}
                      </span>
                      {order.payment && <div className="mt-1.5"><AlipayPaymentStatusView payment={order.payment} compact /></div>}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900 dark:text-slate-900">¥{order.total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(order.createdAt).toLocaleDateString('zh-CN')}</p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    收货人：{order.addressSnapshot?.name || '-'}{order.addressSnapshot?.phone ? ` · ${order.addressSnapshot.phone}` : ''}
                  </div>
                  {order.addressSnapshot?.address && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 mb-3">{order.addressSnapshot.address}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                      className="min-w-0 flex-1 py-2 text-sm text-brand-600 hover:text-brand-700 font-medium border border-brand-200 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors"
                    >
                      {selectedOrder?.id === order.id ? '收起详情' : '查看详情'}
                    </button>
                    {canCancelOrder(order) && (
                      <button type="button" onClick={() => void cancelOrder(order)} disabled={orderActionId !== null} className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <XCircle className="h-4 w-4" />取消
                      </button>
                    )}
                    {canReorderOrder(order) && (
                      <button type="button" onClick={() => void reorderOrder(order)} disabled={orderActionId !== null} className="inline-flex items-center justify-center gap-1 rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                        <RotateCcw className="h-4 w-4" />再来一单
                      </button>
                    )}
                  </div>
                  {selectedOrder?.id === order.id && (
                    <div className="mt-4 p-4 bg-gray-50 dark:bg-slate-200/65 rounded-xl space-y-3 text-sm">
                      {selectedOrder.shipments.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">发货记录</p>
                          {selectedOrder.shipments.map((shipment) => <p key={shipment.id} className="text-gray-700 dark:text-slate-900">{SHIPPING_LABELS[shipment.method] || shipment.method}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</p>)}
                        </div>
                      )}
                      {selectedOrder.paymentMethod && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">付款方式</p>
                          <p className="text-orange-600 font-medium">{translatePaymentMethod(selectedOrder.paymentMethod)}</p>
                        </div>
                      )}
                      <AlipayPaymentButton order={selectedOrder} payment={selectedOrder.payment} />
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">产品清单</p>
                        <div className="space-y-2">
                          {parseItems(selectedOrder.items).map((item, i) => (
                            <div key={i} className="bg-white dark:bg-slate-200/75 rounded-lg p-3 border border-gray-100 dark:border-slate-400">
                              <p className="text-gray-800 dark:text-slate-900 font-medium">{item.name || '未知产品'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-500">¥{item.price} × {item.quantity || 1}</p>
                              <PricingBreakdown snapshot={item.pricingSnapshot} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-400 text-gray-600 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">上一页</button>
              <span className="text-sm text-gray-600 dark:text-gray-400">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-400 text-gray-600 dark:text-gray-400 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">下一页</button>
            </div>
          )}
        </div>
      </div>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen libereal-service-page flex items-center justify-center">
      <div className="text-gray-500 dark:text-gray-500">加载中...</div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OrdersContent />
    </Suspense>
  );
}
