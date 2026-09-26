import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, cleanupRateLimitStore } from '@/lib/rateLimit';

describe('rateLimit', () => {
  beforeEach(() => {
    cleanupRateLimitStore();
  });

  it('should allow first request from an IP', () => {
    const result = rateLimit('10.0.0.1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.resetIn).toBeGreaterThan(0);
  });

  it('should track consecutive requests from same IP', () => {
    rateLimit('10.0.0.2');
    const second = rateLimit('10.0.0.2');
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = rateLimit('10.0.0.2');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('should block excess requests from same IP', () => {
    const ip = '10.0.0.99';
    rateLimit(ip);
    rateLimit(ip);
    rateLimit(ip);
    const fourth = rateLimit(ip);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetIn).toBeGreaterThan(0);
  });

  it('should track different IPs independently', () => {
    rateLimit('10.0.0.10');
    rateLimit('10.0.0.11');
    const result = rateLimit('10.0.0.12');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });
});