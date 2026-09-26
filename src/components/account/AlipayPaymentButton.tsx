'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { canPayOrderWithAlipay, getAlipayPaymentExpiresAt, getAlipayPaymentSummary, type AlipayPaymentSummary } from '@/data/alipay-payment';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { uiSurfaces } from '@/lib/ui-surfaces';
import AlipayPaymentStatusView from '@/components/payment/AlipayPaymentStatus';

type Props = {
  order: {
    id: string;
    createdAt: string;
    paidAt?: string | null;
    paymentMethod?: string | null;
    status?: string | null;
  };
  payment?: AlipayPaymentSummary | null;
  className?: string;
};

function formatRemaining(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

export default function AlipayPaymentButton({ order, payment, className = '' }: Props) {
  const { data: session, status: sessionStatus } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const expiresAt = useMemo(() => getAlipayPaymentExpiresAt(order.createdAt).getTime(), [order.createdAt]);
  const payable = canPayOrderWithAlipay(order, new Date(now));
  const currentPayment = useMemo(() => {
    const summary = payment || getAlipayPaymentSummary(order, null, new Date(now));
    if (summary && !order.paidAt && now >= expiresAt && summary.status !== 'paid') {
      return { ...summary, status: 'expired' as const };
    }
    return summary;
  }, [payment, order, now, expiresAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (normalizeOrderPaymentMethod(order.paymentMethod) !== 'alipay' || !currentPayment) return null;
  const allowContinuePayment = sessionStatus === 'authenticated' && session?.user?.role !== 'admin';

  async function continuePayment() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/alipay`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.redirectUrl !== 'string') {
        throw new Error(data.error || '付款请求创建失败');
      }
      window.location.assign(data.redirectUrl);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : '付款请求创建失败');
      setSubmitting(false);
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <AlipayPaymentStatusView payment={currentPayment} />
      {allowContinuePayment && payable && currentPayment.status !== 'paid' && currentPayment.status !== 'processing' ? (
        <>
          <button
            type="button"
            onClick={continuePayment}
            disabled={submitting}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--brand-border-radius)] bg-[#1677ff] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0f68e8] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${uiSurfaces.focusRing}`}
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {submitting ? '正在前往支付宝' : currentPayment.status === 'pending' ? '继续支付' : '重新支付'}
          </button>
          <p className={`text-xs ${uiSurfaces.mutedText}`}>付款剩余 {formatRemaining(expiresAt - now)}</p>
        </>
      ) : allowContinuePayment && currentPayment.status === 'processing' ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`${uiSurfaces.buttonGhost} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${uiSurfaces.focusRing} text-sm`}
        >
          刷新付款状态
        </button>
      ) : null}
      {error && <p className="text-sm text-[var(--brand-color-error-text)]">{error}</p>}
    </div>
  );
}
