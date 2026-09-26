import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryCacheData, DiscoveryItem } from '@/data/discoveries';

const mocks = vi.hoisted(() => ({
  readDiscoveryCache: vi.fn(),
  writeDiscoveryCache: vi.fn(),
  refreshDiscoveries: vi.fn(),
}));

vi.mock('@/lib/discoveries-cache', () => ({
  readDiscoveryCache: mocks.readDiscoveryCache,
  writeDiscoveryCache: mocks.writeDiscoveryCache,
}));

vi.mock('@/lib/discoveries', () => ({
  refreshDiscoveries: mocks.refreshDiscoveries,
}));

import { GET } from '@/app/api/discoveries/route';

const item: DiscoveryItem = {
  id: 'cmi-1',
  journalId: 'cmi',
  journal: 'Cellular & Molecular Immunology',
  institution: '中国科学技术大学、中国免疫学会',
  city: '合肥',
  title: '论文标题',
  authors: ['Author One'],
  articleType: '研究论文',
  publishedAt: '2026-07-17',
  url: 'https://doi.org/10.1000/example',
};

const cache: DiscoveryCacheData = {
  discoveries: [item, { ...item, id: 'cmi-2' }],
  updatedAt: '2026-07-20T00:00:00.000Z',
  sources: {
    jbr: { fetched: 1, available: true },
    cmi: { fetched: 2, available: true },
    cjnm: { fetched: 1, available: true },
  },
};

describe('GET /api/discoveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readDiscoveryCache.mockReturnValue(null);
    mocks.refreshDiscoveries.mockResolvedValue(cache);
  });

  it('returns a fresh cache and respects the requested limit', async () => {
    mocks.readDiscoveryCache.mockReturnValueOnce(cache);
    const response = await GET(new Request('https://libereal.cn/api/discoveries?limit=1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      discoveries: [{ id: 'cmi-1' }],
      source: 'cache',
    });
    expect(mocks.refreshDiscoveries).not.toHaveBeenCalled();
  });

  it('writes successful refresh results to the cache', async () => {
    const response = await GET(new Request('https://libereal.cn/api/discoveries'));

    expect(response.status).toBe(200);
    expect(mocks.writeDiscoveryCache).toHaveBeenCalledWith(cache);
    await expect(response.json()).resolves.toMatchObject({ source: 'fresh' });
  });

  it('returns stale data when every source refresh fails', async () => {
    mocks.readDiscoveryCache
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(cache);
    mocks.refreshDiscoveries.mockRejectedValue(new Error('upstream unavailable'));

    const response = await GET(new Request('https://libereal.cn/api/discoveries'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ source: 'stale' });
    expect(mocks.writeDiscoveryCache).not.toHaveBeenCalled();
  });

  it('returns 503 when no current or stale data exists', async () => {
    mocks.refreshDiscoveries.mockResolvedValue({ ...cache, discoveries: [] });
    const response = await GET(new Request('https://libereal.cn/api/discoveries'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ discoveries: [] });
  });
});
