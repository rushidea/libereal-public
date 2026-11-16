import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshConfirmedPricingPreview } from '@/lib/pricing-confirmation-refresh';

const hash = 'a'.repeat(64);
const approved = { brand: 'Fixture', scope: 'catalog', mode: 'file', includeVariants: false,
  catalogItems: [{ catalogNumber: 'TEST-1', originalPrice: 120 }], reason: 'Confirmed fixture', approvalHash: hash };

describe('pricing preview after identity verification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renews identical catalogue content without sending or consuming the identity grant', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ preview: { approvalHash: hash } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await refreshConfirmedPricingPreview({ ...approved, stepUpToken: 'private-test-grant' }, () => true)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/pricing-adjustments/preview');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ brand: 'Fixture', scope: 'catalog', mode: 'file',
      includeVariants: false, catalogItems: [{ catalogNumber: 'TEST-1', originalPrice: 120 }], reason: 'Confirmed fixture' });
  });

  it.each([undefined, 'b'.repeat(64)])('does not authorize a missing or changed preview hash %s', async nextHash => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ preview: { approvalHash: nextHash } })));
    await expect(refreshConfirmedPricingPreview(approved, () => true)).rejects.toThrow('请重新生成预览并确认');
  });

  it('stops if the displayed approval is changed while the preview is being refreshed', async () => {
    let current = true;
    vi.stubGlobal('fetch', vi.fn(async () => { current = false; return Response.json({ preview: { approvalHash: hash } }); }));
    expect(await refreshConfirmedPricingPreview(approved, () => current)).toBe(false);
  });

  it('uses the existing chunk protocol and checks the final full-content hash', async () => {
    const items = Array.from({ length: 401 }, (_, n) => ({ catalogNumber: `TEST-${n}`, originalPrice: 120 }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ batchId: 'batch-1', complete: false, preview: null }))
      .mockResolvedValueOnce(Response.json({ batchId: 'batch-1', complete: true, preview: { approvalHash: hash } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await refreshConfirmedPricingPreview({ ...approved, catalogItems: items }, () => true)).toBe(true);
    const first = JSON.parse(fetcher.mock.calls[0][1].body);
    const last = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(first).toMatchObject({ chunkIndex: 0, chunkCount: 2 });
    expect(last).toMatchObject({ batchId: 'batch-1', chunkIndex: 1, chunkCount: 2 });
    expect([...first.catalogItems, ...last.catalogItems]).toEqual(items);
    expect(fetcher.mock.calls.every(call => call[0] === '/api/admin/pricing-adjustments/preview/chunk')).toBe(true);
  });

  it('rejects an incomplete chunk response instead of approving a partial preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ batchId: 'batch-1', complete: true, preview: { approvalHash: hash } })));
    await expect(refreshConfirmedPricingPreview({ ...approved, catalogItems: Array(401).fill(approved.catalogItems[0]) }, () => true))
      .rejects.toThrow('未取得完整的调价预览');
  });

  it('stops on a permission failure and does not retry', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(refreshConfirmedPricingPreview(approved, () => true)).rejects.toThrow('Forbidden');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
