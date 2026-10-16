import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
