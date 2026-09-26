import { describe, expect, it, vi } from 'vitest';
import {
  getWeChatSignInButtonLabel,
  getWeChatSignInProviderId,
  getWeChatLinkHint,
  isIOSSafari,
  isMobileDevice,
  isWeChatInAppBrowser,
  isWeChatMobileLoginAvailable,
  isWeChatProvider,
  normalizeWeChatOAuthAccount,
  shouldUseWeChatMiniProgramLogin,
} from '@/lib/wechat-auth';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.43(0x18002b2d) NetType/WIFI Language/zh_CN';

describe('wechat-auth', () => {
  it('detects WeChat in-app browser', () => {
    expect(isWeChatInAppBrowser(WECHAT_UA)).toBe(true);
    expect(isWeChatInAppBrowser(IPHONE_UA)).toBe(false);
  });

  it('detects mobile devices', () => {
    expect(isMobileDevice(IPHONE_UA)).toBe(true);
    expect(isMobileDevice(DESKTOP_UA)).toBe(false);
  });

  it('detects iOS Safari for mini program login', () => {
    expect(isIOSSafari(IPHONE_UA)).toBe(true);
    expect(isIOSSafari(WECHAT_UA)).toBe(false);
    expect(shouldUseWeChatMiniProgramLogin(IPHONE_UA)).toBe(true);
  });

  it('uses website QR provider on desktop when MP OAuth is disabled', () => {
    expect(getWeChatSignInProviderId(DESKTOP_UA)).toBe('wechat');
  });

  it('falls back to website QR on mobile when MP OAuth is not configured', () => {
    expect(getWeChatSignInProviderId(IPHONE_UA)).toBe('wechat');
  });

  it('does not use MP OAuth directly on mobile Safari when MP OAuth is configured', () => {
    vi.stubEnv('AUTH_WECHAT_MP_ID', 'wx-mp-id');
    vi.stubEnv('AUTH_WECHAT_MP_SECRET', 'mp-secret');
    expect(getWeChatSignInProviderId(IPHONE_UA)).toBe('wechat');
    vi.unstubAllEnvs();
  });

  it('uses MP OAuth inside WeChat in-app browser', () => {
    vi.stubEnv('AUTH_WECHAT_MP_ID', 'wx-mp-id');
    vi.stubEnv('AUTH_WECHAT_MP_SECRET', 'mp-secret');
    expect(getWeChatSignInProviderId(WECHAT_UA)).toBe('wechat-oauth');
    vi.unstubAllEnvs();
  });

  it('allows mobile Safari via mini program login when MP OAuth is configured', () => {
    vi.stubEnv('AUTH_WECHAT_MP_ID', 'wx-mp-id');
    vi.stubEnv('AUTH_WECHAT_MP_SECRET', 'mp-secret');
    expect(isWeChatMobileLoginAvailable(IPHONE_UA)).toBe(true);
    expect(getWeChatLinkHint(IPHONE_UA)).toContain('微信小程序');
    vi.unstubAllEnvs();
  });

  it('allows Safari mini program login but blocks in-app login when MP OAuth is not configured', () => {
    expect(isWeChatMobileLoginAvailable(WECHAT_UA)).toBe(false);
    expect(isWeChatMobileLoginAvailable(IPHONE_UA)).toBe(true);
    expect(getWeChatLinkHint(WECHAT_UA)).toContain('公众号');
    expect(getWeChatLinkHint(IPHONE_UA)).toContain('微信小程序');
  });

  it('keeps mobile Safari on mini program login when website app is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_WECHAT_ID', 'wx-web-id');
    expect(isWeChatMobileLoginAvailable(IPHONE_UA)).toBe(true);
    expect(getWeChatLinkHint(IPHONE_UA)).toContain('微信小程序');
    vi.unstubAllEnvs();
  });

  it('normalizes oauth provider account to wechat', () => {
    expect(normalizeWeChatOAuthAccount({ provider: 'wechat-oauth' }).provider).toBe('wechat');
    expect(normalizeWeChatOAuthAccount({ provider: 'wechat' }).provider).toBe('wechat');
  });

  it('recognizes both wechat providers', () => {
    expect(isWeChatProvider('wechat')).toBe(true);
    expect(isWeChatProvider('wechat-oauth')).toBe(true);
    expect(isWeChatProvider('google')).toBe(false);
  });

  it('shows context-aware button labels', () => {
    expect(getWeChatSignInButtonLabel(DESKTOP_UA)).toBe('使用微信扫码登录');
    expect(getWeChatSignInButtonLabel(IPHONE_UA)).toBe('使用微信小程序登录');
  });
});
