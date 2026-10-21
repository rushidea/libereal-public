import type { Prisma } from '@prisma/client';
import { variantIdFromItemMetadata } from '@/lib/variant-removal-guard';

type Tx = Prisma.TransactionClient;

/** 规格库存不足。HTTP 层翻译成 400 和中文提示，避免和商品级 409 混在一起。 */
export const VARIANT_STOCK_INSUFFICIENT = 'VARIANT_INSUFFICIENT_STOCK';
export const VARIANT_STOCK_INSUFFICIENT_MESSAGE = '所选规格库存不足';

export class VariantStockInsufficientError extends Error {
  readonly code = VARIANT_STOCK_INSUFFICIENT;

  constructor() {
    super(VARIANT_STOCK_INSUFFICIENT);
    this.name = 'VariantStockInsufficientError';
  }
}

export function isVariantStockInsufficientError(error: unknown): boolean {
  return error instanceof VariantStockInsufficientError
    || (error instanceof Error && error.message === VARIANT_STOCK_INSUFFICIENT);
}

type VariantStockLine = {
  productId?: string | null;
  quantity: number;
  variantId?: string | null;
  metadata?: string | null;
};

export function variantIdFromOrderLine(line: { variantId?: string | null; metadata?: string | null }): string | null {
  if (typeof line.variantId === 'string' && line.variantId.trim()) return line.variantId.trim();
  return variantIdFromItemMetadata(line.metadata);
}
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

async function availableForVariantLine(tx: Tx, productId: string, variantId: string): Promise<number | null> {
  const variantAccount = await tx.inventoryAccount.findFirst({
    where: { productId, variantId },
    select: { availableQuantity: true },
  });
  if (variantAccount) return variantAccount.availableQuantity;
  const productAccount = await tx.inventoryAccount.findFirst({
    where: { productId, variantId: null },
    select: { availableQuantity: true },
  });
  if (productAccount) return productAccount.availableQuantity;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { stockQuantity: true } });
  return product?.stockQuantity ?? null;
}

/**
 * 事务内按规格校验可售库存。
 * 规格已有 InventoryAccount 时只认该账户；没有规格账户时回退商品级账户 / Product.stockQuantity。
 * availableQuantity 或 stockQuantity < 0（通常是 -1）表示不限库存，允许超卖。没有独立的期货/预售开关。
 * 没有 variantId 的行不在这里处理。
 */
export async function assertVariantCheckoutStock(tx: Tx, lines: VariantStockLine[]) {
  const grouped = new Map<string, { productId: string; variantId: string; quantity: number }>();
  for (const line of lines) {
    if (!line.productId) continue;
    const variantId = variantIdFromOrderLine(line);
    if (!variantId) continue;
    const key = `${line.productId}\0${variantId}`;
    const current = grouped.get(key);
    if (current) current.quantity += line.quantity;
    else grouped.set(key, { productId: line.productId, variantId, quantity: line.quantity });
  }
  for (const line of grouped.values()) {
    const availableQuantity = await availableForVariantLine(tx, line.productId, line.variantId);
    if (availableQuantity == null || availableQuantity < 0) continue;
    if (availableQuantity < line.quantity) throw new VariantStockInsufficientError();
  }
}

async function claimReservationQuantity(tx: Tx, before: AccountState, quantity: number): Promise<AccountState> {
  const updated = before.availableQuantity < 0
    ? await tx.inventoryAccount.updateMany({
        where: { id: before.id, availableQuantity: { lt: 0 } },
        data: { reservedQuantity: { increment: quantity } },
      })
    : await tx.inventoryAccount.updateMany({
        where: { id: before.id, availableQuantity: { gte: quantity } },
        data: {
          reservedQuantity: { increment: quantity },
          availableQuantity: { decrement: quantity },
        },
      });
  if (updated.count !== 1) throw new Error('INSUFFICIENT_AVAILABLE_INVENTORY');
  return tx.inventoryAccount.findUniqueOrThrow({ where: { id: before.id } });
}

async function accountForOrderItem(tx: Tx, productId: string, variantId: string | null, variantLinesOnly: boolean) {
  if (variantId) {
    const variantAccount = await tx.inventoryAccount.findFirst({ where: { productId, variantId } });
    if (variantAccount) return variantAccount;
    if (variantLinesOnly) return null;
  }
  return accountFor(tx, productId, null);
}

export async function reserveOrderInventory(
  tx: Tx,
  orderId: string,
  actorId?: string | null,
  reason = '订单确认预占库存',
  options?: { variantLinesOnly?: boolean },
) {
  const variantLinesOnly = options?.variantLinesOnly === true;
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  for (const item of order.orderItems) {
    if (!item.productId) continue;
    const variantId = variantIdFromItemMetadata(item.metadata);
    if (variantLinesOnly && !variantId) continue;
    const existing = await tx.inventoryReservation.findUnique({ where: { orderItemId: item.id } });
    if (existing) continue;
    const before = await accountForOrderItem(tx, item.productId, variantId, variantLinesOnly);
    if (!before) continue;
    let after: AccountState;
    try {
      after = await claimReservationQuantity(tx, before, item.quantity);
    } catch (error) {
      if (variantLinesOnly && error instanceof Error && error.message === 'INSUFFICIENT_AVAILABLE_INVENTORY') {
        throw new VariantStockInsufficientError();
      }
      throw error;
    }
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
      const claimed = await tx.inventoryBatch.updateMany({
        where: { id: batch.id, reservedQuantity: { lte: batch.quantity - allocated } },
        data: { reservedQuantity: { increment: allocated } },
      });
      if (claimed.count !== 1) continue;
      await tx.inventoryReservationBatch.create({ data: { reservationId: reservation.id, batchId: batch.id, quantity: allocated } });
      allocationRemaining -= allocated;
    }
    await record(tx, before, after, { type: 'reserve', quantity: item.quantity, reason, actorId, orderId, reservationId: reservation.id });
    await syncProductMirror(tx, after);
  }
}

async function releaseReservedQuantity(tx: Tx, before: AccountState, quantity: number): Promise<AccountState> {
  if (quantity === 0) return before;
  const updated = before.availableQuantity < 0
    ? await tx.inventoryAccount.updateMany({
        where: { id: before.id, availableQuantity: { lt: 0 }, reservedQuantity: { gte: quantity } },
        data: { reservedQuantity: { decrement: quantity } },
      })
    : await tx.inventoryAccount.updateMany({
        where: { id: before.id, reservedQuantity: { gte: quantity } },
        data: {
          reservedQuantity: { decrement: quantity },
          availableQuantity: { increment: quantity },
        },
      });
  if (updated.count !== 1) throw new Error('INVENTORY_RELEASE_CONFLICT');
  return tx.inventoryAccount.findUniqueOrThrow({ where: { id: before.id } });
}

export async function releaseOrderInventory(tx: Tx, orderId: string, actorId?: string | null, reason = '订单取消释放库存') {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'active' } });
  for (const reservation of reservations) {
    const claimed = await tx.inventoryReservation.updateMany({
      where: { id: reservation.id, status: 'active' },
      data: { status: 'released' },
    });
    if (claimed.count !== 1) continue;
    const current = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    const remaining = Math.max(0, current.quantity - current.fulfilledQuantity);
    const before = await tx.inventoryAccount.findUniqueOrThrow({ where: { id: reservation.inventoryAccountId } });
    const allocations = await tx.inventoryReservationBatch.findMany({ where: { reservationId: reservation.id } });
    for (const allocation of allocations) {
      const allocatedRemaining = Math.max(0, allocation.quantity - allocation.fulfilledQuantity);
      if (!allocatedRemaining) continue;
      const released = await tx.inventoryBatch.updateMany({
        where: { id: allocation.batchId, reservedQuantity: { gte: allocatedRemaining } },
        data: { reservedQuantity: { decrement: allocatedRemaining } },
      });
      if (released.count !== 1) throw new Error('INVENTORY_RELEASE_CONFLICT');
    }
    const after = await releaseReservedQuantity(tx, before, remaining);
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
  const claimed = await tx.inventoryReservation.updateMany({
    where: { id: reservation.id, status: 'active', fulfilledQuantity: reservation.fulfilledQuantity },
    data: {
      fulfilledQuantity,
      status: fulfilledQuantity >= reservation.quantity ? 'fulfilled' : 'active',
    },
  });
  if (claimed.count !== 1) throw new Error('INVENTORY_RESERVATION_EXCEEDED');
  const updated = before.availableQuantity < 0
    ? await tx.inventoryAccount.updateMany({
        where: { id: before.id, availableQuantity: { lt: 0 }, reservedQuantity: { gte: quantity } },
        data: {
          reservedQuantity: { decrement: quantity },
          shippedQuantity: { increment: quantity },
        },
      })
    : await tx.inventoryAccount.updateMany({
        where: { id: before.id, actualQuantity: { gte: quantity }, reservedQuantity: { gte: quantity } },
        data: {
          actualQuantity: { decrement: quantity },
          reservedQuantity: { decrement: quantity },
          shippedQuantity: { increment: quantity },
        },
      });
  if (updated.count !== 1) throw new Error('INSUFFICIENT_ACTUAL_INVENTORY');
  const after = await tx.inventoryAccount.findUniqueOrThrow({ where: { id: before.id } });
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
    const consumedBatch = await tx.inventoryBatch.updateMany({
      where: { id: allocation.batchId, quantity: { gte: consumed }, reservedQuantity: { gte: consumed } },
      data: { quantity: { decrement: consumed }, reservedQuantity: { decrement: consumed } },
    });
    if (consumedBatch.count !== 1) throw new Error('INSUFFICIENT_ACTUAL_INVENTORY');
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
