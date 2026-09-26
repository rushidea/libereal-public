// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createMemoryMfaRateLimitStore,
  enforceMfaChallengeCreationRateLimits,
  enforceMfaRateLimits,
  mfaRateLimitKey,
  MFA_CHALLENGE_CREATION_POLICY,
  MFA_RATE_LIMIT_POLICY,
} from '@/lib/security/mfa-rate-limit';

describe('MFA rate limits', () => {
  it('derives stable keys per scope', () => {
    expect(mfaRateLimitKey('user', 'u1')).toBe('mfa:user:u1');
    expect(mfaRateLimitKey('provider', 'google:u1')).toBe('mfa:provider:google:u1');
    expect(mfaRateLimitKey('setup', 'u1')).toBe('mfa:setup:u1');
  });

  it('blocks after the user and provider windows are exhausted', async () => {
    const store = createMemoryMfaRateLimitStore();
    for (let i = 0; i < MFA_RATE_LIMIT_POLICY.user; i += 1) {
      const result = await enforceMfaRateLimits({ store, userId: 'user-1', provider: 'google', ip: '1.2.3.4' });
      expect(result.allowed).toBe(true);
    }
    const blocked = await enforceMfaRateLimits({ store, userId: 'user-1', provider: 'google', ip: '1.2.3.4' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons).toContain('user_limit');
  });

  it('tracks IP and provider dimensions independently', async () => {
    const store = createMemoryMfaRateLimitStore();
    for (let i = 0; i < MFA_RATE_LIMIT_POLICY.provider; i += 1) {
      await enforceMfaRateLimits({ store, userId: 'user-a', provider: 'wechat', ip: '10.0.0.1' });
    }
    const otherProvider = await enforceMfaRateLimits({ store, userId: 'user-b', provider: 'credentials', ip: '10.0.0.1' });
    expect(otherProvider.allowed).toBe(true);
    const otherIp = await enforceMfaRateLimits({ store, userId: 'user-c', provider: 'wechat', ip: '10.0.0.2' });
    expect(otherIp.allowed).toBe(true);
    const blockedIp = await enforceMfaRateLimits({ store, userId: 'user-a', provider: 'wechat', ip: '10.0.0.1' });
    expect(blockedIp.allowed).toBe(false);
  });

  it('enforces the setup-confirmation window', async () => {
    const store = createMemoryMfaRateLimitStore();
    for (let i = 0; i < MFA_RATE_LIMIT_POLICY.setup; i += 1) {
      const result = await enforceMfaRateLimits({ store, userId: 'user-1', provider: 'setup', setup: true });
      expect(result.allowed).toBe(true);
    }
    const blocked = await enforceMfaRateLimits({ store, userId: 'user-1', provider: 'setup', setup: true });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons).toContain('setup_limit');
  });

  it('limits login Challenge creation independently from verification attempts', async () => {
    const store = createMemoryMfaRateLimitStore();
    for (let i = 0; i < MFA_CHALLENGE_CREATION_POLICY.user; i += 1) {
      const result = await enforceMfaChallengeCreationRateLimits({
        store,
        userId: 'user-1',
        provider: 'google',
        ip: '1.2.3.4',
      });
      expect(result.allowed).toBe(true);
    }
    const blocked = await enforceMfaChallengeCreationRateLimits({
      store,
      userId: 'user-1',
      provider: 'google',
      ip: '1.2.3.4',
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons).toContain('user_challenge_limit');

    const verification = await enforceMfaRateLimits({
      store,
      userId: 'user-1',
      provider: 'google',
      ip: '1.2.3.4',
    });
    expect(verification.allowed).toBe(true);
  });
});
