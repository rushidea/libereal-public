import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  requireAdmin: vi.fn(),
  requireActiveSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireActiveSession: mocks.requireActiveSession,
  requireUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findUnique: mocks.orderFindUnique },
  },
}));

import { PATCH } from '@/app/api/orders/[id]/route';

function request(body: object) {
  return new NextRequest('https://libereal.cn/api/orders/order-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    status: 'pending',
    paymentMethod: 'alipay',
    paidAt: null,
    adjustments: [],
    paymentAttempts: [],
    ...overrides,
  };
}

describe('order payment guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue({ id: 'admin-1', email: 'admin@libereal.cn', role: 'admin' });
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@libereal.cn', role: 'admin' });
  });

  it('locks the payment method after an Alipay attempt is created', async () => {
    mocks.orderFindUnique.mockResolvedValue(order({ paymentAttempts: [{ id: 'attempt-1' }] }));

    const response = await PATCH(request({ paymentMethod: 'bank_transfer' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'PAYMENT_METHOD_LOCKED' });
  });

  it('locks the payment method after the order is paid', async () => {
    mocks.orderFindUnique.mockResolvedValue(order({ paidAt: new Date('2026-07-17T08:00:00.000Z') }));

    const response = await PATCH(request({ paymentMethod: 'bank_transfer' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'PAYMENT_METHOD_LOCKED' });
  });

  it('prevents confirming an unpaid Alipay order', async () => {
    mocks.orderFindUnique.mockResolvedValue(order({ status: 'unpaid' }));

    const response = await PATCH(request({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'ALIPAY_PAYMENT_REQUIRED' });
  });

  it('prevents confirming a legacy unpaid Alipay pending order', async () => {
    mocks.orderFindUnique.mockResolvedValue(order());

    const response = await PATCH(request({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'ALIPAY_PAYMENT_REQUIRED' });
  });

  it('prevents closing a paid Alipay order without refund', async () => {
    mocks.orderFindUnique.mockResolvedValue(order({
      status: 'pending',
      paidAt: new Date('2026-07-17T08:00:00.000Z'),
    }));

    const response = await PATCH(request({ status: 'closed' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'PAID_ORDER_REFUND_REQUIRED' });
  });

  it('locks Alipay order items after a payment attempt exists', async () => {
    mocks.orderFindUnique.mockResolvedValue(order({
      status: 'unpaid',
      paymentAttempts: [{ id: 'attempt-1' }],
    }));

    const response = await PATCH(request({ items: [{ name: '抗体', price: 10, quantity: 1 }] }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'ORDER_ITEMS_LOCKED' });
  });
});
