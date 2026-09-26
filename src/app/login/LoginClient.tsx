'use client';

import { useState, Suspense, useMemo, useSyncExternalStore } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { isGoogleLoginEnabled } from '@/lib/auth-helpers';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import TurnstileWidget from '@/components/TurnstileWidget';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { getWeChatLinkHint, getWeChatSignInButtonLabel, isWeChatMobileLoginAvailable } from '@/lib/wechat-auth';
import { signInWithWeChat, WeChatMobileUnavailableError } from '@/lib/wechat-sign-in';

function subscribeToWebAuthn(): () => void {
  return () => undefined;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';
  const error = searchParams.get('error');
  const errorCode = searchParams.get('code');
  const wechatParam = searchParams.get('wechat');

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const wechatLoginAvailable = useMemo(() => isWeChatMobileLoginAvailable(userAgent), [userAgent]);
  const wechatHint = useMemo(() => getWeChatLinkHint(userAgent), [userAgent]);
  const wechatButtonLabel = useMemo(() => getWeChatSignInButtonLabel(userAgent), [userAgent]);
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const passkeyAvailable = useSyncExternalStore(subscribeToWebAuthn, browserSupportsWebAuthn, () => false);

  const authErrorMessage = useMemo(() => {
    if (localError) return localError;
    if (wechatParam === 'inapp-unavailable') {
      return '微信内登录需配置公众号网页授权。配置完成前请使用邮箱登录。';
    }
    if (wechatParam === 'mobile-needs-mp') {
      return '手机端无法用网站应用扫码登录。请使用邮箱登录，或在电脑端扫码；配置公众号后可在此直接唤起微信 App。';
    }
    if (!error) return '';
    if (error === 'MfaUnavailable') return '多因素验证服务暂时不可用，请稍后重试。';
    if (error === 'Configuration') {
      const triedWeChat = searchParams.get('provider') === 'wechat' || wechatParam != null;
      if (triedWeChat) {
        return '微信登录未完成。请重新打开登录页再试；若刚从微信返回，请再点一次「使用微信授权登录」。';
      }
      return '第三方登录配置异常。微信登录请确认网站应用已审核；Google 登录在大陆服务器通常需配置 HTTPS_PROXY。您也可先使用邮箱登录。';
    }
    if (error === 'GoogleLink') return 'Google 账号绑定失败，请重试或联系客服。';
    if (error === 'GoogleEmailUnverified') return 'Google 账号邮箱尚未验证，请先在 Google 账户中完成邮箱验证。';
    if (errorCode === 'account-frozen') return '账户已冻结：可登录，但无法看到折扣价，也无法下单或询价。';
    if (error === 'WechatLink') return '微信账号绑定失败，请重试或联系客服。';
    return '登录失败，请重试。';
  }, [error, errorCode, localError, searchParams, wechatParam]);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setLocalError('');

    try {
      await signIn('google', { callbackUrl });
    } catch (e) {
      console.error('[google signIn] failed:', e);
      setGoogleLoading(false);
      setLocalError('Google 登录启动失败，请刷新页面重试');
    }
  };

  const handleWeChatSignIn = async () => {
    setWechatLoading(true);
    setLocalError('');

    try {
      await signInWithWeChat(callbackUrl);
    } catch (e) {
      console.error('[wechat signIn] failed:', e);
      setWechatLoading(false);
      if (e instanceof WeChatMobileUnavailableError) {
        setLocalError('手机/微信内登录需配置公众号授权。配置完成前请使用邮箱登录，或在电脑端扫码。');
      } else {
        setLocalError('微信登录启动失败，请刷新页面重试');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLocalError('');

    const result = await signIn('credentials', {
      email: form.email,
      password: form.password,
      turnstileToken,
      redirect: false,
    });

    if (result?.error) {
      setLocalError(result.code === 'account-frozen' ? '账户已冻结：可登录，但无法看到折扣价，也无法下单或询价。' : '邮箱或密码错误，请重试。');
      setLoading(false);
    } else if (result?.url?.includes('/login/mfa')) {
      router.push(result.url);
      router.refresh();
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  const handlePasskeySignIn = async () => {
    setPasskeyLoading(true);
    setLocalError('');
    try {
      const email = form.email.trim();
      let challengeId = '';
      let options: unknown;
      let verifyUrl = '';

      if (email) {
        const startResponse = await fetch('/api/authenticator/passkey/login/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const startBody = await startResponse.json().catch(() => null) as { challengeId?: string; error?: string } | null;
        if (!startResponse.ok || !startBody?.challengeId) throw new Error(startBody?.error || '通行密钥登录暂时不可用');
        challengeId = startBody.challengeId;

        const optionsResponse = await fetch('/api/authenticator/passkey/login/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId }),
        });
        const optionsBody = await optionsResponse.json().catch(() => null) as { error?: string } | null;
        if (!optionsResponse.ok) throw new Error(optionsBody?.error || '无法开始通行密钥验证');
        options = optionsBody;
        verifyUrl = '/api/authenticator/passkey/login/verify';
      } else {
        const startResponse = await fetch('/api/authenticator/passkey/login/discoverable/start', { method: 'POST' });
        const startBody = await startResponse.json().catch(() => null) as { challengeId?: string; options?: unknown; error?: string } | null;
        if (!startResponse.ok || !startBody?.challengeId || !startBody.options) throw new Error(startBody?.error || '通行密钥登录暂时不可用');
        challengeId = startBody.challengeId;
        options = startBody.options;
        verifyUrl = '/api/authenticator/passkey/login/discoverable/verify';
      }

      const assertion = await startAuthentication(options as Parameters<typeof startAuthentication>[0]);
      const verifyResponse = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: assertion }),
      });
      const verifyBody = await verifyResponse.json().catch(() => null) as { challengeId?: string; passkeyToken?: string; error?: string } | null;
      if (!verifyResponse.ok || !verifyBody?.passkeyToken) throw new Error(verifyBody?.error || '通行密钥验证失败');

      const result = await signIn('mfa-verify', {
        challengeId: verifyBody.challengeId || challengeId,
        passkeyToken: verifyBody.passkeyToken,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) throw new Error('通行密钥登录失败，请重试。');
      router.push(callbackUrl);
      router.refresh();
    } catch (passkeyError) {
      const errorData = passkeyError as { message?: unknown; name?: unknown; code?: unknown; cause?: { name?: unknown } } | null;
      const message = typeof errorData?.message === 'string' ? errorData.message : '';
      const errorName = [errorData?.name, errorData?.code, errorData?.cause?.name].filter(Boolean).join(' ');
      setLocalError(
        errorName.includes('NotAllowedError') || errorName.includes('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') || message.includes('未找到')
          ? '当前设备未找到可用的通行密钥。也可输入邮箱后继续验证，或在账户安全页重新添加。'
          : message || '通行密钥登录失败，请重试。',
      );
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-1">登录账户</h1>
              <p className="text-gray-500 text-sm">欢迎回来</p>
            </div>

            {(localError || error || wechatParam != null) && (
              <div className="mb-5 flex items-center gap-2 bg-red-100/70 backdrop-blur-sm border border-red-200/50 text-red-600 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{authErrorMessage}</span>
              </div>
            )}

            {/* OAuth */}
            <div className="space-y-3">
              {wechatHint && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {wechatHint}
                </p>
              )}
              {isGoogleLoginEnabled() && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || wechatLoading || passkeyLoading}
                className="w-full flex items-center justify-center gap-3 border border-white/50 hover:border-gray-300 hover:bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm font-medium text-gray-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {googleLoading ? '正在跳转...' : '使用 Google 登录'}
              </button>
              )}
              <button
                type="button"
                onClick={handleWeChatSignIn}
                disabled={googleLoading || wechatLoading || passkeyLoading || !wechatLoginAvailable}
                className="w-full flex items-center justify-center gap-3 border border-white/50 hover:border-green-300 hover:bg-white/80 backdrop-blur-sm rounded-xl px-4 py-3 text-sm font-medium text-gray-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Image src="/images/wechat-logo.svg" alt="" width={28} height={28} className="h-5 w-5" />
                {wechatLoading ? '正在跳转...' : wechatButtonLabel}
              </button>
            </div>

            {passkeyAvailable && (
              <button
                type="button"
                onClick={() => void handlePasskeySignIn()}
                disabled={loading || googleLoading || wechatLoading || passkeyLoading}
                className="mt-3 w-full flex items-center justify-center gap-2 border border-brand-300 hover:bg-brand-50 rounded-xl px-4 py-3 text-sm font-medium text-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {passkeyLoading ? '验证中...' : '使用通行密钥登录'}
              </button>
            )}

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white/80 px-3 text-gray-400 dark:bg-[#4a515c]/90">或使用邮箱登录</span>
              </div>
            </div>

            {/* Email login */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <TurnstileWidget
                onVerify={(token) => setTurnstileToken(token)}
                onExpire={() => setTurnstileToken('')}
                theme="auto"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="you@institution.edu.cn"
                    value={form.email}
                    onChange={(e) => setForm(form => ({...form, email: e.target.value }))}
                    className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">密码</label>
                  <Link
                    href={
                      form.email
                        ? `/forgot-password?email=${encodeURIComponent(form.email)}`
                        : '/forgot-password'
                    }
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    忘记密码？
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm(form => ({...form, password: e.target.value }))}
                    className="w-full border border-white/50 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-800 bg-white/60 backdrop-blur-sm focus:bg-white/80 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-500/90 backdrop-blur-sm hover:bg-brand-600 disabled:bg-brand-300/50 text-white py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md"
              >
                {loading ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    登录中...
                  </>
                ) : '登录'}
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link href="/register" className="text-sm text-gray-400 hover:text-brand-600">
                还没有账户？<span className="text-brand-600 font-medium">立即注册</span>
              </Link>
            </div>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center justify-center gap-1">
              <ArrowLeft className="w-4 h-4" /> 返回首页
            </Link>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function LoginClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  );
}
