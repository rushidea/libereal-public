import type { NextRequest } from 'next/server';

/**
 * Prefer x-real-ip (set by the edge proxy). When only X-Forwarded-For is present,
 * use the rightmost hop (closest to the proxy), not the leftmost client-supplied value.
 */
export function getTrustedClientIp(req: NextRequest | Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }

  return 'unknown';
}
