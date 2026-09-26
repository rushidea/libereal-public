'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { buildWeChatInAppLaunchUrl } from '@/lib/wechat-open-url';

function WeChatOpenContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';
  const [copied, setCopied] = useState(false);

  const launchUrl = useMemo(
    () => buildWeChatInAppLaunchUrl(
      callbackUrl,
      typeof window === 'undefined' ? undefined : window.location.origin,
    ),
    [callbackUrl],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(launchUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('请复制此链接，并在微信中打开：', launchUrl);
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
              <h1 className="text-2xl font-bold text-gray-900 mb-2">在微信中完成登录</h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                iOS Safari 无法直接打开公众号授权。请复制下方登录链接，在微信里打开后确认授权。
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 bg-[#07C160] hover:bg-[#06ad56] text-white font-medium py-3.5 rounded-xl transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? '链接已复制' : '复制微信登录链接'}
            </button>

            <div className="mt-5 rounded-2xl border border-green-100 bg-green-50/70 p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-2">操作步骤</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>复制链接</li>
                <li>打开微信，发到「文件传输助手」或任意聊天</li>
                <li>在微信里点击该链接，进入授权登录</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

export default function WeChatOpenPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-50" />}>
      <WeChatOpenContent />
    </Suspense>
  );
}
