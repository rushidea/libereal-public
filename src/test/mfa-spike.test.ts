// @vitest-environment node

import { decode } from 'next-auth/jwt';
import { describe, expect, it } from 'vitest';
import {
  beginPrimaryAuthentication,
  encodeSpikeMfaJwt,
  SpikeMfaStore,
  totpCodeAt,
  type SpikeProvider,
} from '@/lib/security/mfa-spike';

const RFC6238_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const AUTH_SECRET = 'phase-1a-test-secret-only';
const AUTH_SALT = 'authjs.session-token';
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

function createSpike() {
  const store = new SpikeMfaStore();
  store.registerTotp('user-1', RFC6238_SECRET);
  return store;
}

describe('Phase 1-A MFA protocol Spike', () => {
  it('calculates the RFC 6238-compatible six digit code', () => {
    expect(totpCodeAt(RFC6238_SECRET, 59_000)).toBe('287082');
  });

  it('turns a correct TOTP into a standard Auth.js JWT with MFA claims', async () => {
    const store = createSpike();
    const challenge = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW },
    );
    if (!('kind' in challenge)) throw new Error('expected challenge');
    expect(challenge.kind).toBe('mfa_challenge');
    const identity = store.verifyChallenge(challenge.challengeToken, totpCodeAt(RFC6238_SECRET, NOW), NOW);
    expect(identity?.authLevel).toBe('mfa_verified');

    if (!identity) throw new Error('expected MFA identity');
    const jwt = await encodeSpikeMfaJwt(identity, { secret: AUTH_SECRET, salt: AUTH_SALT });
    const claims = await decode({ token: jwt, secret: AUTH_SECRET, salt: AUTH_SALT });
    expect(claims?.sub).toBe('user-1');
    expect(claims?.authLevel).toBe('mfa_verified');
    expect(claims?.mfaMethod).toBe('totp');
  });

  it('does not issue an MFA identity for a wrong TOTP', () => {
    const store = createSpike();
    const challenge = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW },
    );
    if (!('kind' in challenge)) throw new Error('expected challenge');

    expect(store.verifyChallenge(challenge.challengeToken, '000000', NOW)).toBeNull();
  });

  it('rejects an expired Challenge and a replayed Challenge', () => {
    const store = createSpike();
    const expired = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW },
    );
    if (!('kind' in expired)) throw new Error('expected challenge');
    expect(store.verifyChallenge(expired.challengeToken, totpCodeAt(RFC6238_SECRET, NOW), expired.expiresAt)).toBeNull();

    const replayable = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW + 60_000 },
    );
    if (!('kind' in replayable)) throw new Error('expected challenge');
    const code = totpCodeAt(RFC6238_SECRET, NOW + 60_000);
    expect(store.verifyChallenge(replayable.challengeToken, code, NOW + 60_000)?.authLevel).toBe('mfa_verified');
    expect(store.verifyChallenge(replayable.challengeToken, code, NOW + 60_000)).toBeNull();
  });

  it('does not allow the same TOTP time step to be replayed through a new Challenge', () => {
    const store = createSpike();
    const first = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW },
    );
    const second = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider: 'credentials' },
      { mfaRequired: true, nowMs: NOW },
    );
    if (!('kind' in first) || !('kind' in second)) throw new Error('expected challenges');
    const code = totpCodeAt(RFC6238_SECRET, NOW);
    expect(store.verifyChallenge(first.challengeToken, code, NOW)?.authLevel).toBe('mfa_verified');
    expect(store.verifyChallenge(second.challengeToken, code, NOW)).toBeNull();
  });

  it.each<SpikeProvider>(['google', 'wechat', 'wechat-mini'])('requires MFA after %s primary authentication', (provider) => {
    const store = createSpike();
    const result = beginPrimaryAuthentication(
      store,
      { userId: 'user-1', email: 'test@example.com', provider },
      { mfaRequired: true, nowMs: NOW },
    );
    expect('kind' in result ? result.kind : undefined).toBe('mfa_challenge');
    if ('kind' in result) {
      expect(result.challengeToken).toBeTruthy();
      expect(result).not.toHaveProperty('authLevel', 'mfa_verified');
    }
  });
});
