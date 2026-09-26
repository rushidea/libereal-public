'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import {
  Search, Package, Archive, Trash2, ChevronLeft, ChevronRight,
  Plus, Check, Clock, ClipboardList, Wallet,
} from 'lucide-react';
import ProductSearchOverlayForOrder from '@/components/admin/ProductSearchOverlayForOrder';
import { normalizeOrderPaymentMethod, ORDER_PAYMENT_METHODS } from '@/data/payment-methods';
import AlipayPaymentStatusView from '@/components/payment/AlipayPaymentStatus';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';
import { canTransitionOrder, displayedOrderStatus, isOrderStatus } from '@/lib/order-domain';

interface Order {
  id: string;
  name: string;
  email: string;
  phone: string;
  institution: string;
  department?: string;
  items: OrderItem[];
  subtotal: number;
  total: number;
  status: string;
  createdAt: string;
  paymentMethod?: string;
  paidAt?: string | null;
  receivable?: { id: string; amount: number; status: string; dueAt?: string | null; paidAt?: string | null } | null;
  payment?: AlipayPaymentSummary | null;
  leadTime?: string;
  notes?: string;
  quoteSent?: boolean;
  quoteSentAt?: string;
  quoteConfirmed?: boolean;
  events?: Array<{ id: string; type: string; actorEmail?: string; message?: string; createdAt: string }>;
  shipments?: Array<{ id: string; method: string; carrier?: string; trackingNumber?: string; shippedAt?: string }>;
  userDepartment?: string;
  pointsPersonal?: number;
  pointsGroup?: number;
  pointsDiscount?: number;
  pointsApplied?: boolean;
  pointsRefundedPersonal?: number;
  pointsRefundedGroup?: number;
}

interface OrderItem {
  id?: string;
  isQuickOrder?: boolean;
  name?: string;
  brand?: string;
  catalogNumber?: string;
  quantity?: number;
  shippedQty?: number;
  price?: number;
  leadTime?: string;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  available?: boolean;
  confirmed?: boolean;
  product?: {
    id?: string;
    name?: string;
    brand?: string;
    catalogNumber?: string;
    promotionalPrice?: number;
    price?: number;
  };
}

const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  unpaid: { label: '未付款', color: 'bg-orange-100 text-orange-700', icon: Clock },
  pending: { label: '待确认', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  confirmed: { label: '已确认', color: 'bg-blue-100 text-blue-700', icon: Check },
  partially_shipped: { label: '部分发货', color: 'bg-purple-100 text-purple-700', icon: Package },
  shipped: { label: '已发货', color: 'bg-purple-100 text-purple-700', icon: Package },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700', icon: Check },
  cancelled: { label: '已取消', color: 'bg-red-100 text-red-700', icon: Archive },
  closed: { label: '关闭', color: 'bg-gray-100 text-gray-600', icon: Archive },
};

function orderActionErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    ALIPAY_PAYMENT_REQUIRED: '支付宝订单尚未付款，不能确认订单。',
    PAID_ORDER_REFUND_REQUIRED: '支付宝订单已经付款，取消或关闭前需要先办理退款。',
    ORDER_ITEMS_LOCKED: '支付宝订单已经发起付款，不能再改商品。',
    INVALID_ORDER_AMOUNT: '订单金额无效，请检查商品价格和数量。',
    PAYMENT_METHOD_LOCKED: '该订单已经产生支付记录，付款方式不能修改。',
    INVALID_ORDER_TRANSITION: '当前订单状态不允许执行该操作。',
    INVALID_STATUS_TRANSITION: '当前订单状态不允许执行该操作。',
  };
  return messages[error] || error || '操作失败';
}

export default function AdminOrdersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-brand-600" /> 活跃订单
        </h1>
        <p className="text-sm text-gray-500 mt-1">查看和处理未付款、待确认、已确认与已发货的订单</p>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" /></div>}>
        <OrdersPanel />
      </Suspense>
    </div>
  );
}

function OrdersPanel() {
  const router = useRouter();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  // ?view=receivable：工作台/侧边栏「待收款」入口进入的视图
  const receivableView = searchParams.get('view') === 'receivable';

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [addProductSearch, setAddProductSearch] = useState('');
  const [addingToOrder, setAddingToOrder] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (receivableView) params.set('receivable', 'open');
      const qs = params.toString();
      const res = await fetch(`/api/admin/orders${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : (data.orders || []));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [receivableView]);

  useEffect(() => {
    if (selectedOrder) {
      setOrderItems(selectedOrder.items);
    } else {
      setOrderItems([]);
    }
  }, [selectedOrder]);

  const filteredOrders = orders.filter(o => {
    const matchSearch = !search ||
      (o.name && o.name.includes(search)) ||
      o.email.includes(search) ||
      (o.institution && o.institution.includes(search)) ||
      o.id.includes(search);
    const orderDate = new Date(o.createdAt);
    const matchDateFrom = !dateFrom || orderDate >= new Date(dateFrom);
    const matchDateTo = !dateTo || orderDate <= new Date(dateTo + 'T23:59:59');
    const matchStatus = !statusFilter || displayedOrderStatus(o) === statusFilter;
    return matchSearch && matchDateFrom && matchDateTo && matchStatus;
  });
  const paginatedOrders = filteredOrders.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filteredOrders.length / pageSize);

  async function updateOrderStatus(orderId: string, newStatus: string): Promise<string | null> {
    const response = await fetch(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return orderActionErrorMessage(data.error);
    fetchData();
    if (selectedOrder?.id === orderId) {
      setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
    }
    return null;
  }

  async function archiveOrders(orderIds: string[]) {
    if (!confirm(`确定要归档 ${orderIds.length} 个订单吗？`)) return;
    try {
      const res = await fetch('/api/admin/orders/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, action: 'archive' }),
      });
      if (res.ok) {
        fetchData();
        setSelectedOrder(null);
      }
    } catch (e) { console.error(e); }
  }

  async function deleteOrders(orderIds: string[]) {
    if (!confirm(`确定要删除 ${orderIds.length} 个订单吗？此操作不可恢复！`)) return;
    try {
      const res = await fetch('/api/admin/orders/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, action: 'delete' }),
      });
      if (res.ok) {
        fetchData();
        setSelectedOrder(null);
        setSelectedOrders(new Set());
      }
    } catch (e) { console.error(e); }
  }

  async function handleAddProductToOrder(product: { name: string; brand: string; catalogNumber: string; price?: number; promotionalPrice?: number }) {
    if (!selectedOrder) return;
    const newItem: OrderItem = {
      name: product.name,
      brand: product.brand,
      catalogNumber: product.catalogNumber,
      price: product.promotionalPrice ?? product.price ?? 0,
      quantity: 1,
      leadTime: '',
      confirmed: false,
    };
    const updatedItems = [...orderItems, newItem];
    const newSubtotal = updatedItems.reduce((sum, it) => sum + (it.price || 0) * (it.quantity || 1), 0);
    try {
      const res = await fetch(`/api/orders/${selectedOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updatedItems, subtotal: newSubtotal }),
      });
      if (res.ok) {
        setOrderItems(updatedItems);
        setSelectedOrder(prev => prev ? { ...prev, items: updatedItems, subtotal: newSubtotal } : null);
        setAddProductSearch('');
        setAddingToOrder(false);
        fetchData();
      }
    } catch (e) { console.error(e); }
  }

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap w-full lg:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="搜索订单..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full sm:w-64 text-gray-900" />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-sm text-gray-500">从</span>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 min-w-36" />
            <span className="text-sm text-gray-500">至</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 min-w-36" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
                清除
              </button>
            )}
          </div>
          <button onClick={() => router.push('/admin/orders/archived')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Package className="w-4 h-4" /> 已归档
          </button>
          {selectedOrders.size > 0 && (
            <>
              <button onClick={() => archiveOrders(Array.from(selectedOrders))}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
                <Archive className="w-4 h-4" /> 批量归档 ({selectedOrders.size})
              </button>
              <button onClick={() => deleteOrders(Array.from(selectedOrders))}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
                <Trash2 className="w-4 h-4" /> 批量删除 ({selectedOrders.size})
              </button>
            </>
          )}
        </div>
        {receivableView && (
          <div className="flex items-center gap-3 flex-wrap rounded-xl px-4 py-3 bg-brand-50/60 border border-brand-100">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <Wallet className="w-4 h-4 text-brand-600" /> 待收款视图
            </span>
            <span className="text-sm text-gray-600">
              共 <b className="text-gray-900">{orders.length}</b> 笔待回款
            </span>
            <span className="text-sm text-gray-600">
              金额 <b className="text-gray-900">¥{orders.reduce((s, o) => s + (o.receivable?.amount ?? 0), 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            </span>
            <button
              onClick={() => { router.push('/admin/orders'); }}
              className="ml-auto text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              退出待收款视图
            </button>
          </div>
        )}
        <div className="flex gap-2 text-sm w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(Object.keys(ORDER_STATUS_CONFIG)).map(s => {
            const count = orders.filter(o => displayedOrderStatus(o) === s).length;
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(active ? '' : s);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0 border transition-colors ${
                  active
                    ? 'bg-brand-500 text-white border-brand-500 shadow-sm'
                    : 'bg-white/70 border-white/70 hover:border-brand-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${ORDER_STATUS_CONFIG[s].color.replace('bg-', 'bg-').split(' ')[0]}`} />
                <span className={active ? 'text-white' : 'text-gray-600'}>{ORDER_STATUS_CONFIG[s].label} {count}</span>
              </button>
            );
          })}
          {statusFilter && (
            <button
              onClick={() => {
                setStatusFilter('');
                setPage(1);
              }}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0 bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 transition-colors"
            >
              全部
            </button>
          )}
        </div>
      </div>

      <div className="lg:hidden space-y-3">
        {paginatedOrders.map(order => (
          <MobileOrderCard
            key={order.id}
            order={order}
            selectedOrder={selectedOrder}
            setSelectedOrder={setSelectedOrder}
            orderItems={orderItems}
            setOrderItems={setOrderItems}
            addingToOrder={addingToOrder}
            setAddingToOrder={setAddingToOrder}
            addProductSearch={addProductSearch}
            setAddProductSearch={setAddProductSearch}
            updateOrderStatus={updateOrderStatus}
            archiveOrders={archiveOrders}
            deleteOrders={deleteOrders}
            handleAddProductToOrder={handleAddProductToOrder}
            session={session}
            formatPrice={formatPrice}
            fetchData={fetchData}
          />
        ))}
        {paginatedOrders.length === 0 && (
          <div className="bg-white/80 rounded-xl border border-white/80 px-4 py-12 text-center text-gray-600">暂无订单</div>
        )}
      </div>

      <div className="hidden lg:block bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm table-fixed">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-10">
                  <input type="checkbox"
                    checked={selectedOrders.size === paginatedOrders.length && paginatedOrders.length > 0}
                    onChange={e => { setSelectedOrders(e.target.checked ? new Set(paginatedOrders.map(o => o.id)) : new Set()); }}
                    className="w-4 h-4 text-brand-600 rounded border-gray-300" />
                </th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[16%]">订单号</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[22%]">客户</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[20%]">机构</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[13%]">金额</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[12%]">状态</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[11%]">时间</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-700 w-[6%]">操作</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map(order => (
                <OrdersRow
                  key={order.id}
                  order={order}
                  selectedOrder={selectedOrder}
                  setSelectedOrder={setSelectedOrder}
                  selectedOrders={selectedOrders}
                  setSelectedOrders={setSelectedOrders}
                  orderItems={orderItems}
                  setOrderItems={setOrderItems}
                  addingToOrder={addingToOrder}
                  setAddingToOrder={setAddingToOrder}
                  addProductSearch={addProductSearch}
                  setAddProductSearch={setAddProductSearch}
                  updateOrderStatus={updateOrderStatus}
                  archiveOrders={archiveOrders}
                  deleteOrders={deleteOrders}
                  handleAddProductToOrder={handleAddProductToOrder}
                  session={session}
                  formatPrice={formatPrice}
                  fetchData={fetchData}
                />
              ))}
              {paginatedOrders.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-600">暂无订单</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-600">
              显示 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredOrders.length)} / {filteredOrders.length}
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = page <= 3 ? i + 1 : page + i - 2;
                if (p < 1 || p > totalPages) return null;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded text-sm ${p === page ? 'bg-brand-500 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrdersRow({
  order, selectedOrder, setSelectedOrder, selectedOrders, setSelectedOrders,
  orderItems, setOrderItems, addingToOrder, setAddingToOrder, addProductSearch, setAddProductSearch,
  updateOrderStatus, archiveOrders, deleteOrders, handleAddProductToOrder,
  session, formatPrice, fetchData,
}: {
  order: Order;
  selectedOrder: Order | null;
  setSelectedOrder: (o: Order | null) => void;
  selectedOrders: Set<string>;
  setSelectedOrders: (s: Set<string>) => void;
  orderItems: OrderItem[];
  setOrderItems: (i: OrderItem[]) => void;
  addingToOrder: boolean;
  setAddingToOrder: (b: boolean) => void;
  addProductSearch: string;
  setAddProductSearch: (s: string) => void;
  updateOrderStatus: (id: string, s: string) => Promise<string | null>;
  archiveOrders: (ids: string[]) => Promise<void>;
  deleteOrders: (ids: string[]) => Promise<void>;
  handleAddProductToOrder: (p: { name: string; brand: string; catalogNumber: string; price?: number; promotionalPrice?: number }) => Promise<void>;
  session: Session | null;
  formatPrice: (p: number) => string;
  fetchData: () => Promise<void>;
}) {
  const isExpanded = selectedOrder?.id === order.id;

  return (
    <>
      <tr className={`border-b border-gray-100 cursor-pointer ${isExpanded ? 'bg-brand-50/50' : 'hover:bg-gray-50/50'}`}
        onClick={() => setSelectedOrder(isExpanded ? null : order)}>
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selectedOrders.has(order.id)}
            onChange={e => {
              const newSelected = new Set(selectedOrders);
              if (e.target.checked) newSelected.add(order.id);
              else newSelected.delete(order.id);
              setSelectedOrders(newSelected);
            }}
            className="w-4 h-4 text-brand-600 rounded border-gray-300" />
        </td>
        <td className="px-3 py-3 min-w-0">
          <div className="font-mono text-xs text-gray-700 truncate" title={order.id}>{order.id}</div>
        </td>
        <td className="px-3 py-3 min-w-0">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate" title={order.name || order.email}>{order.name || order.email}</div>
            <div className="text-xs text-gray-600 truncate" title={order.email}>{order.email}</div>
          </div>
        </td>
        <td className="px-3 py-3 min-w-0">
          <div className="text-gray-700 truncate" title={order.institution || '-'}>{order.institution || '-'}</div>
          {(order.userDepartment || order.department) && (
            <div className="text-xs text-gray-500 truncate" title={order.userDepartment || order.department}>
              {order.userDepartment || order.department}
            </div>
          )}
        </td>
        <td className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">¥{order.total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
        <td className="px-3 py-3">
          <div className="flex flex-col items-start gap-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_CONFIG[displayedOrderStatus(order)]?.color || 'bg-gray-100 text-gray-700'}`}>
              {(() => { const Ic = ORDER_STATUS_CONFIG[displayedOrderStatus(order)]?.icon; return Ic ? <Ic className="w-3 h-3" /> : null; })()}
              {ORDER_STATUS_CONFIG[displayedOrderStatus(order)]?.label || order.status}
            </span>
            {order.payment && <AlipayPaymentStatusView payment={order.payment} compact />}
          </div>
        </td>
        <td className="px-3 py-3 text-gray-600 text-xs">{new Date(order.createdAt).toLocaleDateString('zh-CN')}</td>
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button onClick={() => archiveOrders([order.id])}
              className="text-purple-600 hover:text-purple-700 text-xs flex items-center gap-1" title="归档">
              <Archive className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => deleteOrders([order.id])}
              className="text-red-600 hover:text-red-700 text-xs flex items-center gap-1" title="删除">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-brand-50/70 p-3 border-b border-brand-200">
            <div className="w-full min-w-0 overflow-hidden">
              <OrderDetailPanel
                order={order}
                orderItems={orderItems}
                setOrderItems={setOrderItems}
                addingToOrder={addingToOrder}
                setAddingToOrder={setAddingToOrder}
                addProductSearch={addProductSearch}
                setAddProductSearch={setAddProductSearch}
                updateOrderStatus={updateOrderStatus}
                handleAddProductToOrder={handleAddProductToOrder}
                session={session}
                formatPrice={formatPrice}
                fetchData={fetchData}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MobileOrderCard({
  order, selectedOrder, setSelectedOrder,
  orderItems, setOrderItems, addingToOrder, setAddingToOrder, addProductSearch, setAddProductSearch,
  updateOrderStatus, archiveOrders, deleteOrders, handleAddProductToOrder,
  session, formatPrice, fetchData,
}: {
  order: Order;
  selectedOrder: Order | null;
  setSelectedOrder: (o: Order | null) => void;
  orderItems: OrderItem[];
  setOrderItems: (i: OrderItem[]) => void;
  addingToOrder: boolean;
  setAddingToOrder: (b: boolean) => void;
  addProductSearch: string;
  setAddProductSearch: (s: string) => void;
  updateOrderStatus: (id: string, s: string) => Promise<string | null>;
  archiveOrders: (ids: string[]) => Promise<void>;
  deleteOrders: (ids: string[]) => Promise<void>;
  handleAddProductToOrder: (p: { name: string; brand: string; catalogNumber: string; price?: number; promotionalPrice?: number }) => Promise<void>;
  session: Session | null;
  formatPrice: (p: number) => string;
  fetchData: () => Promise<void>;
}) {
  const isExpanded = selectedOrder?.id === order.id;
  const status = ORDER_STATUS_CONFIG[displayedOrderStatus(order)];
  const StatusIcon = status?.icon;

  return (
    <div className={`bg-white/85 backdrop-blur-md rounded-xl border shadow-sm overflow-hidden ${isExpanded ? 'border-brand-200' : 'border-white/80'}`}>
      <button
        onClick={() => setSelectedOrder(isExpanded ? null : order)}
        className="w-full text-left p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-gray-600 truncate max-w-[210px]">{order.id}</div>
            <div className="mt-1 font-semibold text-gray-900 truncate max-w-[220px]">{order.name || order.email}</div>
            <div className="mt-0.5 text-xs text-gray-600 truncate max-w-[240px]">{order.email}</div>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${status?.color || 'bg-gray-100 text-gray-700'}`}>
            {StatusIcon && <StatusIcon className="w-3 h-3" />}
            {status?.label || order.status}
          </span>
        </div>
        {order.payment && <div className="mt-2"><AlipayPaymentStatusView payment={order.payment} compact /></div>}

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 items-end">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">机构</div>
            <div className="text-sm text-gray-700 truncate">{order.institution || '-'}</div>
            {(order.userDepartment || order.department) && (
              <div className="text-xs text-gray-500 truncate">{order.userDepartment || order.department}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString('zh-CN')}</div>
            <div className="text-base font-bold text-gray-900">¥{order.total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </button>

      <div className="flex items-center justify-end gap-4 px-4 pb-4">
        <button onClick={() => archiveOrders([order.id])}
          className="text-purple-600 text-sm font-medium flex items-center gap-1">
          <Archive className="w-4 h-4" /> 归档
        </button>
        <button onClick={() => deleteOrders([order.id])}
          className="text-red-600 text-sm font-medium flex items-center gap-1">
          <Trash2 className="w-4 h-4" /> 删除
        </button>
      </div>

      {isExpanded && (
        <div className="p-3 border-t border-brand-100 bg-brand-50/50">
          <OrderDetailPanel
            order={order}
            orderItems={orderItems}
            setOrderItems={setOrderItems}
            addingToOrder={addingToOrder}
            setAddingToOrder={setAddingToOrder}
            addProductSearch={addProductSearch}
            setAddProductSearch={setAddProductSearch}
            updateOrderStatus={updateOrderStatus}
            handleAddProductToOrder={handleAddProductToOrder}
            session={session}
            formatPrice={formatPrice}
            fetchData={fetchData}
          />
        </div>
      )}
    </div>
  );
}

function OrderDetailPanel({
  order, orderItems, setOrderItems, addingToOrder, setAddingToOrder,
  addProductSearch, setAddProductSearch, updateOrderStatus, handleAddProductToOrder,
  session, formatPrice, fetchData,
}: {
  order: Order;
  orderItems: OrderItem[];
  setOrderItems: (i: OrderItem[]) => void;
  addingToOrder: boolean;
  setAddingToOrder: (b: boolean) => void;
  addProductSearch: string;
  setAddProductSearch: (s: string) => void;
  updateOrderStatus: (id: string, s: string) => Promise<string | null>;
  handleAddProductToOrder: (p: { catalogNumber: string; name: string; price?: number; brand: string }) => Promise<void>;
  session: Session | null;
  formatPrice: (p: number) => string;
  fetchData: () => Promise<void>;
}) {
  const [actionError, setActionError] = useState('');
  const [pointsRefundYuan, setPointsRefundYuan] = useState('');
  const [pointsRefundMsg, setPointsRefundMsg] = useState('');
  const [pointsRefundLoading, setPointsRefundLoading] = useState(false);
  const paymentMethodLocked = Boolean(order.paidAt || order.payment?.outTradeNo);

  async function refundPoints() {
    setPointsRefundMsg('');
    const refundYuan = Number(pointsRefundYuan);
    if (!Number.isFinite(refundYuan) || refundYuan <= 0) {
      setPointsRefundMsg('请输入有效退款金额');
      return;
    }
    setPointsRefundLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/points-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refundYuan, reason: '管理员按退款金额退回积分' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPointsRefundMsg(data.error || '退积分失败');
        return;
      }
      setPointsRefundMsg(`已退个人 ${data.personal} 分、课题组 ${data.group} 分`);
      setPointsRefundYuan('');
      await fetchData();
    } catch {
      setPointsRefundMsg('网络错误');
    } finally {
      setPointsRefundLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-brand-300 shadow-sm p-3 sm:p-4 space-y-4 min-w-0 overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
        <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">客户姓名</p><p className="font-medium text-gray-800 break-words">{order.name || order.email}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">邮箱</p><p className="text-sm text-gray-700 break-all">{order.email}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">电话</p><p className="text-sm text-gray-700 break-words">{order.phone || '-'}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">机构</p><p className="text-sm text-gray-700 break-words">{order.institution || '-'}</p></div>
        {order.userDepartment && (
          <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">部门</p><p className="text-sm text-gray-700 break-words">{order.userDepartment}</p></div>
        )}
        {order.department && !order.userDepartment && (
          <div className="min-w-0"><p className="text-xs text-gray-600 mb-1">部门</p><p className="text-sm text-gray-700 break-words">{order.department}</p></div>
        )}
        {order.paymentMethod !== undefined && (
          <div className="min-w-0">
            <p className="text-xs text-gray-600 mb-1">付款方式</p>
            <select value={normalizeOrderPaymentMethod(order.paymentMethod) ?? order.paymentMethod ?? ''}
              disabled={paymentMethodLocked}
              onChange={async e => {
                const newMethod = e.target.value;
                const res = await fetch(`/api/orders/${order.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ paymentMethod: newMethod }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                  setActionError('');
                  fetchData();
                } else {
                  setActionError(orderActionErrorMessage(data.error));
                }
              }}
              className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500">
              <option value="">未选择</option>
              {ORDER_PAYMENT_METHODS.map(method => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
              {order.paymentMethod && normalizeOrderPaymentMethod(order.paymentMethod) === undefined && (
                <option value={order.paymentMethod} disabled>{order.paymentMethod}</option>
              )}
            </select>
            {paymentMethodLocked && <p className="mt-1 text-xs text-gray-500">已经产生支付记录，付款方式已锁定。</p>}
          </div>
        )}
      </div>
      {order.payment && <AlipayPaymentStatusView payment={order.payment} showReferences />}
      {((order.pointsPersonal || 0) > 0 || (order.pointsGroup || 0) > 0) && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
          <p className="text-xs text-gray-600">积分抵扣</p>
          <p className="text-sm text-gray-800">
            个人 {order.pointsPersonal || 0} · 课题组 {order.pointsGroup || 0}
            · 抵扣 {formatPrice(order.pointsDiscount || 0)}
            {order.pointsApplied ? ' · 已扣减' : ' · 未扣减'}
          </p>
          {(order.pointsRefundedPersonal || 0) + (order.pointsRefundedGroup || 0) > 0 && (
            <p className="text-xs text-gray-500">
              已退回 个人 {order.pointsRefundedPersonal || 0} · 课题组 {order.pointsRefundedGroup || 0}
            </p>
          )}
          {order.pointsApplied && (
            <div className="flex flex-col sm:flex-row gap-2 max-w-md">
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={pointsRefundYuan}
                onChange={(e) => setPointsRefundYuan(e.target.value)}
                placeholder="按退款金额退积分"
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={() => void refundPoints()}
                disabled={pointsRefundLoading}
                className="px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg disabled:opacity-50"
              >
                退积分
              </button>
            </div>
          )}
          {pointsRefundMsg && <p className="text-xs text-gray-700">{pointsRefundMsg}</p>}
        </div>
      )}
      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      <div>
        <p className="text-xs text-gray-600 mb-2">状态更新</p>
        <div className="flex flex-wrap gap-2 min-w-0">
          {Object.keys(ORDER_STATUS_CONFIG).filter((s) => (
            order.status === s
            || (isOrderStatus(order.status) && isOrderStatus(s) && canTransitionOrder(order.status, s)
              && !(s === 'closed' && normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay' && order.paidAt))
          )).map(s => (
            <button key={s} onClick={async () => setActionError(await updateOrderStatus(order.id, s) || '')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${order.status === s ? ORDER_STATUS_CONFIG[s].color : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {ORDER_STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-600">订单产品</p>
          <button onClick={() => setAddingToOrder(!addingToOrder)}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700">
            <Plus className="w-3.5 h-3.5" /> 添加产品
          </button>
        </div>
        {addingToOrder && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 min-w-0">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="搜索产品名称、CAS号、品牌..."
                value={addProductSearch} onChange={e => setAddProductSearch(e.target.value)} autoFocus
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full text-gray-900" />
            </div>
            {addProductSearch.trim().length >= 2 && (
              <ProductSearchOverlayForOrder
                query={addProductSearch}
                onClose={() => { setAddingToOrder(false); setAddProductSearch(''); }}
                onAddProduct={handleAddProductToOrder}
              />
            )}
          </div>
        )}
        <div className="border border-gray-200 rounded-lg overflow-hidden min-w-0">
          {(() => {
            try {
              return orderItems.map((item, i) => {
                const name = item.name || item.product?.name || '未知产品';
                const brand = item.brand || item.product?.brand || '';
                const catalogNumber = item.catalogNumber || item.product?.catalogNumber || '';
                const isConfirmed = item.confirmed;
                return (
                  <div key={i} className={`px-3 sm:px-4 py-4 border-b border-gray-100 last:border-0 min-w-0 ${isConfirmed ? 'bg-green-50/30' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${item.isQuickOrder ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-600'}`}>
                        <Package className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-words sm:truncate min-w-0">{name}</p>
                          {isConfirmed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              <Check className="w-3 h-3" /> 已确认
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                              <Clock className="w-3 h-3" /> 待确认
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 break-words">{brand} · {catalogNumber}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
                      <div className="min-w-0">
                        <label className="text-xs text-gray-600 mb-1 block">单价</label>
                        <input type="number" step="0.01" value={item.price || ''}
                          onChange={e => {
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], price: parseFloat(e.target.value) || 0 };
                            setOrderItems(updated);
                          }}
                          onBlur={async e => {
                            const newPrice = parseFloat(e.target.value) || 0;
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], price: newPrice };
                            const res = await fetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) });
                            if (res.ok) fetchData();
                          }}
                          className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
                      </div>
                      <div className="min-w-0">
                        <label className="text-xs text-gray-600 mb-1 block">数量</label>
                        <input type="number" min="1" value={item.quantity || 1}
                          onChange={e => {
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], quantity: parseInt(e.target.value) || 1 };
                            setOrderItems(updated);
                          }}
                          onBlur={async e => {
                            const newQty = parseInt(e.target.value) || 1;
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], quantity: newQty };
                            const res = await fetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) });
                            if (res.ok) fetchData();
                          }}
                          className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
                      </div>
                      <div className="min-w-0">
                        <label className="text-xs text-gray-600 mb-1 block">货期</label>
                        <input type="text" value={item.leadTime || ''}
                          onChange={e => {
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], leadTime: e.target.value };
                            setOrderItems(updated);
                          }}
                          onBlur={async e => {
                            const updated = [...orderItems];
                            updated[i] = { ...updated[i], leadTime: e.target.value };
                            const res = await fetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) });
                            if (res.ok) fetchData();
                          }}
                          placeholder="如：3-5个工作日"
                          className="text-sm px-2 py-1 border border-gray-200 rounded w-full text-gray-900" />
                      </div>
                    </div>
                    <div className="mt-2 text-right"><p className="text-xs text-gray-600">小计 {formatPrice((item.price || 0) * (item.quantity || 1))}</p></div>
                  </div>
                );
              });
            } catch { return <p className="px-4 py-3 text-gray-600 text-sm">无法解析产品数据</p>; }
          })()}
        </div>
      </div>
      <ShipmentPanel order={order} orderItems={orderItems} fetchData={fetchData} />
      <div className="flex flex-wrap justify-between items-center gap-2 pt-4 border-t border-gray-200">
        <span className="text-gray-700 font-medium">订单总计</span>
        <span className="text-xl font-bold text-brand-600">¥{orderItems.reduce((s, it) => s + (it.price||0)*(it.quantity||1), 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="pt-4 border-t border-gray-200">
        {order.quoteSent ? (
          <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
            <Check className="w-5 h-5" />
            <div><p className="text-sm font-medium">订单已确认</p>{order.quoteSentAt && <p className="text-xs text-green-600/70">确认时间：{new Date(order.quoteSentAt).toLocaleString('zh-CN')}</p>}</div>
          </div>
        ) : (
          <button onClick={async () => {
            if (!confirm('确定确认订单并通知客户吗？')) return;
            const patchRes = await fetch(`/api/orders/${order.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: orderItems,
                adminLog: {
                  adminId: session?.user?.id || session?.user?.email || 'admin',
                  adminEmail: session?.user?.email,
                  time: new Date().toISOString(),
                  items: orderItems.map(it => ({ name: it.name, price: it.price, quantity: it.quantity, leadTime: it.leadTime || '' })),
                },
              }),
            });
            if (!patchRes.ok) { alert('保存失败'); return; }
            const res = await fetch(`/api/orders/${order.id}/quote`, { method: 'POST' });
            if (res.ok) fetchData();
            else alert('操作失败');
          }} className="w-full py-3 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700">
            确认订单
          </button>
        )}
      </div>
      <OrderEvents events={order.events} />
      {order.notes && <div><p className="text-xs text-gray-600 mb-1">备注</p><p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{order.notes}</p></div>}
      <div><p className="text-xs text-gray-600 mb-1">下单时间</p><p className="text-sm text-gray-700">{new Date(order.createdAt).toLocaleString('zh-CN')}</p></div>
    </div>
  );

function ShipmentPanel({ order, orderItems, fetchData }: { order: Order; orderItems: OrderItem[]; fetchData: () => Promise<void> }) {
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const canShip = ['confirmed', 'partially_shipped'].includes(order.status);

  const submit = async () => {
    const items = orderItems
      .filter((item): item is OrderItem & { id: string } => Boolean(item.id))
      .map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] || 0 }))
      .filter((item) => item.quantity > 0);
    if (!carrier.trim() || !trackingNumber.trim() || items.length === 0) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'logistics', carrier: carrier.trim(), trackingNumber: trackingNumber.trim(), items }),
      });
      if (response.ok) {
        setCarrier('');
        setTrackingNumber('');
        setQuantities({});
        await fetchData();
      } else {
        const data = await response.json();
        alert(data.error || '发货失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-4 border-t border-gray-200 space-y-3">
      <p className="text-xs text-gray-600 font-medium">发货记录</p>
      {order.shipments?.length ? order.shipments.map((shipment) => (
        <div key={shipment.id} className="text-sm text-gray-700 rounded-lg bg-gray-50 px-3 py-2">
          {shipment.carrier || '物流'} · {shipment.trackingNumber || '-'}
          {shipment.shippedAt && <span className="ml-2 text-xs text-gray-500">{new Date(shipment.shippedAt).toLocaleString('zh-CN')}</span>}
        </div>
      )) : <p className="text-sm text-gray-500">暂未发货</p>}

      {canShip && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="物流公司" className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900" />
            <input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="运单号" className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900" />
          </div>
          <div className="space-y-2">
            {orderItems.filter((item) => item.id && (item.shippedQty || 0) < (item.quantity || 1)).map((item) => {
              const remaining = (item.quantity || 1) - (item.shippedQty || 0);
              return (
                <label key={item.id} className="grid grid-cols-[1fr_88px] gap-3 items-center text-sm">
                  <span className="text-gray-700 truncate">{item.name || '未知产品'} <span className="text-gray-500">剩余 {remaining}</span></span>
                  <input type="number" min="0" max={remaining} value={quantities[item.id!] || 0}
                    onChange={(event) => setQuantities((current) => ({ ...current, [item.id!]: Math.min(remaining, Math.max(0, Number(event.target.value) || 0)) }))}
                    className="px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-900" />
                </label>
              );
            })}
          </div>
          <button onClick={submit} disabled={submitting || !carrier.trim() || !trackingNumber.trim()}
            className="w-full py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
            {submitting ? '提交中' : '创建发货单'}
          </button>
        </div>
      )}
    </div>
  );
}

function OrderEvents({ events }: { events?: Array<{ id: string; type: string; actorEmail?: string; message?: string; createdAt: string }> }) {
  if (!events?.length) return null;
  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <p className="text-xs text-gray-600 mb-2 font-medium">操作日志</p>
      <div className="space-y-2">
        {events.map((event) => (
          <div key={event.id} className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs min-w-0">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-blue-700 mb-1 min-w-0">
              <span className="font-medium break-all">{event.actorEmail || event.type}</span>
              <span className="whitespace-nowrap">{new Date(event.createdAt).toLocaleString('zh-CN')}</span>
            </div>
            {event.message && <div className="text-gray-700 break-words">{event.message}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

}
