import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FinanceManager from '@/components/admin/finance/FinanceManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin finance workspace', () => {
  it.each([false, true])('requires covered lines and supports supplementary legacy invoice evidence (first scope present: %s)', async hasFirst => {
    const orderId = 'legacy-office-with-reviewed-receivable';
    const workspace = {
      orderId, version: 'legacy-office-view', status: 'confirmed', customerEmail: 'office@example.test', principalCents: 0,
      postingPrincipal: { cents: 12050, reviewId: 'receivable-review' }, settlementCents: 12050, verifiedCents: 12050,
      acceptanceId: 'original-order-acceptance', shipmentDates: { dispatched: null, delivered: null },
      banks: [], receipts: [], cash: [], purchases: [], invoicePlans: [], events: [], latePayments: [],
      customerInvoiceScopes: hasFirst ? [{ id: 'original-accepted-scope', familyId: 'original-accepted-scope', grossCents: 6000,
        reference: '原协议 A', issuer: '合成售方', recipient: '合成客户', lines: [{ id: 'archived-office-label', name: '合成标签', quantity: 1 }] }] : [],
      customerInvoiceFamilies: hasFirst ? [{ id: 'original-accepted-scope', authorizedCents: 6000,
        issuedCents: 6000, plannedCents: 6000, availableCents: 0 }] : [],
      originalInvoiceLines: [{ id: 'archived-office-folder', name: '合成文件夹', quantity: 1, unverifiedQuantity: 1, unitPrice: 120.5 },
        { id: 'archived-office-label', name: '合成标签', quantity: 1, unverifiedQuantity: hasFirst ? 0 : 1, unitPrice: 60 }],
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
    expect(Boolean(screen.queryByRole('button', { name: '登记开票或收票安排' }))).toBe(hasFirst);
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
      data: { grossCents: 10000, invoiceLines: [{ orderItemId: 'archived-office-folder', quantity: 1 }], reference: '原签订协议-001' } });
  });

  it('offers a signed amount supplement when the only original item is already covered', async () => {
    const orderId = 'legacy-one-office-label';
    const scopeId = 'original-one-label-proof';
    const line = { id: 'label-line', name: '合成标签', quantity: 1, unverifiedQuantity: 0 };
    const scope = { id: scopeId, familyId: scopeId, grossCents: 6000, reference: '原开票书证 A',
      issuer: '合成售方', recipient: '合成客户', lines: [line] };
    const amounts = { id: scopeId, authorizedCents: 6000, issuedCents: 6000, plannedCents: 6000, availableCents: 0 };
    const workspace = { orderId, version: 'legacy-office-view', status: 'confirmed', customerEmail: 'office@example.test', principalCents: 0,
      settlementCents: 0, verifiedCents: 0, acceptanceId: 'accepted-original-order', shipmentDates: { dispatched: null, delivered: null },
      banks: [], receipts: [], cash: [], purchases: [], invoicePlans: [], events: [], latePayments: [],
      customerInvoiceScopes: [scope], customerInvoiceFamilies: [amounts], originalInvoiceLines: [line] };
    const fetchFinance = vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return Response.json({ canWrite: true, workspace });
      const { data } = JSON.parse(String(options.body));
      return Response.json({ preview: { actionHash: 'supplementary-proof', snapshot: { orderId, actor: { email: 'accountant@example.test' },
        operation: { ...data, action: 'verify_customer_invoice_scope', acceptanceId: workspace.acceptanceId, lines: [line],
          scopeChange: { beforeCents: 6000, deltaCents: 4000, afterCents: 10000, issuedCents: 6000, plannedCents: 6000, availableCents: 4000 } } } } });
    });
    vi.stubGlobal('fetch', fetchFinance);
    render(<FinanceManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button', { name: '核对历史客户可开票范围' }));
    expect(screen.getByLabelText('开票书证对应范围')).toHaveValue(scopeId);
    expect(screen.getByLabelText('原书证开票方全称')).toHaveValue(scope.issuer);
    expect(screen.getByText('已核商品与数量 合成标签 1 件')).toBeInTheDocument();
    const revise = screen.getByRole('checkbox', { name: '书证重新核定累计可开额' });
    fireEvent.click(revise);
    expect(screen.getByLabelText('原书证核定的新累计可开额（元）')).toHaveAttribute('min', '0');
    fireEvent.click(revise);
    for (const [label, value] of [
      ['原书证明确补充的含税金额（元）', '40'], ['原书证载明的实际确认时间', '2026-01-03T08:00'],
      ['书面依据或原件编号', '后到书证 B'], ['原件 SHA-256 摘要', 'b'.repeat(64)],
      ['核对结果或书面约定', '原来一件另有四十元含税开票书证。'],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '票款操作预览' });
    expect(panel).toHaveTextContent('原累计可开 ¥60.00 · 本次增加 ¥40.00 · 新累计可开 ¥100.00');
    expect(panel).toHaveTextContent('已开及更正中 ¥60.00 · 已占额度 ¥60.00 · 尚可安排 ¥40.00');
    const request = fetchFinance.mock.calls.find(([, options]) => options?.method === 'POST');
    const { data } = JSON.parse(String(request?.[1]?.body));
    expect(data).toMatchObject({ invoiceScopeBasisId: scopeId, grossCents: 4000, reference: '后到书证 B' });
    expect(data).not.toHaveProperty('invoiceLines');
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

  it.each(['supplement', 'clarification'] as const)('binds the written invoice scope for an exact %s', async action => {
    const orderId = 'legacy-office-two-lines';
    const at = '2026-01-02T08:00:00.000Z';
    const root = 'office-original-scope';
    const lines = [{ id: 'office-A', name: '合成文件夹', quantity: 1, unverifiedQuantity: 0 },
      { id: 'office-B', name: '合成标签', quantity: 1, unverifiedQuantity: 0 }];
    const parties = { issuer: '合成售方', recipient: '合成客户' };
    const scope = { id: root, familyId: root, reference: '初始两件原书证', grossCents: 6000, lines, ...parties };
    const pending = action === 'clarification';
    const workspace = { orderId, version: 'two-item-version', status: 'confirmed', customerEmail: 'office@example.test', principalCents: 0,
      settlementCents: 0, verifiedCents: 0, acceptanceId: 'original-order-acceptance', shipmentDates: { dispatched: null, delivered: null },
      banks: [], receipts: [], cash: [], purchases: [], invoicePlans: [], events: [], latePayments: [],
      originalInvoiceLines: lines, customerInvoiceScopes: [scope],
      customerInvoiceFamilies: [{ id: root, authorizedCents: pending ? null : 6000, availableCents: pending ? null : 0, issuedCents: 6000,
        plannedCents: 6000, invoiceConflicts: [], timeline: [{ at, needsReview: pending, evidenceIds: [root, 'later-conflicting-hash'] }],
        evidence: [scope, { id: 'later-conflicting-hash', reference: '同一时间的冲突书证' }] }] };
    const fetchFinance = vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return Response.json({ canWrite: true, workspace });
      const { data } = JSON.parse(String(options.body));
      return Response.json({ preview: { actionHash: 'checked-invoice-evidence', snapshot: { orderId, actor: { email: 'accountant@example.test' },
        operation: { ...data, action: 'verify_customer_invoice_scope', acceptanceId: workspace.acceptanceId,
          lines: pending ? lines : [lines[1]] } } } });
    });
    vi.stubGlobal('fetch', fetchFinance);
    render(<FinanceManager initialOrder={orderId}/>);
    fireEvent.click(await screen.findByRole('button', { name: '核对历史客户可开票范围' }));
    if (pending) {
      expect(screen.getByText(/书证生效顺序待核/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('已有书证的待核时间'), { target: { value: at } });
      fireEvent.click(screen.getByRole('checkbox', { name: '初始两件原书证' }));
    } else {
      fireEvent.click(screen.getByRole('checkbox', { name: '合成标签 · 1 件' }));
    }
    for (const [label, value] of [
      [pending ? '澄清书证确认当时的累计可开额（元）' : '原书证明确补充的含税金额（元）', pending ? '60' : '40'],
      [pending ? '澄清书证的实际确认时间' : '原书证载明的实际确认时间', '2026-01-03T08:00'],
      ['书面依据或原件编号', '有明示内容的新书证'], ['原件 SHA-256 摘要', 'c'.repeat(64)],
      ['核对结果或书面约定', pending ? '核明该时点依原书证。' : '新金额只对应合成标签。'],
    ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));
    const panel = await screen.findByRole('region', { name: '票款操作预览' });
    expect(panel).toHaveTextContent('合成标签 · 1 件');
    const request = fetchFinance.mock.calls.find(([, options]) => options?.method === 'POST');
    const { data } = JSON.parse(String(request?.[1]?.body));
    expect(data).toMatchObject(pending ? { invoiceScopeBasisId: root, restateInvoiceCeiling: true, grossCents: 6000,
      clarifiesInvoiceEvidenceAt: at, confirmedInvoiceEvidenceIds: [root] }
      : { invoiceScopeBasisId: root, grossCents: 4000, invoiceLines: [{ orderItemId: 'office-B', quantity: 1 }] });
    if (!pending) expect(panel).not.toHaveTextContent('合成文件夹');
  });
});
