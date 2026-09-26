// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  createMfaStepUpChallenge: vi.fn(),
  verifyMfaStepUpChallenge: vi.fn(),
  sendMail: vi.fn(),
  sendAliyunSmsCode: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique }, securityEvent: { create: vi.fn() } } }));
vi.mock('@/lib/security/mfa-service', () => ({
  getMfaAuthenticatorPresence: vi.fn(() => ({ hasTotp: true, hasPasskey: true })),
  createMfaStepUpChallenge: mocks.createMfaStepUpChallenge,
  verifyMfaStepUpChallenge: mocks.verifyMfaStepUpChallenge,
}));
vi.mock('@/lib/mail', () => ({ sendMail: mocks.sendMail }));
vi.mock('@/lib/aliyun-sms', () => ({ sendAliyunSmsCode: mocks.sendAliyunSmsCode }));
vi.mock('@/lib/ephemeral-store', () => ({
  getEphemeralStore: () => ({
    get: async (key: string) => mocks.store.get(key) ?? null,
    set: async (key: string, value: string) => { mocks.store.set(key, value); },
    delete: async (key: string) => { mocks.store.delete(key); },
    compareAndDelete: async (key: string, expected: string) => mocks.store.get(key) === expected && (mocks.store.delete(key), true),
    increment: async () => 1,
    acquireLock: async () => 'lock',
    releaseLock: async () => undefined,
  }),
}));
vi.mock('@/lib/security/mfa-rate-limit', () => ({ enforceMfaRateLimits: vi.fn(async () => ({ allowed: true, reasons: [], counts: {} })) }));

import { completeSecurityStepUp, getSecurityStepUpAvailability, startSecurityStepUp } from '@/lib/security/security-step-up';

describe('security step-up', () => {
  beforeEach(() => {
    process.env.MFA_PHASE1_ENABLED = 'true';
    mocks.store.clear();
    mocks.userFindUnique.mockResolvedValue({ email: 'user@example.com', emailVerified: new Date(), phone: '13800000000', phoneVerifiedAt: new Date() });
    mocks.sendMail.mockResolvedValue({ ok: true, provider: 'console' });
    mocks.createMfaStepUpChallenge.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', token: 'totp-token', provider: 'credentials', expiresAt: new Date(Date.now() + 300000) });
  });

  it('prefers TOTP and exposes verified fallback methods', async () => {
    await expect(getSecurityStepUpAvailability('user-1')).resolves.toEqual({ methods: ['totp', 'sms', 'email'], preferredMethod: 'totp' });
  });

  it('sends email codes and issues a one-time operation-bound grant', async () => {
    const challenge = await startSecurityStepUp({ userId: 'user-1', sessionId: 'session-1', action: 'password_change', method: 'email' });
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    const sentText = String(mocks.sendMail.mock.calls[0][0].text);
    const code = sentText.match(/：([0-9]{6})/)?.[1] ?? '';
    const result = await completeSecurityStepUp({ challengeId: challenge.challengeId, userId: 'user-1', sessionId: 'session-1', action: 'password_change', method: 'email', code });
    expect(result).toHaveProperty('grantToken');
  });

  it('sends SMS codes and locks the challenge after repeated invalid codes', async () => {
    const challenge = await startSecurityStepUp({ userId: 'user-1', sessionId: 'session-1', action: 'password_change', method: 'sms' });
    expect(mocks.sendAliyunSmsCode).toHaveBeenCalledOnce();
    const sentCode = String(mocks.sendAliyunSmsCode.mock.calls[0][1]);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(completeSecurityStepUp({
        challengeId: challenge.challengeId,
        userId: 'user-1',
        sessionId: 'session-1',
        action: 'password_change',
        method: 'sms',
        code: '000000',
      })).resolves.toEqual({ error: 'invalid' });
    }
    await expect(completeSecurityStepUp({
      challengeId: challenge.challengeId,
      userId: 'user-1',
      sessionId: 'session-1',
      action: 'password_change',
      method: 'sms',
      code: '000000',
    })).resolves.toEqual({ error: 'locked' });
    await expect(completeSecurityStepUp({
      challengeId: challenge.challengeId,
      userId: 'user-1',
      sessionId: 'session-1',
      action: 'password_change',
      method: 'sms',
      code: sentCode,
    })).resolves.toEqual({ error: 'expired' });
  });

  it('rejects an expired code challenge', async () => {
    const challenge = await startSecurityStepUp({ userId: 'user-1', sessionId: 'session-1', action: 'password_change', method: 'email' });
    mocks.store.delete(`security-step-up:intent:${challenge.challengeId}`);
    await expect(completeSecurityStepUp({
      challengeId: challenge.challengeId,
      userId: 'user-1',
      sessionId: 'session-1',
      action: 'password_change',
      method: 'email',
      code: '000000',
    })).resolves.toEqual({ error: 'expired' });
  });

  it('rejects reuse under another action', async () => {
    const challenge = await startSecurityStepUp({ userId: 'user-1', sessionId: 'session-1', action: 'password_change', method: 'email' });
    const sentText = String(mocks.sendMail.mock.calls[0][0].text);
    const code = sentText.match(/：([0-9]{6})/)?.[1] ?? '';
    await expect(completeSecurityStepUp({ challengeId: challenge.challengeId, userId: 'user-1', sessionId: 'session-1', action: 'passkey_add', method: 'email', code })).resolves.toEqual({ error: 'invalid' });
  });
});
