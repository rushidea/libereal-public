'use client';

import React, { useEffect, useState } from 'react';

import {
  Package, Search, Eye, RotateCcw, Trash2
} from 'lucide-react';
import AlipayPaymentStatusView from '@/components/payment/AlipayPaymentStatus';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';
import { formatOrderPaymentMethod } from '@/data/payment-methods';

interface OrderItem {
  id?: string;
  isQuickOrder?: boolean;
  name?: string;
  brand?: string;
  catalogNumber?: string;
  quantity?: number;
  price?: number;
  leadTime?: string;
  available?: boolean;
  confirmed?: boolean;
}

interface Order {
  id: string;
  email: string;
  name?: string;
  institution?: string;
  department?: string;
  phone?: string;
  items: OrderItem[];
  subtotal: number;
  status: string;
  paymentMethod?: string;
  payment?: AlipayPaymentSummary | null;
  createdAt: string;
  archivedAt?: string;
}

const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  unpaid:       { label: '未付款',    color: 'bg-orange-100 text-orange-700' },
  pending:      { label: '待确认',    color: 'bg-yellow-100 text-yellow-700' },
  confirmed:    { label: '已确认',    color: 'bg-blue-100 text-blue-700' },
  partially_shipped: { label: '部分发货', color: 'bg-purple-100 text-purple-700' },
  shipped:      { label: '已发货',    color: 'bg-purple-100 text-purple-700' },
  completed:    { label: '已完成',    color: 'bg-green-100 text-green-700' },
  cancelled:    { label: '已取消',    color: 'bg-red-100 text-red-700' },
  closed:       { label: '关闭',      color: 'bg-gray-100 text-gray-600' },
};

export default function ArchivedOrdersPage() {

  const [orders, setOrders] = useState<Order[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchArchivedOrders();
  }, []);

  async function fetchArchivedOrders() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/orders/archived', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedOrder) {
      setOrderItems(selectedOrder.items);
    } else {
      setOrderItems([]);
    }
  }, [selectedOrder]);

  async function handleUnarchive(orderIds: string[]) {
    if (!confirm(`确定要还原 ${orderIds.length} 个订单吗？`)) return;
    try {
      const res = await fetch('/api/admin/orders/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, action: 'unarchive' }),
      });
      if (res.ok) {
        fetchArchivedOrders();
        setSelectedOrder(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDelete(orderIds: string[]) {
    if (!confirm(`确定要永久删除 ${orderIds.length} 个订单吗？此操作不可恢复！`)) return;
    try {
      const res = await fetch('/api/admin/orders/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, action: 'delete' }),
      });
      if (res.ok) {
        fetchArchivedOrders();
        setSelectedOrder(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  const filteredOrders = orders.filter(o =>
    !search ||
    (o.name && o.name.includes(search)) ||
    o.email.includes(search) ||
    (o.institution && o.institution.includes(search)) ||
    o.id.includes(search)
  );

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  return (
    <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索归档订单..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64 text-gray-900"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">订单号</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">客户</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">机构</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">金额</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">原状态</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">归档时间</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-600">暂无归档订单</td></tr>
                  ) : filteredOrders.map(order => (
                    <React.Fragment key={order.id}>
                      <tr
                        className={`border-b border-gray-100 cursor-pointer ${selectedOrder?.id === order.id ? 'bg-purple-100/50 hover:bg-purple-100/50' : 'hover:bg-gray-50/50'}`}
                        onClick={() => setSelectedOrder(selectedOrder?.id === order.id ? null : order)}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all">{order.id}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{order.name || order.email?.split('@')[0]}（{order.email}）</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{order.institution || '-'}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(order.subtotal)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_CONFIG[order.status]?.color || 'bg-gray-100 text-gray-700'}`}>
                            {ORDER_STATUS_CONFIG[order.status]?.label || order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {order.archivedAt ? new Date(order.archivedAt).toLocaleDateString('zh-CN') : '-'}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUnarchive([order.id])}
                              className="text-blue-600 hover:text-blue-700 font-medium text-xs flex items-center gap-1"
                              title="还原订单"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> 还原
                            </button>
                            <button
                              onClick={() => {
                                setSelectedOrder(order);
                              }}
                              className="text-brand-600 hover:text-brand-700 font-medium text-xs flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> 详情
                            </button>
                            <button
                              onClick={() => handleDelete([order.id])}
                              className="text-red-600 hover:text-red-700 font-medium text-xs flex items-center gap-1"
                              title="永久删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {selectedOrder?.id === order.id && (
                        <tr>
                          <td colSpan={7} className="bg-purple-100/70 p-4 border-b border-purple-200">
                            <div className="bg-white rounded-lg border border-purple-300 shadow-sm p-4 space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">客户姓名</p>
                                  <p className="font-medium text-gray-800">{selectedOrder.name || selectedOrder.email?.split('@')[0]}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">邮箱</p>
                                  <p className="text-sm text-gray-700">{selectedOrder.email}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">电话</p>
                                  <p className="text-sm text-gray-700">{selectedOrder.phone || '-'}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">机构</p>
                                  <p className="text-sm text-gray-700">{selectedOrder.institution || '-'}</p>
                                </div>
                                {selectedOrder.paymentMethod && (
                                  <div>
                                    <p className="text-xs text-gray-600 mb-1">付款方式</p>
                                    <p className="text-sm font-bold text-orange-600">{formatOrderPaymentMethod(selectedOrder.paymentMethod)}</p>
                                  </div>
                                )}
                              </div>
                              {selectedOrder.payment && <AlipayPaymentStatusView payment={selectedOrder.payment} showReferences />}
                              <div>
                                <p className="text-xs text-gray-600 mb-2">订单产品</p>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                  {orderItems.map((item: OrderItem, i: number) => (
                                    <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                                      <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 bg-purple-50 text-purple-600">
                                          <Package className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-gray-900 truncate">{item.name || '未知产品'}</p>
                                          <p className="text-xs text-gray-600">{item.brand} · {item.catalogNumber}</p>
                                        </div>
                                        <div className="text-right">
                                          <p className="text-sm font-medium text-gray-900">{formatPrice((item.price || 0) * (item.quantity || 1))}</p>
                                          <p className="text-xs text-gray-500">x{item.quantity || 1}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                                <span className="text-gray-700 font-medium">订单总计</span>
                                <span className="text-xl font-bold text-purple-600">{formatPrice(selectedOrder.subtotal)}</span>
                              </div>
                              <div className="flex gap-2 pt-4 border-t border-gray-200">
                                <button
                                  onClick={() => handleUnarchive([selectedOrder.id])}
                                  className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <RotateCcw className="w-4 h-4" /> 还原此订单
                                </button>
                                <button
                                  onClick={() => handleDelete([selectedOrder.id])}
                                  className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" /> 删除
                                </button>
                              </div>
                              <div className="text-xs text-gray-500 text-center">
                                归档时间：{selectedOrder.archivedAt ? new Date(selectedOrder.archivedAt).toLocaleString('zh-CN') : '-'}
                              </div>
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
        </div>
  );
}
