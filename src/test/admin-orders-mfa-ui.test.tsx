import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';
import ArchivedOrdersPage from '@/app/admin/orders/archived/page';
import type { MerchantOrderApprovalPreview } from '@/lib/order-approval';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin', email: 'admin@example.test' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeApproval(
  version = 'a'.repeat(64),
  action: MerchantOrderApprovalPreview['action'] = 'accept_order',
  quantity = 1,
): MerchantOrderApprovalPreview {
  return {
    version, action,
    snapshot: {
      orderId: 'ORD-MFA-1', inquiryId: null, organizationId: null, ownerScope: 'personal',
      customerId: 'buyer-1', customerEmail: 'buyer@example.test', payee: 'Libereal',
      total: 120 * quantity - 10, subtotal: 120 * quantity, adjustmentTotal: 0, pointsDiscount: 10,
      paymentMethod: action === 'accept_order' ? 'rjmart' : 'alipay',
      status: 'pending', paidAt: null, alipay: null,
      recipient: { name: '合成客户', institution: '合成机构', phone: '00000000000', address: '合成地址' },
      credit: action === 'accept_order' ? { debtorId: 'buyer-1', paymentTermDays: 30,
        effectiveLimit: 1000, availableAmount: 1000, status: 'active', receivable: null } : null,
      adjustments: [],
      lines: [{ id: 'item-1', productId: 'p1', variantId: null, name: '测试试剂盒', brand: '合成品牌',
        catalogNumber: 'CAT-1', spec: '合成规格', unit: '件', unitPrice: 120, quantity, leadTime: null, conditions: null }],
    },
  };
}

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ORD-MFA-1',
    name: '合成客户',
    email: 'buyer@example.test',
    phone: '00000000000',
    institution: '合成机构',
    subtotal: 120,
    total: 120,
    status: 'pending',
    paymentMethod: 'rjmart',
    quoteSent: false,
    acceptedAt: null as string | null,
    approvalPreview: overrides.status === 'confirmed' ? null : makeApproval(),
    createdAt: '2026-11-22T01:00:00.000Z',
    items: [
      { id: 'item-1', productId: 'p1', name: '测试试剂盒', brand: '合成品牌', catalogNumber: 'CAT-1', price: 120, quantity: 1, leadTime: '' },
    ],
    events: [],
    shipments: [],
    pointsPersonal: 100,
    pointsGroup: 0,
    pointsDiscount: 10,
    pointsApplied: true,
    ...overrides,
  };
}

async function renderOrderDetail(order: ReturnType<typeof makeOrder>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/admin/access?view=current') return jsonResponse({ permissions: ['orders.read', 'orders.write'] });
    if (url.startsWith('/api/admin/orders?')) return jsonResponse({ orders: [order], total: 1, statusCounts: {} });
    if (url === `/api/admin/orders/${order.id}`) return jsonResponse({ order });
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<AdminOrdersPage />);
  fireEvent.click((await screen.findAllByText(order.id))[0]);
}

async function completeStagingStepUpDialog(code = '123456') {
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: '开始验证' }));
  const input = await screen.findByLabelText('固定测试口令');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));
}

describe('Admin orders MFA step-up flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens AdminMfaStepUpDialog on 已确认 403, retries with stepUpToken, and surfaces post-MFA business errors', async () => {
    const order = makeOrder({ ownerScope: 'organization', organizationId: 'test-organization' });
    let patchAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/access?view=current') {
        return jsonResponse({ permissions: ['orders.read', 'orders.write', 'finance.write'] });
      }
      if (url.startsWith('/api/admin/orders?')) {
        return jsonResponse({ orders: [order], page: 1, pageSize: 20, total: 1, statusCounts: { pending: 1 } });
      }
      if (url === `/api/admin/orders/${order.id}`) {
        return jsonResponse({ order });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return jsonResponse({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { challengeId?: string; code?: string };
        if (!body.challengeId) return jsonResponse({ challengeId: 'chg-1', method: 'staging_test' });
        expect(body.code).toBe('123456');
        return jsonResponse({ grantToken: 'grant-confirm-1', verifiedAt: Date.now() });
      }
      if (url === `/api/orders/${order.id}` && init?.method === 'PATCH') {
        patchAttempts += 1;
        const body = JSON.parse(String(init.body || '{}')) as { status?: string; action?: string; stepUpToken?: string };
        expect(body).toMatchObject({ status: 'confirmed', action: 'accept_order', approvalVersion: 'a'.repeat(64) });
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        expect(body.stepUpToken).toBe('grant-confirm-1');
        return jsonResponse({ error: 'CREDIT_LIMIT_EXCEEDED' }, 409);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);
    fireEvent.click((await screen.findAllByRole('button', { name: '核对接单明细' }))[0]);
    const preview = within((await screen.findAllByRole('region', { name: '订单确认明细' }))[0]);
    expect(preview.getByText(/测试试剂盒.*合成规格.*× 1件/)).toBeInTheDocument();
    expect(preview.getByText(/账期 30 天/)).toBeInTheDocument();
    expect(preview.getByText(/合成地址/)).toBeInTheDocument();
    fireEvent.click(preview.getByRole('button', { name: '确认 Libereal 接单' }));

    await completeStagingStepUpDialog();

    await waitFor(() => expect(patchAttempts).toBe(2));
    expect((await screen.findAllByText(/客户可用授信额度不足/)).length).toBeGreaterThan(0);
  });

  it('keeps the shown order version on the accept-and-notify MFA retry without saving unchanged lines', async () => {
    const order = makeOrder();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/access?view=current') {
        return jsonResponse({ permissions: ['orders.read', 'orders.write', 'finance.write'] });
      }
      if (url.startsWith('/api/admin/orders?')) {
        return jsonResponse({ orders: [order], page: 1, pageSize: 20, total: 1, statusCounts: { pending: 1 } });
      }
      if (url === `/api/admin/orders/${order.id}`) {
        return jsonResponse({ order });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return jsonResponse({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { challengeId?: string };
        if (!body.challengeId) return jsonResponse({ challengeId: 'chg-quote', method: 'staging_test' });
        return jsonResponse({ grantToken: 'grant-quote-1', verifiedAt: Date.now() });
      }
      if (url === `/api/orders/${order.id}/quote` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { stepUpToken?: string };
        expect(body).toMatchObject({ action: 'accept_order', approvalVersion: 'a'.repeat(64) });
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        expect(body.stepUpToken).toBe('grant-quote-1');
        order.quoteSent = true;
        order.status = 'confirmed';
        order.acceptedAt = '2026-11-22T01:15:00.000Z';
        order.approvalPreview = null;
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url} (${init?.method || 'GET'})`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);
    fireEvent.click((await screen.findAllByRole('button', { name: '核对接单并通知客户' }))[0]);
    fireEvent.click((await screen.findAllByRole('button', { name: '确认接单并通知客户' }))[0]);

    await completeStagingStepUpDialog();

    await waitFor(() => {
      const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url) === `/api/orders/${order.id}/quote`);
      expect(quoteCalls).toHaveLength(2);
    });
    const patchCalls = fetchMock.mock.calls.filter(([url, init]) => String(url) === `/api/orders/${order.id}` && init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);
    expect((await screen.findAllByText('Libereal 已接单')).length).toBeGreaterThan(0);
  });

  it('requires a fresh preview after inline saving and after the displayed version changes during MFA', async () => {
    const order = makeOrder();
    const quoteVersions: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/access?view=current') return jsonResponse({ permissions: ['orders.read', 'orders.write'] });
      if (url.startsWith('/api/admin/orders?')) return jsonResponse({ orders: [order], total: 1, statusCounts: { pending: 1 } });
      if (url === `/api/admin/orders/${order.id}`) return jsonResponse({ order });
      if (url === `/api/orders/${order.id}` && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        expect(body.items[0].quantity).toBe(2);
        order.items[0].quantity = 2;
        order.approvalPreview = makeApproval('b'.repeat(64), 'accept_order', 2);
        return jsonResponse({ success: true });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return jsonResponse({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (!body.challengeId) return jsonResponse({ challengeId: 'chg-quote', method: 'staging_test' });
        order.items[0].quantity = 3;
        order.approvalPreview = makeApproval('c'.repeat(64), 'accept_order', 3);
        return jsonResponse({ grantToken: 'grant-stale', verifiedAt: Date.now() });
      }
      if (url === `/api/orders/${order.id}/quote` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        quoteVersions.push(body.approvalVersion);
        if (body.approvalVersion === 'b'.repeat(64)) {
          return body.stepUpToken
            ? jsonResponse({ error: '订单或结算条件已变化，请重新查看明细后确认。' }, 409)
            : jsonResponse({ error: 'Admin MFA required' }, 403);
        }
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);
    const open = async () => fireEvent.click((await screen.findAllByRole('button', { name: '核对接单并通知客户' }))[0]);
    const accept = async () => fireEvent.click((await screen.findAllByRole('button', { name: '确认接单并通知客户' }))[0]);

    const quantityInput = (await screen.findAllByRole('spinbutton')).find((input) => (input as HTMLInputElement).min === '1');
    expect(quantityInput).toBeDefined();
    fireEvent.change(quantityInput!, { target: { value: '2' } });
    await open();
    expect((await screen.findAllByText('请重新核对保存后的订单明细。')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: '订单确认明细' })).not.toBeInTheDocument();
    expect(quoteVersions).toEqual([]);

    await open();
    expect((await screen.findAllByText(/测试试剂盒.*× 2件/)).length).toBeGreaterThan(0);
    await accept();
    await completeStagingStepUpDialog();
    expect((await screen.findAllByText(/订单或结算条件已变化/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: '订单确认明细' })).not.toBeInTheDocument();
    expect(quoteVersions).toEqual(['b'.repeat(64), 'b'.repeat(64)]);

    await open();
    expect((await screen.findAllByText(/测试试剂盒.*× 3件/)).length).toBeGreaterThan(0);
    await accept();
    await waitFor(() => expect(quoteVersions).toEqual(['b'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]));
  });

  it.each(['unpaid', 'pending'])('shows a sent quote as a quote while the order is %s', async (status) => {
    const order = makeOrder({ status, paymentMethod: 'alipay', quoteSent: true, approvalPreview: makeApproval('a'.repeat(64), 'send_quote') });
    await renderOrderDetail(order);
    expect((await screen.findAllByText('报价已发送')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Libereal 已接单')).not.toBeInTheDocument();
  });

  it('shows a legacy confirmed status without claiming platform acceptance', async () => {
    await renderOrderDetail(makeOrder({ status: 'confirmed', acceptedAt: null, quoteSent: false }));

    expect((await screen.findAllByText('平台接单记录待核实')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('当前订单状态 已确认').length).toBeGreaterThan(0);
    expect(screen.queryByText('Libereal 已接单')).not.toBeInTheDocument();
    expect(screen.queryByText('订单已确认')).not.toBeInTheDocument();
  });

  it('retains proven platform acceptance after cancellation', async () => {
    const acceptedAt = '2026-11-22T01:15:00.000Z';
    await renderOrderDetail(makeOrder({ status: 'cancelled', acceptedAt, quoteSent: true, approvalPreview: null }));

    expect((await screen.findAllByText('Libereal 已接单')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('当前订单状态 已取消').length).toBeGreaterThan(0);
    expect(screen.getAllByText(`接单时间 ${new Date(acceptedAt).toLocaleString('zh-CN')}`).length).toBeGreaterThan(0);
    expect(screen.queryByText('平台接单记录待核实')).not.toBeInTheDocument();
  });

  it('triggers MFA step-up and retries for paymentMethod change, shipment create, points refund, withdraw, and unarchive', async () => {
    const order = makeOrder({ status: 'confirmed' });
    vi.stubGlobal('confirm', vi.fn(() => true));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/access?view=current') {
        return jsonResponse({ permissions: ['orders.read', 'orders.write', 'finance.write'] });
      }
      if (url.startsWith('/api/admin/orders?')) {
        return jsonResponse({ orders: [{ ...order, detailLoaded: undefined }], page: 1, pageSize: 20, total: 1, statusCounts: { confirmed: 1 } });
      }
      if (url === `/api/admin/orders/${order.id}`) {
        return jsonResponse({ order });
      }
      if (url === '/api/auth/security/step-up?action=admin_sensitive') {
        return jsonResponse({ methods: ['staging_test'], preferredMethod: 'staging_test' });
      }
      if (url === '/api/auth/security/step-up' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { challengeId?: string };
        if (!body.challengeId) return jsonResponse({ challengeId: 'chg-misc', method: 'staging_test' });
        return jsonResponse({ grantToken: 'grant-misc-1', verifiedAt: Date.now() });
      }
      if (url === `/api/orders/${order.id}` && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as { paymentMethod?: string; stepUpToken?: string };
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        order.paymentMethod = body.paymentMethod || order.paymentMethod;
        return jsonResponse({ success: true });
      }
      if (url === `/api/admin/orders/${order.id}/points-refund` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { stepUpToken?: string };
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        return jsonResponse({ ok: true, personal: 50, group: 0 });
      }
      if (url === `/api/admin/orders/${order.id}/shipments` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { stepUpToken?: string };
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        return jsonResponse({ shipment: { id: 'ship-1', method: 'logistics', carrier: '顺丰', trackingNumber: 'SF001' }, orderStatus: 'shipped' }, 201);
      }
      if (url === '/api/admin/orders/archive' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as { stepUpToken?: string; action?: string };
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        return jsonResponse({ success: true, count: 1 });
      }
      if (url === '/api/admin/orders/archived') {
        return jsonResponse({ orders: [{ ...order, archivedAt: '2026-11-22T02:00:00.000Z' }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);

    // Payment method change
    const selects = await screen.findAllByDisplayValue('锐竞');
    fireEvent.change(selects[0], { target: { value: 'casmart' } });
    await completeStagingStepUpDialog();
    await waitFor(() => {
      const pmRetry = fetchMock.mock.calls.find(([url, init]) =>
        String(url) === `/api/orders/${order.id}`
        && init?.method === 'PATCH'
        && String(init.body).includes('grant-misc-1'));
      expect(pmRetry).toBeDefined();
    });

    // Points refund
    fireEvent.change(screen.getAllByPlaceholderText('按退款金额退积分')[0], { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: '退积分' })[0]);
    await completeStagingStepUpDialog();
    expect((await screen.findAllByText(/已退个人 50 分/)).length).toBeGreaterThan(0);

    // Shipment creation
    fireEvent.change(screen.getAllByPlaceholderText('物流公司')[0], { target: { value: '顺丰' } });
    fireEvent.change(screen.getAllByPlaceholderText('运单号')[0], { target: { value: 'SF001' } });
    fireEvent.change(screen.getAllByDisplayValue('0')[0], { target: { value: '1' } });
    fireEvent.click(screen.getAllByRole('button', { name: '创建发货单' })[0]);
    await completeStagingStepUpDialog();
    await waitFor(() => {
      const shipRetry = fetchMock.mock.calls.find(([url, init]) =>
        String(url) === `/api/admin/orders/${order.id}/shipments`
        && String(init?.body).includes('grant-misc-1'));
      expect(shipRetry).toBeDefined();
    });

    // Archive withdraw button
    fireEvent.click(screen.getAllByRole('button', { name: '取消并归档' })[0]);
    await completeStagingStepUpDialog();
    await waitFor(() => {
      const delRetry = fetchMock.mock.calls.find(([url, init]) =>
        String(url) === '/api/admin/orders/archive'
        && String(init?.body).includes('delete')
        && String(init?.body).includes('grant-misc-1'));
      expect(delRetry).toBeDefined();
    });

    // Archived page unarchive flow
    cleanup();
    render(<ArchivedOrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: '还原' }));
    await completeStagingStepUpDialog();
    await waitFor(() => {
      const unarchiveRetry = fetchMock.mock.calls.find(([url, init]) =>
        String(url) === '/api/admin/orders/archive'
        && String(init?.body).includes('unarchive')
        && String(init?.body).includes('grant-misc-1'));
      expect(unarchiveRetry).toBeDefined();
    });
  });
});
