'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ShoppingCart, MessageSquare, Users, FlaskConical,
  ArrowRight, Building2, Coins, FileText,
  TrendingUp, AlertTriangle, BarChart3, Wallet,
} from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { DualAxisLineChart, PaymentMethodDonut, InquiryFunnel, ReceivableAgingBar } from '@/components/admin/OperationsCharts';

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">加载中...</div>}>
      <AdminDashboardContent />
    </Suspense>
  );
}

interface User {
  role: string;
  email: string;
  id: string;
}

interface AnalyticsTodo {
  orders: number;
  inquiries: number;
  users: number;
  community: number;
  organizations: number;
  overdueOrders: number;
  overdueInquiries: number;
}

interface AnalyticsKpi {
  revenueToday: number;
  cancelledToday: number;
  newCustomersMonth: number;
  pendingOrders: number;
  pendingInquiries: number;
}

interface RevenuePoint {
  date: string;
  label: string;
  amount: number;
}

interface OrderStatusSlice {
  status: string;
  label: string;
  count: number;
}

interface Revenue30dPoint {
  date: string;
  label: string;
  revenue: number;
  orderCount: number;
}

interface PaymentMethodSlice {
  method: string;
  label: string;
  amount: number;
  count: number;
}

interface InquiryFunnel {
  inquiries: number;
  quoted: number;
  ordered: number;
  completed: number;
  quotedRate: number;
  orderedRate: number;
  completedRate: number;
}

interface ReceivableAgingSlice {
  key: string;
  label: string;
  amount: number;
  count: number;
}

interface ActivityItem {
  id: string;
  kind: string;
  action: string;
  title: string;
  actorEmail: string | null;
  message: string;
  createdAt: string;
}

interface AnalyticsResponse {
  todo: AnalyticsTodo;
  kpi: AnalyticsKpi;
  insights?: {
    revenueWeek: RevenuePoint[];
    orderStatus: OrderStatusSlice[];
    revenue30d: Revenue30dPoint[];
    paymentMethod: PaymentMethodSlice[];
    inquiryFunnel: InquiryFunnel;
    receivableAging: ReceivableAgingSlice[];
    receivableAgingTotal: number;
  };
  receivable?: { count: number; totalAmount: number; overdueCount: number };
  activity?: ActivityItem[];
  generatedAt: string;
}

function AdminDashboardContent() {
  const { data: session, status } = useSession();
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (status !== 'authenticated' || (session?.user as User)?.role !== 'admin') return;
    fetch('/api/admin/access?view=current')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Forbidden')))
      .then((data) => {
        const allowed = Array.isArray(data.permissions) ? data.permissions : [];
        setPermissions(allowed);
        return fetchAnalytics();
      })
      .catch(() => { setPageError(true); setLoading(false); });
  }, [status, session]);

  async function fetchAnalytics() {
    setLoading(true);
    setPageError(false);
    setAnalyticsError(false);
    try {
      const res = await fetch('/api/admin/analytics', { cache: 'no-store' });
      if (!res.ok) throw new Error('analytics failed');
      const data = await res.json();
      setAnalytics(data);
    } catch (e) {
      console.error(e);
      setAnalyticsError(true);
    } finally {
      setLoading(false);
    }
  }

  if (status === 'unauthenticated') notFound();
  if (status === 'authenticated' && (session?.user as User)?.role !== 'admin') notFound();

  if (pageError) {
    return (
      <div className={`rounded-2xl p-8 text-center ${uiSurfaces.panelStrong}`}>
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">后台权限服务暂时无法使用</h2>
        <p className="text-gray-500 mb-6">请稍后重新加载页面</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-block bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-xl font-medium"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (analyticsError) {
    return (
      <div className={`rounded-2xl p-8 text-center ${uiSurfaces.panelStrong}`}>
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">数据加载失败</h2>
        <p className="text-gray-500 mb-6">统计数据暂时无法获取，请稍后重试</p>
        <button
          type="button"
          onClick={fetchAnalytics}
          className="inline-block bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-xl font-medium"
        >
          重新加载
        </button>
      </div>
    );
  }

  const todo = analytics?.todo;
  const kpi = analytics?.kpi;
  const can = (p: string) => permissions.includes(p);

  const todoItems = [
    { key: 'orders', label: '待处理订单', count: todo?.orders ?? 0, overdue: todo?.overdueOrders ?? 0, href: '/admin/orders', permission: 'orders.read', icon: <ShoppingCart className="w-5 h-5" /> },
    { key: 'inquiries', label: '待报价询价', count: todo?.inquiries ?? 0, overdue: todo?.overdueInquiries ?? 0, href: '/admin/inquiries', permission: 'inquiries.read', icon: <MessageSquare className="w-5 h-5" /> },
    { key: 'users', label: '待审核用户', count: todo?.users ?? 0, overdue: 0, href: '/admin/users', permission: 'customers.read', icon: <Users className="w-5 h-5" /> },
    { key: 'community', label: '待审社区', count: todo?.community ?? 0, overdue: 0, href: '/admin/community', permission: 'content.read', icon: <FlaskConical className="w-5 h-5" /> },
    { key: 'organizations', label: '待审组织', count: todo?.organizations ?? 0, overdue: 0, href: '/admin/organizations', permission: 'organizations.read', icon: <Building2 className="w-5 h-5" /> },
  ].filter((i) => can(i.permission));

  const kpiItems = [
    { label: '今日营业额', value: `¥${(kpi?.revenueToday ?? 0).toLocaleString('zh-CN')}`, hint: (kpi?.cancelledToday ?? 0) > 0 ? `含取消 ¥${(kpi?.cancelledToday ?? 0).toLocaleString('zh-CN')}` : null, danger: false, permission: 'orders.read', icon: <TrendingUp className="w-5 h-5" /> },
    { label: '本月新客户', value: `${(kpi?.newCustomersMonth ?? 0).toLocaleString('zh-CN')}`, hint: null, danger: false, permission: 'customers.read', icon: <Users className="w-5 h-5" /> },
    { label: '待处理订单', value: `${(kpi?.pendingOrders ?? 0).toLocaleString('zh-CN')}`, hint: (todo?.overdueOrders ?? 0) > 0 ? `${todo?.overdueOrders} 笔超时` : null, danger: (todo?.overdueOrders ?? 0) > 0, permission: 'orders.read', icon: <ShoppingCart className="w-5 h-5" /> },
    { label: '待报价询价', value: `${(kpi?.pendingInquiries ?? 0).toLocaleString('zh-CN')}`, hint: (todo?.overdueInquiries ?? 0) > 0 ? `${todo?.overdueInquiries} 笔超时` : null, danger: (todo?.overdueInquiries ?? 0) > 0, permission: 'inquiries.read', icon: <MessageSquare className="w-5 h-5" /> },
  ].filter((k) => can(k.permission));

  const syncTime = analytics?.generatedAt
    ? new Date(analytics.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-brand-600" /> 管理工作台
        </h1>
        {syncTime && (
          <span className={`text-xs ${uiSurfaces.mutedText}`}>数据更新于 {syncTime}</span>
        )}
      </div>

      {/* 今日待处理 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">今日待处理</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {todoItems.map((item) => (
            <TodoCard
              key={item.key}
              label={item.label}
              count={item.count}
              overdue={item.overdue}
              href={item.href}
              icon={item.icon}
            />
          ))}
          {todoItems.length === 0 && (
            <p className={`col-span-full text-sm ${uiSurfaces.mutedText}`}>当前账号暂无待处理事项权限。</p>
          )}
        </div>
      </section>

      {/* 经营概览 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">经营概览</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {kpiItems.map((item) => (
            <KpiCard
              key={item.label}
              label={item.label}
              value={item.value}
              hint={item.hint}
              danger={item.danger}
              icon={item.icon}
            />
          ))}
        </div>
      </section>

      {/* 数据洞察 */}
      {analytics?.insights && can('orders.read') && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">数据洞察</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            <DualAxisLineChart data={analytics.insights.revenue30d} className="lg:col-span-2" />
            <OrderStatusChart data={analytics.insights.orderStatus} />
            {can('finance.read') && analytics.insights.paymentMethod && (
              <PaymentMethodDonut data={analytics.insights.paymentMethod} />
            )}
            {can('inquiries.read') && analytics.insights.inquiryFunnel && (
              <InquiryFunnel data={analytics.insights.inquiryFunnel} />
            )}
            {can('finance.read') ? (
              analytics.insights.receivableAging && (
                <ReceivableAgingBar data={analytics.insights.receivableAging} total={analytics.insights.receivableAgingTotal} />
              )
            ) : (
              <RevenueChart data={analytics.insights.revenueWeek} />
            )}
          </div>
        </section>
      )}

      {/* 最近动态 */}
      {analytics?.activity && analytics.activity.length > 0 && can('audit.read') && (
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">最近动态</h2>
          <div className={`rounded-xl p-4 sm:rounded-2xl divide-y divide-gray-100 ${uiSurfaces.panel}`}>
            {analytics.activity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  item.kind === 'order' ? 'bg-brand-50 text-brand-600' : item.kind === 'payment' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {item.kind === 'order' ? <ShoppingCart className="w-4 h-4" /> : item.kind === 'payment' ? <Coins className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {item.actorEmail ?? '系统'} · {item.message}
                  </p>
                </div>
                <time className="text-[11px] text-gray-400 flex-shrink-0">
                  {new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── 数据洞察：近 7 天营业额折线（内联 SVG，不引外部图表库）──
function RevenueChart({ data, className }: { data: RevenuePoint[]; className?: string }) {
  const W = 560;
  const H = 200;
  const PAD = { top: 20, right: 16, bottom: 28, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const max = Math.max(...data.map((d) => d.amount), 1);
  // 向上取整到 10 的幂（100/1000/10000…），保证刻度友好
  const pow = Math.pow(10, Math.max(Math.ceil(Math.log10(max)), 0));
  const niceMax = max <= 1 ? 1 : Math.ceil(max / pow) * pow;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const y = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;

  const points = data.map((d, i) => `${(PAD.left + i * stepX).toFixed(1)},${y(d.amount).toFixed(1)}`);
  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => ({
      y: PAD.top + innerH - f * innerH,
      label: Math.round(niceMax * f),
    }))
    // niceMax=1 时 0.25/0.5/0.75 的 label 都是 0，只保留 0 和 1
    .filter((g, i, arr) => !(niceMax === 1 && i > 0 && i < arr.length - 1));

  const hasData = data.some((d) => d.amount > 0);
  const last = data[data.length - 1];

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">近 7 天营业额</h3>
        {last && (
          <span className="text-xs text-gray-500">
            今日 <b className="text-brand-600">¥{last.amount.toLocaleString('zh-CN')}</b>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="近 7 天营业额折线图">
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{g.label}</text>
          </g>
        ))}
        {hasData ? (
          <>
            <polyline points={points.join(' ')} fill="none" stroke="var(--color-brand-500, #0d9488)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {data.map((d, i) => (
              <g key={d.date}>
                <circle cx={PAD.left + i * stepX} cy={y(d.amount)} r="3.5" fill="var(--color-brand-500, #0d9488)" />
                <text x={PAD.left + i * stepX} y={H - 8} textAnchor="middle" fontSize="10" fill="#9ca3af">{d.label}</text>
              </g>
            ))}
          </>
        ) : (
          <>
            <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} stroke="#e5e7eb" strokeWidth="1.5" />
            {data.map((d, i) => (
              <text key={d.date} x={PAD.left + i * stepX} y={H - 8} textAnchor="middle" fontSize="10" fill="#9ca3af">{d.label}</text>
            ))}
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="#9ca3af">近 7 天暂无订单数据</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ── 数据洞察：订单状态环形图（内联 SVG，不引外部图表库）──
const STATUS_COLORS = ['#0d9488', '#0284c7', '#d97706', '#7c3aed', '#dc2626', '#64748b'];

function OrderStatusChart({ data, className }: { data: OrderStatusSlice[]; className?: string }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const R = 44;
  const CX = 60;
  const CY = 60;
  const C = 2 * Math.PI * R;

  const arcs = data.map((d, i) => {
    const frac = total > 0 ? d.count / total : 0;
    const dash = frac * C;
    const prior = data.slice(0, i).reduce((sum, item) => sum + (total > 0 ? item.count / total : 0), 0);
    const offset = -prior * C;
    return { ...d, color: STATUS_COLORS[i % STATUS_COLORS.length], dash, offset };
  });

  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel} ${className ?? ''}`}>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">订单状态分布</h3>
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 120 120" className="w-28 h-28" role="img" aria-label="订单状态分布环形图">
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
            {total > 0 && arcs.map((a) => (
              <circle
                key={a.status}
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth="16"
                strokeDasharray={`${Math.max(a.dash - 1.5, 0)} ${C - Math.max(a.dash - 1.5, 0)}`}
                strokeDashoffset={a.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <b className="text-lg text-gray-900 leading-none">{total}</b>
            <span className="text-[10px] text-gray-500 mt-0.5">全部订单</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {total === 0 && <li className="text-xs text-gray-500">暂无订单数据</li>}
          {arcs.map((a) => (
            <li key={a.status} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
              <span className="text-gray-600 truncate">{a.label}</span>
              <span className="ml-auto font-semibold text-gray-800">{a.count}</span>
              <span className="text-gray-400 w-9 text-right">{total > 0 ? Math.round((a.count / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TodoCard({ label, count, overdue, href, icon }: { label: string; count: number; overdue: number; href: string; icon: React.ReactNode }) {
  const hasOverdue = overdue > 0;
  return (
    <Link
      href={href}
      className={`rounded-xl p-4 sm:rounded-2xl flex flex-col gap-2 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        hasOverdue ? 'border border-red-300 bg-red-50/40' : uiSurfaces.panel
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          hasOverdue ? 'bg-red-100 text-red-600' : 'bg-brand-50 text-brand-600'
        }`}>{icon}</div>
        {hasOverdue && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white text-[11px] font-bold px-2 py-0.5">
            <AlertTriangle className="w-3 h-3" /> 超时 {overdue}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 leading-none">{count}</p>
      <p className="text-xs text-gray-600">{label}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600">
        去处理 <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </Link>
  );
}

function KpiCard({ label, value, hint, danger, icon }: { label: string; value: string; hint: string | null; danger: boolean; icon: React.ReactNode }) {  return (
    <div className={`rounded-xl p-4 sm:rounded-2xl ${uiSurfaces.panel}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={danger ? 'text-red-500' : 'text-brand-600'}>{icon}</span>
        <span className="text-xs font-semibold text-gray-600">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-red-500 mt-0.5">{hint}</p>}
    </div>
  );
}
