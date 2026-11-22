'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  FileText,
  Filter,
  MessageSquare,
  Package,
} from 'lucide-react';
import { InquiryIdDisplay } from '@/components/InquiryIdDisplay';
import { QuoteDeclineDetails } from '@/components/account/DeclineQuoteDialog';
import {
  AdminFeedbackHandlingCard,
  AdminProxyFeedbackCard,
  type FeedbackQuoteOption,
} from '@/components/admin/AdminInquiryFeedbackPanel';
import { CatalogRepricingReview } from '@/components/admin/CatalogRepricingReview';
import { SupplierQuoteReview, type SupplierQuoteEntry } from '@/components/admin/SupplierQuoteReview';
import { ADMIN_INQUIRY_TODO_STATUSES, notifyAdminInquiryTodoChanged } from '@/lib/admin-inquiry-todo';
import {
  TIMELINE_CATEGORY_LABELS,
  buildAdminInquiryTimeline,
  buildCurrentActionAlert,
  buildInquiryProgressSteps,
  formatDateTimeSafe,
  resolveEditableInquiryItems,
  type AdminInquiryItem,
  type AdminInquiryRecord,
  type ProgressStepStatus,
  type TimelineCategory,
  type TimelineEvent,
  type TimelineEventTone,
  type TimelineSortOrder,
} from '@/lib/admin-inquiry-timeline';
import { commerceLineWarningList, commerceLineWarningPrompt } from '@/lib/commerce-line-review';
import type { AdminFeedbackView } from '@/lib/inquiry-feedback';
import { QUOTE_STATUS_LABELS } from '@/lib/quote-records';
import { effectiveInquiryStatus } from '@/lib/quote-expiry';

export interface AdminInquiryTimelineWorkspaceProps {
  inquiry: AdminInquiryRecord;
  fetchData: (options?: { silent?: boolean }) => Promise<void>;
}

const INQUIRY_STATUS_LABELS: Record<string, string> = {
  closed: '已关闭',
  declined: '已放弃',
  pending_quote: '待报价',
  quote_expired: '已过期',
  quote_sent: '已发报价',
  待确认: '待确认',
  待人工审核: '待人工审核',
};

const TONE_DOT_CLASSES: Record<TimelineEventTone, string> = {
  neutral: 'bg-gray-400',
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

const TONE_BADGE_CLASSES: Record<TimelineEventTone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-rose-100 text-rose-700',
};

const STEP_STATUS_STYLES: Record<ProgressStepStatus, { card: string; badge: string }> = {
  completed: {
    card: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    badge: 'bg-emerald-600 text-white',
  },
  current: {
    card: 'border-blue-300 bg-blue-50/80 text-blue-950',
    badge: 'bg-blue-600 text-white',
  },
  attention: {
    card: 'border-amber-300 bg-amber-50/90 text-amber-950',
    badge: 'bg-amber-500 text-white',
  },
  skipped: {
    card: 'border-gray-200 bg-gray-50 text-gray-600',
    badge: 'bg-gray-300 text-gray-700',
  },
  pending: {
    card: 'border-gray-200 bg-white text-gray-600',
    badge: 'bg-gray-200 text-gray-600',
  },
};

function isOrderRevisionLine(item: AdminInquiryItem): boolean {
  if (!item.metadata) return false;
  try {
    return typeof (JSON.parse(item.metadata) as Record<string, unknown>).repricingOrderId === 'string';
  } catch {
    return false;
  }
}

export function AdminInquiryTimelineWorkspace({
  inquiry,
  fetchData,
}: AdminInquiryTimelineWorkspaceProps) {
  const paymentSelectId = useId();
  const addressInputId = useId();
  const notesInputId = useId();

  // Auxiliary fetches per inquiry expansion
  const [feedbacks, setFeedbacks] = useState<AdminFeedbackView[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  const [supplierEntries, setSupplierEntries] = useState<SupplierQuoteEntry[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(true);
  const [supplierError, setSupplierError] = useState('');
  const feedbackRequest = useRef<AbortController | null>(null);
  const supplierRequest = useRef<AbortController | null>(null);

  // Timeline view state
  const [sortOrder, setSortOrder] = useState<TimelineSortOrder>('desc');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TimelineCategory>('all');
  const [viewPreset, setViewPreset] = useState<'smart' | 'all_open' | 'all_closed'>('smart');
  const [expandOverrides, setExpandOverrides] = useState<Record<string, boolean>>({});
  const [mobileTab, setMobileTab] = useState<'timeline' | 'action'>('timeline');

  // Metadata drawer state (split address/notes drafts from paymentMethod so changing paymentMethod never clears unsaved text)
  const [metaDrawerOpen, setMetaDrawerOpen] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaNotice, setMetaNotice] = useState('');
  const [metaError, setMetaError] = useState('');
  const textMetaKey = `${inquiry.id}\0${inquiry.address ?? ''}\0${inquiry.notes ?? ''}`;
  const [textDrafts, setTextDrafts] = useState<{
    key: string;
    address: string;
    notes: string;
  } | null>(null);
  const currentTextDrafts = textDrafts && textDrafts.key === textMetaKey
    ? textDrafts
    : {
        key: textMetaKey,
        address: inquiry.address ?? '',
        notes: inquiry.notes ?? '',
      };
  const paymentMetaKey = `${inquiry.id}\0${inquiry.paymentMethod ?? ''}`;
  const [paymentDraft, setPaymentDraft] = useState<{ key: string; value: string } | null>(null);
  const currentPaymentMethod = paymentDraft && paymentDraft.key === paymentMetaKey
    ? paymentDraft.value
    : (inquiry.paymentMethod ?? '');

  // Quote item edits state (preserved across mobile tab switches and non-quote refreshes)
  const serverItemsKey = useMemo(() => JSON.stringify({
    id: inquiry.id,
    activeQuoteId: inquiry.activeQuote?.id ?? null,
    activeQuoteVersion: inquiry.activeQuote?.version ?? null,
    activeQuoteStatus: inquiry.activeQuote?.status ?? null,
    activeQuoteHash: inquiry.activeQuote?.contentHash ?? null,
    items: inquiry.items.map((item) => ({
      id: item.id ?? null,
      price: item.price ?? null,
      quantity: item.quantity ?? null,
      leadTime: item.leadTime ?? null,
    })),
  }), [inquiry]);
  const [itemEdits, setItemEdits] = useState<{ key: string; items: AdminInquiryItem[] } | null>(null);
  const inquiryItems = itemEdits && itemEdits.key === serverItemsKey
    ? itemEdits.items
    : resolveEditableInquiryItems(inquiry);

  const setInquiryItems = useCallback((updated: AdminInquiryItem[]) => {
    setItemEdits({ key: serverItemsKey, items: updated });
  }, [serverItemsKey]);

  const loadFeedbacks = useCallback(() => {
    feedbackRequest.current?.abort();
    const controller = new AbortController();
    feedbackRequest.current = controller;
    const { signal } = controller;
    return fetch(`/api/inquiries/${encodeURIComponent(inquiry.id)}/feedback`, { signal }).then(async (res) => {
      if (signal.aborted) return;
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: unknown } | null;
        if (signal.aborted) return;
        const msg = errBody && typeof errBody === 'object' && !Array.isArray(errBody) && typeof errBody.error === 'string'
          ? errBody.error
          : '加载客户反馈失败';
        setFeedbackError(msg);
        return;
      }
      const data = await res.json().catch(() => null);
      if (signal.aborted) return;
      if (Array.isArray(data)) {
        setFeedbacks([]);
        setFeedbackLoaded(true);
        return;
      }
      if (data && typeof data === 'object') {
        const rows = Array.isArray((data as { feedbacks?: unknown }).feedbacks)
          ? (data as { feedbacks: AdminFeedbackView[] }).feedbacks
          : [];
        setFeedbacks(rows);
        setFeedbackLoaded(true);
        return;
      }
      setFeedbacks([]);
      setFeedbackLoaded(true);
    }).catch(() => {
      if (!signal.aborted) setFeedbackError('网络异常，加载客户反馈失败');
    }).finally(() => {
      if (!signal.aborted) setFeedbackLoading(false);
    });
  }, [inquiry.id]);

  const loadSupplierEntries = useCallback((signal: AbortSignal) => {
    return fetch(`/api/inquiries/${encodeURIComponent(inquiry.id)}/supplier-quote`, { signal }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (signal.aborted) return;
      if (!res.ok) {
        const msg = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : '未能读取供应商询价记录';
        throw new Error(msg);
      }
      if (Array.isArray(body)) {
        setSupplierEntries([]);
        return;
      }
      if (body && typeof body === 'object' && Array.isArray((body as { entries?: unknown }).entries)) {
        setSupplierEntries((body as { entries: SupplierQuoteEntry[] }).entries);
        return;
      }
      throw new Error('未取得有效的供应商询价记录，请刷新后重试');
    }).catch((err) => {
      if (!signal.aborted) setSupplierError(err instanceof Error ? err.message : '未能读取供应商询价记录');
    }).finally(() => {
      if (!signal.aborted) setSupplierLoading(false);
    });
  }, [inquiry.id]);

  useEffect(() => {
    const controller = new AbortController();
    supplierRequest.current = controller;
    void loadFeedbacks();
    void loadSupplierEntries(controller.signal);
    return () => {
      feedbackRequest.current?.abort();
      controller.abort();
    };
  }, [loadFeedbacks, loadSupplierEntries]);

  const handleFeedbackUpdated = useCallback(async () => {
    if (feedbackRequest.current?.signal.aborted) return;
    setFeedbackLoading(true);
    setFeedbackError('');
    const loadingFeedback = loadFeedbacks();
    const request = feedbackRequest.current;
    await loadingFeedback;
    if (!request?.signal.aborted) await fetchData({ silent: true });
  }, [loadFeedbacks, fetchData]);

  function handleSupplierEntriesChange(entries: SupplierQuoteEntry[]) {
    if (feedbackRequest.current?.signal.aborted) return;
    supplierRequest.current?.abort();
    setSupplierEntries(entries);
    setSupplierLoading(false);
    setSupplierError('');
  }

  const handleSupplierRecorded = useCallback(async () => {
    if (!feedbackRequest.current?.signal.aborted) await fetchData({ silent: true });
  }, [fetchData]);

  const timelineEvents = useMemo(
    () => buildAdminInquiryTimeline({ inquiry, supplierEntries, feedbacks, sortOrder }),
    [inquiry, supplierEntries, feedbacks, sortOrder],
  );

  const visibleEvents = useMemo(
    () => (categoryFilter === 'all' ? timelineEvents : timelineEvents.filter((event) => event.category === categoryFilter)),
    [timelineEvents, categoryFilter],
  );

  const progressSteps = useMemo(
    () => buildInquiryProgressSteps({ inquiry, supplierEntries, feedbacks }),
    [inquiry, supplierEntries, feedbacks],
  );

  const actionAlert = useMemo(
    () => buildCurrentActionAlert({ inquiry, supplierEntries, feedbacks }),
    [inquiry, supplierEntries, feedbacks],
  );

  const shownStatus = effectiveInquiryStatus(inquiry.status, inquiry.activeQuote);
  const pendingFeedbackCount = feedbackLoaded
    ? feedbacks.filter((fb) => fb.handlingStatus === 'pending').length
    : (inquiry.feedbackSummary?.pendingCount ?? 0);

  const quoteOptions: FeedbackQuoteOption[] = useMemo(() => {
    const map = new Map<string, FeedbackQuoteOption>();
    for (const q of inquiry.quoteVersions ?? []) {
      map.set(q.id, { id: q.id, version: q.version, status: q.status });
    }
    if (inquiry.activeQuote && !map.has(inquiry.activeQuote.id)) {
      map.set(inquiry.activeQuote.id, {
        id: inquiry.activeQuote.id,
        version: inquiry.activeQuote.version,
        status: inquiry.activeQuote.status,
      });
    }
    return Array.from(map.values());
  }, [inquiry.quoteVersions, inquiry.activeQuote]);

  const catalogDraft = inquiry.activeQuote?.status === 'draft' && inquiry.activeQuote.catalogRepricing
    ? inquiry.activeQuote
    : null;
  const remaining = catalogDraft?.items.filter((item) => !isOrderRevisionLine(item) && item.available !== false) ?? [];
  const pendingOrderReview = Boolean(
    catalogDraft?.items.some((item) => isOrderRevisionLine(item) && item.available !== false),
  );
  const hasOrderedLine = Boolean(
    inquiry.activeQuote?.status === 'accepted'
    || inquiry.activeQuote?.items?.some((item) => (item.orderedQty ?? 0) > 0),
  );
  const canEditQuantity = !catalogDraft
    && inquiry.status !== 'declined'
    && inquiry.status !== 'closed'
    && !hasOrderedLine;

  const inquiryTotal = inquiryItems.reduce((sum, item) => {
    const price = item.price || 0;
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);

  const actionTabNeedsAttention = Boolean(
    actionAlert?.target === 'action'
    || pendingOrderReview
    || supplierError
    || supplierEntries.some((entry) => Boolean(entry.error) || entry.status !== 'succeeded'),
  );

  function isEventExpanded(event: TimelineEvent): boolean {
    if (event.id in expandOverrides) return expandOverrides[event.id];
    if (viewPreset === 'all_open') return true;
    if (viewPreset === 'all_closed') return false;
    return event.defaultExpanded;
  }

  function toggleEventExpanded(event: TimelineEvent) {
    const current = isEventExpanded(event);
    setExpandOverrides((prev) => ({ ...prev, [event.id]: !current }));
  }

  function handleStepClick(category: TimelineCategory) {
    setCategoryFilter((prev) => (prev === category ? 'all' : category));
    setMobileTab('timeline');
  }

  function handleAlertJump() {
    if (!actionAlert) return;
    if (actionAlert.target === 'timeline') {
      if (actionAlert.filterCategory) setCategoryFilter(actionAlert.filterCategory);
      setViewPreset('smart');
      setExpandOverrides({});
      setMobileTab('timeline');
    } else {
      setMobileTab('action');
    }
  }

  async function handlePaymentMethodChange(newMethod: string) {
    setPaymentDraft({ key: paymentMetaKey, value: newMethod });
    setSavingMeta(true);
    setMetaError('');
    setMetaNotice('');
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiry.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: newMethod }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setPaymentDraft(null);
        setMetaError(body.error || '付款方式保存失败');
        return;
      }
      setMetaNotice('付款方式已保存');
      await fetchData({ silent: true });
      setPaymentDraft(null);
    } catch {
      setPaymentDraft(null);
      setMetaError('网络异常，付款方式保存失败');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleSaveAddressAndNotes() {
    setSavingMeta(true);
    setMetaError('');
    setMetaNotice('');
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiry.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: currentTextDrafts.address, notes: currentTextDrafts.notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setMetaError(body.error || '保存地址与备注失败');
        return;
      }
      setTextDrafts(null);
      setMetaNotice('地址与备注已保存');
      await fetchData({ silent: true });
    } catch {
      setMetaError('网络异常，保存失败');
    } finally {
      setSavingMeta(false);
    }
  }

  const categoryTabs: { key: 'all' | TimelineCategory; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'inquiry', label: TIMELINE_CATEGORY_LABELS.inquiry },
    { key: 'supplier', label: TIMELINE_CATEGORY_LABELS.supplier },
    { key: 'quote', label: TIMELINE_CATEGORY_LABELS.quote },
    { key: 'feedback', label: TIMELINE_CATEGORY_LABELS.feedback },
  ];

  return (
    <div className="min-w-0 bg-white rounded-xl border border-brand-300 shadow-sm p-3 sm:p-5 space-y-4">
      {/* 1. 顶部档案头 */}
      <div className="min-w-0 border-b border-gray-200 pb-4 space-y-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <InquiryIdDisplay id={inquiry.id} className="text-gray-900" />
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                shownStatus === 'closed' || shownStatus === 'declined'
                  ? 'bg-gray-100 text-gray-700'
                  : shownStatus === 'quote_expired'
                    ? 'bg-amber-100 text-amber-800'
                    : shownStatus === 'quote_sent'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-yellow-100 text-yellow-800'
              }`}>
                {INQUIRY_STATUS_LABELS[shownStatus] ?? shownStatus}
              </span>
              {pendingFeedbackCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
                  待处理反馈 {pendingFeedbackCount}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              提交时间：{formatDateTimeSafe(inquiry.createdAt)}
            </p>
          </div>

          <button
            type="button"
            aria-expanded={metaDrawerOpen}
            onClick={() => {
              setMetaDrawerOpen((prev) => !prev);
              setMetaNotice('');
              setMetaError('');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            <Edit3 className="w-3.5 h-3.5" />
            编辑资料 / 付款方式 / 地址 / 备注
          </button>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1.5 text-xs text-gray-700 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 break-words">
            <span className="text-gray-500">客户：</span>
            <span className="font-medium text-gray-900 break-all">{inquiry.name}</span>
          </div>
          <div className="min-w-0 break-all">
            <span className="text-gray-500">邮箱：</span>
            <span>{inquiry.email}</span>
          </div>
          <div className="min-w-0 break-all">
            <span className="text-gray-500">电话：</span>
            <span>{inquiry.phone}</span>
          </div>
          <div className="min-w-0 break-all">
            <span className="text-gray-500">机构：</span>
            <span>{inquiry.institution}{inquiry.department ? ` · ${inquiry.department}` : ''}</span>
          </div>
          {inquiry.paymentMethod !== undefined && (
            <div className="min-w-0 break-words">
              <span className="text-gray-500">付款方式：</span>
              <span>{inquiry.paymentMethod || '未选择'}</span>
            </div>
          )}
          {inquiry.address && (
            <div className="min-w-0 sm:col-span-2 xl:col-span-2 break-all">
              <span className="text-gray-500">通讯地址：</span>
              <span>{inquiry.address}</span>
            </div>
          )}
          {inquiry.notes && (
            <div className="min-w-0 sm:col-span-2 xl:col-span-4 truncate" title={inquiry.notes}>
              <span className="text-gray-500">备注预览：</span>
              <span>{inquiry.notes}</span>
            </div>
          )}
        </div>

        {metaDrawerOpen && (
          <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-3">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              {inquiry.paymentMethod !== undefined && (
                <div className="min-w-0">
                  <label htmlFor={paymentSelectId} className="text-xs text-gray-600 mb-1 block">
                    付款方式
                  </label>
                  <select
                    id={paymentSelectId}
                    disabled={savingMeta}
                    value={currentPaymentMethod}
                    onChange={(e) => { void handlePaymentMethodChange(e.target.value); }}
                    className="text-sm px-2.5 py-1.5 border border-gray-200 bg-white rounded w-full min-w-0 text-gray-900"
                  >
                    <option value="">未选择</option>
                    <option value="对公转账">对公转账</option>
                    <option value="锐竞平台">锐竞平台</option>
                    <option value="喀斯玛平台">喀斯玛平台</option>
                    <option value="支付宝">支付宝</option>
                  </select>
                </div>
              )}
              <div className={inquiry.paymentMethod !== undefined ? 'min-w-0' : 'min-w-0 sm:col-span-2'}>
                <label htmlFor={addressInputId} className="text-xs text-gray-600 mb-1 block">
                  通讯地址
                </label>
                <input
                  id={addressInputId}
                  type="text"
                  disabled={savingMeta}
                  value={currentTextDrafts.address}
                  onChange={(e) => setTextDrafts({
                    key: textMetaKey,
                    address: e.target.value,
                    notes: currentTextDrafts.notes,
                  })}
                  className="text-sm px-2.5 py-1.5 border border-gray-200 bg-white rounded w-full min-w-0 text-gray-900"
                />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor={notesInputId} className="text-xs text-gray-600 mb-1 block">
                  备注
                </label>
                <textarea
                  id={notesInputId}
                  rows={2}
                  disabled={savingMeta}
                  value={currentTextDrafts.notes}
                  onChange={(e) => setTextDrafts({
                    key: textMetaKey,
                    address: currentTextDrafts.address,
                    notes: e.target.value,
                  })}
                  className="text-sm px-2.5 py-1.5 border border-gray-200 bg-white rounded w-full min-w-0 text-gray-900"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                {metaError && <span className="text-rose-600">{metaError}</span>}
                {metaNotice && <span className="text-emerald-700">{metaNotice}</span>}
              </div>
              <button
                type="button"
                disabled={savingMeta}
                onClick={() => { void handleSaveAddressAndNotes(); }}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {savingMeta ? '保存中...' : '保存地址与备注'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. 移动端单行待办提醒条 */}
      {actionAlert && (
        <div
          className={`xl:hidden flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
            actionAlert.level === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-950'
              : 'border-blue-200 bg-blue-50 text-blue-950'
          }`}
        >
          <span className="min-w-0 font-medium truncate">{actionAlert.title}</span>
          <button
            type="button"
            onClick={handleAlertJump}
            className="shrink-0 rounded bg-white px-2.5 py-1 font-medium shadow-xs border border-current/20"
          >
            {actionAlert.actionLabel}
          </button>
        </div>
      )}

      {/* 3. 4步进度条 */}
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="询价进度条">
        {progressSteps.map((step, idx) => {
          const isActiveFilter = categoryFilter === step.category;
          const style = STEP_STATUS_STYLES[step.status];
          return (
            <button
              key={step.key}
              type="button"
              aria-pressed={isActiveFilter}
              onClick={() => handleStepClick(step.category)}
              className={`flex min-w-0 flex-col items-start rounded-lg border p-2.5 text-left transition ${style.card} ${
                isActiveFilter ? 'ring-2 ring-brand-500 ring-offset-1' : 'hover:opacity-90'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${style.badge}`}>
                    {idx + 1}
                  </span>
                  {step.label}
                </span>
                {step.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                {step.status === 'attention' && <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                {step.status === 'current' && <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
              </div>
              <span className="mt-1 w-full truncate text-[11px] opacity-80">{step.subtitle}</span>
            </button>
          );
        })}
      </div>

      {/* 4. 移动端分段切换 */}
      <div className="xl:hidden grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          aria-pressed={mobileTab === 'timeline'}
          onClick={() => setMobileTab('timeline')}
          className={`rounded-md px-3 py-2 text-xs font-medium transition ${
            mobileTab === 'timeline'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          时间线 ({timelineEvents.length})
        </button>
        <button
          type="button"
          aria-pressed={mobileTab === 'action'}
          onClick={() => setMobileTab('action')}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition ${
            mobileTab === 'action'
              ? 'bg-white text-gray-900 shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>报价与操作</span>
          {actionTabNeedsAttention && (
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" aria-label="有待办操作" />
          )}
        </button>
      </div>

      {/* 5. 统一双栏工作区（两栏始终挂载，移动端通过 hidden xl:block 切换） */}
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-12">
        {/* 左栏 · 统一询价时间线 */}
        <section
          aria-label="统一询价时间线"
          data-testid="admin-inquiry-feedback-panel"
          className={mobileTab === 'timeline'
            ? 'block min-w-0 space-y-3 xl:col-span-7'
            : 'hidden min-w-0 xl:block space-y-3 xl:col-span-7'}
        >
          <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  询价全流程时间线（{visibleEvents.length} 条）
                </h3>
              </div>
              <div className="inline-flex items-center rounded-md border border-gray-200 bg-white p-0.5 text-xs">
                <ArrowDownUp className="w-3.5 h-3.5 text-gray-400 mx-1.5" />
                <button
                  type="button"
                  aria-pressed={sortOrder === 'desc'}
                  onClick={() => setSortOrder('desc')}
                  className={`rounded px-2 py-1 font-medium ${
                    sortOrder === 'desc' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  最新在前
                </button>
                <button
                  type="button"
                  aria-pressed={sortOrder === 'asc'}
                  onClick={() => setSortOrder('asc')}
                  className={`rounded px-2 py-1 font-medium ${
                    sortOrder === 'asc' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  从早到晚
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                {categoryTabs.map((tab) => {
                  const active = categoryFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (tab.key === 'all') {
                          setCategoryFilter('all');
                        } else {
                          setCategoryFilter((prev) => (prev === tab.key ? 'all' : tab.key));
                        }
                      }}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        active
                          ? 'bg-brand-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  aria-pressed={viewPreset === 'smart' && Object.keys(expandOverrides).length === 0}
                  onClick={() => {
                    setViewPreset('smart');
                    setExpandOverrides({});
                  }}
                  className={`rounded border px-2 py-1 ${
                    viewPreset === 'smart' && Object.keys(expandOverrides).length === 0
                      ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  仅看重点
                </button>
                <button
                  type="button"
                  aria-pressed={viewPreset === 'all_open' && Object.keys(expandOverrides).length === 0}
                  onClick={() => {
                    setViewPreset('all_open');
                    setExpandOverrides({});
                  }}
                  className={`rounded border px-2 py-1 ${
                    viewPreset === 'all_open' && Object.keys(expandOverrides).length === 0
                      ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  全部展开
                </button>
                <button
                  type="button"
                  aria-pressed={viewPreset === 'all_closed' && Object.keys(expandOverrides).length === 0}
                  onClick={() => {
                    setViewPreset('all_closed');
                    setExpandOverrides({});
                  }}
                  className={`rounded border px-2 py-1 ${
                    viewPreset === 'all_closed' && Object.keys(expandOverrides).length === 0
                      ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  全部折叠
                </button>
              </div>
            </div>
          </div>

          {(feedbackLoading || supplierLoading) && (
            <p className="text-xs text-gray-500" role="status">正在同步供应商核价与客户反馈…</p>
          )}
          {feedbackError && (
            <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              {feedbackError}
            </p>
          )}

          {visibleEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-xs text-gray-500">
              当前筛选条件下暂无时间线事件。
            </div>
          ) : (
            <div
              data-testid="timeline-event-list"
              className="relative ml-2 min-w-0 border-l-2 border-gray-200 pl-4 sm:pl-5 space-y-3"
            >
              {visibleEvents.map((event) => {
                const expanded = isEventExpanded(event);
                return (
                  <article
                    key={event.id}
                    data-testid={`timeline-event-${event.id}`}
                    data-event-type={event.type}
                    className="relative min-w-0 rounded-lg border border-gray-200 bg-white shadow-2xs"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[23px] sm:-left-[27px] top-4 h-3 w-3 rounded-full ring-2 ring-white ${TONE_DOT_CLASSES[event.tone]}`}
                    />
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleEventExpanded(event)}
                      className="flex w-full min-w-0 items-start justify-between gap-2 p-3 text-left hover:bg-gray-50/70 rounded-lg"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="text-gray-400 tabular-nums">
                            {formatDateTimeSafe(event.timestamp)}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                            {TIMELINE_CATEGORY_LABELS[event.category]}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE_BADGE_CLASSES[event.tone]}`}>
                            {event.statusLabel}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 break-words break-all">{event.title}</p>
                        <p className="text-xs text-gray-600 line-clamp-2 break-all">{event.summary}</p>
                      </div>
                      <span className="mt-1 shrink-0 text-gray-400">
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </span>
                    </button>

                    {expanded && (
                      <div className="min-w-0 border-t border-gray-100 px-3 pb-3 pt-2.5">
                        <TimelineEventBody
                          event={event}
                          inquiryId={inquiry.id}
                          quoteOptions={quoteOptions}
                          onFeedbackUpdated={handleFeedbackUpdated}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 右栏 · 常驻待办与报价操作台 */}
        <aside
          aria-label="报价与操作台"
          className={mobileTab === 'action'
            ? 'block min-w-0 space-y-4 xl:col-span-5 xl:sticky xl:top-4 xl:self-start'
            : 'hidden min-w-0 xl:block space-y-4 xl:col-span-5 xl:sticky xl:top-4 xl:self-start'}
        >
          {actionAlert && (
            <div
              className={`min-w-0 rounded-lg border p-3 text-xs space-y-1.5 ${
                actionAlert.level === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-950'
                  : 'border-blue-200 bg-blue-50 text-blue-950'
              }`}
            >
              <p className="font-semibold text-sm break-words">{actionAlert.title}</p>
              <p className="opacity-90 leading-relaxed break-words">{actionAlert.description}</p>
              {actionAlert.target === 'timeline' && (
                <button
                  type="button"
                  onClick={handleAlertJump}
                  className="mt-1 inline-flex items-center rounded border border-current/25 bg-white px-2.5 py-1 font-medium hover:bg-gray-50"
                >
                  {actionAlert.actionLabel}
                </button>
              )}
            </div>
          )}

          <SupplierQuoteReview
            key={`supplier-quote-${inquiry.id}`}
            inquiryId={inquiry.id}
            entries={supplierEntries}
            loading={supplierLoading}
            error={supplierError}
            onEntriesChange={handleSupplierEntriesChange}
            onRecorded={handleSupplierRecorded}
            compactWhenComplete
            compactLayout
          />

          {catalogDraft && (
            <div className="min-w-0 space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <span className="min-w-0 text-xs text-gray-700">
                  目录价、折扣或客户条件变化后，可在本询价重新核算并查看新版草稿。
                </span>
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  onClick={async () => {
                    const response = await fetch(`/api/inquiries/${inquiry.id}/quote`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        refreshCatalogQuote: true,
                        catalogQuoteId: catalogDraft.id,
                        catalogQuoteHash: catalogDraft.contentHash,
                      }),
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || data.result?.status !== 'draft') {
                      alert(data.error || '未取得新版草稿，请核对后重试');
                      return;
                    }
                    await fetchData();
                  }}
                >
                  重新核算并预览
                </button>
              </div>
            </div>
          )}

          {inquiry.activeQuote?.status === 'draft' && (
            <CatalogRepricingReview
              inquiryId={inquiry.id}
              quote={inquiry.activeQuote}
              onRecorded={fetchData}
            />
          )}

          {catalogDraft && remaining.length > 0 && (
            <section className="min-w-0 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="font-semibold text-gray-900">
                重新核算后的待报价明细 · 第 {catalogDraft.version} 版
              </h3>
              {remaining.map((line, index) => (
                <div key={index} className="min-w-0 rounded border border-blue-100 bg-white p-2.5 text-xs space-y-1">
                  <p className="font-medium text-gray-900 break-words">
                    {line.name} × {line.quantity} · 单价 ¥{Number(line.price).toFixed(2)} · 金额 ¥{(Number(line.price) * Number(line.quantity)).toFixed(2)}
                  </p>
                  <p className="text-gray-600 break-words">
                    货期：{line.leadTime || '未记录'}；供货条件：{line.notes || '未记录'}
                  </p>
                </div>
              ))}
              <button
                type="button"
                disabled={pendingOrderReview}
                className="w-full rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={async () => {
                  if (!confirm(`确认将当前显示的第 ${catalogDraft.version} 版重算报价发送给客户？`)) return;
                  const send = (confirmWarnings = false) => fetch(`/api/inquiries/${inquiry.id}/quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      catalogQuoteId: catalogDraft.id,
                      catalogQuoteHash: catalogDraft.contentHash,
                      confirmWarnings,
                    }),
                  });
                  let response = await send();
                  let data = await response.json().catch(() => ({}));
                  const warnings = commerceLineWarningList(data);
                  if (response.status === 409 && warnings?.length) {
                    if (!confirm(commerceLineWarningPrompt(warnings, '发送当前这版报价'))) return;
                    response = await send(true);
                    data = await response.json().catch(() => ({}));
                  }
                  if (!response.ok) {
                    alert(data.error || '发送失败');
                    return;
                  }
                  await fetchData();
                  alert('重算报价已提交发送');
                }}
              >
                {pendingOrderReview ? '请先完成原订单价格复核' : '确认并发送这版重算报价'}
              </button>
            </section>
          )}

          {!catalogDraft && (
            <section className="min-w-0 rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">报价明细编辑与发送</h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  询价产品（可直接编辑价格{canEditQuantity ? '、数量' : ''}和货期）
                </p>
              </div>

              <div className="min-w-0 rounded-lg border border-gray-200 bg-white overflow-hidden">
                {inquiryItems.length === 0 ? (
                  <p className="p-3 text-xs text-gray-500">当前无产品明细。</p>
                ) : inquiryItems.map((item, i) => {
                  const name = item.name || item.product?.name || '未知产品';
                  const brand = item.brand || item.product?.brand || '';
                  const catalogNumber = item.catalogNumber || item.product?.catalogNumber || '';
                  const qty = item.quantity || 1;
                  const priceInputId = `quote-item-price-${inquiry.id}-${i}`;
                  const qtyInputId = `quote-item-qty-${inquiry.id}-${i}`;
                  const leadTimeInputId = `quote-item-lead-${inquiry.id}-${i}`;

                  return (
                    <div key={item.id ?? i} className="min-w-0 px-3 py-3 border-b border-gray-100 last:border-0 space-y-2">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="w-7 h-7 rounded flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
                          <Package className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-all">{name}</p>
                          <p className="text-xs text-gray-600 break-all">{[brand, catalogNumber].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      </div>
                      <div className="grid min-w-0 grid-cols-3 gap-2">
                        <div className="min-w-0">
                          <label htmlFor={priceInputId} className="text-xs text-gray-600 mb-1 block">单价</label>
                          <input
                            id={priceInputId}
                            type="number"
                            step="0.01"
                            value={item.price ?? ''}
                            onChange={(e) => {
                              const updated = [...inquiryItems];
                              updated[i] = { ...updated[i], price: parseFloat(e.target.value) || 0 };
                              setInquiryItems(updated);
                            }}
                            className="text-sm px-2 py-1 border border-gray-200 rounded w-full min-w-0 text-gray-900"
                          />
                        </div>
                        <div className="min-w-0">
                          {canEditQuantity ? (
                            <>
                              <label htmlFor={qtyInputId} className="text-xs text-gray-600 mb-1 block">数量</label>
                              <input
                                id={qtyInputId}
                                type="number"
                                min={1}
                                step={1}
                                value={qty}
                                onChange={(e) => {
                                  const parsed = parseInt(e.target.value, 10);
                                  const updated = [...inquiryItems];
                                  updated[i] = { ...updated[i], quantity: Number.isInteger(parsed) && parsed > 0 ? parsed : 1 };
                                  setInquiryItems(updated);
                                }}
                                className="text-sm px-2 py-1 border border-gray-200 rounded w-full min-w-0 text-gray-900"
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-gray-600 mb-1 block">数量</span>
                              <p className="text-sm px-2 py-1 text-gray-700">{qty}</p>
                            </>
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs text-gray-600 mb-1 block">客户期望</span>
                          <p className="text-sm px-2 py-1 text-gray-700 break-all">
                            {item.customerLeadTime || '不限'}
                          </p>
                        </div>
                        <div className="min-w-0 col-span-3">
                          <label htmlFor={leadTimeInputId} className="text-xs text-gray-600 mb-1 block">实际货期</label>
                          <input
                            id={leadTimeInputId}
                            type="text"
                            value={item.actualLeadTime || item.leadTime || ''}
                            onChange={(e) => {
                              const updated = [...inquiryItems];
                              updated[i] = { ...updated[i], actualLeadTime: e.target.value, leadTime: e.target.value };
                              setInquiryItems(updated);
                            }}
                            placeholder="如：28天"
                            className="text-sm px-2 py-1 border border-gray-200 rounded w-full min-w-0 text-gray-900"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                <span className="text-sm text-gray-700 font-medium">询价总计</span>
                <span className="text-lg font-bold text-brand-600">
                  ¥{inquiryTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!confirm('确定提交报价单给客户吗？')) return;
                  const alreadyRecorded = inquiry.hasUnresolvedPricing !== true
                    && Boolean(inquiry.operationLogs)
                    && inquiry.operationLogs !== '[]'
                    && inquiry.operationLogs !== '';
                  const wasAwaitingQuote = (ADMIN_INQUIRY_TODO_STATUSES as readonly string[]).includes(inquiry.status)
                    && inquiry.activeQuote?.status !== 'sent'
                    && inquiry.activeQuote?.status !== 'accepted'
                    && !alreadyRecorded;
                  const quoteRes = await fetch(`/api/inquiries/${inquiry.id}/quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: inquiryItems }),
                  });
                  if (!quoteRes.ok) {
                    const err = await quoteRes.json().catch(() => ({}));
                    alert('提交失败：' + (err.error || '未知错误'));
                    return;
                  }
                  setItemEdits(null);
                  notifyAdminInquiryTodoChanged(wasAwaitingQuote ? -1 : undefined);
                  await fetchData();
                  alert('报价已提交');
                }}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
              >
                提交报价
              </button>
            </section>
          )}

          <AdminProxyFeedbackCard
            key={`proxy-feedback-${inquiry.id}`}
            inquiryId={inquiry.id}
            inquiryStatus={inquiry.status}
            activeQuote={inquiry.activeQuote}
            onCreated={handleFeedbackUpdated}
            compact
          />
        </aside>
      </div>
    </div>
  );
}

function TimelineEventBody({
  event,
  inquiryId,
  quoteOptions,
  onFeedbackUpdated,
}: {
  event: TimelineEvent;
  inquiryId: string;
  quoteOptions: FeedbackQuoteOption[];
  onFeedbackUpdated: () => Promise<void>;
}) {
  switch (event.type) {
    case 'inquiry_created': {
      const { inquiry } = event;
      return (
        <div className="min-w-0 space-y-2.5 text-xs">
          {inquiry.items.length === 0 ? (
            <p className="text-gray-500">提交时无明细条目。</p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {inquiry.items.map((item, idx) => {
                const name = item.name || item.product?.name || '未知产品';
                const brand = item.brand || item.product?.brand || '';
                const catalog = item.catalogNumber || item.product?.catalogNumber || '';
                return (
                  <div key={item.id ?? idx} className="min-w-0 rounded border border-gray-100 bg-gray-50/80 p-2.5 space-y-1">
                    <p className="font-medium text-gray-900 break-all">{name}</p>
                    <p className="text-gray-600 break-all">
                      {[brand, catalog].filter(Boolean).join(' · ') || '未指定品牌/货号'}
                      {item.spec ? ` · ${item.spec}` : ''}
                    </p>
                    <p className="text-gray-700 break-words">
                      数量：{item.quantity ?? 1}{item.unit ? ` ${item.unit}` : ''} · 期望货期：<span className="break-all">{item.customerLeadTime || '不限'}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {inquiry.notes && (
            <div className="min-w-0 rounded border border-gray-100 bg-gray-50 px-2.5 py-2 text-gray-700 whitespace-pre-wrap break-words">
              <span className="font-medium text-gray-800">初始备注：</span>
              {inquiry.notes}
            </div>
          )}
        </div>
      );
    }

    case 'supplier_quote_prepared': {
      const { entry } = event;
      if (entry.error) {
        return <p className="text-xs text-rose-700 break-words">{entry.error}</p>;
      }
      return (
        <div className="min-w-0 space-y-1.5 text-xs text-gray-700">
          {entry.scope && (
            <p className="font-medium text-gray-900 break-all">
              {entry.scope.brand} · {entry.scope.catalogNumber} · {entry.scope.quantity} 包（目录价 ¥{entry.scope.cataloguePrice.toFixed(2)}）
            </p>
          )}
          <p className="break-words">
            状态：{event.statusLabel} · 负责人：<span className="break-all">{entry.owner || '未指派'}</span>
            {entry.requestedAt ? ` · 准备时间：${formatDateTimeSafe(entry.requestedAt)}` : ''}
          </p>
          {entry.reviewId && entry.status === 'awaiting_human' && (
            <Link
              className="inline-flex items-center gap-1 text-brand-600 underline"
              href={`/admin/business-letters?reviewId=${encodeURIComponent(entry.reviewId)}&reference=${encodeURIComponent(inquiryId)}`}
            >
              <FileText className="w-3.5 h-3.5" />
              选用模板准备询价函
            </Link>
          )}
        </div>
      );
    }

    case 'supplier_quote_replied': {
      const { reply } = event;
      return (
        <div className="min-w-0 space-y-1.5 text-xs text-gray-700">
          <p className="font-medium text-gray-900 break-all">
            供应商：{reply.supplier} · 渠道：{reply.channel} · 依据：{reply.reference}
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
            <p className="min-w-0">供应商单价：¥{reply.supplierUnitPrice.toFixed(2)}（{reply.taxBasis === 'included' ? '含税' : '未税'}）</p>
            <p className="min-w-0">本次客户单价：¥{reply.customerUnitPrice.toFixed(2)}</p>
            <p className="min-w-0 break-all">确认货期：{reply.leadTime}</p>
            <p className="min-w-0">有效期至：{formatDateTimeSafe(reply.validUntil)}</p>
          </div>
          <p className="break-all">
            <span className="font-medium text-gray-800">对客户供货条件：</span>
            {reply.customerConditions}
          </p>
          <p className="rounded bg-amber-50/70 px-2 py-1 text-amber-950 break-all">
            <span className="font-medium">内部供货与付款条件：</span>
            {reply.conditions}
          </p>
        </div>
      );
    }

    case 'quote_version': {
      const { quote, effectiveStatus, operationLog } = event;
      const statusText = QUOTE_STATUS_LABELS[effectiveStatus] ?? effectiveStatus;
      return (
        <div className="min-w-0 space-y-2.5 text-xs">
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 rounded bg-gray-50 p-2 text-gray-700">
            <div className="min-w-0">
              <span className="text-gray-500 block">状态</span>
              <span className="font-medium text-gray-900">{statusText}</span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 block">总额</span>
              <span className="font-medium text-gray-900">
                ¥{quote.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 block">发出时间</span>
              <span>{formatDateTimeSafe(quote.sentAt)}</span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 block">有效期</span>
              <span>{formatDateTimeSafe(quote.validUntil)}</span>
            </div>
          </div>

          {quote.items?.length > 0 && (
            <div className="min-w-0 space-y-1.5">
              {quote.items.map((line, idx) => {
                const qty = line.quantity ?? 1;
                const price = Number(line.price ?? 0);
                const lineTotal = line.lineTotal ?? price * qty;
                return (
                  <div
                    key={line.id ?? idx}
                    className="min-w-0 rounded border border-gray-100 bg-gray-50/60 p-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 break-all">
                        {line.name || '未知产品'}
                        {line.catalogNumber ? <span className="text-gray-500 font-normal"> · {line.catalogNumber}</span> : null}
                      </p>
                      <p className="text-gray-600 break-all">
                        货期：{line.leadTime || '未记录'}
                        {line.notes ? ` · 条件：${line.notes}` : ''}
                        {(line.orderedQty ?? 0) > 0 ? ` · 已下单 ${line.orderedQty}/${qty}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-gray-800 sm:text-right">
                      <p>¥{price.toFixed(2)} × {qty}</p>
                      <p className="font-semibold">¥{Number(lineTotal).toFixed(2)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {operationLog && (
            <div className="min-w-0 rounded border border-blue-100 bg-blue-50/70 p-2.5 space-y-1">
              <div className="flex flex-wrap justify-between gap-2 text-blue-800">
                <span className="font-medium break-all">
                  报价操作记录：{operationLog.adminEmail || operationLog.adminId || '管理员'}
                </span>
                <span>{formatDateTimeSafe(operationLog.time)}</span>
              </div>
              {operationLog.items?.map((it, idx) => (
                <div key={idx} className="text-gray-700 break-all">
                  · {it.name} | 单价: {it.price != null ? `¥${it.price}` : '未定价'} | 数量: {it.quantity} | 货期: {it.leadTime || '-'}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'quote_operation_log': {
      const { log } = event;
      return (
        <div className="min-w-0 rounded border border-blue-100 bg-blue-50/70 p-2.5 text-xs space-y-1">
          <div className="flex flex-wrap justify-between gap-2 text-blue-800">
            <span className="font-medium break-all">{log.adminEmail || log.adminId || '管理员'}</span>
            <span>{formatDateTimeSafe(log.time)}</span>
          </div>
          {log.items?.map((it, idx) => (
            <div key={idx} className="text-gray-700 break-all">
              · {it.name} | 单价: {it.price != null ? `¥${it.price}` : '未定价'} | 数量: {it.quantity} | 货期: {it.leadTime || '-'}
            </div>
          ))}
        </div>
      );
    }

    case 'customer_feedback':
      return (
        <AdminFeedbackHandlingCard
          inquiryId={inquiryId}
          feedback={event.feedback}
          quoteVersions={quoteOptions}
          onUpdated={onFeedbackUpdated}
          embedded
        />
      );

    case 'quote_declined':
      return (
        <QuoteDeclineDetails
          reasonCode={event.declineReasonCode}
          note={event.declineNote}
          declinedAt={event.declinedAt}
          declinedByEmail={event.declinedByEmail}
        />
      );
  }
}
