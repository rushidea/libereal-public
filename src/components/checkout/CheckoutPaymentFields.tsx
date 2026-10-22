'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Coins, CreditCard } from 'lucide-react';
import { isThirdPartyPaymentMethod, ORDER_PAYMENT_METHODS } from '@/data/payment-methods';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type CheckoutPointsBalance = {
  personalPoints: number;
  group: {
    id: string;
    name: string;
    points: number;
    status?: string;
    usable: boolean;
  } | null;
};

const PAYMENT_METHODS = ORDER_PAYMENT_METHODS.map((method) => ({
  value: method.value,
  label: method.label,
  image: method.value === 'alipay' ? '/images/payments/alipay-payment.png' : undefined,
}));

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
}

export function useCheckoutPointsBalance() {
  const [pointsBalance, setPointsBalance] = useState<CheckoutPointsBalance | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/points/balance')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setPointsBalance(data as CheckoutPointsBalance);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return pointsBalance;
}

export function CheckoutPaymentFields({
  paymentMethod,
  onPaymentMethodChange,
  personalPoints,
  onPersonalPointsChange,
  groupPoints,
  onGroupPointsChange,
  pointsBalance,
  pointsError,
  pointsDiscount,
  compact = false,
}: {
  paymentMethod: string;
  onPaymentMethodChange: (value: string) => void;
  personalPoints: number;
  onPersonalPointsChange: (value: number) => void;
  groupPoints: number;
  onGroupPointsChange: (value: number) => void;
  pointsBalance: CheckoutPointsBalance | null;
  pointsError?: string;
  pointsDiscount: number;
  compact?: boolean;
}) {
  const sectionClass = compact ? 'mb-4' : 'mb-8';
  const isPlatformPayment = isThirdPartyPaymentMethod(paymentMethod);

  return (
    <div data-testid="checkout-payment-fields">
      <div className={`${sectionClass} rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
          <Coins className="w-5 h-5 text-brand-600" />
          积分抵扣
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-slate-700">1 积分 = 1 元，可与个人积分、课题组积分合用，数量自行分配。</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-slate-400 dark:bg-slate-100/70">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-800 dark:text-slate-900">个人积分</span>
              <span className="tabular-nums text-gray-600 dark:text-slate-700">
                可用 {pointsBalance?.personalPoints ?? 0}
              </span>
            </div>
            <input
              type="number"
              min={0}
              max={pointsBalance?.personalPoints ?? 0}
              value={personalPoints}
              onChange={(event) => {
                const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                onPersonalPointsChange(next);
              }}
              className={`w-full px-3 py-2.5 text-sm ${uiSurfaces.input}`}
              placeholder="输入抵扣积分"
              aria-label="个人积分"
            />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-slate-400 dark:bg-slate-100/70">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-800 dark:text-slate-900">
                课题组积分{pointsBalance?.group ? ` · ${pointsBalance.group.name}` : ''}
              </span>
              <span className="tabular-nums text-gray-600 dark:text-slate-700">
                可用 {pointsBalance?.group?.usable ? (pointsBalance.group.points ?? 0) : 0}
              </span>
            </div>
            <input
              type="number"
              min={0}
              max={pointsBalance?.group?.usable ? (pointsBalance.group.points ?? 0) : 0}
              value={groupPoints}
              disabled={!pointsBalance?.group?.usable}
              onChange={(event) => {
                const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                onGroupPointsChange(next);
              }}
              className={`w-full px-3 py-2.5 text-sm disabled:opacity-50 ${uiSurfaces.input}`}
              placeholder={
                pointsBalance?.group?.status === 'pending'
                  ? '课题组待审核'
                  : pointsBalance?.group?.usable
                    ? '输入抵扣积分'
                    : '未加入课题组'
              }
              aria-label="课题组积分"
            />
          </div>
        </div>
        {pointsError && (
          <p className="mt-3 text-sm text-red-600">{pointsError}</p>
        )}
        {pointsDiscount > 0 && !pointsError && (
          <p className="mt-3 text-sm text-brand-700">
            本单抵扣 {formatPrice(pointsDiscount)}
            {paymentMethod === 'alipay' ? '（支付宝到账后扣减）' : '（下单后立即扣减）'}
          </p>
        )}
      </div>

      <div className={`${compact ? '' : 'mb-8'} rounded-xl p-5 ${uiSurfaces.panelStrong}`}>
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-900">
          <CreditCard className="w-5 h-5 text-brand-600" />
          付款方式
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="付款方式">
          {PAYMENT_METHODS.map((method) => (
            <label
              key={method.value}
              data-testid={`checkout-payment-${method.value}`}
              className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                paymentMethod === method.value
                  ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-100/75'
                  : 'border-gray-200 hover:border-brand-200 hover:bg-gray-50 dark:border-slate-400 dark:bg-slate-200/55 dark:hover:border-brand-500 dark:hover:bg-slate-200/80'
              }`}
            >
              <input
                type="radio"
                name="payment"
                value={method.value}
                checked={paymentMethod === method.value}
                onChange={() => onPaymentMethodChange(method.value)}
                className="accent-brand-600"
                aria-label={method.label}
              />
              {method.image ? (
                <Image src={method.image} alt={method.label} width={210} height={39} className="h-auto w-full max-w-[210px]" />
              ) : (
                <span className="text-sm font-medium text-gray-800 dark:text-slate-900">{method.label}</span>
              )}
            </label>
          ))}
        </div>
        {isPlatformPayment && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-400/70 dark:bg-amber-100/75">
            <p className="text-sm text-amber-700 dark:text-amber-900">
              如有支付服务费，将在确认订单前显示。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
