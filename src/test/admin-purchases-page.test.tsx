import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PurchaseManager from '@/components/admin/purchases/PurchaseManager';
import type { Line, Purchase, Workspace } from '@/components/admin/purchases/PurchaseLineForm';
import type { PurchaseTerms } from '@/lib/purchase-terms';

const orderId = 'TEST-CUSTOMER-ORDER';
const purchaseId = 'PO-TEST-01';
const orderItemId = 'TEST-ORDER-LINE';
const version = 'b'.repeat(64);
const actionHash = 'c'.repeat(64);
const terms = {
  supplier: '合成供方甲', payee: '合成供方收款账户', paymentTerms: '供方书面确认后按约分付',
  unitPriceCents: 4321, linePayableCents: 8642, currency: 'CNY', taxBasis: 'included',
  freightTerms: '含运费', leadTime: '供方交期五个工作日', validUntil: '2031-06-15T10:20:00Z',
  sourceReference: 'TEST-SUPPLIER-QUOTE', settlementReference: 'TEST-SUPPLIER-SETTLEMENT',
  coordinationReference: 'TEST-CUSTOMER-AND-DELIVERY-CHECK',
} satisfies PurchaseTerms;

type RequestBody = Record<string, unknown>;

const source: Line['source'] = {
  orderItemId, productId: 'test-product', variantId: 'test-package', position: 0,
  brand: '合成品牌', catalogNumber: 'TEST-SKU', name: '合成采购商品', spec: '合成规格',
  unit: '件', quantity: 2, customerLeadTime: '客户要求四周后收货',
  customerConditions: '客户先收货后付款',
  written: {
    reviewId: 'test-supplier-review', replyHash: 'test-written-reply-hash',
    supplier: terms.supplier, unitPriceCents: terms.unitPriceCents, currency: 'CNY', taxBasis: 'included',
    leadTime: terms.leadTime, conditions: '供方书面原条件，采购需要核实付款和收款方',
    validUntil: terms.validUntil, channel: '合成书面回执', reference: terms.sourceReference, confirmedBy: 'test-operator',
  },
};

function makeWorkspace(status?: Purchase['status'], lineChanges: Partial<Line> = {}): Workspace {
  const line: Line = {
    orderItemId, ownerId: 'test-operator', source, terms: status ? terms : {
      unitPriceCents: terms.unitPriceCents, currency: 'CNY', taxBasis: 'included', sourceReference: terms.sourceReference,
      leadTime: terms.leadTime, validUntil: terms.validUntil,
    },
    revision: 3, purchaseOrderId: status ? purchaseId : null,
    missing: status ? [] : ['收款方', '供应商付款条件'],
    ...lineChanges,
  };
  const purchase: Purchase | null = status ? {
    id: purchaseId, status, version, revision: 4, contentHash: 'd'.repeat(64),
    approvedHash: status === 'draft' ? null : 'd'.repeat(64),
    totalCents: 8642, paidCents: 0, lines: [line], ledger: [], orderedBefore: status === 'ordered',
  } : null;
  return {
    orderId, orderStatus: 'confirmed',
    eligibility: { eligible: true, reason: null, basis: { acceptanceId: 'test-acceptance', receivableId: 'test-receivable', reserveId: 'test-credit-reserve', amount: 250 } },
    lines: [line], orders: purchase ? [purchase] : [], activities: [],
  };
}

function preview(body: RequestBody, workspace: Workspace) {
  const [purchase] = workspace.orders;
  const {
    action, reference, description, conditionReference, amountCents, changeKind,
    outcome, supplierReference, customerReference, revisedTerms,
  } = body;
  return {
    preview: {
      actionHash,
      snapshot: {
        orderId, purchaseOrderId: purchase.id, version: purchase.version, requestId: body.requestId,
        actorId: 'test-admin', totalCents: purchase.totalCents, paidCents: purchase.paidCents,
        lines: purchase.lines.map(({ orderItemId, source, terms, revision }) => ({ orderItemId, source, terms, revision })),
        eligibility: workspace.eligibility,
        operation: { action, reference, description, conditionReference, amountCents, changeKind,
          outcome, supplierReference, customerReference, revisedTerms },
      },
    },
  };
}

function mockWorkspace(workspace: Workspace, permissions: string[], respond?: (body: RequestBody) => Response) {
  const posts: RequestBody[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/admin/purchases?orderId=${orderId}` && !init?.method) return Response.json({ permissions, workspace });
    if (url === '/api/admin/purchases' && init?.method === 'POST') {
      const body: RequestBody = JSON.parse(String(init.body));
      posts.push(body);
      if (respond) return respond(body);
    }
    throw new Error(`Unexpected test request: ${url}`);
  }));
  return posts;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function open(title: string) {
  fireEvent.click(screen.getByText(title, { selector: 'summary' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('supplier purchasing page', () => {
  it('finds the customer order, preserves missing terms, and keeps customer conditions out of supplier fields', async () => {
    const workspace = makeWorkspace();
    const requests: RequestBody[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const permissions = ['purchases.read', 'purchases.write'];
      if (url.pathname !== '/api/admin/purchases') throw new Error(`Unexpected test request: ${url}`);
      if (init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        requests.push(body);
        return Response.json({ workspace: makeWorkspace(undefined, {
          revision: 4, terms: { ...workspace.lines[0].terms, payee: terms.payee }, missing: ['供应商付款条件'],
        }) });
      }
      if (url.searchParams.get('orderId') === orderId) return Response.json({ permissions, workspace });
      return Response.json({ permissions, orders: url.searchParams.get('search') === orderId
        ? [{ id: orderId, status: 'confirmed', prepared: 1, purchases: 0 }] : [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PurchaseManager initialOrder="" />);

    expect(await screen.findByText('未找到可以查看的采购记录。')).toBeInTheDocument();
    fill('客户订单号或采购单号', orderId);
    fireEvent.click(screen.getByRole('button', { name: '查找' }));
    fireEvent.click(await screen.findByRole('button', { name: orderId }));

    expect(await screen.findByRole('heading', { name: `客户订单 ${orderId}` })).toBeInTheDocument();
    expect(screen.getByText('待补 收款方、供应商付款条件')).toBeInTheDocument();
    expect(screen.getByText(/原供应商回复.*合成供方甲.*43\.21/)).toBeInTheDocument();
    expect(screen.getByText(source.written!.conditions)).toBeInTheDocument();
    open('编辑本行采购资料');
    expect(screen.getByLabelText('供应商付款条件')).toHaveValue('');
    expect(screen.getByLabelText('供货期')).toHaveValue(terms.leadTime);
    expect(screen.getByLabelText('收款方全称')).toHaveValue('');
    expect(screen.queryByText('客户先收货后付款')).not.toBeInTheDocument();
    expect(screen.queryByText('客户要求四周后收货')).not.toBeInTheDocument();
    expect(requests).toEqual([]);

    fill('收款方全称', terms.payee);
    fireEvent.click(screen.getByRole('button', { name: '保存本行资料' }));
    expect(await screen.findByText('待补 供应商付款条件')).toBeInTheDocument();
    expect(requests).toEqual([{
      action: 'save_line', orderId, orderItemId, revision: 3,
      terms: { ...workspace.lines[0].terms, payee: terms.payee },
    }]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      `/api/admin/purchases?search=${orderId}`, `/api/admin/purchases?orderId=${orderId}`,
    ]));
  });

  it('asks an operator to prepare an eligible order that has no purchase requirements', async () => {
    const workspace = { ...makeWorkspace(), lines: [] };
    const posts = mockWorkspace(workspace, ['purchases.read', 'purchases.write'], () =>
      Response.json({ workspace: makeWorkspace() }),
    );
    render(<PurchaseManager initialOrder={orderId} />);

    const prepare = await screen.findByRole('button', { name: '从原订单准备采购' });
    expect(posts).toEqual([]);
    fireEvent.click(prepare);

    expect(await screen.findByText('待补 收款方、供应商付款条件')).toBeInTheDocument();
    expect(posts).toEqual([{ action: 'prepare', orderId }]);
  });

  it.each(['draft', 'approved', 'on_hold'] as const)('shows records without mutation controls to a read-only role (%s)', async status => {
    const posts = mockWorkspace(makeWorkspace(status), ['purchases.read']);
    render(<PurchaseManager initialOrder={orderId} />);

    expect(await screen.findByRole('heading', { name: '采购单' })).toBeInTheDocument();
    expect(screen.getByText(/PO-TEST-01 · 第 4 版/)).toBeInTheDocument();
    expect(screen.queryByText('编辑本行采购资料')).not.toBeInTheDocument();
    for (const label of ['批准采购单', '登记供应商订购结果', '登记实际付款', '登记供货变化', '回填协调结果']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(posts).toEqual([]);
  });

  it.each([
    {
      action: 'approve', label: '批准采购单', status: 'draft', next: 'approved', permission: 'purchases.approve',
      fields: [], expected: {}, absent: ['登记实际付款', '登记供货变化', '登记供应商订购结果'],
    },
    {
      action: 'register_order', label: '登记供应商订购结果', status: 'approved', next: 'ordered', permission: 'purchases.write',
      fields: [['供应商已接受订购的单据或书面确认编号', 'TEST-SUPPLIER-ORDER-NO']],
      expected: { reference: 'TEST-SUPPLIER-ORDER-NO' }, absent: ['批准采购单', '登记实际付款'],
    },
    {
      action: 'report_change', label: '登记供货变化', status: 'ordered', next: 'on_hold', permission: 'purchases.write',
      fields: [['变更类别', 'delay'], ['供应商反馈来源', 'TEST-SUPPLIER-DELAY-REF'], ['受影响的商品和具体变化', '第二批合成商品延期']],
      expected: { changeKind: 'delay', reference: 'TEST-SUPPLIER-DELAY-REF', description: '第二批合成商品延期' },
      absent: ['批准采购单', '登记实际付款', '登记供应商订购结果'],
    },
    {
      action: 'resolve_change', label: '回填协调结果', status: 'on_hold', next: 'draft', permission: 'purchases.write',
      fields: [
        ['协调结果', 'revised_terms'], ['人工与供应商协调的书面依据', 'TEST-SUPPLIER-REPLY-2'],
        ['客户对方案的回复依据', 'TEST-CUSTOMER-REPLY-2'], ['双方确认的具体结果', '采购价调整后须重新批准'],
        ['采购单价（元）', '45.50'], ['含税含费用的本行应付合计（元）', '91.00'],
      ],
      expected: {
        outcome: 'revised_terms', supplierReference: 'TEST-SUPPLIER-REPLY-2', customerReference: 'TEST-CUSTOMER-REPLY-2',
        revisedTerms: [{ orderItemId, terms: { ...terms, unitPriceCents: 4550, linePayableCents: 9100 } }],
      },
      absent: ['批准采购单', '登记实际付款', '登记供货变化'],
    },
  ] as const)('previews and confirms $action only for its role and order status', async scenario => {
    const workspace = makeWorkspace(scenario.status);
    const posts = mockWorkspace(workspace, ['purchases.read', scenario.permission], body => {
      if (body.stage === 'preview') return Response.json(preview(body, workspace));
      const updated = makeWorkspace(scenario.next);
      updated.orders[0].version = 'e'.repeat(64);
      return Response.json({ workspace: updated });
    });
    render(<PurchaseManager initialOrder={orderId} />);

    const action = await screen.findByRole('button', { name: scenario.label });
    for (const label of scenario.absent) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    fireEvent.click(action);
    for (const [label, value] of scenario.fields) fill(label, value);
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));

    const dialog = await screen.findByRole('region', { name: '操作预览' });
    expect(dialog).toHaveTextContent(scenario.label);
    expect(posts).toEqual([expect.objectContaining({
      action: scenario.action, stage: 'preview', orderId, purchaseOrderId: purchaseId, version,
      requestId: expect.any(String), ...scenario.expected,
    })]);
    expect(dialog).toHaveTextContent(version);

    fireEvent.click(within(dialog).getByRole('button', { name: `确认${scenario.label}` }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '操作预览' })).not.toBeInTheDocument());
    expect(posts).toEqual([posts[0], { ...posts[0], stage: 'confirm', actionHash }]);
  });

  it('shows exact payment terms and retries the same version, request and hash after MFA', async () => {
    const workspace = makeWorkspace('ordered');
    const posts: RequestBody[] = [];
    const mfaRequests: RequestBody[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/admin/purchases?orderId=${orderId}`) {
        return Response.json({ permissions: ['purchases.read', 'purchases.pay'], workspace });
      }
      if (url === '/api/admin/purchases' && init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        posts.push(body);
        if (body.stage === 'preview') return Response.json(preview(body, workspace));
        if (!body.stepUpToken) return Response.json({ error: 'Admin MFA required' }, { status: 403 });
        const paid = makeWorkspace('ordered');
        paid.orders[0] = { ...paid.orders[0], paidCents: 1234, version: 'f'.repeat(64) };
        return Response.json({ workspace: paid });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return Response.json({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body: RequestBody = JSON.parse(String(init.body));
        mfaRequests.push(body);
        return body.challengeId
          ? Response.json({ grantToken: 'synthetic-admin-grant', verifiedAt: Date.now() })
          : Response.json({ challengeId: 'synthetic-admin-challenge', method: 'staging_test' });
      }
      throw new Error(`Unexpected test request: ${url}`);
    }));

    render(<PurchaseManager initialOrder={orderId} />);
    fireEvent.click(await screen.findByRole('button', { name: '登记实际付款' }));
    expect(screen.queryByRole('button', { name: '批准采购单' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记供货变化' })).not.toBeInTheDocument();
    fill('本次实际支付金额（元）', '12.34');
    fill('本次付款条件已满足的依据', 'TEST-SUPPLIER-DEPOSIT-DUE');
    fill('实际付款流水或银行凭证编号', 'TEST-SUPPLIER-BANK-TRACE');
    fireEvent.click(screen.getByRole('button', { name: '查看完整预览' }));

    const panel = await screen.findByRole('region', { name: '操作预览' });
    expect(panel).toHaveTextContent(/本次实际付款.*12\.34.*收款方 合成供方收款账户.*TEST-SUPPLIER-DEPOSIT-DUE/);
    expect(panel).toHaveTextContent('TEST-SUPPLIER-BANK-TRACE');
    expect(panel).toHaveTextContent(version);
    expect(posts).toEqual([expect.objectContaining({
      stage: 'preview', action: 'record_payment', orderId, purchaseOrderId: purchaseId, version,
      amountCents: 1234, requestId: expect.any(String),
    })]);
    expect(mfaRequests).toEqual([]);

    fireEvent.click(within(panel).getByRole('button', { name: '确认登记实际付款' }));
    const mfaDialog = await screen.findByRole('dialog', { name: '管理员身份确认' });
    expect(posts).toEqual([posts[0], { ...posts[0], stage: 'confirm', actionHash }]);
    fireEvent.click(await within(mfaDialog).findByRole('button', { name: '开始验证' }));
    const code = await within(mfaDialog).findByLabelText('固定测试口令');
    fireEvent.change(code, { target: { value: '246810' } });
    fireEvent.click(within(mfaDialog).getByRole('button', { name: '验证并继续' }));

    expect(await screen.findByText(/本单应付.*已登记实际付款.*12\.34/)).toBeInTheDocument();
    expect(mfaRequests).toEqual([
      expect.objectContaining({ action: 'admin_sensitive', method: 'staging_test' }),
      expect.objectContaining({ action: 'admin_sensitive', challengeId: 'synthetic-admin-challenge', code: '246810' }),
    ]);
    expect(posts).toEqual([
      posts[0],
      { ...posts[0], stage: 'confirm', actionHash },
      { ...posts[0], stage: 'confirm', actionHash, stepUpToken: 'synthetic-admin-grant' },
    ]);
    expect(screen.queryByRole('region', { name: '操作预览' })).not.toBeInTheDocument();
  });
});
