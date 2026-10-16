import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import AdminOrdersPage from '@/app/admin/orders/page';

const listOrder = {
  id: 'o1',
  email: 'zhang@test.com',
  name: '张三',
  institution: '清华大学',
  phone: '13800001111',
  subtotal: 10,
  total: 10,
  status: 'pending',
  createdAt: '2026-03-03T00:00:00.000Z',
  payment: null,
  receivable: null,
};

function listResponse(url: string) {
  const params = new URL(url, 'http://localhost').searchParams;
  return {
    orders: [listOrder],
    page: Number(params.get('page') || '1'),
    pageSize: 20,
    total: 40,
    statusCounts: {
      unpaid: 0,
      pending: 2,
      confirmed: 0,
      partially_shipped: 0,
      shipped: 1,
      completed: 0,
      cancelled: 0,
      closed: 0,
    },
    receivableSummary: params.get('receivable') === 'open' ? { count: 2, amount: 80.5 } : null,
  };
}

describe('admin active orders page', () => {
  afterEach(() => {
    cleanup();
    navigation.search = '';
    vi.unstubAllGlobals();
  });

  it('loads a page from the server, then sends search, status, paging, and detail requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/orders/o1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            order: {
              ...listOrder,
              items: [{ id: 'item-1', name: '产品A', price: 10, quantity: 1 }],
              events: [],
              shipments: [],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => listResponse(url) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);

    expect((await screen.findAllByText('张三')).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/api/admin/orders?page=1&pageSize=20'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /已发货/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('status=shipped'))).toBe(true);
    });

    fireEvent.change(screen.getByPlaceholderText('搜索订单...'), { target: { value: '清华' } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('q=%E6%B8%85%E5%8D%8E'))).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('page=2'))).toBe(true);
    });

    fireEvent.click(screen.getAllByText('o1')[0]);
    expect((await screen.findAllByText('产品A')).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/api/admin/orders/o1'))).toBe(true);
  });

  it('requests the open receivable view from the address bar', async () => {
    navigation.search = 'view=receivable';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => listResponse(String(input)),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminOrdersPage />);

    expect(await screen.findByText('待收款视图')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes('receivable=open'))).toBe(true);
    });
    expect(screen.getByText(/80\.50/)).toBeInTheDocument();
  });
});
