import { describe, it, expect } from 'vitest';
import {
  isPlaceholderOAuthEmail,
  isBcryptHash,
  userHasPassword,
  WECHAT_EMAIL_DOMAIN,
  normalizeWeChatSex,
  wechatProfileUpdates,
} from '@/lib/auth-helpers';
import {
  createPendingOAuthLink,
  linkSuccessParam,
  linkConflictParam,
  upgradePendingOAuthToMerge,
} from '@/lib/account-linking';

describe('account linking helpers', () => {
  it('detects WeChat placeholder emails', () => {
    expect(isPlaceholderOAuthEmail(`wechat_abc123@${WECHAT_EMAIL_DOMAIN}`)).toBe(true);
    expect(isPlaceholderOAuthEmail('user@example.com')).toBe(false);
    expect(isPlaceholderOAuthEmail(null)).toBe(false);
  });

  it('userHasPassword requires bcrypt hash format', () => {
    expect(isBcryptHash('$2a$12$abcdefghijklmnopqrstuv')).toBe(true);
    expect(userHasPassword('$2a$12$abcdefghijklmnopqrstuv')).toBe(true);
    expect(userHasPassword('plaintext')).toBe(false);
    expect(userHasPassword('')).toBe(false);
    expect(userHasPassword(null)).toBe(false);
  });

  it('builds provider-specific callback params', () => {
    expect(linkSuccessParam('google')).toBe('oauthLink=success');
    expect(linkSuccessParam('wechat')).toBe('wechatLink=success');
    expect(linkConflictParam('google')).toBe('oauthLink=conflict');
    expect(linkConflictParam('wechat')).toBe('wechatLink=conflict');
  });

  it('upgrades register pending oauth to merge mode', () => {
    const pending = createPendingOAuthLink(
      { provider: 'wechat', providerAccountId: 'wx123' },
      'wechat',
      { mode: 'register' },
    );
    const upgraded = upgradePendingOAuthToMerge(pending, 'usr_existing');
    expect(upgraded.mode).toBe('merge');
    expect(upgraded.targetUserId).toBe('usr_existing');
    expect(upgraded.provider).toBe('wechat');
    expect(upgraded.providerAccountId).toBe('wx123');
    expect(upgraded.exp).toBeGreaterThan(Date.now());
  });

  it('stores WeChat profile in pending oauth link', () => {
    const pending = createPendingOAuthLink(
      { provider: 'wechat', providerAccountId: 'wx123' },
      'wechat',
      {
        mode: 'register',
        oauthName: '微信用户',
        oauthImage: 'https://thirdwx.qlogo.cn/mmopen/example/0',
        oauthSex: 1,
      },
    );
    expect(pending.oauthName).toBe('微信用户');
    expect(pending.oauthImage).toContain('qlogo.cn');
    expect(pending.oauthSex).toBe(1);
  });

  it('normalizes WeChat sex values', () => {
    expect(normalizeWeChatSex(0)).toBe(0);
    expect(normalizeWeChatSex(1)).toBe(1);
    expect(normalizeWeChatSex(2)).toBe(2);
    expect(normalizeWeChatSex(3)).toBeUndefined();
    expect(normalizeWeChatSex('1')).toBeUndefined();
    expect(normalizeWeChatSex(null)).toBeUndefined();
  });

  it('builds WeChat profile updates without overwriting custom community fields', () => {
    const empty = wechatProfileUpdates(
      { name: null, wechatNickname: null, displayAvatarUrl: null, sex: null },
      { name: 'Alice', image: 'https://thirdwx.qlogo.cn/a/0', sex: 2 },
    );
    expect(empty).toEqual({
      avatar: 'https://thirdwx.qlogo.cn/a/0',
      name: 'Alice',
      wechatNickname: 'Alice',
      displayAvatarUrl: 'https://thirdwx.qlogo.cn/a/0',
      sex: 2,
    });

    const custom = wechatProfileUpdates(
      {
        name: 'Bob',
        wechatNickname: 'Custom Nick',
        displayAvatarUrl: 'https://example.com/me.png',
        sex: 1,
      },
      { name: 'Alice', image: 'https://thirdwx.qlogo.cn/a/0', sex: 2 },
    );
    expect(custom).toEqual({
      avatar: 'https://thirdwx.qlogo.cn/a/0',
      name: 'Alice',
    });
  });
});
