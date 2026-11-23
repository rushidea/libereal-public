import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FinanceManager from '@/components/admin/finance/FinanceManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin finance workspace', () => {
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
