'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { signInWithWeChat } from '@/lib/wechat-sign-in';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, AlertCircle, Link2 } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { isGoogleLoginEnabled } from '@/lib/auth-helpers';

function RegisterLinkForm() {
  const searchParams = useSearchParams();
  const [googleLinked, setGoogleLinked] = useState(false);
  const [wechatLinked, setWechatLinked] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<'google' | 'wechat' | null>(null);
  const [oauthLinkMsg, setOauthLinkMsg] = useState('');

  useEffect(() => {
    const googleStatus = searchParams.get('oauthLink');
    const wechatStatus = searchParams.get('wechatLink');
    if (googleStatus === 'success') setOauthLinkMsg('Google 账号绑定成功');
    if (wechatStatus === 'success') setOauthLinkMsg('微信账号绑定成功');
    if (googleStatus === 'conflict' || wechatStatus === 'conflict') {
      setOauthLinkMsg('该第三方账号已绑定其他账户');
    }

    fetch('/api/profile')
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) {
          setGoogleLinked(!!data.profile.googleLinked);
          setWechatLinked(!!data.profile.wechatLinked);
        }
      });
  }, [searchParams]);

  const handleLinkProvider = async (provider: 'google' | 'wechat') => {
    setLinkingProvider(provider);
    try {
      const res = await fetch('/api/account/link-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, source: 'register' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '绑定失败');
        return;
      }
      if (provider === 'wechat') {
        await signInWithWeChat(data.callbackUrl);
      } else {
        await signIn(provider, { callbackUrl: data.callbackUrl });
      }
    } catch {
      alert('绑定启动失败，请重试');
    } finally {
      setLinkingProvider(null);
    }
  };

  const allLinked = googleLinked && wechatLinked;

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            <div className="text-center mb-6">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">注册成功</h1>
              <p className="text-gray-500 text-sm">绑定更多登录方式，下次登录更方便</p>
            </div>

            {oauthLinkMsg && (
              <div className={`mb-5 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
 oauthLinkMsg.includes('成功')
 ? 'border border-green-200 bg-green-50 text-green-700'
 : 'border border-red-200 bg-red-50 text-red-700'
 }`}>
                {oauthLinkMsg.includes('成功')
                  ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{oauthLinkMsg}</span>
              </div>
            )}

            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-800">
              <p className="font-medium text-sm mb-1">⚠️ 您的注册资料已锁定</p>
              <p>单位/实验室、身份、导师信息注册后不可修改。<br />手机号一年内仅可更改一次。<br />如需修改请联系客服：<a href="/support" className="text-amber-900 underline font-medium">帮助中心 →</a></p>
            </div>

            <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
              <Link2 className="w-4 h-4" />
              <span>可选：绑定第三方登录</span>
            </div>

            <div className="space-y-3 mb-6">
              {isGoogleLoginEnabled() && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-gray-200">
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.02.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Google 登录</p>
                    <p className="text-xs text-gray-500">{googleLinked ? '已绑定' : '绑定后可使用 Google 登录'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLinkProvider('google')}
                  disabled={googleLinked || linkingProvider === 'google'}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-gray-300"
                >
                  {googleLinked ? '已绑定' : linkingProvider === 'google' ? '跳转中...' : '绑定'}
                </button>
              </div>
              )}

              <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Image src="/images/wechat-logo.svg" alt="" width={28} height={28} className="h-9 w-9" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">微信登录</p>
                    <p className="text-xs text-gray-500">{wechatLinked ? '已绑定' : '绑定后可使用微信授权登录'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleLinkProvider('wechat')}
                  disabled={wechatLinked || linkingProvider === 'wechat'}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-gray-300"
                >
                  {wechatLinked ? '已绑定' : linkingProvider === 'wechat' ? '跳转中...' : '绑定'}
                </button>
              </div>
            </div>

            <Link
              href="/account"
              className="block w-full text-center bg-brand-500 hover:bg-brand-600 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {allLinked ? '进入账户' : '跳过，稍后绑定'}
            </Link>

            <p className="mt-4 text-center text-xs text-gray-400">
              也可稍后在「账户设置 → 登录方式」中绑定
            </p>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function RegisterLinkClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <RegisterLinkForm />
    </Suspense>
  );
}
