'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Coins, Filter, Package, FileText, AlertCircle, Info, Wallet } from 'lucide-react';
import { formatPoints } from '@/lib/points';
import { uiSurfaces } from '@/lib/ui-surfaces';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import PointsProductCard from '@/components/points/PointsProductCard';
import PointsHistoryTable from '@/components/points/PointsHistoryTable';
import GroupPointsHistoryTable, { type GroupPointsLog } from '@/components/points/GroupPointsHistoryTable';
import RedemptionForm from '@/components/points/RedemptionForm';
import PointsTopupSection, { type PointsBalanceView } from '@/components/points/PointsTopupSection';
import { useRouter } from 'next/navigation';

interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  pointsCost: number;
  stock: number;
  metadata: string | null;
}

interface LogEntry {
  id: string;
  delta: number;
  type: string;
  reason: string | null;
  adminEmail: string | null;
  createdAt: string;
}

interface Redemption {
  id: string;
  productName: string;
  pointsCost: number;
  status: string;
  shippingInfo: string | null;
  trackingNumber: string | null;
  variantName: string | null;
  createdAt: string;
}

const REDEMPTION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'bg-amber-100 text-amber-700' },
  shipped: { label: '已发货', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700' },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-700' },
};

function MyPointsPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab');
  const initialTab = (
    tabParam === 'history' || tabParam === 'redemptions' || tabParam === 'topup' || tabParam === 'shop'
      ? tabParam
      : 'shop'
  ) as 'shop' | 'history' | 'redemptions' | 'topup';

  const [tab, setTab] = useState<'shop' | 'history' | 'redemptions' | 'topup'>(initialTab);
  const [currentPoints, setCurrentPoints] = useState(0);
  const [currentTier, setCurrentTier] = useState('standard');
  const [pointsBalance, setPointsBalance] = useState<PointsBalanceView | null>(null);
  const [topupNotice, setTopupNotice] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [groupLogs, setGroupLogs] = useState<GroupPointsLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState<number | undefined>(undefined);
  const [redeemError, setRedeemError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.replace('/login?callbackUrl=/account/points');
    }
  }, [status]);

  useEffect(() => {
    const topupId = searchParams.get('topup');
    if (topupId) {
      setTopupNotice('充值请求已提交，到账后积分将自动入账。');
      setTab('topup');
    }
  }, [searchParams]);

  function switchTab(next: typeof tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    params.delete('topup');
    router.replace(`/account/points?${params.toString()}`, { scroll: false });
  }

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/points/balance');
      if (res.ok) {
        const data = await res.json();
        setPointsBalance({
          personalPoints: data.personalPoints ?? 0,
          group: data.group ?? null,
        });
        setCurrentPoints(data.personalPoints ?? 0);
      }
    } catch {}
  }, []);

  const fetchPoints = useCallback(async () => {
    try {
      const res = await fetch('/api/points/logs');
      if (res.ok) {
        const data = await res.json();
        setCurrentPoints(data.currentPoints ?? 0);
        setCurrentTier(data.currentTier ?? 'standard');
        setGroupLogs(data.groupLogs || []);
      }
    } catch {}
    await fetchBalance();
  }, [fetchBalance]);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch('/api/points/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/points/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setGroupLogs(data.groupLogs || []);
      }
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  const fetchRedemptions = useCallback(async () => {
    setLoadingRedemptions(true);
    try {
      const res = await fetch('/api/points/my-redemptions');
      if (res.ok) {
        const data = await res.json();
        setRedemptions(data.redemptions || []);
      }
    } finally {
      setLoadingRedemptions(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchPoints();
    }
  }, [status, fetchPoints]);

  useEffect(() => {
    if (status === 'authenticated') {
      if (tab === 'shop') fetchProducts();
      if (tab === 'history') fetchLogs();
      if (tab === 'redemptions') fetchRedemptions();
    }
  }, [tab, status, fetchProducts, fetchLogs, fetchRedemptions]);

  async function handleRedeem(shippingInfo?: { name: string; phone: string; address: string }, variantIndex?: number) {
    if (!selectedProduct) return;
    setRedeemError('');
    const res = await fetch('/api/points/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: selectedProduct.id, shippingInfo, variantIndex }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '兑换失败');
    }
    setSelectedProduct(null);
    setSelectedVariantIndex(undefined);
    await fetchPoints();
    switchTab('redemptions');
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-8">
        {/* Blind-box notice */}
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-sm text-amber-800">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>
            <span className="font-medium">温馨提示：</span>
            所有实物会员礼均为盲盒形式。
          </p>
        </div>

        {topupNotice && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
            {topupNotice}
          </div>
        )}

        {/* Header: Points card */}
        <div className="bg-emerald-500 rounded-2xl shadow-xl p-6 mb-6 text-white">
          <div className="flex items-center gap-3 mb-2">
            <Coins className="w-6 h-6" />
            <span className="text-sm opacity-90">我的积分</span>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-4xl font-bold">{formatPoints(currentPoints)}</span>
            <span className="text-sm opacity-80">积分</span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-90">
            <span>当前等级：</span>
            <span className="font-semibold">{currentTier}</span>
          </div>
          {pointsBalance?.group && (
            <p className="text-xs opacity-90 mt-2">
              {pointsBalance.group.status === 'pending'
                ? `课题组「${pointsBalance.group.name}」待审核`
                : `课题组「${pointsBalance.group.name}」共享 ${formatPoints(pointsBalance.group.points)} 分`}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6 bg-white/60 backdrop-blur-md rounded-xl p-1.5 w-fit flex-wrap">
          {[
            { key: 'shop' as const, label: '积分商城', icon: Package },
            { key: 'topup' as const, label: '充值与课题组', icon: Wallet },
            { key: 'history' as const, label: '积分历史', icon: FileText },
            { key: 'redemptions' as const, label: '兑换记录', icon: Coins },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
 tab === t.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
 }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'topup' && (
          <PointsTopupSection balance={pointsBalance} onBalanceChange={fetchBalance} />
        )}

        {/* Shop tab */}
        {tab === 'shop' && (
          <div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">分类：</span>
              {[
                { value: 'all', label: '全部' },
                { value: 'tool', label: '实用工具' },
                { value: 'digital', label: '数字商品' },
                { value: 'physical', label: '实物商品' },
              ].map(f => (
                <button
                  key={f.value}
                  onClick={() => setCategoryFilter(f.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
 categoryFilter === f.value
 ? 'bg-emerald-500 text-white'
 : 'bg-white/60 text-gray-600 hover:bg-white'
 }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loadingProducts ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : products.length === 0 ? (
              <div className="bg-white/60 backdrop-blur-md rounded-2xl p-12 text-center border border-white/50">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无商品，敬请期待</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {products
                  .filter(p => categoryFilter === 'all' || p.category === categoryFilter)
                  .map(p => (
                    <PointsProductCard
                      key={p.id}
                      product={p}
                      userPoints={currentPoints}
                      onRedeem={(product, variantIndex) => {
                        setSelectedProduct(product);
                        setSelectedVariantIndex(variantIndex);
                      }}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="space-y-6">
            {loadingLogs ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : (
              <>
                <section className="space-y-3">
                  <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>个人积分</h2>
                  <PointsHistoryTable logs={logs} />
                </section>
                {pointsBalance?.group && (
                  <section className="space-y-3">
                    <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>课题组积分 · {pointsBalance.group.name}</h2>
                    <GroupPointsHistoryTable logs={groupLogs} />
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* Redemptions tab */}
        {tab === 'redemptions' && (
          <div>
            {loadingRedemptions ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : redemptions.length === 0 ? (
              <div className="bg-white/60 backdrop-blur-md rounded-2xl p-12 text-center border border-white/50">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无兑换记录</p>
                <button
                  onClick={() => switchTab('shop')}
                  className="mt-3 text-sm text-emerald-600 hover:text-emerald-700"
                >
                  去积分商城逛逛 →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {redemptions.map(r => {
                  const statusInfo = REDEMPTION_STATUS_LABELS[r.status] || REDEMPTION_STATUS_LABELS.pending;
                  const shipping = r.shippingInfo ? JSON.parse(r.shippingInfo) : null;
                  return (
                    <div key={r.id} className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/50 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-bold text-gray-900">
                            {r.productName}
                            {r.variantName && <span className="ml-1.5 text-xs font-normal text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{r.variantName}</span>}
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(r.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-violet-600">-{formatPoints(r.pointsCost)}</div>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </div>
                      </div>
                      {shipping && (
                        <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-600">
                          <p><span className="text-gray-500">收件人：</span>{shipping.name} · {shipping.phone}</p>
                          <p className="text-gray-500 mt-0.5">{shipping.address}</p>
                        </div>
                      )}
                      {r.trackingNumber && (
                        <p className="text-xs text-gray-600 mt-1">
                          <span className="text-gray-500">物流：</span>{r.trackingNumber}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {selectedProduct && (
        <RedemptionForm
          product={selectedProduct}
          variantIndex={selectedVariantIndex}
          onConfirm={handleRedeem}
          onCancel={() => { setSelectedProduct(null); setSelectedVariantIndex(undefined); }}
        />
      )}

      {redeemError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {redeemError}
        </div>
      )}

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MyPointsPage />
    </Suspense>
  );
}
