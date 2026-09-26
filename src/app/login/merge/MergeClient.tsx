'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, AlertCircle, Shield, ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

type MergeInfo = {
  provider: string;
  providerLabel: string;
  email: string;
  oauthEmail: string | null;
};

function MergeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [info, setInfo] = useState<MergeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account/merge')
      .then((r) => r.json())
      .then((data) => {
        if (data.pending) {
          setInfo(data.pending);
        } else {
          const provider = searchParams.get('provider');
          const email = searchParams.get('email');
          if (provider && email) {
            setError('合并请求已过期，请重新使用第三方登录');
          }
        }
      })
      .catch(() => setError('无法加载合并信息'))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const handleMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/account/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '合并失败');
        setSubmitting(false);
        return;
      }

      const result = await signIn('credentials', {
        email: info.email,
        password,
        redirect: false,
      });

      if (result?.error) {
        router.push(`/login?callbackUrl=${encodeURIComponent('/account')}`);
        return;
      }

      router.push('/account');
      router.refresh();
    } catch {
      setError('网络错误，请重试');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <p className="text-gray-500 text-sm">加载中...</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen libereal-service-page flex flex-col">
        <AdaptiveHeader />
        <main className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-md bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8 text-center">
            <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">无法合并账户</h1>
            <p className="text-sm text-gray-500 mb-6">{error || '请重新尝试第三方登录'}</p>
            <Link href="/login" className="text-brand-600 text-sm font-medium hover:underline">
              返回登录
            </Link>
          </div>
        </main>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            <div className="text-center mb-6">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
                <Shield className="h-6 w-6 text-brand-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">合并账户</h1>
              <p className="text-gray-500 text-sm">验证身份以绑定 {info.providerLabel}</p>
            </div>

            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {info.provider === 'wechat' && !info.oauthEmail ? (
                <>
                  <p>
                    您正在通过微信登录，该微信尚未绑定账户。检测到邮箱 <strong>{info.email}</strong> 已有账户。
                  </p>
                  <p className="mt-2">请输入该邮箱账户的密码以绑定微信并合并账户，防止账户被他人接管。</p>
                </>
              ) : (
                <>
                  <p>
                    检测到 <strong>{info.providerLabel}</strong> 账号
                    {info.oauthEmail ? `（${info.oauthEmail}）` : ''} 与已有邮箱账户 <strong>{info.email}</strong> 匹配。
                  </p>
                  <p className="mt-2">请输入该邮箱账户的密码以确认合并，防止账户被他人接管。</p>
                </>
              )}
            </div>

            {error && (
              <div className="mb-5 flex items-center gap-2 bg-red-100/70 border border-red-200/50 text-red-600 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleMerge} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
                <input
                  type="email"
                  value={info.email}
                  disabled
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-500 bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">账户密码</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    required
                    placeholder="请输入已有账户密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || !password}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white py-3 rounded-xl font-semibold transition-colors"
              >
                {submitting ? '验证并合并中...' : '验证密码并合并账户'}
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link href="/login" className="text-sm text-gray-400 hover:text-brand-600 inline-flex items-center gap-1">
                <ArrowLeft className="w-4 h-4" /> 返回登录
              </Link>
            </div>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function MergeClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <MergeForm />
    </Suspense>
  );
}
