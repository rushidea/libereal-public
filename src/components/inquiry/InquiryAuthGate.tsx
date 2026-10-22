'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

const INQUIRY_RETURN_PATH = '/inquiry';

function openKnocketConsultation(): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('contact-widget-auto');
  if (!host) return;
  const launcher = host.shadowRoot?.querySelector('button') ?? host.querySelector('button');
  if (launcher instanceof HTMLElement) launcher.click();
}

type InquiryAuthGateProps = {
  variant: 'banner' | 'modal';
  onClose?: () => void;
  onNavigateAuth?: () => void;
};

export default function InquiryAuthGate({ variant, onClose, onNavigateAuth }: InquiryAuthGateProps) {
  const loginHref = `/login?callbackUrl=${encodeURIComponent(INQUIRY_RETURN_PATH)}`;
  const registerHref = `/register?callbackUrl=${encodeURIComponent(INQUIRY_RETURN_PATH)}`;

  const actions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Link
        href={loginHref}
        onClick={onNavigateAuth}
        className={`${uiSurfaces.primaryButton} w-full sm:w-auto justify-center px-5 py-2.5 text-sm`}
      >
        登录
      </Link>
      <Link
        href={registerHref}
        onClick={onNavigateAuth}
        className={`w-full sm:w-auto justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-400 dark:bg-slate-100 ${uiSurfaces.focusRing}`}
      >
        注册
      </Link>
      <button
        type="button"
        onClick={() => {
          onClose?.();
          openKnocketConsultation();
        }}
        className={`w-full sm:w-auto rounded-lg border border-brand-200 bg-brand-50 px-5 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-300 dark:bg-brand-900/20 dark:text-brand-200 ${uiSurfaces.focusRing}`}
      >
        咨询人工
      </button>
    </div>
  );

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="inquiry-auth-gate-title">
        <div className={`relative w-full max-w-md rounded-[1.15rem] p-6 shadow-xl ${uiSurfaces.panelStrong}`}>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 id="inquiry-auth-gate-title" className="pr-8 text-lg font-semibold text-gray-900">
            提交询价需要先登录或注册
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            也可以咨询人工客服。已填写的内容会保留，登录或注册返回后可继续提交。
          </p>
          <div className="mt-5">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 shadow-sm dark:border-amber-400/60 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="text-sm font-medium leading-relaxed">
        提交询价需要先登录或注册；也可以咨询人工客服
      </p>
      <div className="mt-3">{actions}</div>
    </div>
  );
}
