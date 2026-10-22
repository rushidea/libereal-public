'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import {
  QUOTE_DECLINE_NOTE_MAX,
  QUOTE_DECLINE_REASONS,
  quoteDeclineReasonLabel,
  type QuoteDeclineReasonCode,
} from '@/lib/quote-decline';

function declineQuoteErrorMessage(status: number, serverError?: string): string {
  const trimmed = serverError?.trim() ?? '';
  if (trimmed && /[\u4e00-\u9fff]/.test(trimmed)) return trimmed;
  if (status === 401) return '请先登录后再试';
  if (status === 403) return '无权操作此询价';
  if (status === 409) return '当前无法放弃该报价，请刷新后重试';
  if (status === 400) return '提交内容无效，请检查后重试';
  return '提交失败，请稍后重试';
}

type DeclineQuoteDialogProps = {
  inquiryId: string;
  quoteId?: string | null;
  quoteVersion?: number | null;
  onClose: () => void;
  onDeclined: () => void;
};

export default function DeclineQuoteDialog({
  inquiryId,
  quoteId,
  quoteVersion,
  onClose,
  onDeclined,
}: DeclineQuoteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reasonCode, setReasonCode] = useState<QuoteDeclineReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const node = dialogRef.current;
    node?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const trimmed = note.trim();
  const noteMissing = reasonCode === 'other' && trimmed.length === 0;
  const canSubmit = Boolean(reasonCode) && !noteMissing && note.length <= QUOTE_DECLINE_NOTE_MAX && !submitting;

  async function submit() {
    if (!reasonCode || !canSubmit) {
      setError(reasonCode === 'other' && noteMissing ? '选择「其他」时请填写说明' : '请选择放弃原因');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reasonCode,
          note: trimmed || null,
          quoteId: quoteId ?? null,
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(declineQuoteErrorMessage(response.status, data.error));
        setSubmitting(false);
        return;
      }
      onDeclined();
    } catch {
      setError('网络异常，请稍后重试');
      setSubmitting(false);
    }
  }

  return (
    <div className={uiSurfaces.overlay}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="关闭"
        disabled={submitting}
        className={`absolute inset-0 ${uiSurfaces.modalBackdrop}`}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid="decline-quote-dialog"
        className={`relative z-10 mx-auto my-auto w-full max-w-md rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal} p-5 outline-none sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className={`text-lg font-semibold ${uiSurfaces.titleText}`}>放弃报价</h2>
            <p id={descriptionId} className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>
              {quoteVersion ? `报价 v${quoteVersion} 放弃后将标记为已放弃，且不能再据此生成订单。` : '放弃后该报价将标记为已放弃，且不能再据此生成订单。'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={submitting}
            className={`${uiSurfaces.buttonGhost} h-11 w-11 min-h-11 min-w-11 p-0 ${uiSurfaces.focusRing}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className={`mb-2 text-sm font-medium ${uiSurfaces.titleText}`}>放弃原因</legend>
          {QUOTE_DECLINE_REASONS.map((reason) => {
            const selected = reasonCode === reason.code;
            return (
              <label
                key={reason.code}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--brand-border-radius)] border px-3 py-2 ${
                  selected
                    ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary-bg)]'
                    : `${uiSurfaces.border} bg-transparent`
                }`}
              >
                <input
                  type="radio"
                  name="quote-decline-reason"
                  value={reason.code}
                  checked={selected}
                  data-testid={`decline-reason-${reason.code}`}
                  onChange={() => {
                    setReasonCode(reason.code);
                    setError('');
                  }}
                  className="h-4 w-4 shrink-0 accent-[var(--brand-color-primary)]"
                />
                <span className={`text-sm ${uiSurfaces.text}`}>{reason.label}</span>
              </label>
            );
          })}
        </fieldset>

        <label className="mt-4 block" htmlFor="decline-quote-note">
          <span className={`text-sm font-medium ${uiSurfaces.titleText}`}>
            补充说明{reasonCode === 'other' ? '（必填）' : '（选填）'}
          </span>
          <textarea
            id="decline-quote-note"
            data-testid="decline-note"
            value={note}
            maxLength={QUOTE_DECLINE_NOTE_MAX}
            rows={4}
            required={reasonCode === 'other'}
            onChange={(event) => {
              setNote(event.target.value);
              setError('');
            }}
            placeholder={reasonCode === 'other' ? '请简要说明原因' : '可补充具体情况'}
            className={`mt-2 w-full resize-y ${uiSurfaces.input} text-sm`}
          />
          <span className={`mt-1 block text-right text-xs ${uiSurfaces.mutedText}`}>{note.length}/{QUOTE_DECLINE_NOTE_MAX}</span>
        </label>

        {error && (
          <p id={errorId} role="alert" className={`mt-3 text-sm ${uiSurfaces.statusError}`}>
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`${uiSurfaces.buttonGhost} min-h-11 w-full sm:w-auto ${uiSurfaces.focusRing}`}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="decline-submit"
            onClick={() => { void submit(); }}
            disabled={!canSubmit}
            aria-describedby={error ? errorId : undefined}
            className={`${uiSurfaces.buttonDanger} min-h-11 w-full sm:w-auto ${uiSurfaces.focusRing}`}
          >
            {submitting ? '提交中...' : '确认放弃'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuoteDeclineDetails({
  reasonCode,
  note,
  declinedAt,
  declinedByEmail,
  testId = 'quote-decline-details',
}: {
  reasonCode?: string | null;
  note?: string | null;
  declinedAt?: string | Date | null;
  declinedByEmail?: string | null;
  testId?: string;
}) {
  const label = quoteDeclineReasonLabel(reasonCode);
  if (!label && !note) return null;
  const when = declinedAt ? new Date(declinedAt) : null;
  const whenLabel = when && !Number.isNaN(when.getTime()) ? when.toLocaleString('zh-CN') : null;
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--brand-border-radius)] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-50"
    >
      <p className="font-medium">报价已放弃</p>
      {label && <p className="mt-1">原因：{label}</p>}
      {note && <p className="mt-1 whitespace-pre-wrap break-words">说明：{note}</p>}
      {whenLabel && <p className="mt-1 text-xs opacity-80">时间：{whenLabel}</p>}
      {declinedByEmail && <p className="text-xs opacity-80">操作人：{declinedByEmail}</p>}
    </div>
  );
}
