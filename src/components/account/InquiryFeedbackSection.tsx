'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { QuoteDeclineDetails } from '@/components/account/DeclineQuoteDialog';
import { quoteIsExpired } from '@/lib/quote-expiry';
import {
  INQUIRY_FEEDBACK_CONTENT_MAX,
  INQUIRY_FEEDBACK_TYPES,
  INQUIRY_FEEDBACK_TYPE_LABELS,
  inquiryFeedbackChannelLabel,
  inquiryFeedbackHandlingStatusLabel,
  inquiryFeedbackTypeLabel,
  type CustomerFeedbackView,
  type InquiryFeedbackType,
} from '@/lib/inquiry-feedback';

type InquiryFeedbackQuoteInfo = {
  id: string;
  version: number;
  status: string;
  validUntil?: string | null;
  declineReasonCode?: string | null;
  declineNote?: string | null;
  declinedAt?: string | Date | null;
  declinedByEmail?: string | null;
};

type InquiryFeedbackSectionProps = {
  inquiryId: string;
  inquiryStatus: string;
  activeQuote?: InquiryFeedbackQuoteInfo | null;
  quoteIsHistorical?: boolean;
  onSubmitted?: () => void;
};

function generateClientRequestId(inquiryId: string): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `fb-${inquiryId}-${randomPart}`;
}

export default function InquiryFeedbackSection(props: InquiryFeedbackSectionProps) {
  return <InquiryFeedbackContent key={props.inquiryId} {...props} />;
}

function InquiryFeedbackContent({
  inquiryId,
  inquiryStatus,
  activeQuote,
  quoteIsHistorical = false,
  onSubmitted,
}: InquiryFeedbackSectionProps) {
  const [feedbacks, setFeedbacks] = useState<CustomerFeedbackView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<InquiryFeedbackType>('price_negotiation');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const requestIdRef = useRef<string>(generateClientRequestId(inquiryId));
  const loadRequest = useRef<AbortController | null>(null);

  const fetchFeedbacks = useCallback(() => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    const { signal } = controller;
    return fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/feedback`, { signal }).then(async (res) => {
      if (signal.aborted) return;
      if (!res.ok) {
        setLoadError('反馈记录加载失败');
        return;
      }
      const data = await res.json() as { feedbacks?: CustomerFeedbackView[] };
      if (signal.aborted) return;
      setFeedbacks(Array.isArray(data.feedbacks) ? data.feedbacks : []);
    }).catch(() => {
      if (!signal.aborted) setLoadError('网络异常，反馈记录加载失败');
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
  }, [inquiryId]);

  useEffect(() => {
    void fetchFeedbacks();
    return () => loadRequest.current?.abort();
  }, [fetchFeedbacks]);

  const canSubmitFeedback = !quoteIsHistorical
    && inquiryStatus === 'quote_sent'
    && activeQuote?.status === 'sent'
    && !quoteIsExpired(activeQuote);

  const hasDeclineDetails = Boolean(activeQuote?.declineReasonCode || activeQuote?.declineNote);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = content.trim();
    if (!trimmed) {
      setSubmitError('请填写具体反馈内容');
      return;
    }
    if (trimmed.length > INQUIRY_FEEDBACK_CONTENT_MAX) {
      setSubmitError(`反馈内容不能超过 ${INQUIRY_FEEDBACK_CONTENT_MAX} 字`);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestIdRef.current,
        },
        body: JSON.stringify({
          feedbackType,
          content: trimmed,
          quoteId: activeQuote?.id ?? null,
          quoteVersion: activeQuote?.version ?? null,
          clientRequestId: requestIdRef.current,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (loadRequest.current?.signal.aborted) return;
      if (!res.ok) {
        setSubmitError(data.error || '提交失败，请稍后重试');
        return;
      }
      setContent('');
      setFormOpen(false);
      setSubmitSuccess('反馈已提交，客服将尽快跟进处理。');
      requestIdRef.current = generateClientRequestId(inquiryId);
      setLoading(true);
      setLoadError('');
      await fetchFeedbacks();
      if (!loadRequest.current?.signal.aborted) onSubmitted?.();
    } catch {
      if (!loadRequest.current?.signal.aborted) setSubmitError('网络异常，请稍后重试');
    } finally {
      if (!loadRequest.current?.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-xl border border-gray-200 bg-white/80 p-4 dark:border-slate-400 dark:bg-slate-200/50"
      onClick={(e) => e.stopPropagation()}
      data-testid="inquiry-feedback-section"
    >
      {hasDeclineDetails && activeQuote && (
        <QuoteDeclineDetails
          reasonCode={activeQuote.declineReasonCode}
          note={activeQuote.declineNote}
          declinedAt={activeQuote.declinedAt}
          declinedByEmail={activeQuote.declinedByEmail}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-brand-600 dark:text-brand-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-900">
            沟通与反馈记录{feedbacks.length > 0 ? `（${feedbacks.length}）` : ''}
          </h3>
        </div>
        {canSubmitFeedback && (
          <button
            type="button"
            data-testid="toggle-feedback-form-button"
            onClick={() => {
              setFormOpen((prev) => !prev);
              setSubmitError('');
              setSubmitSuccess('');
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-500/40 dark:bg-brand-500/20 dark:text-brand-700"
          >
            提出修改 / 留言反馈
            {formOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {submitSuccess && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {submitSuccess}
        </p>
      )}

      {canSubmitFeedback && formOpen && (
        <form
          onSubmit={(e) => { void handleSubmit(e); }}
          className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-500/30 dark:bg-brand-500/10"
          data-testid="customer-feedback-form"
        >
          <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            提交反馈仅作沟通与调整报价，不会直接生成订单。
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-800">
              反馈类型
            </label>
            <select
              value={feedbackType}
              onChange={(e) => {
                setFeedbackType(e.target.value as InquiryFeedbackType);
                setSubmitError('');
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
            >
              {INQUIRY_FEEDBACK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INQUIRY_FEEDBACK_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-800">
              反馈内容（针对报价 v{activeQuote?.version}）
            </label>
            <textarea
              value={content}
              maxLength={INQUIRY_FEEDBACK_CONTENT_MAX}
              rows={3}
              onChange={(e) => {
                setContent(e.target.value);
                setSubmitError('');
              }}
              placeholder="请说明希望调整的价格、货期、数量或需要确认的问题..."
              className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
            />
            <div className="mt-1 text-right text-xs text-gray-400">
              {content.length}/{INQUIRY_FEEDBACK_CONTENT_MAX}
            </div>
          </div>

          {submitError && (
            <p role="alert" className="text-xs text-rose-600">
              {submitError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || content.trim().length === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? '提交中...' : '提交反馈'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-gray-500">正在加载反馈记录...</p>
      ) : loadError ? (
        <p className="text-xs text-rose-600">{loadError}</p>
      ) : feedbacks.length === 0 ? (
        <p className="text-xs text-gray-500">暂无沟通反馈记录。</p>
      ) : (
        <div className="space-y-2">
          {feedbacks.map((item) => {
            const isStaffProxy = item.actorType === 'admin_proxy';
            const sourceLabel = isStaffProxy
              ? `客服代录（来源：${inquiryFeedbackChannelLabel(item.channel)}${item.channelReference ? ` · ${item.channelReference}` : ''}）`
              : '我的反馈（站内）';
            const statusClass = item.handlingStatus === 'resolved'
              ? 'bg-emerald-100 text-emerald-700'
              : item.handlingStatus === 'ignored'
                ? 'bg-gray-100 text-gray-600'
                : 'bg-amber-100 text-amber-800';
            return (
              <div
                key={item.id}
                className="rounded-lg border border-gray-100 bg-gray-50/70 p-3 text-xs dark:border-slate-400/60 dark:bg-slate-100/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-gray-800 dark:text-slate-900">
                      {sourceLabel}
                    </span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                      {inquiryFeedbackTypeLabel(item.feedbackType)}
                    </span>
                    {item.quoteVersion != null && (
                      <span className="rounded bg-gray-200/80 px-1.5 py-0.5 text-[11px] text-gray-700">
                        v{item.quoteVersion}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusClass}`}>
                      {inquiryFeedbackHandlingStatusLabel(item.handlingStatus)}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-slate-900">
                  {item.content}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
