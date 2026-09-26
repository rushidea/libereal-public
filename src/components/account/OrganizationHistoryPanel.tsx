'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, FileText, Info, ReceiptText, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type Receivable = {
  id: string;
  amount: number;
  status: string;
  dueAt: string | null;
  paidAt: string | null;
  overdueDays: number;
  trigger: 'normal' | 'reminder' | 'credit_limited' | 'order_hold';
};

type OrganizationOrder = {
  id: string;
  status: string;
  subtotal: number;
  adjustmentTotal: number;
  total: number;
  paymentMethod: string | null;
  pointsPersonal: number;
  pointsGroup: number;
  pointsGroupId: string | null;
  pointsDiscount: number;
  pointsRefundedPersonal: number;
  pointsRefundedGroup: number;
  researchGroup: { id: string; name: string } | null;
  createdAt: string;
  archivedAt: string | null;
  receivable: Receivable | null;
  canReview: boolean;
};

type OrganizationInquiry = {
  id: string;
  status: string;
  subtotal: number;
  createdAt: string;
  archivedAt: string | null;
};

type HistoryResponse = {
  organization: { id: string; name: string };
  canReviewOrders: boolean;
  payableSummary: {
    totalOutstanding: number;
    maxOverdueDays: number;
    restriction: 'active' | 'credit_limited' | 'overdue_hold';
    policy: { reminderAfterDays: number; limitedAfterDays: number; limitedCreditLimit: number; holdAfterDays: number };
    checkedAt: string;
  };
  orders: OrganizationOrder[];
  inquiries: OrganizationInquiry[];
  payables: Array<Receivable & { orderId: string }>;
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待确认',
    unpaid: '未付款',
    confirmed: '已确认',
    partially_shipped: '部分发货',
    shipped: '已发货',
    completed: '已完成',
    cancelled: '已取消',
    pending_quote: '待报价',
    quote_sent: '已报价',
    closed: '已关闭',
    open: '待回款',
    overdue: '已逾期',
    paid: '已付款',
  };
  return labels[status] || status;
}

type HistoryView = 'orders' | 'inquiries' | 'payables';

export default function OrganizationHistoryPanel({ organizationId, view }: { organizationId: string; view: HistoryView }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState(organizationId ? '' : '缺少组织信息。');
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null);
  const [payablePolicyOpen, setPayablePolicyOpen] = useState(false);
  const payablePolicyTriggerRef = useRef<HTMLButtonElement>(null);
  const payablePolicyDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!payablePolicyOpen) return;
    const trigger = payablePolicyTriggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = payablePolicyDialogRef.current;
      if (event.key === 'Escape') {
        setPayablePolicyOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    payablePolicyDialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [payablePolicyOpen]);

  const reviewOrder = async (orderId: string, status: 'confirmed' | 'cancelled') => {
    setReviewingOrderId(orderId);
    setError('');
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || '订单审核失败');
      setData((current) => current
        ? { ...current, orders: current.orders.map((order) => order.id === orderId ? { ...order, status, canReview: false } : order) }
        : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '订单审核失败');
    } finally {
      setReviewingOrderId(null);
    }
  };

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    fetch(`/api/organizations/${encodeURIComponent(organizationId)}/history`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || '组织历史记录读取失败');
        return body as HistoryResponse;
      })
      .then((body) => {
        if (active) setData(body);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '组织历史记录读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (loading) {
    return <div className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-6 text-sm ${uiSurfaces.mutedText}`}>正在读取组织历史记录…</div>;
  }

  if (error) {
    return (
      <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-6`}>
        <p className={`text-sm ${uiSurfaces.statusError}`} role="alert">{error}</p>
        <Link href="/account/organizations" className={`${uiSurfaces.buttonGhost} mt-4 inline-flex items-center gap-2 text-sm`}><ArrowLeft size={15} />返回组织管理</Link>
      </section>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Building2 className={uiSurfaces.textInteractive} size={22} aria-hidden="true" />
            <div>
              <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{data.organization.name} · 应付款记录</h2>
              <p className={`mt-1 text-sm leading-6 ${uiSurfaces.mutedText}`}>组织端属于客户侧，查看订单应付款、提醒和下单限制。</p>
            </div>
          </div>
          <Link href="/account/organizations" className={`${uiSurfaces.buttonGhost} inline-flex items-center gap-2 text-sm`}><ArrowLeft size={15} />返回组织管理</Link>
        </div>
        <nav className="mt-5 grid gap-2 sm:grid-cols-3" aria-label="组织记录分类">
          <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(organizationId)}&view=orders`} className={`rounded-xl border px-3 py-2 text-sm font-medium ${view === 'orders' ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary-light)]' : `${uiSurfaces.border} ${uiSurfaces.toolbar}`}`}>订单记录</Link>
          <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(organizationId)}&view=inquiries`} className={`rounded-xl border px-3 py-2 text-sm font-medium ${view === 'inquiries' ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary-light)]' : `${uiSurfaces.border} ${uiSurfaces.toolbar}`}`}>询价记录</Link>
          <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(organizationId)}&view=payables`} className={`rounded-xl border px-3 py-2 text-sm font-medium ${view === 'payables' ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary-light)]' : `${uiSurfaces.border} ${uiSurfaces.toolbar}`}`}>应付款记录</Link>
        </nav>
      </section>

      {view === 'orders' && <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
        <div className="flex items-center gap-3">
          <ReceiptText className={uiSurfaces.textInteractive} size={20} aria-hidden="true" />
          <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>组织采购</h2>
        </div>
        {data.orders.length === 0 ? <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>暂无组织采购记录。</p> : (
          <div className="mt-5 space-y-3">
            {data.orders.map((order) => (
              <div key={order.id} className={`rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={`break-all font-mono text-sm ${uiSurfaces.titleText}`}>{order.id}</p>
                    <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{formatDate(order.createdAt)} · {statusLabel(order.status)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <p className={`text-sm font-semibold ${uiSurfaces.textInteractive}`}>{formatPrice(order.total)}</p>
                    {order.canReview && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void reviewOrder(order.id, 'cancelled')} disabled={reviewingOrderId !== null} className={`${uiSurfaces.buttonDanger} text-xs`}>取消订单</button>
                        <button type="button" onClick={() => void reviewOrder(order.id, 'confirmed')} disabled={reviewingOrderId !== null} className={`${uiSurfaces.primaryButton} text-xs`}>{reviewingOrderId === order.id ? '处理中…' : '通过订单'}</button>
                      </div>
                    )}
                  </div>
                </div>
                {order.receivable && <p className={`mt-3 text-xs ${uiSurfaces.mutedText}`}>应付款：{formatPrice(order.receivable.amount)} · {statusLabel(order.receivable.status)} · 到期 {formatDate(order.receivable.dueAt)}</p>}
                {order.pointsDiscount > 0 && (
                  <div className={`mt-3 space-y-1 text-xs ${uiSurfaces.mutedText}`}>
                    <p>积分抵扣：{formatPrice(order.pointsDiscount)}</p>
                    <p>
                      积分来源：
                      {order.pointsPersonal > 0 && `个人 ${formatPoints(order.pointsPersonal)} 分`}
                      {order.pointsPersonal > 0 && order.pointsGroup > 0 && ' + '}
                      {order.pointsGroup > 0 && `课题组「${order.researchGroup?.name || '历史课题组'}」${formatPoints(order.pointsGroup)} 分`}
                    </p>
                    {(order.pointsRefundedPersonal > 0 || order.pointsRefundedGroup > 0) && (
                      <p>
                        已退回：个人 {formatPoints(order.pointsRefundedPersonal)} 分，课题组 {formatPoints(order.pointsRefundedGroup)} 分
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>}

      {view === 'inquiries' && <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
        <div className="flex items-center gap-3">
          <FileText className={uiSurfaces.textInteractive} size={20} aria-hidden="true" />
          <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>组织询价</h2>
        </div>
        {data.inquiries.length === 0 ? <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>暂无组织询价记录。</p> : (
          <div className="mt-5 space-y-3">
            {data.inquiries.map((inquiry) => (
              <div key={inquiry.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4`}>
                <div>
                  <p className={`break-all font-mono text-sm ${uiSurfaces.titleText}`}>{inquiry.id}</p>
                  <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{formatDate(inquiry.createdAt)} · {statusLabel(inquiry.status)}</p>
                </div>
                <p className={`text-sm font-semibold ${uiSurfaces.textInteractive}`}>{formatPrice(inquiry.subtotal)}</p>
              </div>
            ))}
          </div>
        )}
      </section>}

      {view === 'payables' && <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
          <div className="flex items-center gap-3">
            <ReceiptText className={uiSurfaces.textInteractive} size={20} aria-hidden="true" />
            <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>应付款记录</h2>
          </div>
        <div className={`mt-4 rounded-xl border p-4 ${uiSurfaces.border} ${uiSurfaces.toolbar}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className={`text-xs ${uiSurfaces.mutedText}`}>当前组织未结清应付款</p><p className={`mt-1 text-xl font-semibold ${uiSurfaces.titleText}`}>{formatPrice(data.payableSummary.totalOutstanding)}</p></div>
            <span className={`${data.payableSummary.restriction === 'active' ? uiSurfaces.badgeSuccess : uiSurfaces.badgeWarning} text-xs`}>{data.payableSummary.restriction === 'active' ? '正常下单' : data.payableSummary.restriction === 'credit_limited' ? '限额下单' : '限制下单'}</span>
          </div>
          <button ref={payablePolicyTriggerRef} type="button" onClick={() => setPayablePolicyOpen(true)} className={`${uiSurfaces.buttonGhost} mt-4 inline-flex items-center gap-2 text-xs`} aria-haspopup="dialog">
            <Info size={15} aria-hidden="true" />查看应付款规则
          </button>
        </div>
        {data.payables.length === 0 ? <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>暂无应付款记录。</p> : (
          <div className="mt-5 space-y-3">
            {data.payables.map((receivable) => (
              <div key={receivable.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4`}>
                <div>
                  <p className={`break-all font-mono text-sm ${uiSurfaces.titleText}`}>{receivable.orderId}</p>
                  <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{statusLabel(receivable.status)} · 到期 {formatDate(receivable.dueAt)}{receivable.overdueDays >= 0 ? ` · 已超过 ${receivable.overdueDays} 天` : ''}</p>
                </div>
                <p className={`text-sm font-semibold ${uiSurfaces.textInteractive}`}>{formatPrice(receivable.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </section>}

      {payablePolicyOpen && view === 'payables' && (
        <div className={`fixed inset-0 z-site-overlay flex items-end justify-center overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(var(--site-header-height)+var(--site-header-gap)+1rem)] sm:items-center sm:p-6 ${uiSurfaces.modalBackdrop}`} role="presentation">
          <button type="button" aria-label="关闭应付款规则窗口" className="absolute inset-0 cursor-default" onClick={() => setPayablePolicyOpen(false)} />
          <div ref={payablePolicyDialogRef} tabIndex={-1} className={`relative z-10 w-full max-w-md overflow-hidden rounded-t-[var(--brand-border-radius-lg)] sm:rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`} role="dialog" aria-modal="true" aria-labelledby="payable-policy-title" aria-describedby="payable-policy-description">
            <div className="flex items-start gap-3 border-b border-[var(--brand-color-border)] px-5 py-4 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-info-bg)] text-[var(--brand-color-info-text)]" aria-hidden="true">
                <Info size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="payable-policy-title" className={`text-base font-semibold ${uiSurfaces.titleText}`}>应付款规则</h2>
                <p id="payable-policy-description" className={`mt-1 text-sm leading-6 ${uiSurfaces.textSecondary}`}>系统根据未结清订单的逾期天数更新提醒和下单状态。</p>
              </div>
              <button type="button" onClick={() => setPayablePolicyOpen(false)} className={`rounded-full p-2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`} aria-label="关闭应付款规则窗口">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className={`space-y-3 px-5 py-5 text-sm leading-6 ${uiSurfaces.textSecondary} sm:px-6`}>
              <p>超过 {data.payableSummary.policy.reminderAfterDays} 天未付款，将发送付款提醒。</p>
              <p>超过 {data.payableSummary.policy.limitedAfterDays} 天未付款，下单额度上限为 {formatPrice(data.payableSummary.policy.limitedCreditLimit)}。</p>
              <p>超过 {data.payableSummary.policy.holdAfterDays} 天未付款，将限制新订单。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
