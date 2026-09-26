import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireOrganizationPermission: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  notificationCreate: vi.fn(),
  userUpdate: vi.fn(),
  assertOrderTransition: vi.fn(),
  reserveOrderCredit: vi.fn(),
  settleOrderReceivable: vi.fn(),
  releaseOrderReceivableOnCancellation: vi.fn(),
  reserveOrderInventory: vi.fn(),
  releaseOrderInventory: vi.fn(),
  refundOrderPointsProportionally: vi.fn(),
  isPostDeliveryPaymentMethod: vi.fn(() => false),
  normalizeOrderPaymentMethod: vi.fn((value: string | null) => value),
  orderItemView: vi.fn((item: unknown) => item),
  toOrderItemCreates: vi.fn((items: unknown[]) => items),
}));

vi.mock('@/lib/session', () => ({
  requireActiveSession: mocks.requireActiveSession,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/organization-service', () => ({ requireOrganizationPermission: mocks.requireOrganizationPermission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findUnique: mocks.orderFindUnique },
    notification: { create: mocks.notificationCreate },
    user: { update: mocks.userUpdate },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ order: { update: mocks.orderUpdate } }),
  },
}));
vi.mock('@/lib/order-domain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/order-domain')>()),
  assertOrderTransition: mocks.assertOrderTransition,
  calculateOrderAmounts: vi.fn(),
}));
vi.mock('@/lib/customer-credit', () => ({
  reserveOrderCredit: mocks.reserveOrderCredit,
  settleOrderReceivable: mocks.settleOrderReceivable,
  releaseOrderReceivableOnCancellation: mocks.releaseOrderReceivableOnCancellation,
}));
vi.mock('@/lib/inventory', () => ({
  reserveOrderInventory: mocks.reserveOrderInventory,
  releaseOrderInventory: mocks.releaseOrderInventory,
}));
vi.mock('@/lib/points-checkout-service', () => ({ refundOrderPointsProportionally: mocks.refundOrderPointsProportionally }));
vi.mock('@/data/payment-methods', () => ({
  isPostDeliveryPaymentMethod: mocks.isPostDeliveryPaymentMethod,
  normalizeOrderPaymentMethod: mocks.normalizeOrderPaymentMethod,
}));
vi.mock('@/data/alipay-payment', () => ({ getAlipayPaymentSummary: vi.fn() }));
vi.mock('@/lib/commerce-records', () => ({
  orderItemView: mocks.orderItemView,
  toOrderItemCreates: mocks.toOrderItemCreates,
}));

import { PATCH } from '@/app/api/orders/[id]/route';

function request(body: object) {
  return new NextRequest('https://libereal.cn/api/orders/org-order-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('organization order review permission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue({ id: 'manager-1', email: 'manager@test.com', role: 'customer' });
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'manager-member' });
    mocks.orderFindUnique.mockResolvedValue({
      id: 'org-order-1',
      status: 'pending',
      ownerScope: 'organization',
      organizationId: 'org-1',
      paymentMethod: 'bank_transfer',
      paidAt: null,
      total: 100,
      pointsDiscount: 0,
      inquiryId: null,
      adjustments: [],
      paymentAttempts: [],
    });
    mocks.orderUpdate.mockResolvedValue({ id: 'org-order-1', status: 'confirmed' });
    mocks.notificationCreate.mockResolvedValue({});
  });

  it('allows a member with order review permission to confirm an organization order', async () => {
    const response = await PATCH(request({ status: 'confirmed' }), { params: Promise.resolve({ id: 'org-order-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.requireOrganizationPermission).toHaveBeenCalledWith('manager-1', 'org-1', 'organization.orders.review');
    expect(mocks.orderUpdate).toHaveBeenCalled();
  });

  it('rejects organization order status changes without order review permission', async () => {
    mocks.requireOrganizationPermission.mockRejectedValue(new Error('组织权限不足'));

    const response = await PATCH(request({ status: 'confirmed' }), { params: Promise.resolve({ id: 'org-order-1' }) });

    expect(response.status).toBe(403);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });
});
