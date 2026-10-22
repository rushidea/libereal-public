import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getTrustedClientIp } from '@/lib/trusted-client-ip';

describe('getTrustedClientIp', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const req = new NextRequest('http://localhost/', {
      headers: {
        'x-real-ip': '203.0.113.1',
        'x-forwarded-for': '198.51.100.2, 10.0.0.1',
      },
    });
    expect(getTrustedClientIp(req)).toBe('203.0.113.1');
  });

  it('uses the rightmost x-forwarded-for hop when x-real-ip is absent', () => {
    const req = new NextRequest('http://localhost/', {
      headers: { 'x-forwarded-for': 'spoofed, 198.51.100.9, 10.0.0.5' },
    });
    expect(getTrustedClientIp(req)).toBe('10.0.0.5');
  });
});
