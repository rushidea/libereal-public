'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Save, X } from 'lucide-react';
import { adminPermissionErrorMessage } from '@/data/admin-permission-message';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';
import {
  addDaysToShanghaiDate,
  CREDIT_STATUS_LABELS,
  formatCreditDateForInput,
  previewEffectiveCreditLimit,
  validateCreditDraftInput,
  type CustomerCreditSummary,
} from '@/lib/credit-summary';

type Props = {
  userId: string;
  userName?: string;
  tier?: string;
  summary: CustomerCreditSummary;
  canWriteCredit: boolean;
  defaultReason?: string;
  suggestedMinTotal?: number | null;
  onSaved: () => Promise<void> | void;
  onCancel?: () => void;
  onSwitchToFull?: () => void;
};

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

export default function CustomerCreditEditor(props: Props) {
  return <CreditEditorForm key={props.userId} {...props} />;
}

function CreditEditorForm({
  userId,
  userName,
  tier,
  summary,
  canWriteCredit,
  defaultReason,
  suggestedMinTotal,
  onSaved,
  onCancel,
  onSwitchToFull,
}: Props) {
  const idPrefix = useId();
  const savedFields = {
    creditOverride: summary.overrideLimit?.toString() ?? '',
    temporaryLimit: summary.temporaryLimit.toString(),
    temporaryUntil: formatCreditDateForInput(summary.temporaryUntil),
    paymentTermDays: summary.paymentTermDays.toString(),
    creditStatus: summary.status || 'active',
  };
  const savedFieldsKey = JSON.stringify([
    summary.overrideLimit, summary.temporaryLimit, summary.temporaryUntil, summary.paymentTermDays, summary.status,
  ]);
  const [draft, setDraft] = useState(() => ({ savedFieldsKey, fields: savedFields }));
  const fields = draft.savedFieldsKey === savedFieldsKey ? draft.fields : savedFields;
  const { creditOverride, temporaryLimit, temporaryUntil, paymentTermDays, creditStatus } = fields;
  const [reason, setReason] = useState(defaultReason || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { begin, dialog } = useAdminMfaStepUp();
  const scope = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    return () => controller.abort();
  }, []);

  if (draft.savedFieldsKey !== savedFieldsKey) setDraft({ savedFieldsKey, fields: savedFields });

  function updateFields(changes: Partial<typeof fields>) {
    setDraft((current) => ({ ...current, fields: { ...current.fields, ...changes } }));
  }

  const baseForPreview = summary.hasAccount ? summary.baseLimit : summary.tierDefaultLimit;
  const previewLimit = previewEffectiveCreditLimit(baseForPreview, {
    creditOverride,
    temporaryLimit,
    temporaryUntil,
    creditStatus,
  });
  const neededShortfallForDraft = typeof suggestedMinTotal === 'number' && Number.isFinite(suggestedMinTotal)
    ? Math.max(0, Math.round((suggestedMinTotal - summary.permanentLimit + Number.EPSILON) * 100) / 100)
    : null;

  async function submitCredit(stepUpToken?: string) {
    const signal = scope.current?.signal;
    if (signal?.aborted) return;
    if (!canWriteCredit) {
      setFeedback({ type: 'error', text: '修改授信需要财务权限。' });
      return;
    }
    const validated = validateCreditDraftInput(fields);
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/credit`, {
        method: 'PATCH',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validated.payload,
          reason: reason.trim() || defaultReason || '后台调整授信额度',
          ...(stepUpToken ? { stepUpToken } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; requiredPermission?: string };
      if (signal?.aborted) return;
      if (!stepUpToken && isAdminMfaStepUpResponse(response.status, data.error)) {
        await begin(async (token) => {
          await submitCredit(token);
        });
        return;
      }
      if (!response.ok) {
        setFeedback({ type: 'error', text: adminPermissionErrorMessage(data.error, data.requiredPermission) });
        return;
      }
      setFeedback({ type: 'success', text: '授信额度已保存' });
      await onSaved();
    } catch {
      if (!signal?.aborted) setFeedback({ type: 'error', text: '网络错误，请稍后重试。' });
    } finally {
      if (!signal?.aborted) setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-brand-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">
            授信额度与账期调整{userName ? ` · ${userName}` : ''}
          </h4>
          <p className="text-xs text-gray-500">
            {tier ? `当前客户等级：${tier}（等级默认 ${formatCurrency(summary.tierDefaultLimit)}）` : `等级默认额度 ${formatCurrency(summary.tierDefaultLimit)}`}
            {!summary.hasAccount ? ' · 尚未生成独立授信档案，保存后自动创建' : ''}
          </p>
        </div>
        {onSwitchToFull && (
          <button
            type="button"
            onClick={onSwitchToFull}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 underline underline-offset-2"
          >
            编辑完整用户资料
          </button>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs sm:grid-cols-5">
        <div>
          <div className="text-gray-500">等级默认</div>
          <div className="mt-0.5 font-semibold text-gray-800">{formatCurrency(summary.tierDefaultLimit)}</div>
        </div>
        <div>
          <div className="text-gray-500">当前生效总额度</div>
          <div className="mt-0.5 font-semibold text-gray-900">{formatCurrency(summary.effectiveLimit)}</div>
        </div>
        <div>
          <div className="text-gray-500">已用额度</div>
          <div className="mt-0.5 font-semibold text-gray-800">{formatCurrency(summary.usedAmount)}</div>
        </div>
        <div>
          <div className="text-gray-500">当前可用</div>
          <div className={`mt-0.5 font-semibold ${summary.availableAmount <= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {formatCurrency(summary.availableAmount)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">保存后预计生效</div>
          <div className="mt-0.5 font-semibold text-brand-700">{formatCurrency(previewLimit)}</div>
        </div>
      </div>

      {typeof suggestedMinTotal === 'number' && suggestedMinTotal > summary.effectiveLimit && canWriteCredit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>要接受本单，客户生效总额度需至少达到 <b>{formatCurrency(suggestedMinTotal)}</b>。</span>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {neededShortfallForDraft !== null && neededShortfallForDraft > 0 && (
              <button
                type="button"
                onClick={() => {
                  updateFields({ temporaryLimit: String(neededShortfallForDraft), temporaryUntil: temporaryUntil || addDaysToShanghaiDate(30) });
                  setFeedback(null);
                }}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100"
              >
                填入本单所需临时额度 (+{formatCurrency(neededShortfallForDraft)})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                updateFields({ creditOverride: String(suggestedMinTotal) });
                setFeedback(null);
              }}
              className="rounded border border-brand-300 bg-white px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-50"
            >
              填入所需永久额度 ({formatCurrency(suggestedMinTotal)})
            </button>
          </div>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={`${idPrefix}-override`} className="text-xs font-medium text-gray-700">
            永久额度（覆盖等级默认）
          </label>
          <input
            id={`${idPrefix}-override`}
            type="number"
            min="0"
            step="0.01"
            value={creditOverride}
            onChange={(e) => updateFields({ creditOverride: e.target.value })}
            disabled={!canWriteCredit}
            title={canWriteCredit ? undefined : '修改授信需要财务权限'}
            placeholder={`留空按等级默认 ${formatCurrency(summary.tierDefaultLimit)}`}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-temporary`} className="text-xs font-medium text-gray-700">
            临时额度（叠加生效）
          </label>
          <input
            id={`${idPrefix}-temporary`}
            type="number"
            min="0"
            step="0.01"
            value={temporaryLimit}
            onChange={(e) => updateFields({ temporaryLimit: e.target.value })}
            disabled={!canWriteCredit}
            title={canWriteCredit ? undefined : '修改授信需要财务权限'}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${idPrefix}-until`} className="text-xs font-medium text-gray-700">
              临时额度到期日
            </label>
            {canWriteCredit && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateFields({ temporaryUntil: addDaysToShanghaiDate(7) })}
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200"
                >
                  +7天
                </button>
                <button
                  type="button"
                  onClick={() => updateFields({ temporaryUntil: addDaysToShanghaiDate(30) })}
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200"
                >
                  +30天
                </button>
              </div>
            )}
          </div>
          <input
            id={`${idPrefix}-until`}
            type="date"
            value={temporaryUntil}
            onChange={(e) => updateFields({ temporaryUntil: e.target.value })}
            disabled={!canWriteCredit}
            title={canWriteCredit ? '到期日当天 23:59 前（北京时间）生效' : '修改授信需要财务权限'}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-term`} className="text-xs font-medium text-gray-700">
            账期（天）
          </label>
          <input
            id={`${idPrefix}-term`}
            type="number"
            min="1"
            max="365"
            value={paymentTermDays}
            onChange={(e) => updateFields({ paymentTermDays: e.target.value })}
            disabled={!canWriteCredit}
            title={canWriteCredit ? undefined : '修改授信需要财务权限'}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-status`} className="text-xs font-medium text-gray-700">
            授信状态
          </label>
          <select
            id={`${idPrefix}-status`}
            value={creditStatus}
            onChange={(e) => updateFields({ creditStatus: e.target.value })}
            disabled={!canWriteCredit}
            title={canWriteCredit ? undefined : '修改授信需要财务权限'}
            className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          >
            {Object.entries(CREDIT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${idPrefix}-reason`} className="text-xs font-medium text-gray-700">
            调整说明
          </label>
          <input
            id={`${idPrefix}-reason`}
            type="text"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canWriteCredit}
            placeholder={defaultReason || '如：客户资质核验通过，调高永久额度'}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
      </div>

      {!canWriteCredit && (
        <p className="text-xs text-amber-700">修改永久额度、临时额度或账期需要财务权限（finance.write）。</p>
      )}

      {feedback && (
        <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`} role="status">
          {feedback.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void submitCredit()}
          disabled={saving || !canWriteCredit}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中...' : '保存授信'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            <X className="h-3.5 w-3.5" />
            收起
          </button>
        )}
      </div>

      {dialog}
    </div>
  );
}
