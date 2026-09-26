'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import LegalConsentChecklist from '@/components/legal/LegalConsentChecklist';
import { uiSurfaces } from '@/lib/ui-surfaces';

type LegalConsentModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (acceptedIds: string[]) => void;
  submitting?: boolean;
};

export default function LegalConsentModal({ open, onClose, onConfirm, submitting = false }: LegalConsentModalProps) {
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [requiredCount, setRequiredCount] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setAcceptedIds([]);
      return;
    }
    fetch('/api/legal/documents?context=checkout')
      .then((r) => r.json())
      .then((data) => {
        const docs = Array.isArray(data.documents) ? data.documents : [];
        setRequiredCount(docs.length);
      })
      .catch(() => setRequiredCount(0));
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;

  const canConfirm = requiredCount === 0 || acceptedIds.length >= requiredCount;

  return (
    <div className="fixed inset-0 z-site-overlay flex items-end justify-center p-4 sm:items-center">
      <button type="button" className={`absolute inset-0 ${uiSurfaces.modalBackdrop}`} aria-label="关闭" onClick={onClose} />
      <div className={`relative w-full max-w-lg rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal} p-5 sm:p-6`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className={`text-lg font-semibold ${uiSurfaces.titleText}`}>确认采购协议</h2>
            <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>提交订单前请阅读并同意下列条款与协议。</p>
          </div>
          <button type="button" onClick={onClose} className={`${uiSurfaces.buttonGhost} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <LegalConsentChecklist context="checkout" acceptedIds={acceptedIds} onChange={setAcceptedIds} />

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`${uiSurfaces.buttonGhost} w-full sm:w-auto`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm || submitting}
            onClick={() => onConfirm(acceptedIds)}
            className={`${uiSurfaces.buttonPrimary} w-full sm:w-auto`}
          >
            {submitting ? '提交中...' : '同意并提交订单'}
          </button>
        </div>
      </div>
    </div>
  );
}
