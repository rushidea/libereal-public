import { describe, expect, it } from 'vitest';
import { verifiedEmailMatches, verifiedMailboxEmail, verifiedStoredEmail } from '@/lib/verified-email-access';

describe('verified email identity', () => {
  it('accepts a verified deliverable mailbox and ignores case', () => {
    const identity = { email: 'Owner@Example.com', emailVerified: new Date('2026-01-01T00:00:00.000Z') };
    expect(verifiedMailboxEmail(identity)).toBe('owner@example.com');
    expect(verifiedStoredEmail(identity)).toBe('Owner@Example.com');
    expect(verifiedEmailMatches(identity, 'owner@example.com')).toBe(true);
  });

  it('rejects placeholder and unverified mailboxes', () => {
    expect(verifiedMailboxEmail({ email: 'wechat_abc@wechat.local', emailVerified: new Date() })).toBeNull();
    expect(verifiedMailboxEmail({ email: 'owner@example.com', emailVerified: null })).toBeNull();
    expect(verifiedEmailMatches({ email: 'owner@example.com', emailVerified: null }, 'owner@example.com')).toBe(false);
    expect(verifiedStoredEmail({ email: 'owner@example.com', emailVerified: null })).toBeNull();
  });
});
