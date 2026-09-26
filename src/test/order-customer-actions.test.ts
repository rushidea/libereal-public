import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireAdmin: vi.fn(),
  orderFindUnique: vi.fn(),
  transactionOrderUpdate: vi.fn(),
  notificationCreate: vi.fn(),
  releaseOrderInventory: vi.fn(),
  refundOrderPointsProportionally: vi.fn(),
  releaseOrderReceivableOnCancellation: vi.fn(),
  requireOrganizationPermission: vi.fn(),
  productFindMany: vi.fn(),
  productVariantFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  cartFindUnique: vi.fn(),
  cartUpsert: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireActiveSession: mocks.requireActiveSession,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findUnique: mocks.orderFindUnique },
    notification: { create: mocks.notificationCreate },
    product: { findMany: mocks.productFindMany },
    productVariant: { findMany: mocks.productVariantFindMany },
    user: { findUnique: mocks.userFindUnique },
    cart: { findUnique: mocks.cartFindUnique, upsert: mocks.cartUpsert },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      order: { update: mocks.transactionOrderUpdate },
    }),
  },
}));
vi.mock('@/lib/inventory', () => ({
  releaseOrderInventory: mocks.releaseOrderInventory,
  reserveOrderInventory: vi.fn(),
}));
vi.mock('@/lib/customer-credit', () => ({
  releaseOrderReceivableOnCancellation: mocks.releaseOrderReceivableOnCancellation,
  reserveOrderCredit: vi.fn(),
  settleOrderReceivable: vi.fn(),
}));
vi.mock('@/lib/points-checkout-service', () => ({
  refundOrderPointsProportionally: mocks.refundOrderPointsProportionally,
}));
vi.mock('@/lib/organization-service', () => ({
  requireOrganizationPermission: mocks.requireOrganizationPermission,
}));
vi.mock('@/lib/product-pricing', () => ({
  getProductDisplayPrice: vi.fn(() => ({ salePrice: 100, hasPrice: true, showGuestDiscount: false, isPromo: false })),
}));

import { PATCH } from '@/app/api/orders/[id]/route';
import { POST as reorderPOST } from '@/app/api/orders/[id]/reorder/route';

function patchRequest(body: object) {
  return new NextRequest('https://libereal.cn/api/orders/order-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function customerOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    status: 'pending',
    ownerScope: 'personal',
    customerId: 'user-1',
    email: 'buyer@example.com',
    paymentMethod: 'bank_transfer',
    paidAt: null,
    total: 100,
    pointsDiscount: 0,
    adjustments: [],
    paymentAttempts: [],
    ...overrides,
  };
}

describe('customer order actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue({ id: 'user-1', email: 'buyer@example.com', role: 'customer' });
    mocks.requireAdmin.mockResolvedValue({ id: 'user-1', email: 'buyer@example.com', role: 'customer' });
    mocks.orderFindUnique.mockResolvedValue(customerOrder());
    mocks.transactionOrderUpdate.mockResolvedValue({});
    mocks.notificationCreate.mockResolvedValue({});
    mocks.releaseOrderInventory.mockResolvedValue(undefined);
    mocks.refundOrderPointsProportionally.mockResolvedValue(undefined);
    mocks.releaseOrderReceivableOnCancellation.mockResolvedValue(undefined);
    mocks.productFindMany.mockResolvedValue([{
      id: 'product-1', catalogNumber: 'CAT-1', brand: '测试品牌', subBrand: null, name: '产品A',
      category: null, subcategory: null, host: null, target: null, hazardous: false, spec: '盒',
      price: 100, promotionalPrice: null, promotion: false, originalPrice: null, inStock: true,
      stockQuantity: -1, leadTime: null, imageUrl: null, applications: '[]', reactivity: '[]',
    }]);
    mocks.productVariantFindMany.mockResolvedValue([]);
    mocks.userFindUnique.mockResolvedValue({ approvalStatus: 'approved', isNewUser: false, isFrozen: false, isBlacklisted: false });
    mocks.cartFindUnique.mockResolvedValue({ items: '[]' });
    mocks.cartUpsert.mockResolvedValue({});
  });

  it('allows the owner to cancel an unpaid personal order', async () => {
    mocks.orderFindUnique.mockResolvedValue(customerOrder({ status: 'unpaid', paymentMethod: 'alipay' }));

    const response = await PATCH(patchRequest({ status: 'cancelled', reason: '用户取消订单' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.transactionOrderUpdate).toHaveBeenCalled();
    expect(mocks.releaseOrderInventory).toHaveBeenCalled();
    expect(mocks.notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: '订单状态更新' }),
    }));
  });

  it('allows the owner to cancel a pending personal transfer order', async () => {
    const response = await PATCH(patchRequest({ status: 'cancelled', reason: '用户取消订单' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.transactionOrderUpdate).toHaveBeenCalled();
  });

  it('rejects cancellation by another personal-account user', async () => {
    mocks.requireActiveSession.mockResolvedValue({ id: 'other-user', email: 'other@example.com', role: 'customer' });

    const response = await PATCH(patchRequest({ status: 'cancelled' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.transactionOrderUpdate).not.toHaveBeenCalled();
  });

  it('adds cancelled order items to the owner cart for reordering', async () => {
    mocks.orderFindUnique.mockResolvedValue({
      id: 'order-1', status: 'cancelled', ownerScope: 'personal', customerId: 'user-1', email: 'buyer@example.com',
      orderItems: [{ productId: 'product-1', catalogNumber: 'CAT-1', brand: '测试品牌', quantity: 2, name: '产品A' }],
    });

    const response = await reorderPOST(new Request('https://libereal.cn/api/orders/order-1/reorder', { method: 'POST' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, itemCount: 1 });
    expect(mocks.cartUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: { items: expect.stringContaining('product-1') },
    }));
  });

  it('allows reordering a closed personal order', async () => {
    mocks.orderFindUnique.mockResolvedValue({
      id: 'order-1', status: 'closed', ownerScope: 'personal', customerId: 'user-1', email: 'buyer@example.com',
      orderItems: [{ productId: 'product-1', catalogNumber: 'CAT-1', brand: '测试品牌', quantity: 2, name: '产品A' }],
    });

    const response = await reorderPOST(new Request('https://libereal.cn/api/orders/order-1/reorder', { method: 'POST' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.cartUpsert).toHaveBeenCalled();
  });
});
