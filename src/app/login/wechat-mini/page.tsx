'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Copy, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';

type ChallengeResponse = {
  challengeId: string;
  expiresAt: string;
  miniProgram: {
    appId: string | null;
    path: string;
    query: string;
    scheme: string | null;
    schemeError?: string | null;
  };
};

type StatusResponse = {
  status: 'pending' | 'linked' | 'unlinked' | 'expired' | 'consumed';
  expiresAt: string;
  linked?: boolean;
  needsRegistration?: boolean;
  error?: string;
};

type CompleteResponse = {
  ok?: boolean;
  redirectUrl?: string;
  error?: string;
};

function WeChatMiniLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/account';
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [statusText, setStatusText] = useState('正在创建微信小程序登录请求...');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completedRef = useRef(false);

  const copyText = useMemo(() => {
    if (!challenge) return '';
    return [
      'LIBEREAL 微信小程序登录',
      `AppID: ${challenge.miniProgram.appId ?? '请先配置 NEXT_PUBLIC_WECHAT_MINI_APP_ID'}`,
      `路径: ${challenge.miniProgram.path}`,
      `参数: ${challenge.miniProgram.query}`,
      `challengeId: ${challenge.challengeId}`,
    ].join('\n');
  }, [challenge]);

  const createChallenge = useCallback(async () => {
    completedRef.current = false;
    setCompleting(false);
    setError(null);
    setChallenge(null);
    setStatusText('正在创建微信小程序登录请求...');

    const response = await fetch('/api/auth/wechat-mini/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = (await response.json()) as ChallengeResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || '创建登录请求失败');

    setChallenge(data);
    setStatusText(data.miniProgram.scheme
      ? '请打开微信小程序完成授权，完成后回到本页。'
      : '小程序直达链接暂不可用，请复制参数后在小程序里粘贴。');
  }, []);

  const completeLogin = useCallback(async (challengeId: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleting(true);
    setStatusText('微信授权完成，正在登录...');

    const response = await fetch('/api/auth/wechat-mini/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, callbackUrl }),
    });
    const data = (await response.json()) as CompleteResponse;
    if (!response.ok || !data.redirectUrl) {
      completedRef.current = false;
      throw new Error(data.error || '完成登录失败');
    }
    router.replace(data.redirectUrl);
  }, [callbackUrl, router]);

  useEffect(() => {
    createChallenge().catch((err) => {
      setError(err instanceof Error ? err.message : '创建登录请求失败');
      setStatusText('创建失败，请重试。');
    });
  }, [createChallenge]);

  useEffect(() => {
    if (!challenge) return;

    const poll = async () => {
      try {
        const response = await fetch(`/api/auth/wechat-mini/status?challengeId=${encodeURIComponent(challenge.challengeId)}`, {
          cache: 'no-store',
        });
        const data = (await response.json()) as StatusResponse;
        if (!response.ok) throw new Error(data.error || '读取登录状态失败');

        if (data.status === 'pending') {
          setStatusText('等待小程序授权中。完成后请返回本页，本页会自动登录。');
          return;
        }
        if (data.status === 'linked' || data.status === 'unlinked') {
          await completeLogin(challenge.challengeId);
          return;
        }
        if (data.status === 'expired') {
          setError('登录请求已过期，请重新发起。');
          setStatusText('请求已过期。');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取登录状态失败');
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [challenge, completeLogin]);

  const handleOpenMiniProgram = () => {
    if (!challenge?.miniProgram.scheme) {
      void handleCopy();
      return;
    }
    window.location.href = challenge.miniProgram.scheme;
  };

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('请复制以下小程序登录参数：', copyText);
    }
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <div className="bg-white/60 backdrop-blur-md rounded-3xl shadow-xl border border-white/50 p-8">
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              返回登录
            </Link>

            <div className="text-center mb-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-50">
                <Image src="/images/wechat-logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">使用微信小程序登录</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                保持本页打开，前往微信小程序授权后返回，本页会自动完成登录。
              </p>
            </div>

            <div className="rounded-2xl border border-green-100 bg-green-50/70 p-4 text-sm text-gray-700 mb-5">
              <div className="flex items-center gap-2 font-medium text-gray-900">
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {statusText}
              </div>
              {challenge && (
                <p className="mt-2 break-all text-xs text-gray-500">
                  登录参数：{challenge.miniProgram.query}
                </p>
              )}
              {challenge?.miniProgram.schemeError && (
                <p className="mt-2 break-all text-xs text-amber-700">
                  小程序直达链接未生成：{challenge.miniProgram.schemeError}
                </p>
              )}
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleOpenMiniProgram}
                disabled={!challenge || completing}
                className="w-full flex items-center justify-center gap-2 bg-[#07C160] hover:bg-[#06ad56] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-xl transition-colors"
              >
                <Smartphone className="w-4 h-4" />
                {challenge?.miniProgram.scheme ? '打开微信小程序授权' : '复制小程序登录参数'}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!challenge || completing}
                className="w-full flex items-center justify-center gap-2 bg-white/70 hover:bg-white disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-800 font-medium py-3.5 rounded-xl border border-gray-200 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? '已复制' : '复制参数备用'}
              </button>
              <button
                type="button"
                onClick={() => void createChallenge().catch((err) => setError(err instanceof Error ? err.message : '重试失败'))}
                disabled={completing}
                className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 py-2"
              >
                <RefreshCw className="w-4 h-4" />
                重新生成登录请求
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-gray-100 bg-white/50 p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-2">使用步骤</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>点击打开微信小程序，或复制参数后在小程序里粘贴。</li>
                <li>小程序显示授权成功后，回到本页。</li>
                <li>本页检测到授权结果后会自动跳转。</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function WeChatMiniLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-50" />}>
      <WeChatMiniLoginContent />
    </Suspense>
  );
}
