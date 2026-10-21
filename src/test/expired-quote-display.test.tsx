import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InquiriesPanel from '@/components/account/InquiriesPanel';
import AdminInquiriesPage from '@/app/admin/inquiries/page';
import ArchivedInquiriesPage from '@/app/admin/inquiries/archived/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'user-1', email: 'buyer@test.com', role: 'customer' } },
    status: 'authenticated',
  }),
}));

const past = '2020-01-01T00:00:00.000Z';

const expiredInquiry = {
  id: 'inq-expired',
  name: '过期客户',
  email: 'buyer@test.com',
  phone: '13800000000',
  institution: '过期实验室',
  items: [{ name: '抗体', price: 100, quantity: 1 }],
  subtotal: 100,
  status: 'quote_sent',
  createdAt: '2026-09-01T00:00:00.000Z',
  activeQuote: {
    id: 'q-expired',
    version: 3,
    status: 'sent',
    subtotal: 100,
    validUntil: past,
    sentAt: '2026-08-01T00:00:00.000Z',
    items: [{ name: '抗体', price: 100, quantity: 1, available: true }],
  },
};

describe('expired quote display', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows 已过期 on the customer list and still offers 放弃', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/my-orders')) {
        return Promise.resolve({ ok: true, json: async () => ({ inquiries: [expiredInquiry], orders: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => null });
    }));

    render(<InquiriesPanel />);
    expect(await screen.findByText('已过期')).toBeInTheDocument();
    expect(screen.queryByText(/条新报价待确认/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('已过期'));
    expect(await screen.findByText('报价已过期')).toBeInTheDocument();
    expect(screen.getByTestId('decline-quote-button')).toHaveTextContent('放弃');
    expect(screen.queryByRole('button', { name: /确认提交订单/ })).not.toBeInTheDocument();
  });

  it('shows 已过期 in the admin inquiry list and archived list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => [expiredInquiry],
    })));
    const { unmount } = render(<AdminInquiriesPage />);
    expect(await screen.findByText('已过期')).toBeInTheDocument();
    expect(screen.getByText(/过期客户/)).toBeInTheDocument();
    unmount();

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ inquiries: [{ ...expiredInquiry, status: 'quote_expired', archivedAt: '2026-10-02T00:00:00.000Z' }] }),
    })));
    render(<ArchivedInquiriesPage />);
    expect(await screen.findByText('已过期')).toBeInTheDocument();
  });
});
