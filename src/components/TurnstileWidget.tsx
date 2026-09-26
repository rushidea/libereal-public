'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  siteKey?: string;
}

export default function TurnstileWidget({ onVerify, onExpire, theme = 'auto', siteKey: siteKeyOverride }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const resetTimerRef = useRef<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Keep refs up to date
  useEffect(() => { onVerifyRef.current = onVerify; });
  useEffect(() => { onExpireRef.current = onExpire; });

  useEffect(() => {
    const siteKey = siteKeyOverride ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) return;

    const resetWidget = () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    };

    const scheduleTimeoutReset = () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        resetWidget();
      }, 1200);
    };

    const callback = (token: string) => {
      setErrorCode(null);
      onVerifyRef.current(token);
    };
    const expiredCallback = () => {
      setErrorCode(null);
      onExpireRef.current?.();
    };

    const renderWidget = () => {
      if (window.turnstile && containerRef.current) {
        if (widgetIdRef.current) return;

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback,
          'expired-callback': expiredCallback,
          'timeout-callback': () => {
            onVerifyRef.current('');
            onExpireRef.current?.();
            scheduleTimeoutReset();
          },
          'error-callback': (code?: string) => {
            setErrorCode(code ?? 'unknown');
            onVerifyRef.current('');
            // A 600* error is recoverable. Returning false preserves Turnstile's
            // own automatic retry instead of racing it with a second reset.
            return false;
          },
          theme,
          retry: 'auto',
          'retry-interval': 8000,
          'refresh-expired': 'auto',
          'data-allow-cookies': 'true',
        });
      }
    };

    // Avoid loading the script multiple times
    const existingScript = document.querySelector('script[src*="cloudflare.com/turnstile"]');
    if (existingScript) {
      if (window.turnstile) {
        renderWidget();
      } else {
        existingScript.addEventListener('load', renderWidget, { once: true });
      }
    } else {
      // Use URL onload callback instead of script.onload for Safari reliability.
      // Safari's onload for dynamically-created cross-origin scripts is unreliable.
      const callbackName = `turnstileOnLoad_${Date.now()}` as `turnstileOnLoad_${number}`;
      window[callbackName] = () => {
        delete window[callbackName];
        renderWidget();
      };

      const script = document.createElement('script');
      script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${callbackName}`;
      script.async = true;
      document.head.appendChild(script);
    }

    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      existingScript?.removeEventListener('load', renderWidget);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = undefined;
      }
    };
  }, [siteKeyOverride, theme]);

  const handleManualRetry = () => {
    setErrorCode(null);
    onVerifyRef.current('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  };

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {errorCode ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-800">
          安全验证未通过，已自动重试。若仍失败，请关闭 Safari 的内容拦截器或换用无痕窗口后再试。
          <button
            type="button"
            onClick={handleManualRetry}
            className="ml-2 font-semibold text-amber-900 underline underline-offset-2"
          >
            重新验证
          </button>
          <span className="ml-2 text-amber-700/80">错误码：{errorCode}</span>
        </div>
      ) : null}
    </div>
  );
}

declare global {
  interface Window {
    [key: `turnstileOnLoad_${number}`]: (() => void) | undefined;
    turnstile?: {
      render: (el: HTMLElement, options: TurnstileOptions) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'error-callback'?: (code?: string) => boolean | void;
  theme?: 'light' | 'dark' | 'auto';
  retry?: 'never' | 'auto';
  'retry-interval'?: number;
  'refresh-expired'?: 'never' | 'auto';
  'data-allow-cookies'?: 'true' | 'false';
}
