'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type PendingAck = {
  id: string;
  title: string;
  content: string;
  linkUrl: string | null;
  createdAt: string;
};

export default function ForcedAckOverlay() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingAck[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const role = (session?.user as { role?: string } | undefined)?.role;
  const skip =
    status !== 'authenticated' ||
    role === 'admin' ||
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/api');

  const loadPending = useCallback(async () => {
    if (skip) {
      setPending([]);
      return;
    }
    try {
      const res = await fetch('/api/notifications/pending-ack');
      const data = await res.json();
      setPending(Array.isArray(data.pending) ? data.pending : []);
    } catch {
      setPending([]);
    }
  }, [skip]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  async function handleAcknowledge() {
    const current = pending[0];
    if (!current) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/notifications/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: current.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '确认失败');
        return;
      }
      await loadPending();
    } catch {
      setError('确认失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (skip || pending.length === 0) return null;

  const current = pending[0];
  const remaining = pending.length;

  return (
    <div
      className={`fixed inset-0 z-site-overlay flex items-end justify-center p-4 sm:items-center ${uiSurfaces.modalBackdrop}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-ack-title"
    >
      <div className={`relative w-full max-w-lg rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panelStrong} p-5 sm:p-6`}>
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-[var(--brand-border-radius)] bg-[var(--brand-color-warning-bg)] p-2 text-[var(--brand-color-warning-text)]">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium ${uiSurfaces.mutedText}`}>
              重要通知{remaining > 1 ? `（剩余 ${remaining} 条）` : ''}
            </p>
            <h2 id="forced-ack-title" className={`mt-1 text-lg font-semibold ${uiSurfaces.titleText}`}>
              {current.title}
            </h2>
          </div>
        </div>
        <div className={`max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed ${uiSurfaces.textSecondary}`}>
          {current.content}
        </div>
        {current.linkUrl ? (
          <a
            href={current.linkUrl}
            target={current.linkUrl.startsWith('http') ? '_blank' : undefined}
            rel={current.linkUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
            className={`mt-3 inline-block text-sm font-medium ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing}`}
          >
            查看详情
          </a>
        ) : null}
        {error ? <p className={`mt-3 text-sm ${uiSurfaces.statusError}`}>{error}</p> : null}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleAcknowledge()}
            className={uiSurfaces.primaryButton}
          >
            {submitting ? '提交中…' : '我已阅读并确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
