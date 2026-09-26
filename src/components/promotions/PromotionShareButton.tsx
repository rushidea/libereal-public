'use client';

import { Share2, X, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { buildPromotionShareUrl, SHARE_VERSION, withVersion } from '@/data/promotion-share';
import { uiSurfaces } from '@/lib/ui-surfaces';

type WechatConfig = {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
};

type WechatShareData = {
  title: string;
  desc?: string;
  link: string;
  imgUrl: string;
};

type WechatSdk = {
  config: (options: WechatConfig & { debug: boolean; jsApiList: string[] }) => void;
  ready: (callback: () => void) => void;
  error: (callback: (error: unknown) => void) => void;
  updateAppMessageShareData: (data: WechatShareData) => void;
  updateTimelineShareData: (data: WechatShareData) => void;
};

declare global {
  interface Window {
    wx?: WechatSdk;
    __liberealWechatSdkPromise?: Promise<WechatSdk>;
  }
}

type PromotionShareButtonProps = {
  title: string;
  description: string;
  campaign: string;
  imageUrl: string;
  className?: string;
};

const WECHAT_SDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';

function loadWechatSdk(): Promise<WechatSdk> {
  if (window.wx) return Promise.resolve(window.wx);
  if (window.__liberealWechatSdkPromise) return window.__liberealWechatSdkPromise;

  window.__liberealWechatSdkPromise = new Promise<WechatSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WECHAT_SDK_URL}"]`);
    const script = existing ?? document.createElement('script');

    const handleLoad = () => {
      if (window.wx) resolve(window.wx);
      else reject(new Error('WECHAT_SDK_UNAVAILABLE'));
    };
    const handleError = () => reject(new Error('WECHAT_SDK_LOAD_FAILED'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = WECHAT_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return window.__liberealWechatSdkPromise;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function WechatGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M9 3C4.86 3 1.5 6.04 1.5 9.7c0 2.04 1.14 3.86 2.93 5.05L3.7 17.6l3.02-1.55c.95.27 1.96.42 3.02.44A6.1 6.1 0 0 1 9 15.4c0-3.4 3.24-6.15 7.24-6.15.26 0 .52.01.77.04C15.6 5.2 12.55 3 9 3Zm-2.3 5.9c.62 0 1.12.5 1.12 1.12S7.32 11.14 6.7 11.14s-1.12-.5-1.12-1.12.5-1.12 1.12-1.12Zm5.2 0c.62 0 1.12.5 1.12 1.12s-.5 1.12-1.12 1.12-1.12-.5-1.12-1.12.5-1.12 1.12-1.12Z" />
      <path d="M22.5 14.2c0-3.1-2.9-5.6-6.5-5.6s-6.5 2.5-6.5 5.6 2.9 5.6 6.5 5.6c.78 0 1.53-.11 2.22-.3l2.36 1.22-.64-2.18c1.4-1.06 2.56-2.57 2.56-4.34Zm-8.7-1c.52 0 .94.42.94.94s-.42.94-.94.94-.94-.42-.94-.94.42-.94.94-.94Zm4.4 0c.52 0 .94.42.94.94s-.42.94-.94.94-.94-.42-.94-.94.42-.94.94-.94Z" />
    </svg>
  );
}

export default function PromotionShareButton({
  title,
  description,
  campaign,
  imageUrl,
  className = '',
}: PromotionShareButtonProps) {
  const { show } = useToast();
  const [isWechat, setIsWechat] = useState(false);
  const [showWechatGuide, setShowWechatGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const inWechat = /MicroMessenger/i.test(navigator.userAgent);
    setIsWechat(inWechat);
    if (!inWechat) return;

    let active = true;
    const configureShare = async () => {
      try {
        const currentUrl = window.location.href.split('#')[0];
        const response = await fetch('/api/wechat/jssdk-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: currentUrl }),
        });
        if (!response.ok) throw new Error('WECHAT_SIGNATURE_FAILED');

        const signature = (await response.json()) as WechatConfig;
        const wx = await loadWechatSdk();
        if (!active) return;

        wx.config({
          debug: false,
          ...signature,
          jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'],
        });
        wx.ready(() => {
          if (!active) return;
          // 先拼版本号再绝对化：微信按图片 URL 缓存缩略图，换图后当新图重新抓取
          const absoluteImageUrl = new URL(
            withVersion(imageUrl, SHARE_VERSION),
            window.location.origin,
          ).toString();
          wx.updateAppMessageShareData({
            title,
            desc: description,
            link: buildPromotionShareUrl(currentUrl, 'appmessage', campaign),
            imgUrl: absoluteImageUrl,
          });
          wx.updateTimelineShareData({
            title,
            link: buildPromotionShareUrl(currentUrl, 'timeline', campaign),
            imgUrl: absoluteImageUrl,
          });
        });
        wx.error((error) => console.warn('WeChat share configuration failed', error));
      } catch (error) {
        console.warn('WeChat share initialization failed', error);
      }
    };

    void configureShare();
    return () => {
      active = false;
    };
  }, [campaign, description, imageUrl, title]);

  const shareUrl = () => buildPromotionShareUrl(window.location.href, 'native_share', campaign);

  const copyAndToast = async (msg: string) => {
    try {
      await copyText(shareUrl());
      setCopied(true);
      show(msg, 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      show('分享暂时不可用，请稍后重试', 'error');
    }
  };

  /** 分享入口：微信内引导右上角菜单；支持 Web Share API 的浏览器走原生分享；其余复制链接。 */
  const handleShare = async () => {
    // 微信内置浏览器不支持 Web Share API，且 JS-SDK 已配置好分享内容，引导右上角菜单
    if (isWechat) {
      setShowWechatGuide(true);
      return;
    }

    // 原生分享（iOS Safari / Android Chrome / 桌面 Chrome / Edge 等）
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, text: description, url: shareUrl() });
        return;
      } catch (error) {
        // 用户取消分享，静默返回
        if (error instanceof Error && error.name === 'AbortError') return;
        // 分享面板被拒绝或失败，回退到复制链接
      }
    }

    await copyAndToast('活动链接已复制，可通过微信、QQ 等 App 发送给好友或分享到朋友圈');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleShare()}
        aria-label="分享活动"
        title="分享活动"
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm backdrop-blur transition active:scale-[0.98] ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing} ${className}`}
      >
        <Share2 size={16} strokeWidth={1.8} />
        分享活动
      </button>

      {copied ? (
        <p className={`fixed bottom-20 left-1/2 z-[260] -translate-x-1/2 flex items-center gap-1 rounded-full px-4 py-2 text-xs shadow-lg ${uiSurfaces.modal} ${uiSurfaces.statusSuccess}`}>
          <Check size={14} /> 链接已复制
        </p>
      ) : null}

      {showWechatGuide ? (
        <div
          className={`fixed inset-0 z-[250] ${uiSurfaces.modalBackdrop}`}
          role="dialog"
          aria-modal="true"
          aria-label="微信分享提示"
          onClick={() => setShowWechatGuide(false)}
        >
          <div className={`absolute right-3 top-[max(12px,env(safe-area-inset-top))] w-[min(290px,calc(100vw-24px))] rounded-brand-lg p-4 ${uiSurfaces.modal}`}>
            <div className="flex items-start gap-3">
              <WechatGlyph className="h-5 w-5 shrink-0 text-[#07C160]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">使用右上角菜单分享</p>
                <p className={`mt-1 text-xs leading-5 ${uiSurfaces.mutedText}`}>可发送给朋友或分享到朋友圈。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowWechatGuide(false)}
                aria-label="关闭分享提示"
                className={`-mr-1 -mt-1 rounded-full p-1.5 transition hover:bg-[var(--surface-hover)] ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
