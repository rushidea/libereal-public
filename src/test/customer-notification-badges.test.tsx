import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSidebar from '@/components/account/AccountSidebar';
import MarkNotificationModuleRead from '@/components/account/MarkNotificationModuleRead';
import { CustomerNotificationsProvider, useCustomerNotifications } from '@/context/CustomerNotificationsContext';
import { emptyCustomerNotificationModuleCounts } from '@/lib/customer-notification-modules';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'customer@example.com' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/account',
}));

const baseNotification = {
  id: 'quote-1',
  type: 'quote_received',
  title: '询价已报价',
  content: '请查看报价',
  isRead: false,
  linkUrl: '/account/inquiries',
  metadata: JSON.stringify({ inquiryId: 'inq_1' }),
  createdAt: '2026-10-16T00:00:00.000Z',
};

function countsWith(inquiries: number) {
  return { ...emptyCustomerNotificationModuleCounts(), inquiries, orders: 1, notifications: 3 };
}

function RefreshButton() {
  const { refresh } = useCustomerNotifications();
  return <button type="button" onClick={() => void refresh()}>刷新通知</button>;
}

describe('customer sidebar unread badges', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows unread counts on 我的询价 and 我的订单', () => {
    render(
      <AccountSidebar
        activeKey="overview"
        onTabChange={() => {}}
        unreadCounts={countsWith(2)}
      />,
    );

    expect(screen.getByTestId('account-nav-badge-inquiries')).toHaveTextContent('2');
    expect(screen.getByTestId('account-nav-badge-orders')).toHaveTextContent('1');
    expect(screen.getByTestId('account-nav-badge-notifications')).toHaveTextContent('3');
    expect(screen.queryByTestId('account-nav-badge-points')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /我的询价/ })).toBeInTheDocument();
  });

  it('clears the inquiries badge when the inquiry list is viewed', async () => {
    let cleared = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        cleared = true;
        return { ok: true, json: async () => ({ success: true, module: 'inquiries' }) };
      }
      const inquiries = cleared ? 0 : 2;
      return {
        ok: true,
        json: async () => ({
          notifications: cleared ? [] : [baseNotification, { ...baseNotification, id: 'quote-2' }],
          unreadByModule: countsWith(inquiries),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerNotificationsProvider>
        <MarkNotificationModuleRead module="inquiries" />
      </CustomerNotificationsProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ module: 'inquiries' }),
      }));
    });
  });

  it('does not toast existing unread rows, then summarizes a later arrival', async () => {
    const payloads = [
      {
        notifications: [baseNotification],
        unreadByModule: countsWith(1),
      },
      {
        notifications: [
          baseNotification,
          { ...baseNotification, id: 'ship-1', type: 'shipping_notification', title: '包裹已发出', linkUrl: '/account/orders/ord_1', metadata: JSON.stringify({ orderId: 'ord_1' }) },
        ],
        unreadByModule: { ...countsWith(1), orders: 2 },
      },
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const body = payloads[Math.min(call, payloads.length - 1)];
      call += 1;
      return { ok: true, json: async () => body };
    }));

    render(
      <CustomerNotificationsProvider>
        <RefreshButton />
      </CustomerNotificationsProvider>,
    );

    await waitFor(() => expect(call).toBeGreaterThan(0));
    expect(screen.queryByTestId('customer-notification-toast')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新通知' }));

    expect(await screen.findByTestId('customer-notification-toast')).toHaveTextContent('包裹已发出');
    expect(screen.getByRole('link', { name: '查看' })).toHaveAttribute('href', '/account/orders/ord_1');
  });
});
