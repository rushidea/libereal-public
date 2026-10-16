import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewOrderPage from '@/app/admin/orders/new/page';
import { adminProxyOrderErrorMessage, buildAdminProxyOrderBody } from '@/data/admin-proxy-order';

const cart = vi.hoisted(() => ({
  items: [] as unknown[],
  removeItem: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/context/CartContext', () => ({
  useCart: () => cart,
  getProductCartItemKey: (item: { product: { id: string } }) => item.product.id,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin' } },
    status: 'authenticated',
  }),
}));

const customer = {
  id: 'cust_1',
  name: '李老师',
  email: 'buyer@lab.test',
  institution: '清华大学',
  addresses: [{
    id: 'addr_1',
    userId: 'cust_1',
    name: '李老师',
    phone: '13800001111',
    address: '北京市海淀区学院路1号',
    institution: '清华大学',
    label: null,
    isDefault: 1,
  }],
};

describe('代客下单请求', () => {
  it('提交客户邮箱、地址快照和第三方费用，不带 forCustomerId', () => {
    const body = buildAdminProxyOrderBody({
      customerEmail: 'buyer@lab.test',
      paymentMethod: 'rjmart',
      subtotal: 200,
      address: {
        id: 'addr_1',
        name: '李老师',
        phone: '13800001111',
        address: '北京市海淀区学院路1号',
        institution: '清华大学',
      },
      items: [{
        productId: 'p1',
        name: '抗体A',
        brand: 'CST',
        catalogNumber: 'CST-1',
        spec: '100ul',
        price: 100,
        quantity: 2,
        shippedQty: 0,
        leadTime: null,
        status: 'pending',
      }],
    });

    expect(body.customerEmail).toBe('buyer@lab.test');
    expect(body.addressId).toBe('addr_1');
    expect(body.addressName).toBe('李老师');
    expect(body.addressPhone).toBe('13800001111');
    expect(body.addressText).toBe('北京市海淀区学院路1号');
    expect(body.addressInstitution).toBe('清华大学');
    expect(body.platformFee).toBe(4);
    expect(body.transferFee).toBe(20);
    expect(body).not.toHaveProperty('forCustomerId');
    expect(body).not.toHaveProperty('extraFee');
  });

  it('把权限和地址错误转成可操作的中文提示', () => {
    expect(adminProxyOrderErrorMessage(403, 'Forbidden')).toBe('没有代客下单权限，请联系管理员开通后再试');
    expect(adminProxyOrderErrorMessage(403, 'Admin MFA required')).toContain('再次确认身份');
    expect(adminProxyOrderErrorMessage(400, '所选地址不属于该客户，请重新选择')).toBe('所选地址不属于该客户，请重新选择');
    expect(adminProxyOrderErrorMessage(500, 'Internal server error')).toBe('创建订单失败，请重试');
  });
});

describe('代客下单页', () => {
  beforeEach(() => {
    cart.items = [{
      isQuickOrder: false,
      product: {
        id: 'p1',
        name: '抗体A',
        brand: 'CST',
        catalogNumber: 'CST-1',
        spec: '100ul',
        target: null,
        price: 100,
        promotionalPrice: null,
        promotion: null,
        originalPrice: null,
      },
      quantity: 2,
    }];
    cart.removeItem.mockReset();
    navigation.push.mockReset();
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/api/admin/customers')) {
        return new Response(JSON.stringify({ customers: [customer] }), { status: 200 });
      }
      if (String(url) === '/api/admin/orders' && init?.method === 'POST') {
        return new Response(JSON.stringify({ orderId: 'ORD-20261015-001' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('确认下单时调用管理员订单接口，并把订单记到所选客户和地址', async () => {
    render(<NewOrderPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/customers'));

    fireEvent.click(screen.getByRole('button', { name: /请选择客户/ }));
    fireEvent.click(await screen.findByRole('button', { name: /李老师/ }));
    fireEvent.click(screen.getByRole('button', { name: /13800001111/ }));
    fireEvent.click(screen.getByRole('button', { name: /锐竞/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认下单/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/orders', expect.objectContaining({ method: 'POST' })));
    const orderCall = vi.mocked(fetch).mock.calls.find((call) => String(call[0]) === '/api/admin/orders');
    const body = JSON.parse(String((orderCall?.[1] as RequestInit).body));
    expect(body.customerEmail).toBe('buyer@lab.test');
    expect(body.addressId).toBe('addr_1');
    expect(body.addressText).toBe('北京市海淀区学院路1号');
    expect(body.platformFee).toBe(4);
    expect(body.transferFee).toBe(20);
    expect(body).not.toHaveProperty('forCustomerId');
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]) === '/api/orders')).toBe(false);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/admin/orders'));
    expect(cart.removeItem).toHaveBeenCalledWith('p1');
  });

  it('没有订单写权限时说明下一步，而不是把失败当成已下单', async () => {
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/admin/customers')) {
        return new Response(JSON.stringify({ customers: [customer] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    });
    render(<NewOrderPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/customers'));

    fireEvent.click(screen.getByRole('button', { name: /请选择客户/ }));
    fireEvent.click(await screen.findByRole('button', { name: /李老师/ }));
    fireEvent.click(screen.getByRole('button', { name: /对公转账/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认下单/ }));

    expect(await screen.findByText('没有代客下单权限，请联系管理员开通后再试')).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
