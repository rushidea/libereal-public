// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  user: { role: 'admin', isFrozen: false, email: 'test@example.test', emailVerified: new Date(), phone: null, phoneVerifiedAt: null },
  session: { id: 'test-admin', sessionId: 'test-session', role: 'admin' },
  store: new Map<string, { value: string; expiresAt: number }>(),
  sendMail: vi.fn(), sendSms: vi.fn(), event: vi.fn(), markMfa: vi.fn(), activeSession: vi.fn(), rate: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => mocks.user) }, securityEvent: { create: mocks.event } } }));
vi.mock('@/lib/security/mfa-service', () => ({ getMfaAuthenticatorPresence: () => ({ hasTotp: false }), createMfaStepUpChallenge: vi.fn(), verifyMfaStepUpChallenge: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendMail: mocks.sendMail }));
vi.mock('@/lib/aliyun-sms', () => ({ sendAliyunSmsCode: mocks.sendSms }));
vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.activeSession }));
vi.mock('@/lib/security/security-session-service', () => ({ markSecuritySessionMfaVerified: mocks.markMfa }));
vi.mock('@/lib/security/mfa-cookie', () => ({ clearMfaChallengeCookie: vi.fn(), readMfaChallengeCookie: vi.fn(), setMfaChallengeCookie: vi.fn() }));
vi.mock('@/lib/security/mfa-rate-limit', () => ({ enforceMfaRateLimits: mocks.rate, getRequestIp: async () => '127.0.0.1' }));
vi.mock('@/lib/ephemeral-store', () => ({ getEphemeralStore: () => ({
  get: async (key: string) => { const item = mocks.store.get(key); return item && item.expiresAt > Date.now() ? item.value : null; },
  set: async (key: string, value: string, ttlMs: number) => { mocks.store.set(key, { value, expiresAt: Date.now() + ttlMs }); },
  delete: async (key: string) => { mocks.store.delete(key); },
  compareAndDelete: async (key: string, value: string) => {
    const item = mocks.store.get(key);
    return !!item && item.expiresAt > Date.now() && item.value === value && mocks.store.delete(key);
  },
  acquireLock: async () => 'lock', releaseLock: async () => undefined,
}) }));

import { getStagingMfaTestConfig, hashStagingMfaTestCode } from '@/lib/security/staging-mfa-test';
import { completeSecurityStepUp, consumeSecurityStepUpGrant, getSecurityStepUpAvailability, hasSecurityStepUpGrant, startSecurityStepUp } from '@/lib/security/security-step-up';
import { GET, POST } from '@/app/api/auth/security/step-up/route';

const code = '825174'; // Synthetic test-only input; deployed configuration is separate.
const scope = { userId: 'test-admin', sessionId: 'test-session', action: 'admin_sensitive' as const };
const request = (body: Record<string, unknown>) => new Request('https://staging.example.test/api/auth/security/step-up', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const start = () => startSecurityStepUp({ ...scope, method: 'staging_test' });
const complete = (challengeId: string, override: Record<string, unknown> = {}) => completeSecurityStepUp({ ...scope, challengeId, method: 'staging_test', code, ...override });

describe('explicit staging MFA simulation', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.store.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-02T00:00:00Z'));
    mocks.user.role = 'admin'; mocks.user.isFrozen = false;
    mocks.activeSession.mockResolvedValue(mocks.session); mocks.markMfa.mockResolvedValue(true);
    mocks.rate.mockResolvedValue({ allowed: true }); mocks.sendMail.mockResolvedValue({ ok: true });
    vi.stubEnv('LIBEREAL_RUNTIME_ENV', 'staging'); vi.stubEnv('AUTH_URL', 'https://staging.example.test');
    vi.stubEnv('STAGING_MFA_TEST_ENABLED', 'true'); vi.stubEnv('STAGING_MFA_TEST_ORIGIN', 'https://staging.example.test');
    vi.stubEnv('STAGING_MFA_TEST_USER_IDS', JSON.stringify([scope.userId])); vi.stubEnv('STAGING_MFA_TEST_CODE_SHA256', hashStagingMfaTestCode(code));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it.each([
    ['LIBEREAL_RUNTIME_ENV', 'production'], ['LIBEREAL_RUNTIME_ENV', ''],
    ['STAGING_MFA_TEST_ENABLED', 'false'], ['STAGING_MFA_TEST_ORIGIN', 'https://www.example.test'],
    ['AUTH_URL', 'https://www.example.test'], ['AUTH_URL', 'https://staging.example.test.evil/path'],
    ['STAGING_MFA_TEST_USER_IDS', '["another-user"]'], ['STAGING_MFA_TEST_USER_IDS', '{broken'],
    ['STAGING_MFA_TEST_CODE_SHA256', 'not-a-hash'],
  ])('disables test authentication for invalid runtime configuration %s=%s', async (key, value) => {
    vi.stubEnv(key, value);
    expect(getStagingMfaTestConfig(scope.userId)).toBeNull();
    expect((await getSecurityStepUpAvailability(scope.userId, scope.action)).methods).not.toContain('staging_test');
    await expect(start()).rejects.toThrow('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
  });

  it('requires the current server-side administrator and limits tests to business step-up', async () => {
    mocks.user.role = 'customer'; await expect(start()).rejects.toThrow('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
    mocks.user.role = 'admin'; mocks.user.isFrozen = true; await expect(start()).rejects.toThrow('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
    mocks.user.isFrozen = false;
    await expect(startSecurityStepUp({ ...scope, action: 'mfa_disable', method: 'staging_test' })).rejects.toThrow('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
    expect((await getSecurityStepUpAvailability(scope.userId)).methods).not.toContain('staging_test');
  });

  it('uses the normal challenge, audit and one-use grant without sending a code', async () => {
    const challenge = await start();
    const result = await complete(challenge.challengeId);
    expect(result).toHaveProperty('grantToken'); if (!('grantToken' in result)) throw new Error('missing grant');
    expect(mocks.sendMail).not.toHaveBeenCalled(); expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.event.mock.calls[0][0].data.metadata)).toMatchObject({ method: 'staging_test', action: scope.action });
    expect(await hasSecurityStepUpGrant(result.grantToken, scope)).toBe(true);
    expect(await consumeSecurityStepUpGrant(result.grantToken, { ...scope, sessionId: 'another-session' })).toBe(false);
    expect(await consumeSecurityStepUpGrant(result.grantToken, { ...scope, action: 'mfa_disable' })).toBe(false);
    expect(await consumeSecurityStepUpGrant(result.grantToken, scope)).toBe(true);
    expect(await consumeSecurityStepUpGrant(result.grantToken, scope)).toBe(false);
    expect(await complete(challenge.challengeId)).toEqual({ error: 'expired' });
  });

  it('keeps challenge identity and rate limits enforced', async () => {
    const challenge = await start();
    expect(await complete(challenge.challengeId, { userId: 'another-user' })).toEqual({ error: 'invalid' });
    expect(await complete(challenge.challengeId, { sessionId: 'another-session' })).toEqual({ error: 'invalid' });
    expect(await complete(challenge.challengeId, { action: 'password_change' })).toEqual({ error: 'invalid' });
    mocks.rate.mockResolvedValue({ allowed: false }); await expect(start()).rejects.toThrow('SECURITY_STEP_UP_RATE_LIMITED');
  });

  it('locks repeated failures and never extends a challenge by entering a wrong code', async () => {
    const challenge = await start();
    vi.advanceTimersByTime(9 * 60_000);
    expect(await complete(challenge.challengeId, { code: '000000' })).toEqual({ error: 'invalid' });
    vi.advanceTimersByTime(61_000);
    expect(await complete(challenge.challengeId)).toEqual({ error: 'expired' });
    const fresh = await start();
    for (let n = 0; n < 4; n++) expect(await complete(fresh.challengeId, { code: '000000' })).toEqual({ error: 'invalid' });
    expect(await complete(fresh.challengeId, { code: '000000' })).toEqual({ error: 'locked' });
    expect(await complete(fresh.challengeId)).toEqual({ error: 'expired' });
  });

  it('expires an unused grant and invalidates both challenge and grant after configuration changes', async () => {
    const challenge = await start(); const second = await start(); const result = await complete(challenge.challengeId);
    if (!('grantToken' in result)) throw new Error('missing grant');
    vi.stubEnv('STAGING_MFA_TEST_ENABLED', 'false');
    expect(await complete(second.challengeId)).toEqual({ error: 'invalid' });
    expect(await consumeSecurityStepUpGrant(result.grantToken, scope)).toBe(false);
    vi.stubEnv('STAGING_MFA_TEST_ENABLED', 'true'); vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await consumeSecurityStepUpGrant(result.grantToken, scope)).toBe(false);
  });

  it('does not let runtime, code or role claims in HTTP bodies authorize a production request', async () => {
    vi.stubEnv('LIBEREAL_RUNTIME_ENV', 'production');
    const response = await POST(request({ action: scope.action, method: 'staging_test', role: 'admin', runtime: 'staging', fixedCode: code }));
    expect(response.status).toBe(409); expect(mocks.store.size).toBe(0);
    mocks.activeSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    expect((await POST(request({ action: scope.action, method: 'staging_test' }))).status).toBe(401);
  });

  it('exercises the real HTTP flow but never upgrades the session to real MFA verified', async () => {
    const availability = await GET(new Request('https://staging.example.test/api/auth/security/step-up?action=admin_sensitive'));
    expect(await availability.json()).toMatchObject({ preferredMethod: 'staging_test' });
    const started = await POST(request({ action: scope.action, method: 'staging_test' }));
    const challenge = await started.json();
    const failed = await POST(request({ action: scope.action, method: 'staging_test', challengeId: challenge.challengeId, code: '000000' }));
    expect(failed.status).toBe(400);
    const verified = await POST(request({ action: scope.action, method: 'staging_test', challengeId: challenge.challengeId, code }));
    expect(verified.status).toBe(200); expect(await verified.json()).toHaveProperty('grantToken');
    expect(mocks.markMfa).not.toHaveBeenCalled();
  });
});
