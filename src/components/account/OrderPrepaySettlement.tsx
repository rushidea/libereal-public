'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CheckoutPaymentFields, useCheckoutPointsBalance } from '@/components/checkout/CheckoutPaymentFields';

type CouponOption = {
  instanceId: string;
  code: string;
  name: string;
  type: 'threshold' | 'unrestricted';
  threshold: number;
  discount: number;
  scopeLabel?: string;
};

type SettlementOrder = {
  id: string;
  subtotal: number;
  adjustmentTotal: number;
  total: number;
  pointsPersonal: number;
  pointsGroup: number;
  pointsGroupId: string | null;
  pointsDiscount: number;
  pointsApplied: boolean;
  adjustments: Array<{ id: string; type: string; label: string; amount: number; reason?: string | null }>;
  ownerPrepaySettlement: {
    eligible: boolean;
    couponCode: string | null;
    personalPoints: number;
    groupPoints: number;
    groupId: string | null;
  };
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
}

export default function OrderPrepaySettlement({
  orderId,
  paymentMethod,
  personalPoints: initialPersonalPoints,
  groupPoints: initialGroupPoints,
  groupId: initialGroupId,
  couponCode: initialCouponCode,
  onSettled,
}: {
  orderId: string;
  paymentMethod: string;
  personalPoints: number;
  groupPoints: number;
  groupId?: string | null;
  couponCode?: string | null;
  onSettled: (order: SettlementOrder) => void;
}) {
  const { data: session, status } = useSession();
  const pointsBalance = useCheckoutPointsBalance();
  const [personalPoints, setPersonalPoints] = useState(initialPersonalPoints);
  const [groupPoints, setGroupPoints] = useState(initialGroupPoints);
  const [couponCode, setCouponCode] = useState(initialCouponCode ?? '');
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [pointsDiscount, setPointsDiscount] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPersonalPoints(initialPersonalPoints);
    setGroupPoints(initialGroupPoints);
    setCouponCode(initialCouponCode ?? '');
  }, [orderId, initialPersonalPoints, initialGroupPoints, initialCouponCode]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role === 'admin') return;
    let cancelled = false;
    fetch('/api/coupons')
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setCoupons(data as CouponOption[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.role]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.user?.role === 'admin') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const groupId = groupPoints > 0
        ? (pointsBalance?.group?.usable ? pointsBalance.group.id : initialGroupId ?? undefined)
        : undefined;
      fetch(`/api/orders/${encodeURIComponent(orderId)}/prepay-settlement/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalPoints,
          groupPoints,
          groupId,
          couponCode,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '无法计算应付金额');
          return data as { total?: number; pointsDiscount?: number };
        })
        .then((data) => {
          setPreviewTotal(typeof data.total === 'number' ? data.total : null);
          setPointsDiscount(typeof data.pointsDiscount === 'number' ? data.pointsDiscount : 0);
          setError('');
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return;
          setPreviewTotal(null);
          setError(reason instanceof Error ? reason.message : '无法计算应付金额');
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [status, session?.user?.role, orderId, personalPoints, groupPoints, couponCode, pointsBalance?.group?.id, pointsBalance?.group?.usable, initialGroupId]);

  if (status === 'loading' || session?.user?.role === 'admin') return null;

  async function submit() {
    setSubmitting(true);
    setError('');
    const groupId = groupPoints > 0
      ? (pointsBalance?.group?.usable ? pointsBalance.group.id : initialGroupId ?? undefined)
      : undefined;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/prepay-settlement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ personalPoints, groupPoints, groupId, couponCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '更新应付金额失败');
      if (data.order) onSettled(data.order as SettlementOrder);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新应付金额失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section data-testid="order-prepay-settlement" className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-900">付款前选择积分和优惠券</h3>
      <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-slate-700">
        管理员已代为接受报价。付款前可以改用个人积分、课题组积分和优惠券，支付宝等收款按更新后的应付金额收取。
      </p>
      <div className="mt-3">
        <CheckoutPaymentFields
          compact
          showPaymentSection={false}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={() => {}}
          personalPoints={personalPoints}
          onPersonalPointsChange={setPersonalPoints}
          groupPoints={groupPoints}
          onGroupPointsChange={setGroupPoints}
          pointsBalance={pointsBalance}
          pointsDiscount={pointsDiscount}
          pointsError={error || undefined}
        />
      </div>
      {coupons.length > 0 && (
        <div className="mb-3 space-y-1">
          <p className="text-xs text-gray-500 dark:text-slate-600">选择优惠券</p>
          {coupons.map((coupon) => (
            <button
              key={coupon.instanceId}
              type="button"
              onClick={() => setCouponCode(coupon.code)}
              className={`flex w-full min-h-11 flex-col items-start rounded-md border px-3 py-2 text-left text-sm ${couponCode.trim() === coupon.code ? 'border-brand-500 bg-white' : 'border-gray-200 bg-white/70 dark:border-slate-400'}`}
            >
              <span className="text-gray-800 dark:text-slate-900">{coupon.name} · {coupon.type === 'threshold' ? `满 ${coupon.threshold} 减 ${coupon.discount}` : `减 ${coupon.discount}`}</span>
              <span className="text-xs text-brand-700">{coupon.scopeLabel || '全站商品'}</span>
            </button>
          ))}
        </div>
      )}
      <label className="mb-3 block text-xs text-gray-500 dark:text-slate-600">
        优惠券码（可选）
        <input
          value={couponCode}
          onChange={(event) => setCouponCode(event.target.value)}
          placeholder="不使用优惠券可留空"
          aria-label="优惠券码"
          className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none dark:border-slate-400 dark:bg-slate-100"
        />
      </label>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700 dark:text-slate-800">预计应付</span>
        <span className="text-lg font-bold tabular-nums text-brand-600">{previewTotal == null ? '计算中' : formatPrice(previewTotal)}</span>
      </div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || Boolean(error)}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? '正在更新应付' : '确认抵扣并更新应付'}
      </button>
    </section>
  );
}
