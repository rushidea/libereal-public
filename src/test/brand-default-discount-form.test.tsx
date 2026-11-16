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
  it('shows the supplier enquiry condition and invalidates approval when that condition changes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ preview: { ...preview, changeCount: 2,
      brandDefaultChange: { ...preview.brandDefaultChange, beforeQuoteLimit: null, afterQuoteLimit: 500 } } }));
    vi.stubGlobal('fetch', fetcher);
    render(<BrandDefaultDiscountForm brand="测试品牌" />);
    fireEvent.change(screen.getByLabelText('品牌默认折扣百分比'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('品牌折扣确认依据'), { target: { value: '已核对测试资料及人工询价条件' } });
    fireEvent.change(screen.getByLabelText('供应商书面询价规则'), { target: { value: 'set' } });
    expect((screen.getByRole('button', { name: '预览品牌折扣变更' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('供应商询价目录价门槛'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '预览品牌折扣变更' }));
    await screen.findByRole('button', { name: '确认所示变更并处理受影响报价' });
    expect(screen.getByText(/单个销售包装目录价超过 ¥500.00/)).toBeTruthy();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ supplierQuoteRequiredAbove: 500 });
    fireEvent.change(screen.getByLabelText('供应商书面询价规则'), { target: { value: 'clear' } });
    expect(screen.queryByRole('button', { name: '确认所示变更并处理受影响报价' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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
  it('refreshes an unchanged preview after MFA before using the one-time grant to apply', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ result: null }))
      .mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ result: { ...preview, updatedCount: 1, repricedQuotes: [] } }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    await screen.findByRole('status');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      '/api/admin/pricing-adjustments/preview', '/api/admin/pricing-adjustments/apply',
      `/api/admin/pricing-adjustments/apply?approvalHash=${preview.approvalHash}`,
      '/api/admin/pricing-adjustments/preview', '/api/admin/pricing-adjustments/apply',
    ]);
    expect(JSON.parse(fetcher.mock.calls[3][1].body).stepUpToken).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[4][1].body)).toMatchObject({ approvalHash: preview.approvalHash, stepUpToken: 'verified-token' });
    expect(mfa.begin).toHaveBeenCalledTimes(1);
  });
  it('requires a new confirmation when affected business changes during MFA', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ preview }))
      .mockResolvedValueOnce(Response.json({ error: 'Admin MFA required' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ result: null }))
      .mockResolvedValueOnce(Response.json({ preview: { ...preview, approvalHash: 'b'.repeat(64), quoteImpact: { quoteCount: 2, pendingOrderCount: 1 } } }))
      .mockResolvedValueOnce(Response.json({ result: null }));
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
    await act(async () => { await mfa.begin.mock.calls[0][0]('verified-token'); });
    await screen.findByText('验证期间价格、范围或报价影响发生变化，请重新生成预览并确认');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('recovers a committed change and its quote continuation after the apply response is lost', async () => {
    let writes = 0;
    let previews = 0;
    const result = { ...preview, updatedCount: 0, recovered: true,
      repricedQuotes: [{ inquiryId: 'inquiry-fixture', version: 2, subtotal: 160, pendingOrderIds: [] }] };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('?approvalHash=')) return Response.json({ result: writes ? result : null });
      if (url.endsWith('/preview')) { previews++; return Response.json({ preview }); }
      const body = JSON.parse(String(init?.body));
      if (!body.stepUpToken) return Response.json({ error: 'Admin MFA required' }, { status: 403 });
      writes++;
      throw new Error('保存成功后连接中断');
    });
    vi.stubGlobal('fetch', fetcher);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(1));
    await act(async () => { await mfa.begin.mock.calls[0][0]('first-grant'); });
    await screen.findByText('保存成功后连接中断');
    fireEvent.click(screen.getByRole('button', { name: '确认所示变更并处理受影响报价' }));
    await waitFor(() => expect(mfa.begin).toHaveBeenCalledTimes(2));
    await act(async () => { await mfa.begin.mock.calls[1][0]('second-grant'); });
    expect((await screen.findByRole('status')).textContent).toContain('已核实此前品牌折扣变更成功，本次没有重复改写。');
    expect((await screen.findByRole('link', { name: '打开原询价的第 2 版报价' })).getAttribute('href'))
      .toBe('/admin/inquiries?inquiryId=inquiry-fixture');
    expect(writes).toBe(1);
    expect(previews).toBe(2); // Initial preview plus the renewal before the only write.
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/admin/pricing-adjustments/apply?approvalHash=${preview.approvalHash}`);
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
