import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FinanceManager from '@/components/admin/finance/FinanceManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin finance workspace', () => {
  it('requires evidence for the covered legacy invoice lines before offering a new customer invoice plan', async () => {
    const orderId = 'legacy-office-with-reviewed-receivable';
    const workspace = {
      orderId, version: 'legacy-office-view', status: 'confirmed', customerEmail: 'office@example.test', principalCents: 0,
      postingPrincipal: { cents: 12050, reviewId: 'receivable-review' }, settlementCents: 12050, verifiedCents: 12050,
      acceptanceId: 'original-order-acceptance', shipmentDates: { dispatched: null, delivered: null },
      banks: [], receipts: [], cash: [], purchases: [], invoicePlans: [], events: [], latePayments: [],
      originalInvoiceLines: [{ id: 'archived-office-folder', name: '合成文件夹', quantity: 1, unitPrice: 120.5 }],
    };
    const fetchFinance = vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return Response.json({ canWrite: true, workspace });
      const { data } = JSON.parse(String(options.body));
      return Response.json({ preview: { actionHash: 'proof', snapshot: { orderId, actor: { email: 'accountant@example.test' },
        operation: { ...data, action: 'verify_customer_invoice_scope', acceptanceId: workspace.acceptanceId, lines: workspace.originalInvoiceLines } } } });
    });
    vi.stubGlobal('fetch', fetchFinance);
    render(<FinanceManager initialOrder={orderId}/>);
    const action = await screen.findByRole('button', { name: '核对历史客户可开票范围' });
    expect(screen.queryByRole('button', { name: '登记开票或收票安排' })).not.toBeInTheDocument();
    fireEvent.click(action);
    fireEvent.click(screen.getByRole('checkbox', { name: '合成文件夹 · 1 件' }));
    for (const [label, value] of [
      ['原书证开票方全称', '合成售方'], ['原书证受票方全称', '合成客户'], ['原书证可开的含税金额（元）', '100'],
      ['原书证载明的实际确认时间', '2026-01-02T08:00'], ['书面依据或原件编号', '原签订协议-001'],
      ['原件 SHA-256 摘要', 'a'.repeat(64)], ['核对结果或书面约定', '原书证仅本行含税金额一百元。'],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const preview = await screen.findByRole('region', { name: '票款操作预览' });
    expect(preview).toHaveTextContent('书证可开含税金额 ¥100.00');
    const request = fetchFinance.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ action: 'verify_customer_invoice_scope',
      data: { grossCents: 10000, invoiceLineIds: ['archived-office-folder'], reference: '原签订协议-001' } });
  });

  it('opens supplier followups from the list and offers only evidence progress on a claimed payment case', async () => {
    const orderId = 'office-order';
    const row = { id: orderId, status: 'confirmed', amount: 250, receivableStatus: 'open', supplierCount: 1 };
    const workspace = {
      orderId, version: 'office-case-version', customerEmail: 'office-buyer@example.test', status: 'confirmed',
      principalCents: 25000, settlementCents: 0, verifiedCents: 0, acceptedAt: null,
      shipmentDates: { dispatched: null, delivered: null }, banks: [], receipts: [], cash: [], purchases: [], invoicePlans: [], events: [],
      latePayments: [{ id: 'original-attempt', outTradeNo: 'OFFICE-TRADE', tradeNo: 'ALIPAY-OFFICE-TRADE', amountCents: 25000,
        review: { ownerId: 'office-accountant', lastRecord: { operation: { outcome: 'awaiting_provider_evidence' } } } }],
    };
    const fetchFinance = vi.fn(async (input: string) => {
      const query = new URL(input, 'http://localhost').searchParams;
      if (query.has('orderId')) return Response.json({ canWrite: true, workspace });
      return Response.json({ canWrite: true, orders: [{
        ...row, attention: query.has('attention') ? { supplierDifferences: 1, invoiceFollowups: 1 } : null,
      }] });
    });
    vi.stubGlobal('fetch', fetchFinance);

    render(<FinanceManager initialOrder=""/>);
    await screen.findByRole('button', { name: orderId });
    fireEvent.click(screen.getByRole('button', { name: '供方差异与到期追票' }));
    const pending = await screen.findByRole('cell', { name: '供方差异 1 项 到期追票 1 项' });
    expect(fetchFinance).toHaveBeenCalledWith(expect.stringContaining('attention=1'), expect.anything());
    fireEvent.click(within(pending.closest('tr')!).getByRole('button', { name: orderId }));
    expect(await screen.findByText(/平台到账待核对 · OFFICE-TRADE/)).toHaveTextContent('ALIPAY-OFFICE-TRADE');
    expect(screen.getByText(/跟进负责人 office-accountant/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '领取到账差异' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '记录到账差异进展' }));
    expect(within(screen.getByLabelText('当前进展')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['按已有书证选择', '等待原交易书证', '等待获准并办妥的处理结果']);
  });
});
