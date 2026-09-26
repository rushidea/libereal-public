import { NextResponse } from 'next/server';
import { DISCOVERY_PAGE_SIZE, type DiscoveryItem } from '@/data/discoveries';
import { refreshDiscoveries } from '@/lib/discoveries';
import { readDiscoveryCache, writeDiscoveryCache } from '@/lib/discoveries-cache';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=21600',
};

function parseLimit(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get('limit') ?? '', 10);
  if (!Number.isFinite(parsed)) return DISCOVERY_PAGE_SIZE;
  return Math.min(50, Math.max(1, parsed));
}

function response(
  discoveries: DiscoveryItem[],
  updatedAt: string,
  source: 'cache' | 'fresh' | 'stale'
) {
  return NextResponse.json(
    { discoveries, updatedAt, source },
    { headers: RESPONSE_HEADERS }
  );
}

export async function GET(request: Request) {
  const limit = parseLimit(new URL(request.url).searchParams);
  const freshCache = readDiscoveryCache();
  if (freshCache) {
    return response(freshCache.discoveries.slice(0, limit), freshCache.updatedAt, 'cache');
  }

  const staleCache = readDiscoveryCache({ allowStale: true });
  try {
    const refreshed = await refreshDiscoveries();
    if (refreshed.discoveries.length === 0) {
      if (staleCache?.discoveries.length) {
        return response(staleCache.discoveries.slice(0, limit), staleCache.updatedAt, 'stale');
      }
      return NextResponse.json(
        { discoveries: [], updatedAt: refreshed.updatedAt, source: 'fresh' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    writeDiscoveryCache(refreshed);
    return response(refreshed.discoveries.slice(0, limit), refreshed.updatedAt, 'fresh');
  } catch (error) {
    console.error('[Discoveries API] Refresh failed:', error);
    if (staleCache?.discoveries.length) {
      return response(staleCache.discoveries.slice(0, limit), staleCache.updatedAt, 'stale');
    }
    return NextResponse.json(
      { discoveries: [], updatedAt: new Date().toISOString(), source: 'none' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
