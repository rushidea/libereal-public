import { describe, expect, it } from 'vitest';
import {
  countUnreadByModule,
  CUSTOMER_NOTIFICATION_PERMISSIONS,
  planNotificationArrival,
  resolveCustomerNotificationModule,
  safeNotificationHref,
} from '@/lib/customer-notification-modules';

describe('customer notification module mapping', () => {
  it('maps quote, order, shipment, points, credit, and organization events onto sidebar modules', () => {
    expect(resolveCustomerNotificationModule({
      type: 'quote_received',
      metadata: JSON.stringify({ inquiryId: 'inq_1' }),
      linkUrl: '/account/inquiries',
    })).toBe('inquiries');

    expect(resolveCustomerNotificationModule({
      type: 'quote_received',
      metadata: JSON.stringify({ orderId: 'ord_1' }),
      linkUrl: '/account/orders',
    })).toBe('orders');

    expect(resolveCustomerNotificationModule({ type: 'quote_expired', linkUrl: '/account/inquiries' })).toBe('inquiries');
    expect(resolveCustomerNotificationModule({ type: 'inquiry_status_updated' })).toBe('inquiries');
    expect(resolveCustomerNotificationModule({ type: 'inquiry_leadtime_updated' })).toBe('inquiries');
    expect(resolveCustomerNotificationModule({
      type: 'order_status_changed',
      metadata: JSON.stringify({ orderId: 'ord_1', status: 'shipped' }),
    })).toBe('orders');
    expect(resolveCustomerNotificationModule({
      type: 'order_status_changed',
      metadata: JSON.stringify({ userId: 'user_1' }),
      linkUrl: '/account',
    })).toBe('overview');
    expect(resolveCustomerNotificationModule({ type: 'shipping_notification' })).toBe('orders');
    expect(resolveCustomerNotificationModule({ type: 'points_redemption' })).toBe('points');
    expect(resolveCustomerNotificationModule({ type: 'account_status_changed' })).toBe('overview');
    expect(resolveCustomerNotificationModule({ type: 'system' })).toBe('recipes');
    expect(resolveCustomerNotificationModule({ type: 'organization_invitation' })).toBe('organizations');
    expect(resolveCustomerNotificationModule({ type: 'credit_order_hold' })).toBe('notifications');
    expect(resolveCustomerNotificationModule({ type: 'account_payable_reminder' })).toBe('notifications');
    expect(resolveCustomerNotificationModule({ type: 'public_announcement' })).toBe('notifications');
  });

  it('counts only unread rows and keeps quote events on separate modules', () => {
    const counts = countUnreadByModule([
      { type: 'quote_received', isRead: false, metadata: JSON.stringify({ inquiryId: 'inq_1' }) },
      { type: 'quote_received', isRead: false, metadata: JSON.stringify({ inquiryId: 'inq_2' }) },
      { type: 'quote_received', isRead: true, metadata: JSON.stringify({ inquiryId: 'inq_3' }) },
      { type: 'quote_received', isRead: false, metadata: JSON.stringify({ orderId: 'ord_1' }) },
      { type: 'shipping_notification', isRead: false, metadata: JSON.stringify({ orderId: 'ord_1' }) },
      { type: 'points_redemption', isRead: false },
      { type: 'public_announcement', isRead: false },
    ]);

    expect(counts.inquiries).toBe(2);
    expect(counts.orders).toBe(2);
    expect(counts.points).toBe(1);
    expect(counts.notifications).toBe(1);
    expect(counts.overview).toBe(0);
    expect(counts.organizations).toBe(0);
    expect(counts.recipes).toBe(0);
  });

  it('does not toast the existing unread backlog on the first snapshot', () => {
    const plan = planNotificationArrival({
      initialized: false,
      seenIds: [],
      unread: [
        { id: 'a', type: 'quote_received', title: '询价已报价', linkUrl: '/account/inquiries' },
        { id: 'b', type: 'order_status_changed', title: '订单已发货', linkUrl: '/account/orders/1' },
      ],
    });

    expect(plan.kind).toBe('seed');
    expect(plan.seenIds).toEqual(['a', 'b']);
  });

  it('summarizes newly arrived notifications into one toast', () => {
    const many = planNotificationArrival({
      initialized: true,
      seenIds: ['a'],
      unread: [
        { id: 'a', type: 'quote_received', title: '旧报价', linkUrl: '/account/inquiries' },
        { id: 'b', type: 'quote_received', title: '新报价', metadata: JSON.stringify({ inquiryId: 'inq' }) },
        { id: 'c', type: 'inquiry_status_updated', title: '询价更新', linkUrl: '/account/inquiries/inq' },
      ],
    });

    expect(many.kind).toBe('summary');
    if (many.kind !== 'summary') return;
    expect(many.count).toBe(2);
    expect(many.message).toBe('您有 2 条新消息');
    expect(many.href).toBe('/account/inquiries');
    expect(many.seenIds).toEqual(['a', 'b', 'c']);

    const one = planNotificationArrival({
      initialized: true,
      seenIds: ['a'],
      unread: [{ id: 'd', type: 'shipping_notification', title: '包裹已发出', linkUrl: '/account/orders/ord_1' }],
    });
    expect(one).toMatchObject({
      kind: 'summary',
      count: 1,
      message: '包裹已发出',
      href: '/account/orders/ord_1',
    });
  });

  it('stays silent for notifications that were already seen, including after reload', () => {
    const silent = planNotificationArrival({
      initialized: false,
      seenIds: ['a'],
      unread: [{ id: 'a', type: 'quote_received', title: '询价已报价' }],
    });
    expect(silent.kind).toBe('silent');

    expect(safeNotificationHref('https://evil.example/phish', 'orders')).toBe('/account/orders');
    expect(safeNotificationHref('/account/orders/ord_1', 'orders')).toBe('/account/orders/ord_1');
  });

  it('records the session permission for the inbox API changes', () => {
    expect(CUSTOMER_NOTIFICATION_PERMISSIONS['GET /api/notifications'].permission).toBe('session');
    expect(CUSTOMER_NOTIFICATION_PERMISSIONS['PATCH /api/notifications'].permission).toBe('session');
  });
});
