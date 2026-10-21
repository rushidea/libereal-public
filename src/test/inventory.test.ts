import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertVariantCheckoutStock, receiveInventoryBatch, releaseOrderInventory, reserveOrderInventory, shipOrderInventory } from '@/lib/inventory';
import { assertQuoteAcceptanceStock } from '@/lib/quote-acceptance-guards';
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

  it('rejects an order line when the selected variant does not have enough stock', async () => {
    seedVariant({ available: 1, quantity: 2 });
    await expect(prisma.$transaction((tx) => assertVariantCheckoutStock(tx, [{
      productId: 'p1', variantId: 'v1', quantity: 2,
    }]))).rejects.toThrow('VARIANT_INSUFFICIENT_STOCK');
    await expect(prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'buyer', '下单预占规格库存', { variantLinesOnly: true })))
      .rejects.toThrow('VARIANT_INSUFFICIENT_STOCK');
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 1, availableQuantity: 1, reservedQuantity: 0,
    });
    expect(await prisma.order.count()).toBe(1);
  });

  it('does not oversell a variant when two orders reserve it together', async () => {
    seedVariant({ available: 1, quantity: 1, secondOrder: true });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'buyer-1')),
      prisma.$transaction((tx) => reserveOrderInventory(tx, 'o2', 'buyer-2')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ message: 'INSUFFICIENT_AVAILABLE_INVENTORY' });
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 1, availableQuantity: 0, reservedQuantity: 1,
    });
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: null } })).toMatchObject({
      actualQuantity: 20, availableQuantity: 20, reservedQuantity: 0,
    });
  });

  it('releases a cancelled reservation back to the variant account', async () => {
    seedVariant({ available: 4, quantity: 1 });
    await prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'buyer'));
    await prisma.$transaction((tx) => releaseOrderInventory(tx, 'o1', 'buyer'));
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 4, availableQuantity: 4, reservedQuantity: 0,
    });
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: null } })).toMatchObject({
      actualQuantity: 20, availableQuantity: 20, reservedQuantity: 0,
    });
    expect(await prisma.inventoryReservation.findFirst()).toMatchObject({ status: 'released', inventoryAccountId: 'acc-variant' });
    expect(await prisma.product.findUnique({ where: { id: 'p1' }, select: { stockQuantity: true } })).toEqual({ stockQuantity: -1 });
  });

  it('does not release the same variant reservation twice', async () => {
    seedVariant({ available: 1, quantity: 1 });
    await prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'buyer'));
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => releaseOrderInventory(tx, 'o1', 'buyer')),
      prisma.$transaction((tx) => releaseOrderInventory(tx, 'o1', 'buyer')),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 1, availableQuantity: 1, reservedQuantity: 0,
    });
    expect(await prisma.inventoryTransaction.count({ where: { type: 'release' } })).toBe(1);
  });

  it('deducts shipped quantity from the variant account', async () => {
    seedVariant({ available: 4, quantity: 3 });
    await prisma.$transaction(async (tx) => {
      await reserveOrderInventory(tx, 'o1', 'admin');
      await shipOrderInventory(tx, 'o1', 'oi1', 2, 'admin');
    });
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 2, reservedQuantity: 1, availableQuantity: 1, shippedQuantity: 2,
    });
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: null } })).toMatchObject({
      actualQuantity: 20, availableQuantity: 20, reservedQuantity: 0, shippedQuantity: 0,
    });
    expect(await prisma.product.findUnique({ where: { id: 'p1' }, select: { stockQuantity: true } })).toEqual({ stockQuantity: -1 });
  });

  it('rejects quote acceptance against the variant account and keeps plain lines on the product account', async () => {
    seedVariant({ available: 1, quantity: 1 });
    await expect(prisma.$transaction((tx) => assertQuoteAcceptanceStock(tx, [
      { productId: 'p1', quantity: 2, metadata: JSON.stringify({ variantId: 'v1' }) },
    ]))).rejects.toThrow('VARIANT_INSUFFICIENT_STOCK');
    await prisma.$transaction((tx) => assertQuoteAcceptanceStock(tx, [
      { productId: 'p1', quantity: 2 },
    ]));
    getTestDb().prepare('UPDATE InventoryAccount SET actualQuantity = 1, availableQuantity = 1 WHERE id = ?').run('acc-product');
    await expect(prisma.$transaction((tx) => assertQuoteAcceptanceStock(tx, [
      { productId: 'p1', quantity: 2 },
    ]))).rejects.toThrow('INSUFFICIENT_STOCK');
    expect(await prisma.inventoryReservation.count()).toBe(0);
  });

  it('keeps product-level inventory when the order line has no variant', async () => {
    seed(8);
    const db = getTestDb();
    db.prepare(`INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price) VALUES ('v1', 'p1', 'CAT-1-V', '100 µL', 100)`).run();
    db.prepare(`INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt) VALUES ('acc-variant', 'p1', 'v1', 2, 2, 0, 0, 0, datetime('now'), datetime('now'))`).run();
    await prisma.$transaction((tx) => reserveOrderInventory(tx, 'o1', 'admin'));
    expect(await prisma.inventoryAccount.findFirst({ where: { variantId: 'v1' } })).toMatchObject({
      actualQuantity: 2, availableQuantity: 2, reservedQuantity: 0,
    });
    const productAccount = await prisma.inventoryAccount.findFirst({ where: { variantId: null } });
    expect(productAccount).toMatchObject({ actualQuantity: 8, reservedQuantity: 3, availableQuantity: 5 });
    expect(await prisma.inventoryReservation.findFirst()).toMatchObject({ inventoryAccountId: productAccount?.id });
  });
});

function seedVariant(input: { available: number; quantity: number; secondOrder?: boolean }) {
  const db = getTestDb();
  db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt) VALUES ('p1', 'CAT-1', '产品', 'CST', 100, -1, '[]', '[]', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price) VALUES ('v1', 'p1', 'CAT-1-V', '100 µL', 100)`).run();
  db.prepare(`INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt) VALUES ('acc-product', 'p1', NULL, 20, 20, 0, 0, 0, datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt) VALUES ('acc-variant', 'p1', 'v1', ?, ?, 0, 0, 0, datetime('now'), datetime('now'))`).run(input.available, input.available);
  db.prepare(`INSERT INTO "Order" (id, email, subtotal, total, status, createdAt, updatedAt) VALUES ('o1', 'buyer@test.com', 100, 100, 'pending', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, metadata, createdAt, updatedAt) VALUES ('oi1', 'o1', 0, 'p1', '产品', 100, ?, 0, 'pending', ?, datetime('now'), datetime('now'))`).run(input.quantity, JSON.stringify({ variantId: 'v1' }));
  if (!input.secondOrder) return;
  db.prepare(`INSERT INTO "Order" (id, email, subtotal, total, status, createdAt, updatedAt) VALUES ('o2', 'other@test.com', 100, 100, 'pending', datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, metadata, createdAt, updatedAt) VALUES ('oi2', 'o2', 0, 'p1', '产品', 100, 1, 0, 'pending', ?, datetime('now'), datetime('now'))`).run(JSON.stringify({ variantId: 'v1' }));
}
