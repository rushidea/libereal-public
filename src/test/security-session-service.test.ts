import { describe, expect, it } from 'vitest';
import {
  buildDeviceFingerprint,
  createSecurityRequestMetadata,
  parseUserAgent,
} from '@/lib/security/security-session-service';

describe('security session metadata', () => {
  it('parses common browser and operating system values', () => {
    expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36')).toEqual({
      browser: 'Chrome',
      operatingSystem: 'macOS',
    });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toEqual({
      browser: 'Safari',
      operatingSystem: 'iOS',
    });
  });

  it('keeps fingerprints stable for the same user and request context', () => {
    const first = buildDeviceFingerprint('user-1', 'browser', '1.2.3.4');
    const second = buildDeviceFingerprint('user-1', 'browser', '1.2.3.4');
    expect(first).toBe(second);
    expect(first).toBe(buildDeviceFingerprint('user-1', 'browser', '5.6.7.8'));
    expect(first).not.toBe(buildDeviceFingerprint('user-2', 'browser', '1.2.3.4'));
  });

  it('truncates request metadata and never uses raw input as a fingerprint', () => {
    const metadata = createSecurityRequestMetadata({
      userId: 'user-1',
      userAgent: 'x'.repeat(600),
      ip: '1.2.3.4',
    });
    expect(metadata.userAgent).toHaveLength(512);
    expect(metadata.fingerprint).not.toContain('1.2.3.4');
    expect(metadata.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
