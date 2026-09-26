'use client';

import React, { useState, useEffect } from 'react';
import { Package, Search, Filter, Truck, Eye } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import AlipayPaymentButton from '@/components/account/AlipayPaymentButton';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';
import { formatOrderPaymentMethod } from '@/data/payment-methods';
import { displayedOrderStatus, ORDER_STATUS_LABELS, ORDER_STATUSES } from '@/lib/order-domain';

type OrderItem = {
  productId?: string;
  name?: string;
  price?: number;
  quantity?: number;
  shippedQty?: number;
  leadTime?: string;
  status?: string;
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
  items: OrderItem[];
  subtotal: number;
  total: number;
  status: string;
  paymentMethod?: string;
  paidAt?: string | null;
  payment?: AlipayPaymentSummary | null;
  shipments: Array<{ id: string; method: string; carrier?: string; trackingNumber?: string; pickupPoint?: string }>;
  createdAt: string;
  updatedAt: string;
  leadTime?: string;
  notes?: string;
};

const STATUS_OPTIONS = [...ORDER_STATUSES];
const STATUS_LABELS: Record<string, string> = ORDER_STATUS_LABELS;
const STATUS_COLORS: Record<string, string> = {
  'unpaid': uiSurfaces.badgeWarning,
  'pending': uiSurfaces.badgeWarning,
  'confirmed': uiSurfaces.badgeInfo,
  'partially_shipped': uiSurfaces.badgeInfo,
  'shipped': uiSurfaces.badgeInfo,
  'completed': uiSurfaces.badgeSuccess,
  'cancelled': uiSurfaces.badge,
  'closed': uiSurfaces.badge,
};

const SHIPPING_LABELS: Record<string, string> = {
  'logistics': '物流',
  'self_pickup': '自提',
  'dedicated_delivery': '专送',
};

const formatPrice = (price: number | null | undefined) => {
  if (price == null) return '¥--';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
};

function parseItems(items: OrderItem[]): OrderItem[] { return items; }

function translatePaymentMethod(method: string): string {
  return formatOrderPaymentMethod(method);
}

export default function OrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    fetch('/api/orders', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setOrders(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = orders.filter(o => {
    const matchSearch = !search || o.id.includes(search) || o.email.includes(search) || (o.userInstitution || '').includes(search) || (o.userName || '').includes(search);
    const matchStatus = !statusFilter || displayedOrderStatus(o) === statusFilter;
    return matchSearch && matchStatus;
  });

  const paginatedOrders = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-[var(--brand-border-radius-pill)] border-2 border-[var(--brand-color-primary)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-[var(--brand-border-radius-lg)] p-4 ${uiSurfaces.panelStrong}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Package className={uiSurfaces.textInteractive} size={22} />
            <div>
              <h2 className={`text-lg font-semibold ${uiSurfaces.titleText}`}>我的订单</h2>
              <p className={`text-xs ${uiSurfaces.mutedText}`}>订单查询与状态跟踪</p>
            </div>
          </div>
        </div>
      </div>

      <div className={`flex flex-col gap-3 rounded-[var(--brand-border-radius-lg)] p-4 sm:flex-row ${uiSurfaces.panel}`}>
        <div className="relative flex-1">
          <Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${uiSurfaces.textQuaternary}`} />
          <input
            type="text"
            placeholder="搜索订单号/客户/单位..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 text-sm ${uiSurfaces.inputCompact} ${uiSurfaces.focusRing}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className={`h-4 w-4 ${uiSurfaces.textQuaternary}`} />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className={`px-3 text-sm ${uiSurfaces.inputCompact} ${uiSurfaces.focusRing}`}
          >
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
          </select>
        </div>
      </div>

      <div className={`overflow-hidden rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panel}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${uiSurfaces.border} bg-[var(--surface-muted)]`}>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>订单号</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>客户</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>机构</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>金额</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>状态</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}>时间</th>
                <th className={`px-4 py-3 text-left font-semibold ${uiSurfaces.titleText}`}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className={`py-12 text-center ${uiSurfaces.textSecondary}`}>暂无订单</td></tr>
              ) : paginatedOrders.map(order => (
                <React.Fragment key={order.id}>
                  <tr
                    className={`cursor-pointer border-b border-[var(--surface-border)] ${selectedOrder?.id === order.id ? 'bg-[var(--brand-color-primary-bg)]' : 'hover:bg-[var(--surface-hover)]'}`}
                    onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 font-mono text-xs ${uiSurfaces.textSecondary}`}>
                      {order.id}
                      {order.ownerScope === 'organization' && <span className="ml-2 rounded-full bg-[var(--brand-color-info-bg)] px-2 py-0.5 font-sans text-[10px] text-[var(--brand-color-info-text)]">组织采购</span>}
                    </td>
                    <td className="px-4 py-3"><div className={`font-medium ${uiSurfaces.titleText}`}>{order.userName || order.email}</div></td>
                    <td className={`max-w-[120px] truncate px-4 py-3 ${uiSurfaces.textSecondary}`}>{order.userInstitution || '-'}</td>
                    <td className={`px-4 py-3 font-semibold ${uiSurfaces.titleText}`}>{formatPrice(order.total)}</td>
                    <td className="px-4 py-3">
                      <span className={`${STATUS_COLORS[displayedOrderStatus(order)] || uiSurfaces.badge} min-h-0 px-2 py-1 text-xs font-medium`}>
                        {STATUS_LABELS[displayedOrderStatus(order)] || order.status}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${uiSurfaces.textSecondary}`}>{new Date(order.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedOrder(selectedOrder?.id === order.id ? null : order); }}
                        className={`flex items-center gap-1 text-xs font-medium ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing}`}
                      >
                        <Eye className="w-3.5 h-3.5" /> {selectedOrder?.id === order.id ? '收起' : '详情'}
                      </button>
                    </td>
                  </tr>
                  {selectedOrder?.id === order.id && (
                    <tr>
                      <td colSpan={7} className="border-b border-[var(--brand-color-primary-border)] bg-[var(--brand-color-primary-bg)] p-4">
                        <div className={`space-y-4 rounded-[var(--brand-border-radius)] p-4 ${uiSurfaces.panel}`}>
                          <div>
                            <p className={`mb-2 text-xs font-medium ${uiSurfaces.textSecondary}`}>发货记录</p>
                            {order.shipments.length === 0 ? <p className={`text-sm ${uiSurfaces.mutedText}`}>暂未发货</p> : order.shipments.map((shipment) => (
                              <div key={shipment.id} className={`flex items-center gap-2 text-sm ${uiSurfaces.textSecondary}`}>
                                <Truck className={`h-4 w-4 ${uiSurfaces.textQuaternary}`} />
                                <span>{SHIPPING_LABELS[shipment.method] || shipment.method}{shipment.carrier ? ` · ${shipment.carrier}` : ''}{shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''}</span>
                              </div>
                            ))}
                          </div>

                          {/* 产品清单 */}
                          <div>
                            <p className={`mb-2 text-xs font-medium ${uiSurfaces.textSecondary}`}>产品清单</p>
                            <div className="space-y-3">
                              {parseItems(order.items).map((item, i) => {
                                const qty = item.quantity || 1;
                                const shipped = item.shippedQty || 0;
                                return (
                                  <div key={i} className={`rounded-[var(--brand-border-radius)] p-4 ${uiSurfaces.panel}`}>
                                    <div className="flex items-start gap-3 mb-3">
                                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-primary-bg)] ${uiSurfaces.textInteractive}`}>
                                        <Package className="w-4 h-4" />
                                      </div>
                                      <div className="flex-1">
                                        <p className={`text-sm font-medium ${uiSurfaces.titleText}`}>{item.name || '未知产品'}</p>
                                        {item.productId && <p className={`text-xs ${uiSurfaces.mutedText}`}>SKU: {item.productId}</p>}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                      <div>
                                        <p className={`mb-1 text-xs ${uiSurfaces.textQuaternary}`}>单价</p>
                                        <p className={`font-medium ${uiSurfaces.textInteractive}`}>{formatPrice(item.price)}</p>
                                      </div>
                                      <div>
                                        <p className={`mb-1 text-xs ${uiSurfaces.textQuaternary}`}>数量</p>
                                        <p className={`font-medium ${uiSurfaces.textSecondary}`}>× {qty}
                                          {shipped > 0 && <span className="ml-1 text-xs text-[var(--brand-color-info-text)]">（已发 {shipped}）</span>}
                                        </p>
                                      </div>
                                      <div>
                                        <p className={`mb-1 text-xs ${uiSurfaces.textQuaternary}`}>货期</p>
                                        <p className={`text-xs font-medium ${uiSurfaces.textSecondary}`}>{item.leadTime || '-'}</p>
                                      </div>
                                    </div>
                                    <div className="mt-2 text-right">
                                      <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>小计：{formatPrice((item.price || 0) * qty)}</p>
                                    </div>
                                  </div>
                                );
                              })}
                              {parseItems(order.items).length === 0 && (
                                <p className={`py-4 text-center text-xs ${uiSurfaces.mutedText}`}>无产品数据</p>
                              )}
                            </div>
                          </div>

                          {/* 总计 + 付款方式 */}
                          <div className={`flex items-center justify-between border-t pt-4 ${uiSurfaces.border}`}>
                            <span className={`font-medium ${uiSurfaces.titleText}`}>订单总计</span>
                            <span className={`text-xl font-bold ${uiSurfaces.textInteractive}`}>{formatPrice(order.subtotal)}</span>
                          </div>
                          {order.paymentMethod && (
                            <div className={`text-right text-sm ${uiSurfaces.textSecondary}`}>
                              付款方式：<span className="font-bold text-[var(--brand-color-warning-text)]">{translatePaymentMethod(order.paymentMethod)}</span>
                            </div>
                          )}
                          <AlipayPaymentButton order={order} payment={order.payment} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className={`${uiSurfaces.buttonSecondary} px-3 text-sm`}
          >
            上一页
          </button>
          <span className={`text-sm ${uiSurfaces.textSecondary}`}>{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className={`${uiSurfaces.buttonSecondary} px-3 text-sm`}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
