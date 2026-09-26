import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { receiveInventoryBatch, releaseOrderInventory, reserveOrderInventory, shipOrderInventory } from '@/lib/inventory';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

function seed(stockQuantity: number) {
  const db = getTestDb();
  db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt) VALUES ('p1', 'CAT-1', '产品', 'CST', 100, ?, '[]', '[]', datetime('now'), datetime('now'))`).run(stockQuantity);
  db.prepare(`INSERT INTO "Order" (id, email, subtotal, total, status, createdAt, updatedAt) VALUES ('o1', 'buyer@test.com', 300, 300, 'pending', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt) VALUES ('oi1', 'o1', 0, 'p1', '产品', 100, 3, 0, 'pending', datetime('now'), datetime('now'))`).run();
}

describe('inventory service', () => {
  beforeAll(() => getTestDb());
  afterAll(() => closeTestDb());
  beforeEach(() => clearAllTables(getTestDb()));

  it('reserves known inventory and releases it on cancellation', async () => {
    seed(10);
    await prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'admin'));
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ actualQuantity: 10, reservedQuantity: 3, availableQuantity: 7 });
    expect(await prisma.product.findUnique({ where: { id: 'p1' }, select: { stockQuantity: true } })).toEqual({ stockQuantity: 7 });

    await prisma.$transaction((tx) => releaseOrderInventory(tx, 'o1', 'admin'));
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ actualQuantity: 10, reservedQuantity: 0, availableQuantity: 10 });
    expect(await prisma.inventoryTransaction.count()).toBe(2);
  });

  it('moves reserved inventory to shipped inventory', async () => {
    seed(10);
    await prisma.$transaction(async (tx) => {
      await reserveOrderInventory(tx, 'o1', 'admin');
      await shipOrderInventory(tx, 'o1', 'oi1', 2, 'admin');
    });
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ actualQuantity: 8, reservedQuantity: 1, availableQuantity: 7, shippedQuantity: 2 });
    expect(await prisma.inventoryReservation.findUnique({ where: { orderItemId: 'oi1' } })).toMatchObject({ fulfilledQuantity: 2, status: 'active' });
  });

  it('keeps unknown actual and available inventory at minus one', async () => {
    seed(-1);
    await prisma.$transaction(async (tx) => {
      await reserveOrderInventory(tx, 'o1');
      await shipOrderInventory(tx, 'o1', 'oi1', 1);
    });
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ actualQuantity: -1, availableQuantity: -1, reservedQuantity: 2, shippedQuantity: 1 });
  });

  it('records batch receipt and expiry date', async () => {
    seed(-1);
    const expiryDate = new Date('2027-12-31T00:00:00.000Z');
    await prisma.$transaction((tx) => receiveInventoryBatch(tx, { productId: 'p1', batchNumber: 'LOT-1', quantity: 5, expiryDate, actorId: 'admin' }));
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ actualQuantity: 5, availableQuantity: 5 });
    expect(await prisma.inventoryBatch.findFirst()).toMatchObject({ batchNumber: 'LOT-1', quantity: 5, expiryDate });
    expect(await prisma.inventoryTransaction.findFirst()).toMatchObject({ type: 'receipt', quantity: 5 });
  });

  it('allocates reservations to batches and releases the remaining batch reservation', async () => {
    seed(-1);
    await prisma.$transaction(async (tx) => {
      await receiveInventoryBatch(tx, { productId: 'p1', batchNumber: 'LOT-1', quantity: 5 });
      await reserveOrderInventory(tx, 'o1');
    });
    expect(await prisma.inventoryBatch.findFirst()).toMatchObject({ quantity: 5, reservedQuantity: 3 });
    await prisma.$transaction((tx) => shipOrderInventory(tx, 'o1', 'oi1', 2));
    expect(await prisma.inventoryBatch.findFirst()).toMatchObject({ quantity: 3, reservedQuantity: 1 });
    await prisma.$transaction((tx) => releaseOrderInventory(tx, 'o1'));
    expect(await prisma.inventoryBatch.findFirst()).toMatchObject({ quantity: 3, reservedQuantity: 0 });
  });

  it('rejects reservations above known available inventory', async () => {
    seed(2);
    await expect(prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1'))).rejects.toThrow('INSUFFICIENT_AVAILABLE_INVENTORY');
    expect(await prisma.inventoryReservation.count()).toBe(0);
  });
});
