import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PricingAdjustmentsPage from '@/app/admin/pricing-adjustments/page';

const mfa = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('@/components/admin/AdminMfaStepUpDialog', () => ({
  isAdminMfaStepUpResponse: (status: number) => status === 403,
  useAdminMfaStepUp: () => ({ begin: mfa.begin, dialog: null }),
}));
vi.mock('@/components/admin/BrandDefaultDiscountForm', () => ({ BrandDefaultDiscountForm: () => null }));
vi.mock('@/components/admin/PricingAdjustmentDetails', () => ({ PricingAdjustmentDetails: () => null }));
const hash = 'c'.repeat(64);
const preview = { approvalHash: hash, matchedCount: 1, changeCount: 1, skippedInquiryCount: 0,
  skippedUnchangedCount: 0, skippedMissingCount: 0, flooredCount: 0, unmatchedCatalogs: [], samples: [],
  quoteImpact: { quoteCount: 0, pendingOrderCount: 0 } };

async function prepare() {
  render(<PricingAdjustmentsPage />);
  fireEvent.change(screen.getByPlaceholderText('例如 5'), { target: { value: '5' } });
  fireEvent.change(screen.getByPlaceholderText('例如：供应商年度价格调整'), { target: { value: 'Confirmed fixture source' } });
  fireEvent.click(screen.getByRole('button', { name: '生成调价预览' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认执行调价' }));
  await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
}

describe('price adjustment resumes after MFA', () => {
  beforeEach(() => mfa.begin.mockReset());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('refreshes the exact approved preview before applying after identity verification', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ stats: { topBrands: [] } }))
      .mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ result: { ...preview, updatedCount: 1 } }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    await screen.findByText('已更新 1 条价格');
    expect(fetcher.mock.calls.slice(1).map(call => call[0])).toEqual([
      '/api/admin/pricing-adjustments/preview', '/api/admin/pricing-adjustments/apply',
      '/api/admin/pricing-adjustments/preview', '/api/admin/pricing-adjustments/apply',
    ]);
    expect(JSON.parse(fetcher.mock.calls[3][1].body).stepUpToken).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[4][1].body)).toMatchObject({ approvalHash: hash, stepUpToken: 'verified-token' });
    expect(mfa.begin).toHaveBeenCalledTimes(1);
  });

  it('does not use the prior approval for changed server data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ stats: { topBrands: [] } }))
      .mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ preview: { ...preview, approvalHash: 'd'.repeat(64) } }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    await screen.findByText('验证期间价格、范围或报价影响发生变化，请重新生成预览并确认');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(screen.queryByText('已更新 1 条价格')).toBeNull();
  });

  it('does not submit a callback after leaving the page', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ stats: { topBrands: [] } }))
      .mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    cleanup();
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
