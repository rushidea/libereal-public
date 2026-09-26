'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import AlipayPaymentStatusView from '@/components/payment/AlipayPaymentStatus';
import type { AlipayPaymentSummary } from '@/data/alipay-payment';

function AlipayReturnContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const [payment, setPayment] = useState<AlipayPaymentSummary | null>(null);
  const [checking, setChecking] = useState(Boolean(orderId));
  const [error, setError] = useState('');

  const checkPayment = useCallback(async () => {
    if (!orderId) {
      setChecking(false);
      setError('缺少订单信息');
      return null;
    }
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '订单状态查询失败');
      setPayment(data.payment || null);
      setError('');
      return data.payment as AlipayPaymentSummary | null;
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : '订单状态查询失败');
      return null;
    } finally {
      setChecking(false);
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    let checks = 0;
    void checkPayment();
    const timer = window.setInterval(async () => {
      if (!active || checks >= 60) {
        window.clearInterval(timer);
        return;
      }
      checks += 1;
      const latest = await checkPayment();
      if (latest && ['paid', 'expired', 'closed', 'failed'].includes(latest.status)) {
        window.clearInterval(timer);
      }
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [checkPayment]);

  const paid = payment?.status === 'paid';

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdaptiveHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-16">
        <section className="w-full rounded-lg bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            {paid ? <CheckCircle2 className="h-6 w-6" /> : <LoaderCircle className={`h-6 w-6 ${checking || payment?.status === 'processing' || payment?.status === 'pending' ? 'animate-spin' : ''}`} />}
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900">{paid ? '付款成功' : '支付结果确认中'}</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">付款状态以支付宝异步通知为准，本页会自动更新。</p>
          {payment && <div className="mt-5"><AlipayPaymentStatusView payment={payment} /></div>}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {!paid && (
              <button type="button" onClick={() => { setChecking(true); void checkPayment(); }} disabled={checking} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
                刷新状态
              </button>
            )}
            <Link href={orderId ? `/account/orders/${encodeURIComponent(orderId)}` : '/account/orders'} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600">
              查看订单
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function AlipayReturnPage() {
  return (
    <Suspense fallback={null}>
      <AlipayReturnContent />
    </Suspense>
  );
}
