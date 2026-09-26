import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getRequestIp: vi.fn(),
  createMfaStepUpChallenge: vi.fn(),
  verifyMfaStepUpChallenge: vi.fn(),
  markSecuritySessionMfaVerified: vi.fn(),
  setMfaChallengeCookie: vi.fn(),
  readMfaChallengeCookie: vi.fn(),
  clearMfaChallengeCookie: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/security/mfa-rate-limit', () => ({ getRequestIp: mocks.getRequestIp }));
vi.mock('@/lib/security/mfa-service', () => ({
  createMfaStepUpChallenge: mocks.createMfaStepUpChallenge,
  verifyMfaStepUpChallenge: mocks.verifyMfaStepUpChallenge,
}));
vi.mock('@/lib/security/security-session-service', () => ({ markSecuritySessionMfaVerified: mocks.markSecuritySessionMfaVerified }));
vi.mock('@/lib/security/mfa-cookie', () => ({
  setMfaChallengeCookie: mocks.setMfaChallengeCookie,
  readMfaChallengeCookie: mocks.readMfaChallengeCookie,
  clearMfaChallengeCookie: mocks.clearMfaChallengeCookie,
}));

import { POST } from '@/app/api/auth/mfa/step-up/route';

const user = { id: 'user-1', email: 'user@example.com', role: 'customer', sessionId: 'session-1' };
const previousMfaPhase1 = process.env.MFA_PHASE1_ENABLED;

beforeEach(() => {
  process.env.MFA_PHASE1_ENABLED = 'true';
  vi.clearAllMocks();
});

afterAll(() => {
  if (previousMfaPhase1 === undefined) delete process.env.MFA_PHASE1_ENABLED;
  else process.env.MFA_PHASE1_ENABLED = previousMfaPhase1;
});

describe('MFA step-up route', () => {
  it('creates a current-session challenge without requiring a new login', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.getRequestIp.mockResolvedValue('127.0.0.1');
    mocks.createMfaStepUpChallenge.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      token: 'opaque-token',
      provider: 'credentials',
      expiresAt: new Date('2026-08-07T00:05:00.000Z'),
    });

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challengeId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-08-07T00:05:00.000Z',
    });
    expect(mocks.setMfaChallengeCookie).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'opaque-token');
  });

  it('consumes the TOTP step-up and records it on the current session', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.getRequestIp.mockResolvedValue('127.0.0.1');
    mocks.readMfaChallengeCookie.mockResolvedValue('opaque-token');
    mocks.verifyMfaStepUpChallenge.mockResolvedValue({ ok: true, verifiedAt: 1775520000000 });
    mocks.markSecuritySessionMfaVerified.mockResolvedValue(true);

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, verifiedAt: 1775520000000 });
    expect(mocks.markSecuritySessionMfaVerified).toHaveBeenCalledWith('user-1', 'session-1', new Date(1775520000000));
    expect(mocks.clearMfaChallengeCookie).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('rejects malformed TOTP input before consuming a challenge', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ challengeId: '11111111-1111-4111-8111-111111111111', code: '1234' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(mocks.verifyMfaStepUpChallenge).not.toHaveBeenCalled();
  });

  it('rejects the removed administrator grant scope', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ challengeId: '11111111-1111-4111-8111-111111111111', code: '123456', grantScope: 'admin_mfa_policy' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: '请使用统一安全验证接口' });
    expect(mocks.createMfaStepUpChallenge).not.toHaveBeenCalled();
  });

  it('rejects legacy grant scopes', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', {
      method: 'POST',
      body: JSON.stringify({ grantScope: 'login' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(410);
    expect(mocks.createMfaStepUpChallenge).not.toHaveBeenCalled();
  });

  it('passes through unauthenticated responses from the active-session gate', async () => {
    const denied = NextResponse.json({ error: '未登录' }, { status: 401 });
    mocks.requireActiveSession.mockResolvedValue(denied);

    const response = await POST(new Request('http://localhost/api/auth/mfa/step-up', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401);
  });
});
