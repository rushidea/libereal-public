'use client';

import { isWeChatMobileLoginAvailable } from '@/lib/wechat-auth';

export class WeChatMobileUnavailableError extends Error {
  constructor() {
    super('WECHAT_INAPP_UNAVAILABLE');
    this.name = 'WeChatMobileUnavailableError';
  }
}

/**
 * Full-page redirect via server launch route.
 * Avoids next-auth/react fetch()+JSON flow, which drops OAuth state cookies on iOS
 * when handoff to the WeChat app and back.
 */
export function signInWithWeChat(callbackUrl: string) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!isWeChatMobileLoginAvailable(ua)) {
    return Promise.reject(new WeChatMobileUnavailableError());
  }

  const launchUrl = `/api/auth/wechat/launch?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  window.location.assign(launchUrl);
  return Promise.resolve(undefined);
}
