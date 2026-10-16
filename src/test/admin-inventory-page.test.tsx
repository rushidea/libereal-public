import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InventoryPage from '@/app/admin/inventory/page';

type FetchResult = { ok: boolean; status?: number; json: () => Promise<unknown> };

const summary = {
  id: 'acc-1',
  productId: 'p1',
  variantId: 'variant-1',
  actualQuantity: -1,
  availableQuantity: 5,
  reservedQuantity: 3,
  shippedQuantity: 1,
  inboundQuantity: 2,
  batchCount: 1,
  product: { catalogNumber: 'CAT-1', name: 'AKT1 Antibody', brand: 'CST' },
  variant: { catalogNumber: 'CAT-1-100', spec: '100 μL' },
};

const detail = {
  ...summary,
  actualQuantity: 8,
  batches: [{ id: 'b1', batchNumber: 'LOT-1', quantity: 8, expiryDate: null }],
  transactions: [{ id: 't1', quantity: 8, reason: '批次入库', createdAt: '2026-10-01T00:00:00.000Z' }],
};

function ok(body: unknown, status = 200): FetchResult {
  return { ok: status < 400, status, json: async () => body };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('alert', vi.fn());
  render(<InventoryPage />);
}

describe('admin inventory page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading, then an empty list, without opening a drawer', async () => {
    const pending = deferred<FetchResult>();
    renderPage(vi.fn(() => pending.promise));

    expect(screen.getByRole('status')).toHaveTextContent('正在加载库存');
    expect(screen.queryByText('暂无库存账户')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    pending.resolve(ok({ accounts: [] }));
    expect(await screen.findByText('暂无库存账户')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a side drawer and shows batch loading, then empty batch and transaction states', async () => {
    const pending = deferred<FetchResult>();
    const fetchMock = vi.fn((url: string) => (
      String(url).includes('accountId=') ? pending.promise : Promise.resolve(ok({ accounts: [{ ...summary, batchCount: 0 }] }))
    ));
    renderPage(fetchMock);

    fireEvent.click(await screen.findByText('AKT1 Antibody'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('right-0');
    expect(dialog.parentElement?.className).toContain('fixed');
    expect(screen.getByRole('table').parentElement).not.toHaveTextContent('库存调整');
    expect(dialog).toHaveTextContent('正在加载批次和流水');
    expect(dialog).not.toHaveTextContent('暂无批次');

    pending.resolve(ok({ account: { ...detail, actualQuantity: -1, batches: [], transactions: [] } }));
    expect(await screen.findByText('暂无批次')).toBeInTheDocument();
    expect(screen.getByText('暂无流水')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('库存调整');
    expect(screen.getByRole('heading', { name: '批次入库' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('未知');
  });

  it('loads batches and recent transactions inside the drawer and can close it', async () => {
    const fetchMock = vi.fn((url: string) => (
      String(url).includes('accountId=')
        ? Promise.resolve(ok({ account: detail }))
        : Promise.resolve(ok({ accounts: [summary] }))
    ));
    renderPage(fetchMock);

    const row = (await screen.findByText('AKT1 Antibody')).closest('tr');
    expect(row?.querySelector('td:last-child')).toHaveTextContent('1');
    expect(row).toHaveTextContent('CAT-1-100 · CST');
    fireEvent.click(screen.getByText('AKT1 Antibody'));

    expect(await screen.findByText('LOT-1 · 8 · 无有效期')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '批次入库' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('+8');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory?accountId=acc-1');

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('table')).toHaveTextContent('AKT1 Antibody');
  });

  it('shows a list error separately from the empty state and retries', async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(ok({ error: 'Forbidden' }, 403));
      return Promise.resolve(ok({ accounts: [summary] }));
    });
    renderPage(fetchMock);

    expect(await screen.findByRole('alert')).toHaveTextContent('没有权限查看或修改库存。');
    expect(screen.queryByText('暂无库存账户')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('AKT1 Antibody')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a drawer error and retries the batch request', async () => {
    let detailCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (!String(url).includes('accountId=')) return Promise.resolve(ok({ accounts: [summary] }));
      detailCalls += 1;
      if (detailCalls === 1) return Promise.resolve(ok({ error: '库存账户不存在' }, 404));
      return Promise.resolve(ok({ account: detail }));
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByText('AKT1 Antibody'));
    expect(await screen.findByRole('alert')).toHaveTextContent('库存账户不存在');
    expect(screen.queryByText('暂无批次')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('LOT-1 · 8 · 无有效期')).toBeInTheDocument();
  });

  it('keeps stock adjustment and batch receipt, and shows Chinese save errors', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(ok({ error: 'INVENTORY_BELOW_RESERVED' }, 409));
      if (String(url).includes('accountId=')) return Promise.resolve(ok({ account: detail }));
      return Promise.resolve(ok({ accounts: [summary] }));
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByText('AKT1 Antibody'));
    await screen.findByText('LOT-1 · 8 · 无有效期');
    fireEvent.change(screen.getByRole('spinbutton', { name: '实际库存' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: '调整原因' }), { target: { value: '盘点' } });
    fireEvent.click(screen.getByRole('button', { name: '保存调整' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory', expect.objectContaining({ method: 'PATCH' })));
    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      productId: 'p1',
      variantId: 'variant-1',
      actualQuantity: 1,
      reason: '盘点',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('实际库存不能低于已预占数量。');
    expect(screen.queryByText('INVENTORY_BELOW_RESERVED')).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '实际库存' })).toHaveValue(1);
    expect(alert).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: '批次号' }), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写批次号，入库数量须为正整数。');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('submits a batch receipt and refreshes the open drawer', async () => {
    let received = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        received = true;
        return Promise.resolve(ok({ account: detail }, 201));
      }
      if (String(url).includes('accountId=')) {
        return Promise.resolve(ok({ account: received ? {
          ...detail,
          batches: [{ id: 'b2', batchNumber: 'LOT-2', quantity: 3, expiryDate: '2027-12-31T00:00:00.000Z' }],
        } : detail }));
      }
      return Promise.resolve(ok({ accounts: [summary] }));
    });
    renderPage(fetchMock);

    fireEvent.click(await screen.findByText('AKT1 Antibody'));
    await screen.findByText('LOT-1 · 8 · 无有效期');
    fireEvent.change(screen.getByRole('textbox', { name: '批次号' }), { target: { value: 'LOT-2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '入库数量' }), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2027-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory', expect.objectContaining({ method: 'POST' })));
    const receiveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(receiveCall?.[1]?.body))).toEqual({
      productId: 'p1',
      variantId: 'variant-1',
      batchNumber: 'LOT-2',
      quantity: 3,
      expiryDate: '2027-12-31',
    });
    expect(await screen.findByText(/LOT-2 · 3 · /)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '批次号' })).toHaveValue('');
  });

  it('searches by the current term and says when nothing matches', async () => {
    const fetchMock = vi.fn((url: string) => (
      String(url).includes('search=zzz')
        ? Promise.resolve(ok({ accounts: [] }))
        : Promise.resolve(ok({ accounts: [summary] }))
    ));
    renderPage(fetchMock);

    expect(await screen.findByText('AKT1 Antibody')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索货号、产品或品牌' }), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByText('没有找到匹配的库存账户')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory?search=zzz');
  });

  it('closes the drawer with Escape and leaves the table in place', async () => {
    const fetchMock = vi.fn((url: string) => (
      String(url).includes('accountId=')
        ? Promise.resolve(ok({ account: detail }))
        : Promise.resolve(ok({ accounts: [summary] }))
    ));
    renderPage(fetchMock);

    fireEvent.click(await screen.findByText('AKT1 Antibody'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '库存与批次' })).toBeInTheDocument();
  });
});
