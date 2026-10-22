import { describe, expect, it } from 'vitest';
import {
  appendAuthCallbackUrl,
  callbackPathFromAuthUrl,
  sanitizeAuthCallbackUrl,
  withAuthCallback,
} from '@/lib/auth-callback-url';

describe('sanitizeAuthCallbackUrl', () => {
  it('accepts a same-site inquiry return path', () => {
    expect(sanitizeAuthCallbackUrl('/inquiry')).toBe('/inquiry');
    expect(sanitizeAuthCallbackUrl('/inquiry?step=form')).toBe('/inquiry?step=form');
  });

  it('rejects protocol-relative and absolute urls', () => {
    expect(sanitizeAuthCallbackUrl('//evil.example/phish')).toBe('/');
    expect(sanitizeAuthCallbackUrl('https://evil.example/phish')).toBe('/');
    expect(sanitizeAuthCallbackUrl('/%2F%2Fevil.example')).toBe('/');
    expect(sanitizeAuthCallbackUrl('/\\evil.example')).toBe('/');
    expect(sanitizeAuthCallbackUrl('inquiry')).toBe('/');
    expect(sanitizeAuthCallbackUrl(null, '/account')).toBe('/account');
  });
});

describe('callbackPathFromAuthUrl', () => {
  it('reads /inquiry from an auth.js callback cookie', () => {
    expect(callbackPathFromAuthUrl('http://localhost:3000/inquiry')).toBe('/inquiry');
  });

  it('keeps a nested return path through the register round-trip', () => {
    expect(callbackPathFromAuthUrl('http://localhost:3000/register?oauth=google&callbackUrl=%2Finquiry')).toBe('/inquiry');
    expect(callbackPathFromAuthUrl('/login?callbackUrl=/inquiry')).toBe('/inquiry');
  });

  it('drops a nested open redirect', () => {
    expect(callbackPathFromAuthUrl('/register?callbackUrl=//evil.example')).toBeUndefined();
  });
});

describe('auth callback helpers', () => {
  it('appends the inquiry return path onto register and mfa redirects', () => {
    expect(withAuthCallback('/register?wechat=unlinked', '/inquiry')).toBe('/register?wechat=unlinked&callbackUrl=%2Finquiry');
    expect(appendAuthCallbackUrl('/login/mfa?challengeId=abc&provider=credentials', '/inquiry'))
      .toBe('/login/mfa?challengeId=abc&provider=credentials&callbackUrl=%2Finquiry');
    expect(appendAuthCallbackUrl('http://localhost:3000/login/mfa?challengeId=abc', '//evil.example'))
      .toBe('http://localhost:3000/login/mfa?challengeId=abc');
  });
});
