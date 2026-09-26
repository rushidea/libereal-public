'use client';

import { FormEvent, Suspense, useState, useSyncExternalStore } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

function subscribeToWebAuthn(): () => void {
  return () => undefined;
}

function sanitizeCallbackUrl(value: string | null): string {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value) || typeof window === 'undefined') return '/account';
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return '/account';
    return `${target.pathname}${target.search}${target.hash}` || '/account';
  } catch {
    return '/account';
  }
}

function MfaLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challengeId = searchParams.get('challengeId') ?? '';
  const provider = searchParams.get('provider') ?? '';
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'));
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passkeyAvailable = useSyncExternalStore(subscribeToWebAuthn, browserSupportsWebAuthn, () => false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) {
      setError('验证请求已失效，请重新登录。');
      return;
    }
    setLoading(true);
    setError('');
    const result = await signIn('mfa-verify', {
      challengeId,
      code: useRecoveryCode ? '' : code,
      recoveryCode: useRecoveryCode ? recoveryCode : '',
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setError('验证码无效或验证请求已过期，请重试。');
      setLoading(false);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  async function handlePasskey() {
    if (!challengeId) {
      setError('验证请求已失效，请重新登录。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const optionsResponse = await fetch('/api/authenticator/passkey/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      });
      const optionsBody = await optionsResponse.json().catch(() => null) as { error?: string } | null;
      if (!optionsResponse.ok) throw new Error(optionsBody?.error || '无法开始通行密钥验证');
      const assertion = await startAuthentication(optionsBody as Parameters<typeof startAuthentication>[0]);
      const verifyResponse = await fetch('/api/authenticator/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: assertion }),
      });
      const verifyBody = await verifyResponse.json().catch(() => null) as { passkeyToken?: string; error?: string } | null;
      if (!verifyResponse.ok || !verifyBody?.passkeyToken) throw new Error(verifyBody?.error || '通行密钥验证失败');
      const result = await signIn('mfa-verify', {
        challengeId,
        passkeyToken: verifyBody.passkeyToken,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) throw new Error('通行密钥登录失败，请重试。');
      router.push(callbackUrl);
      router.refresh();
    } catch (passkeyError) {
      setError(passkeyError instanceof Error ? passkeyError.message : '通行密钥验证失败');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen libereal-service-page flex items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-white/40 bg-white/70 p-8 shadow-xl backdrop-blur-md dark:bg-slate-800/80">
        <p className="mb-2 text-sm text-gray-500 dark:text-slate-300">{provider ? `${provider} 登录` : '账户登录'}</p>
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">验证身份</h1>
        <p className="mb-6 text-sm leading-6 text-gray-600 dark:text-slate-200">
          打开验证器应用，输入其中显示的 6 位验证码。验证码不会被保存。
        </p>

        {error && <p className="mb-4 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-200">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {useRecoveryCode ? (
            <input
              autoFocus
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              placeholder="恢复码"
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-500 dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 位验证码"
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-center text-xl tracking-[0.35em] text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-500 dark:bg-slate-900 dark:text-white"
            />
          )}
          <button
            type="submit"
            disabled={loading || (useRecoveryCode ? !recoveryCode : code.length !== 6)}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '验证中…' : '完成验证'}
          </button>
        </form>

        {passkeyAvailable && (
          <button
            type="button"
            onClick={() => void handlePasskey()}
            disabled={loading}
            className="mt-4 w-full rounded-lg border border-emerald-600 px-4 py-3 font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-300 dark:text-emerald-200 dark:hover:bg-slate-700"
          >
            {loading ? '验证中…' : '使用通行密钥（Passkey）'}
          </button>
        )}

        <button
          type="button"
          onClick={() => { setUseRecoveryCode((value) => !value); setError(''); }}
          className="mt-5 text-sm text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-white"
        >
          {useRecoveryCode ? '使用验证器验证码' : '使用恢复码'}
        </button>
      </section>
    </main>
  );
}

export default function MfaLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen libereal-service-page" />}>
      <MfaLoginContent />
    </Suspense>
  );
}
