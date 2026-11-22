import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminOrdersPage from '@/app/admin/orders/page';
import ArchivedOrdersPage from '@/app/admin/orders/archived/page';

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

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ORD-MFA-1',
    name: 'Realgent',
    email: '61216888@qq.com',
    phone: '18602536320',
    institution: '南京测试机构',
    subtotal: 13230,
    total: 13230,
    status: 'pending',
    paymentMethod: 'rjmart',
    quoteSent: false,
    createdAt: '2026-11-22T01:00:00.000Z',
    items: [
      { id: 'item-1', productId: 'p1', name: '测试试剂盒', brand: 'Cytiva', catalogNumber: 'CAT-1', price: 13230, quantity: 1, leadTime: '' },
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

async function completeStagingStepUpDialog(code = '503219') {
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
    const order = makeOrder();
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
        expect(body.code).toBe('503219');
        return jsonResponse({ grantToken: 'grant-confirm-1', verifiedAt: Date.now() });
      }
      if (url === `/api/orders/${order.id}` && init?.method === 'PATCH') {
        patchAttempts += 1;
        const body = JSON.parse(String(init.body || '{}')) as { status?: string; stepUpToken?: string };
        expect(body.status).toBe('confirmed');
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        expect(body.stepUpToken).toBe('grant-confirm-1');
        return jsonResponse({ error: 'CREDIT_LIMIT_EXCEEDED' }, 409);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);
    const confirmedButtons = await screen.findAllByRole('button', { name: '已确认' });
    fireEvent.click(confirmedButtons[confirmedButtons.length - 1]);

    await completeStagingStepUpDialog();

    await waitFor(() => expect(patchAttempts).toBe(2));
    expect((await screen.findAllByText(/客户可用授信额度不足/)).length).toBeGreaterThan(0);
  });

  it('skips redundant PATCH when items are unchanged on 确认订单, prompts confirm once, and retries quote POST after MFA', async () => {
    const order = makeOrder();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);

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
        if (!body.stepUpToken) return jsonResponse({ error: 'Admin MFA required' }, 403);
        expect(body.stepUpToken).toBe('grant-quote-1');
        order.quoteSent = true;
        order.status = 'confirmed';
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected fetch: ${url} (${init?.method || 'GET'})`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);
    fireEvent.click((await screen.findAllByText(order.id))[0]);
    const confirmButtons = await screen.findAllByRole('button', { name: '确认订单' });
    fireEvent.click(confirmButtons[0]);

    await completeStagingStepUpDialog();

    await waitFor(() => {
      const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url) === `/api/orders/${order.id}/quote`);
      expect(quoteCalls).toHaveLength(2);
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const patchCalls = fetchMock.mock.calls.filter(([url, init]) => String(url) === `/api/orders/${order.id}` && init?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);
    expect((await screen.findAllByText('订单已确认')).length).toBeGreaterThan(0);
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
