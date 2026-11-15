import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrandDefaultDiscountForm } from '@/components/admin/BrandDefaultDiscountForm';

const mfa = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('@/components/admin/AdminMfaStepUpDialog', () => ({
  isAdminMfaStepUpResponse: (status: number) => status === 403,
  useAdminMfaStepUp: () => ({ begin: mfa.begin, dialog: null }),
}));
const preview = { approvalHash: 'a'.repeat(64), changeCount: 1,
  brandDefaultChange: { brandId: 'brand-fixture', brandName: '测试品牌', beforeRate: null, afterRate: 0.8 },
  quoteImpact: { quoteCount: 1, pendingOrderCount: 1 } };
async function prepare() {
  render(<BrandDefaultDiscountForm brand="测试品牌" />);
  fireEvent.change(screen.getByLabelText('品牌默认折扣百分比'), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText('品牌折扣确认依据'), { target: { value: '已核对测试资料' } });
  fireEvent.click(screen.getByRole('button', { name: '预览品牌折扣变更' }));
  await screen.findByRole('button', { name: '确认所示变更并处理受影响报价' });
}
describe('brand default approval', () => {
  beforeEach(() => mfa.begin.mockReset());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('requires a preview and binds MFA to that exact version despite later input changes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('品牌默认折扣百分比'), { target: { value: '70' } });
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ brand: '测试品牌', brandDefaultDiscountRate: 0.8, approvalHash: preview.approvalHash });
    expect(screen.queryByRole('button', { name: '确认所示变更并处理受影响报价' })).toBeNull();
  });
  it('shows the original inquiry continuation only after a matching result; an unrelated success is not completion', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ result: { ...preview, approvalHash: 'b'.repeat(64), updatedCount: 1, repricedQuotes: [] } }))
      .mockResolvedValueOnce(Response.json({ result: { ...preview, updatedCount: 1,
        repricedQuotes: [{ inquiryId: 'inquiry-fixture', version: 2, subtotal: 160, pendingOrderIds: ['pending-order'] }] } }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await screen.findByText('未取得本次确认的执行结果，请核对后重试');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    const link = await screen.findByRole('link', { name: '打开原询价的第 2 版报价' });
    expect(link.getAttribute('href')).toBe('/admin/inquiries?inquiryId=inquiry-fixture');
    expect(screen.getByRole('status').textContent).toContain('需按原流程审核及取得客户回复');
  });
});
