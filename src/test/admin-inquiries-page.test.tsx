import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInquiriesPage from '@/app/admin/inquiries/page';
import ArchivedInquiriesPage from '@/app/admin/inquiries/archived/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'admin', email: 'admin@test.com', role: 'admin' } },
    status: 'authenticated',
  }),
}));

const visibleInquiry = {
  id: 'inq_visible',
  name: '可见客户',
  email: 'visible@test.com',
  phone: '13800000000',
  institution: '甲大学',
  items: [],
  subtotal: 100,
  status: 'pending_quote',
  createdAt: '2026-10-01T08:00:00',
};

const hiddenInquiry = {
  id: 'inq_hidden',
  name: '隐藏客户',
  email: 'hidden@test.com',
  phone: '13900000000',
  institution: '乙大学',
  items: [],
  subtotal: 80,
  status: 'quote_sent',
  createdAt: '2026-09-01T08:00:00',
};

describe('admin inquiries page', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the original repricing inquiry from the pricing result link', async () => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{
      ...visibleInquiry, hasUnresolvedPricing: true, activeQuote: {
        id: 'quote-2', version: 2, status: 'draft', catalogRepricing: true,
        items: [{ name: '重算商品', price: 80, quantity: 2, available: true }],
      },
    }, hiddenInquiry] }));
    render(<AdminInquiriesPage />);
    expect(await screen.findByText('重新核算后的待报价明细 · 第 2 版')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并发送这版重算报价' })).toBeInTheDocument();
  });

  it('refreshes the original draft without sending a quote', async () => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    let version = 2;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { version = 3; return Response.json({ result: { status: 'draft', refreshed: true, quoteId: 'quote-3' } }); }
      return Response.json([{ ...visibleInquiry, activeQuote: {
        id: 'quote-' + version, version, status: 'draft', catalogRepricing: true, contentHash: 'hash-' + version,
        items: [{ name: '重算商品', price: 80, quantity: 2, available: true }],
      } }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '重新核算并预览' }));
    await screen.findByText('重新核算后的待报价明细 · 第 3 版');
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ refreshCatalogQuote: true, catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2' });
  });

  it.each([false, true])('requires the human warning decision (%s) before retrying a draft send', async (acceptWarning) => {
    window.history.replaceState({}, '', '/admin/inquiries?inquiryId=inq_visible');
    vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(acceptWarning));
    vi.stubGlobal('alert', vi.fn());
    let writes = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        writes++;
        return writes === 1 ? Response.json({ code: 'COMMERCE_LINE_WARNINGS', warnings: [{ message: '对照价差异需要确认' }] }, { status: 409 }) : Response.json({ success: true });
      }
      return Response.json([{ ...visibleInquiry, activeQuote: { id: 'quote-2', version: 2, status: 'draft',
        catalogRepricing: true, contentHash: 'hash-2', items: [{ name: '重算商品', price: 80, quantity: 2, available: true }] } }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AdminInquiriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '确认并发送这版重算报价' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(writes).toBe(acceptWarning ? 2 : 1));
    if (acceptWarning) await waitFor(() => expect(alert).toHaveBeenCalledWith('重算报价已提交发送'));
    const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toEqual({ catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2', confirmWarnings: false });
    if (acceptWarning) expect(bodies[1]).toEqual({ catalogQuoteId: 'quote-2', catalogQuoteHash: 'hash-2', confirmWarnings: true });
  });

  it('archives only the inquiries visible in the current search', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, count: 1 }) });
      }
      return Promise.resolve({ ok: true, json: async () => [visibleInquiry, hiddenInquiry] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminInquiriesPage />);
    expect(await screen.findByText(/可见客户/)).toBeInTheDocument();
    expect(screen.getByText(/隐藏客户/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }));
    fireEvent.change(screen.getByPlaceholderText('搜索询价单...'), { target: { value: '可见客户' } });

    expect(screen.queryByText(/隐藏客户/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批量归档 \(1\)/ }));

    const archiveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(archiveCall?.[0]).toBe('/api/admin/inquiries/archive');
    expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
      inquiryIds: ['inq_visible'],
      action: 'archive',
    });
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });
});

describe('archived inquiries page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not offer a permanent delete action', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        inquiries: [{
          ...visibleInquiry,
          archivedAt: '2026-10-02T08:00:00',
          items: [{ name: '抗体', brand: 'CST', catalogNumber: 'CAT-1', quantity: 1, price: 100 }],
        }],
      }),
    })));

    render(<ArchivedInquiriesPage />);
    const row = await screen.findByText(/可见客户/);
    expect(screen.queryByTitle('永久删除')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();

    fireEvent.click(row.closest('tr') as HTMLElement);
    const detail = await screen.findByText('还原此询价单');
    expect(within(detail.closest('div') as HTMLElement).queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });
});
