/** NextAuth provider ids for WeChat login flows. */
export const WECHAT_WEB_PROVIDER_ID = 'wechat';
export const WECHAT_OAUTH_PROVIDER_ID = 'wechat-oauth';

export function isWeChatInAppBrowser(userAgent: string): boolean {
  return /MicroMessenger/i.test(userAgent);
}

export function isMobileDevice(userAgent: string): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
}

export function isIOSSafari(userAgent: string): boolean {
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent);
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent);
  return isIOS && isSafari && !isOtherIOSBrowser && !isWeChatInAppBrowser(userAgent);
}

export function shouldUseWeChatMiniProgramLogin(userAgent: string): boolean {
  // iOS Safari / Android（非微信内）：统一走微信小程序登录页（8/4 Peter 要求）。
  // 安卓浏览器点击微信登录原本跳到 qrconnect 扫码页（手机端不可用/体验差），
  // 现改为进入小程序登录页，通过微信小程序授权完成登录。
  if (isIOSSafari(userAgent)) return true;
  return /Android/i.test(userAgent) && !isWeChatInAppBrowser(userAgent);
}

/** Official-account OAuth credentials are configured on the server. */
export function isWeChatMpOAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_WECHAT_MP_ID?.trim()
    && process.env.AUTH_WECHAT_MP_SECRET?.trim(),
  );
}

/** Website-app OAuth credentials (QR on desktop; opens WeChat app on mobile Safari). */
export function isWeChatWebOAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_WECHAT_ID?.trim()
    || process.env.NEXT_PUBLIC_AUTH_WECHAT_ID?.trim(),
  );
}

/** Client can route mobile users to the MP OAuth provider. */
export function isWeChatMpOAuthEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_AUTH_WECHAT_MP_ID?.trim()) || isWeChatMpOAuthConfigured();
}

/**
 * Pick the WeChat provider:
 * - WeChat in-app browser → OfficialAccount OAuth (wechat-oauth)
 * - Desktop → WebsiteApp QR login
 *
 * iOS Safari is routed to /login/wechat-mini by the launch route before this
 * provider is used.
 */
export function getWeChatSignInProviderId(userAgent = ''): typeof WECHAT_WEB_PROVIDER_ID | typeof WECHAT_OAUTH_PROVIDER_ID {
  const inWeChat = isWeChatInAppBrowser(userAgent);

  if (inWeChat && isWeChatMpOAuthConfigured()) {
    return WECHAT_OAUTH_PROVIDER_ID;
  }

  return WECHAT_WEB_PROVIDER_ID;
}

/** Desktop WebsiteApp QR is always available; mobile needs WebsiteApp or in-app MP OAuth. */
export function isWeChatMobileLoginAvailable(userAgent = ''): boolean {
  const onMobile = isMobileDevice(userAgent);
  const inWeChat = isWeChatInAppBrowser(userAgent);
  if (shouldUseWeChatMiniProgramLogin(userAgent)) return true;
  if (!onMobile && !inWeChat) return true;
  if (inWeChat) return isWeChatMpOAuthConfigured() || isWeChatMpOAuthEnabled();
  return isWeChatMpOAuthEnabled() || isWeChatWebOAuthConfigured();
}

export function isWeChatProvider(provider: string | null | undefined): boolean {
  return provider === WECHAT_WEB_PROVIDER_ID || provider === WECHAT_OAUTH_PROVIDER_ID;
}

export function normalizeWeChatProviderId(provider: string): string {
  return provider === WECHAT_OAUTH_PROVIDER_ID ? WECHAT_WEB_PROVIDER_ID : provider;
}

export function normalizeWeChatOAuthAccount<T extends { provider: string }>(account: T): T {
  if (account.provider === WECHAT_OAUTH_PROVIDER_ID) {
    return { ...account, provider: WECHAT_WEB_PROVIDER_ID };
  }
  return account;
}

export function getWeChatSignInButtonLabel(userAgent = ''): string {
  if (isWeChatInAppBrowser(userAgent)) {
    return isWeChatMpOAuthEnabled() ? '使用微信授权登录' : '使用微信登录（待配置公众号）';
  }
  if (shouldUseWeChatMiniProgramLogin(userAgent)) {
    return '使用微信小程序登录';
  }
  if (isMobileDevice(userAgent)) {
    return isWeChatMpOAuthEnabled() || isWeChatWebOAuthConfigured()
      ? '使用微信授权登录'
      : '使用微信登录（待配置公众号）';
  }
  return '使用微信扫码登录';
}

export function getWeChatLinkHint(userAgent = ''): string | null {
  const onMobile = isMobileDevice(userAgent);
  const inWeChat = isWeChatInAppBrowser(userAgent);

  if (inWeChat && !isWeChatMpOAuthEnabled()) {
    return '微信内登录需配置公众号网页授权。配置完成前请使用邮箱登录。';
  }
  if (shouldUseWeChatMiniProgramLogin(userAgent)) {
    return '将通过微信小程序完成授权，请在授权后返回本页。';
  }
  if (onMobile && !inWeChat && isWeChatMpOAuthEnabled()) {
    return '手机端将跳转到微信 App 授权，无需扫码。';
  }
  if (onMobile && !inWeChat && !isWeChatWebOAuthConfigured()) {
    return '手机端需配置公众号或网站应用微信登录。请使用邮箱登录，或在电脑端扫码。';
  }
  if (onMobile && !inWeChat && isWeChatWebOAuthConfigured()) {
    return '手机端将打开微信 App 授权，无需扫码。';
  }
  return null;
}
