'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ticket } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import AccountSidebar from '@/components/account/AccountSidebar';
import Breadcrumb from '@/components/Breadcrumb';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { uiSurfaces } from '@/lib/ui-surfaces';

type CouponCard = {
  instanceId: string;
  code: string;
  name: string;
  type: 'threshold' | 'unrestricted';
  threshold: number;
  discount: number;
  expiresAt: string | null;
  scopeLabel: string;
};

export default function MyCouponsPage() {
  const [coupons, setCoupons] = useState<CouponCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/coupons')
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setUnauthorized(true);
          return [];
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '优惠券加载失败');
        return Array.isArray(data) ? data : [];
      })
      .then((data) => { if (active) setCoupons(data); })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : '优惠券加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 pb-24 sm:px-6 sm:py-8 lg:pb-8">
        <div className="hidden sm:block">
          <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的账户', href: '/account' }, { label: '我的优惠券' }]} />
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <AccountSidebar activeKey="coupons" />
          <section className="min-w-0 flex-1 space-y-4">
            <div className={`rounded-2xl p-4 sm:p-5 ${uiSurfaces.panelStrong}`}>
              <h1 className={`flex items-center gap-2 text-xl font-semibold ${uiSurfaces.titleText}`}>
                <Ticket className="text-brand-600" size={22} /> 我的优惠券
              </h1>
              <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>下单时选择券码，抵扣仅作用于券的适用范围。</p>
            </div>
            {unauthorized && <p className={`text-sm ${uiSurfaces.mutedText}`}>请先 <Link href="/login" className="text-brand-600">登录</Link> 后查看优惠券。</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {loading && <p className={`text-sm ${uiSurfaces.mutedText}`}>加载中…</p>}
            {!loading && !unauthorized && coupons.length === 0 && !error && (
              <p className={`rounded-2xl p-5 text-sm ${uiSurfaces.panel} ${uiSurfaces.mutedText}`}>暂无可用优惠券</p>
            )}
            <ul className="space-y-3">
              {coupons.map((coupon) => (
                <li key={coupon.instanceId} className={`rounded-2xl p-4 ${uiSurfaces.panelStrong}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`font-medium ${uiSurfaces.titleText}`}>{coupon.name}</p>
                      <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>
                        {coupon.type === 'threshold' ? `满 ${coupon.threshold} 减 ${coupon.discount}` : `无门槛减 ${coupon.discount}`}
                      </p>
                      <p className="mt-1 text-sm text-brand-700">{coupon.scopeLabel || '全站商品'}</p>
                    </div>
                    <p className={`font-mono text-sm ${uiSurfaces.titleText}`}>{coupon.code}</p>
                  </div>
                  {coupon.expiresAt && (
                    <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>有效期至 {new Date(coupon.expiresAt).toLocaleDateString('zh-CN')}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
