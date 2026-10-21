import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { reserveOrderInventory } from '@/lib/inventory';
import {
  isOrderIdUniqueConflict,
  orderNumberPrefix,
  withAllocatedOrderNumber,
} from '@/data/order-number';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const shanghaiMorning = new Date('2026-10-20T16:30:00.000Z');

function seedProductAccount() {
  const db = getTestDb();
  db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
    VALUES ('p1', 'CAT-1', '产品', 'CST', 100, 5, '[]', '[]', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt)
    VALUES ('acc-product', 'p1', NULL, 5, 5, 0, 0, 0, datetime('now'), datetime('now'))`).run();
}

describe('order number on Prisma 7 SQLite', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('treats a real Order.id primary key error as a retryable conflict', async () => {
    await prisma.order.create({
      data: { id: 'ORD-20261021-001', email: 'a@test.com', subtotal: 1, total: 1 },
    });

    const duplicate = prisma.order.create({
      data: { id: 'ORD-20261021-001', email: 'b@test.com', subtotal: 1, total: 1 },
    });
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
    await expect(duplicate).rejects.toSatisfy(isOrderIdUniqueConflict);
  });

  it('does not treat a real checkoutAttemptId conflict as an order id conflict', async () => {
    await prisma.order.create({
      data: { id: 'ORD-A', email: 'a@test.com', subtotal: 1, total: 1, checkoutAttemptId: 'attempt-1' },
    });
    const duplicate = prisma.order.create({
      data: { id: 'ORD-B', email: 'b@test.com', subtotal: 1, total: 1, checkoutAttemptId: 'attempt-1' },
    });
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
    await expect(duplicate).rejects.toSatisfy((error: unknown) => !isOrderIdUniqueConflict(error));
  });

  it('retries after a real primary key conflict and redoes the rolled-back inventory reservation', async () => {
    seedProductAccount();
    let attempts = 0;

    const order = await withAllocatedOrderNumber(prisma, async (tx, orderId) => {
      attempts += 1;
      const created = await tx.order.create({
        data: {
          id: orderId,
          email: 'buyer@test.com',
          subtotal: 100,
          total: 100,
          orderItems: {
            create: [{
              position: 0,
              productId: 'p1',
              name: '产品',
              unitPrice: 100,
              quantity: 1,
            }],
          },
        },
      });
      await reserveOrderInventory(tx, created.id, 'buyer', '下单预占库存');
      if (attempts === 1) {
        await tx.order.create({
          data: { id: orderId, email: 'buyer@test.com', subtotal: 100, total: 100 },
        });
      }
      return created;
    }, shanghaiMorning);

    expect(attempts).toBe(2);
    expect(order.id).toBe(`${orderNumberPrefix(shanghaiMorning)}001`);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await prisma.inventoryAccount.findUnique({ where: { id: 'acc-product' } })).toMatchObject({
      actualQuantity: 5,
      availableQuantity: 4,
      reservedQuantity: 1,
    });
  });
});
