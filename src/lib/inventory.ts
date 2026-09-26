import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type AccountState = {
  id: string;
  productId: string;
  variantId: string | null;
  actualQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  shippedQuantity: number;
  inboundQuantity: number;
};

function available(actual: number, reserved: number): number {
  return actual < 0 ? -1 : actual - reserved;
}

async function accountFor(tx: Tx, productId: string, variantId: string | null = null) {
  const existing = await tx.inventoryAccount.findFirst({ where: { productId, variantId } });
  if (existing) return existing;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { stockQuantity: true } });
  if (!product) throw new Error('INVENTORY_PRODUCT_NOT_FOUND');
  return tx.inventoryAccount.create({ data: {
    productId, variantId, actualQuantity: product.stockQuantity,
    availableQuantity: product.stockQuantity,
  } });
}

async function syncProductMirror(tx: Tx, account: AccountState) {
  if (account.variantId) return;
  await tx.product.update({ where: { id: account.productId }, data: {
    stockQuantity: account.availableQuantity,
    inStock: account.availableQuantity !== 0,
  } });
}

async function record(
  tx: Tx,
  before: AccountState,
  after: AccountState,
  input: { type: string; quantity: number; reason: string; actorId?: string | null; orderId?: string | null; reservationId?: string | null; batchId?: string | null },
) {
  await tx.inventoryTransaction.create({ data: {
    inventoryAccountId: before.id,
    batchId: input.batchId || null,
    reservationId: input.reservationId || null,
    orderId: input.orderId || null,
    type: input.type,
    quantity: input.quantity,
    reason: input.reason,
    actorId: input.actorId || null,
    actualBefore: before.actualQuantity,
    actualAfter: after.actualQuantity,
    availableBefore: before.availableQuantity,
    availableAfter: after.availableQuantity,
    reservedBefore: before.reservedQuantity,
    reservedAfter: after.reservedQuantity,
    inboundBefore: before.inboundQuantity,
    inboundAfter: after.inboundQuantity,
    shippedBefore: before.shippedQuantity,
    shippedAfter: after.shippedQuantity,
  } });
}

export async function reserveOrderInventory(tx: Tx, orderId: string, actorId?: string | null) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  for (const item of order.orderItems) {
    if (!item.productId) continue;
    const existing = await tx.inventoryReservation.findUnique({ where: { orderItemId: item.id } });
    if (existing) continue;
    const before = await accountFor(tx, item.productId);
    if (before.availableQuantity >= 0 && before.availableQuantity < item.quantity) throw new Error('INSUFFICIENT_AVAILABLE_INVENTORY');
    const reservedQuantity = before.reservedQuantity + item.quantity;
    const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: {
      reservedQuantity,
      availableQuantity: available(before.actualQuantity, reservedQuantity),
    } });
    const reservation = await tx.inventoryReservation.create({ data: {
      inventoryAccountId: before.id, orderId, orderItemId: item.id, quantity: item.quantity,
    } });
    const batches = await tx.inventoryBatch.findMany({
      where: { inventoryAccountId: before.id },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    });
    let allocationRemaining = item.quantity;
    for (const batch of batches) {
      if (allocationRemaining <= 0) break;
      const allocatable = Math.max(0, batch.quantity - batch.reservedQuantity);
      const allocated = Math.min(allocatable, allocationRemaining);
      if (!allocated) continue;
      await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: { increment: allocated } } });
      await tx.inventoryReservationBatch.create({ data: { reservationId: reservation.id, batchId: batch.id, quantity: allocated } });
      allocationRemaining -= allocated;
    }
    await record(tx, before, after, { type: 'reserve', quantity: item.quantity, reason: '订单确认预占库存', actorId, orderId, reservationId: reservation.id });
    await syncProductMirror(tx, after);
  }
}

export async function releaseOrderInventory(tx: Tx, orderId: string, actorId?: string | null, reason = '订单取消释放库存') {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'active' } });
  for (const reservation of reservations) {
    const before = await tx.inventoryAccount.findUniqueOrThrow({ where: { id: reservation.inventoryAccountId } });
    const remaining = Math.max(0, reservation.quantity - reservation.fulfilledQuantity);
    const allocations = await tx.inventoryReservationBatch.findMany({ where: { reservationId: reservation.id } });
    for (const allocation of allocations) {
      const allocatedRemaining = Math.max(0, allocation.quantity - allocation.fulfilledQuantity);
      if (allocatedRemaining) await tx.inventoryBatch.update({ where: { id: allocation.batchId }, data: { reservedQuantity: { decrement: allocatedRemaining } } });
    }
    const reservedQuantity = Math.max(0, before.reservedQuantity - remaining);
    const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: {
      reservedQuantity,
      availableQuantity: available(before.actualQuantity, reservedQuantity),
    } });
    await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'released' } });
    await record(tx, before, after, { type: 'release', quantity: remaining, reason, actorId, orderId, reservationId: reservation.id });
    await syncProductMirror(tx, after);
  }
}

export async function shipOrderInventory(tx: Tx, orderId: string, orderItemId: string, quantity: number, actorId?: string | null) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_INVENTORY_QUANTITY');
  const item = await tx.orderItem.findUnique({ where: { id: orderItemId } });
  if (!item || item.orderId !== orderId) throw new Error('ORDER_ITEM_NOT_FOUND');
  if (!item.productId) return;
  let reservation = await tx.inventoryReservation.findUnique({ where: { orderItemId } });
  if (!reservation) {
    await reserveOrderInventory(tx, orderId, actorId);
    reservation = await tx.inventoryReservation.findUnique({ where: { orderItemId } });
  }
  if (!reservation || reservation.status !== 'active') throw new Error('INVENTORY_RESERVATION_NOT_ACTIVE');
  const remaining = reservation.quantity - reservation.fulfilledQuantity;
  if (quantity > remaining) throw new Error('INVENTORY_RESERVATION_EXCEEDED');
  const before = await tx.inventoryAccount.findUniqueOrThrow({ where: { id: reservation.inventoryAccountId } });
  if (before.actualQuantity >= 0 && before.actualQuantity < quantity) throw new Error('INSUFFICIENT_ACTUAL_INVENTORY');
  const fulfilledQuantity = reservation.fulfilledQuantity + quantity;
  const reservedQuantity = Math.max(0, before.reservedQuantity - quantity);
  const actualQuantity = before.actualQuantity < 0 ? -1 : before.actualQuantity - quantity;
  const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: {
    actualQuantity,
    reservedQuantity,
    availableQuantity: available(actualQuantity, reservedQuantity),
    shippedQuantity: { increment: quantity },
  } });
  await tx.inventoryReservation.update({ where: { id: reservation.id }, data: {
    fulfilledQuantity,
    status: fulfilledQuantity >= reservation.quantity ? 'fulfilled' : 'active',
  } });
  const allocations = await tx.inventoryReservationBatch.findMany({
    where: { reservationId: reservation.id }, include: { batch: true },
    orderBy: { batch: { expiryDate: 'asc' } },
  });
  let batchRemaining = quantity;
  for (const allocation of allocations) {
    if (batchRemaining <= 0) break;
    const allocationRemaining = allocation.quantity - allocation.fulfilledQuantity;
    const consumed = Math.min(allocationRemaining, batchRemaining);
    if (!consumed) continue;
    await tx.inventoryBatch.update({ where: { id: allocation.batchId }, data: { quantity: { decrement: consumed }, reservedQuantity: { decrement: consumed } } });
    await tx.inventoryReservationBatch.update({ where: { id: allocation.id }, data: { fulfilledQuantity: { increment: consumed } } });
    batchRemaining -= consumed;
  }
  await record(tx, before, after, { type: 'ship', quantity: -quantity, reason: '订单发货扣减库存', actorId, orderId, reservationId: reservation.id });
  await syncProductMirror(tx, after);
}

export async function setActualInventory(
  tx: Tx,
  input: { productId: string; variantId?: string | null; actualQuantity: number; reason: string; actorId?: string | null },
) {
  if (!Number.isInteger(input.actualQuantity) || input.actualQuantity < -1) throw new Error('INVALID_INVENTORY_QUANTITY');
  const before = await accountFor(tx, input.productId, input.variantId || null);
  if (input.actualQuantity >= 0 && input.actualQuantity < before.reservedQuantity) throw new Error('INVENTORY_BELOW_RESERVED');
  const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: {
    actualQuantity: input.actualQuantity,
    availableQuantity: available(input.actualQuantity, before.reservedQuantity),
  } });
  await record(tx, before, after, {
    type: 'adjustment',
    quantity: input.actualQuantity < 0 || before.actualQuantity < 0 ? 0 : input.actualQuantity - before.actualQuantity,
    reason: input.reason,
    actorId: input.actorId,
  });
  await syncProductMirror(tx, after);
  return after;
}

export async function receiveInventoryBatch(
  tx: Tx,
  input: { productId: string; variantId?: string | null; batchNumber: string; quantity: number; expiryDate?: Date | null; actorId?: string | null },
) {
  if (!input.batchNumber.trim() || !Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('INVALID_BATCH_RECEIPT');
  const before = await accountFor(tx, input.productId, input.variantId || null);
  const actualQuantity = before.actualQuantity < 0 ? input.quantity : before.actualQuantity + input.quantity;
  const inboundQuantity = Math.max(0, before.inboundQuantity - input.quantity);
  const batch = await tx.inventoryBatch.upsert({
    where: { inventoryAccountId_batchNumber: { inventoryAccountId: before.id, batchNumber: input.batchNumber.trim() } },
    create: { inventoryAccountId: before.id, batchNumber: input.batchNumber.trim(), quantity: input.quantity, expiryDate: input.expiryDate || null },
    update: { quantity: { increment: input.quantity }, expiryDate: input.expiryDate || undefined },
  });
  const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: {
    actualQuantity,
    availableQuantity: available(actualQuantity, before.reservedQuantity),
    inboundQuantity,
  } });
  await record(tx, before, after, { type: 'receipt', quantity: input.quantity, reason: '批次入库', actorId: input.actorId, batchId: batch.id });
  await syncProductMirror(tx, after);
  return { account: after, batch };
}

export async function setInboundInventory(tx: Tx, input: { productId: string; variantId?: string | null; quantity: number; reason: string; actorId?: string | null }) {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new Error('INVALID_INBOUND_QUANTITY');
  const before = await accountFor(tx, input.productId, input.variantId || null);
  const after = await tx.inventoryAccount.update({ where: { id: before.id }, data: { inboundQuantity: input.quantity } });
  await record(tx, before, after, { type: 'inbound_adjustment', quantity: input.quantity - before.inboundQuantity, reason: input.reason, actorId: input.actorId });
  return after;
}
