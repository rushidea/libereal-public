'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import {
  ADMIN_PROXY_FEEDBACK_CHANNELS,
  INQUIRY_FEEDBACK_CHANNEL_LABELS,
  INQUIRY_FEEDBACK_CHANNEL_REF_MAX,
  INQUIRY_FEEDBACK_CONTENT_MAX,
  INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX,
  INQUIRY_FEEDBACK_TYPES,
  INQUIRY_FEEDBACK_TYPE_LABELS,
  inquiryFeedbackChannelLabel,
  inquiryFeedbackHandlingStatusLabel,
  inquiryFeedbackTypeLabel,
  type AdminFeedbackView,
  type AdminProxyFeedbackChannel,
  type InquiryFeedbackHandlingStatus,
  type InquiryFeedbackType,
} from '@/lib/inquiry-feedback';

type QuoteOption = {
  id: string;
  version: number;
  status: string;
};

type AdminInquiryFeedbackPanelProps = {
  inquiryId: string;
  inquiryStatus: string;
  activeQuote?: { id: string; version: number; status: string } | null;
  quoteVersions?: QuoteOption[];
  onUpdated?: () => void;
};

function generateProxyRequestId(inquiryId: string): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `proxy-fb-${inquiryId}-${randomPart}`;
}

export function AdminInquiryFeedbackPanel({
  inquiryId,
  inquiryStatus,
  activeQuote,
  quoteVersions = [],
  onUpdated,
}: AdminInquiryFeedbackPanelProps) {
  const [feedbacks, setFeedbacks] = useState<AdminFeedbackView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Proxy recording form
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyChannel, setProxyChannel] = useState<AdminProxyFeedbackChannel>('wechat');
  const [proxyChannelRef, setProxyChannelRef] = useState('');
  const [proxyType, setProxyType] = useState<InquiryFeedbackType>('price_negotiation');
  const [proxyContent, setProxyContent] = useState('');
  const [proxySubmitting, setProxySubmitting] = useState(false);
  const [proxyError, setProxyError] = useState('');
  const proxyRequestIdRef = useRef<string>(generateProxyRequestId(inquiryId));

  // Per-item resolution editing state
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [resolvedQuoteById, setResolvedQuoteById] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchFeedbacks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/feedback`);
      if (!res.ok) {
        setError('加载客户反馈失败');
        return;
      }
      const data = await res.json() as { feedbacks?: AdminFeedbackView[] };
      const rows = Array.isArray(data.feedbacks) ? data.feedbacks : [];
      setFeedbacks(rows);
      setNotesById((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!(row.id in next)) next[row.id] = row.resolutionNote ?? '';
        }
        return next;
      });
      setResolvedQuoteById((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!(row.id in next)) next[row.id] = row.resolvedByQuoteId ?? '';
        }
        return next;
      });
    } catch {
      setError('网络异常，加载客户反馈失败');
    } finally {
      setLoading(false);
    }
  }, [inquiryId]);

  useEffect(() => {
    void fetchFeedbacks();
  }, [fetchFeedbacks]);

  const canProxyRecord = inquiryStatus !== 'declined' && inquiryStatus !== 'closed';
  const pendingCount = feedbacks.filter((f) => f.handlingStatus === 'pending').length;

  async function handleProxySubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedRef = proxyChannelRef.trim();
    const trimmedContent = proxyContent.trim();
    if (!trimmedRef) {
      setProxyError('请填写外部渠道来源依据（如微信对话时间、邮件主题等）');
      return;
    }
    if (!trimmedContent) {
      setProxyError('请填写客户反馈内容');
      return;
    }
    setProxySubmitting(true);
    setProxyError('');
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': proxyRequestIdRef.current,
        },
        body: JSON.stringify({
          channel: proxyChannel,
          channelReference: trimmedRef,
          feedbackType: proxyType,
          content: trimmedContent,
          quoteId: activeQuote?.status === 'sent' ? activeQuote.id : undefined,
          quoteVersion: activeQuote?.status === 'sent' ? activeQuote.version : undefined,
          clientRequestId: proxyRequestIdRef.current,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setProxyError(data.error || '代录失败');
        return;
      }
      setProxyChannelRef('');
      setProxyContent('');
      setProxyOpen(false);
      proxyRequestIdRef.current = generateProxyRequestId(inquiryId);
      await fetchFeedbacks();
      onUpdated?.();
    } catch {
      setProxyError('网络异常，代录失败');
    } finally {
      setProxySubmitting(false);
    }
  }

  async function handleStatusUpdate(feedbackId: string, handlingStatus: InquiryFeedbackHandlingStatus) {
    setSavingId(feedbackId);
    try {
      const resolutionNote = (notesById[feedbackId] ?? '').trim();
      const resolvedByQuoteId = (resolvedQuoteById[feedbackId] ?? '').trim();
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/feedback`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackId,
          handlingStatus,
          resolutionNote: resolutionNote || null,
          resolvedByQuoteId: resolvedByQuoteId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        alert(data.error || '更新处理状态失败');
        return;
      }
      await fetchFeedbacks();
      onUpdated?.();
    } catch {
      alert('网络异常，更新失败');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="border-t border-gray-200 pt-4 space-y-3" data-testid="admin-inquiry-feedback-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-brand-600" />
          <p className="text-xs font-semibold text-gray-800">
            客户反馈与沟通记录（共 {feedbacks.length} 条{pendingCount > 0 ? ` · ${pendingCount} 条待处理` : ''}）
          </p>
        </div>
        {canProxyRecord && (
          <button
            type="button"
            onClick={() => {
              setProxyOpen((prev) => !prev);
              setProxyError('');
            }}
            className="inline-flex items-center gap-1 rounded border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
          >
            <Plus className="w-3.5 h-3.5" />
            {proxyOpen ? '收起代录表单' : '代录外部渠道反馈'}
          </button>
        )}
      </div>

      {canProxyRecord && proxyOpen && (
        <form
          onSubmit={(e) => { void handleProxySubmit(e); }}
          className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2.5 text-xs"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-medium text-gray-700">外部渠道（必填）</label>
              <select
                value={proxyChannel}
                onChange={(e) => setProxyChannel(e.target.value as AdminProxyFeedbackChannel)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900"
              >
                {ADMIN_PROXY_FEEDBACK_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {INQUIRY_FEEDBACK_CHANNEL_LABELS[ch]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">反馈类型</label>
              <select
                value={proxyType}
                onChange={(e) => setProxyType(e.target.value as InquiryFeedbackType)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900"
              >
                {INQUIRY_FEEDBACK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {INQUIRY_FEEDBACK_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">来源依据（必填，1~200字）</label>
              <input
                type="text"
                value={proxyChannelRef}
                maxLength={INQUIRY_FEEDBACK_CHANNEL_REF_MAX}
                onChange={(e) => {
                  setProxyChannelRef(e.target.value);
                  setProxyError('');
                }}
                placeholder="如：微信聊天 2026-11-20 14:20"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block font-medium text-gray-700">客户反馈内容（必填）</label>
            <textarea
              value={proxyContent}
              maxLength={INQUIRY_FEEDBACK_CONTENT_MAX}
              rows={3}
              onChange={(e) => {
                setProxyContent(e.target.value);
                setProxyError('');
              }}
              placeholder="如实记录客户在微信/邮件/电话中提出的改价、交期、数量或其他沟通诉求..."
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900"
            />
          </div>
          {proxyError && <p className="text-rose-600">{proxyError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setProxyOpen(false)}
              disabled={proxySubmitting}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={proxySubmitting}
              className="rounded bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {proxySubmitting ? '保存中...' : '保存代录反馈'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-gray-500">加载反馈中...</p>
      ) : error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : feedbacks.length === 0 ? (
        <p className="text-xs text-gray-500">暂无客户反馈。</p>
      ) : (
        <div className="space-y-2.5">
          {feedbacks.map((item) => {
            const isBusy = savingId === item.id;
            const badgeClass = item.handlingStatus === 'resolved'
              ? 'bg-emerald-100 text-emerald-700'
              : item.handlingStatus === 'ignored'
                ? 'bg-gray-100 text-gray-600'
                : 'bg-amber-100 text-amber-800';
            return (
              <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-gray-900">
                      {item.actorType === 'admin_proxy' ? '客服代录' : '客户站内提交'}
                    </span>
                    <span className="text-gray-600">
                      {item.actorName ? `${item.actorName}（${item.actorEmail}）` : item.actorEmail}
                    </span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
                      {inquiryFeedbackTypeLabel(item.feedbackType)}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                      渠道：{inquiryFeedbackChannelLabel(item.channel)}
                      {item.channelReference ? ` · ${item.channelReference}` : ''}
                    </span>
                    {item.quoteVersion != null && (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-700">
                        关联报价 v{item.quoteVersion}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 font-medium ${badgeClass}`}>
                      {inquiryFeedbackHandlingStatusLabel(item.handlingStatus)}
                    </span>
                  </div>
                  <span className="text-gray-400">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>

                <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{item.content}</p>

                {item.handledAt && (
                  <p className="text-[11px] text-gray-500">
                    处理人：{item.handledByAdminEmail || item.handledByAdminId || '-'} · 处理时间：{new Date(item.handledAt).toLocaleString('zh-CN')}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-2 border-t border-gray-200 pt-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] text-gray-500">内部处理备注（仅管理员可见，不向客户展示）</label>
                    <input
                      type="text"
                      value={notesById[item.id] ?? ''}
                      maxLength={INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX}
                      onChange={(e) => setNotesById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="填写内部跟进记录或处理说明..."
                      className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-500">关联响应报价版本（可选）</label>
                    <select
                      value={resolvedQuoteById[item.id] ?? ''}
                      onChange={(e) => setResolvedQuoteById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900"
                    >
                      <option value="">不关联</option>
                      {quoteVersions.map((q) => (
                        <option key={q.id} value={q.id}>
                          第 {q.version} 版（{q.status}）
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => { void handleStatusUpdate(item.id, 'resolved'); }}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    标记已处理
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => { void handleStatusUpdate(item.id, 'ignored'); }}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    标记忽略
                  </button>
                  {item.handlingStatus !== 'pending' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => { void handleStatusUpdate(item.id, 'pending'); }}
                      className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      恢复待处理
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
