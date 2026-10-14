import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProductsPage from '@/app/admin/products/page';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' } }, status: 'authenticated' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const listProduct = {
  id: 'product_1',
  catalogNumber: 'CAT-1',
  name: 'AKT1 Antibody',
  brand: 'CST',
  category: '一抗',
  price: 150,
  originalPrice: 180,
  inStock: true,
  stockQuantity: 5,
};

const detailProduct = {
  ...listProduct,
  pmids: ['12345678'],
  cofaUrl: 'https://example.test/coa.pdf',
  lotNumber: 'LOT-9',
  applications: ['WB'],
  reactivity: ['Human'],
  variants: [],
};

describe('admin products page', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('blocks saving when the product detail request fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve({ ok: true, json: async () => ({ product: detailProduct }) });
      if (String(url).includes('/api/admin/products/product_1')) {
        return Promise.resolve({ ok: false, json: async () => ({ error: '产品不存在或已删除' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ products: [listProduct], stats: { filteredProducts: 1 } }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('产品详情加载失败');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('keeps stock quantity 0 and sends it with the loaded detail', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ product: { ...detailProduct, stockQuantity: 0, inStock: false } }) });
      }
      if (String(url).includes('/api/admin/products/product_1')) {
        return Promise.resolve({ ok: true, json: async () => ({ product: detailProduct }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ products: [listProduct], stats: { filteredProducts: 1 } }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const stock = await screen.findByRole('spinbutton', { name: '库存数量' });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(stock).toHaveValue(5);

    fireEvent.change(stock, { target: { value: '-' } });
    expect(stock).toHaveValue(null);
    fireEvent.change(stock, { target: { value: '-1' } });
    expect(stock).toHaveValue(-1);
    fireEvent.change(stock, { target: { value: '0' } });
    expect(stock).toHaveValue(0);
    expect(screen.getByRole('combobox', { name: '库存状态' })).toHaveValue('false');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/products', expect.objectContaining({ method: 'PUT' })));
    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(body.stockQuantity).toBe(0);
    expect(body.inStock).toBe(false);
    expect(body.pmids).toEqual(['12345678']);
    expect(body.cofaUrl).toBe('https://example.test/coa.pdf');
  });

  it('persists deletion after confirmation', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      if (String(url).includes('/api/admin/products/product_1')) {
        return Promise.resolve({ ok: true, json: async () => ({ product: detailProduct }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ products: [listProduct], stats: { filteredProducts: 1 } }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除产品' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/product_1', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByText('CAT-1')).not.toBeInTheDocument());
  });
});
