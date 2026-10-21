import { describe, expect, it } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  allocateOrderNumber,
  highestSameDayOrderId,
  isOrderIdUniqueConflict,
  nextOrderNumber,
  ORDER_NUMBER_ALLOCATION_ATTEMPTS,
  ORDER_NUMBER_BUSY_ERROR,
  orderDateInShanghai,
  withAllocatedOrderNumber,
} from '@/data/order-number';

const shanghaiMidnight = new Date('2026-10-20T16:00:00.000Z');
const beforeShanghaiMidnight = new Date('2026-10-20T15:59:59.999Z');
const beijingEarlyMorning = new Date('2026-10-20T16:30:00.000Z');

function orderIdConflict(): Error & { code: 'P2002'; meta: { target: string[] } } {
  const error = new Error('Unique constraint failed on the fields: (`id`)') as Error & { code: 'P2002'; meta: { target: string[] } };
  error.code = 'P2002';
  error.meta = { target: ['id'] };
  return error;
}

function memoryOrders(ids: string[]) {
  return {
    order: {
      findMany: async ({ where }: { where: { id: { startsWith: string } } }) => ids
        .filter((id) => id.startsWith(where.id.startsWith))
        .map((id) => ({ id })),
    },
  } as unknown as Pick<Prisma.TransactionClient, 'order'>;
}

describe('order number', () => {
  it('uses the Shanghai calendar date around UTC midnight', () => {
    expect(orderDateInShanghai(new Date('2026-07-15T16:18:00.000Z'))).toBe('20260716');
    expect(orderDateInShanghai(beforeShanghaiMidnight)).toBe('20261020');
    expect(orderDateInShanghai(shanghaiMidnight)).toBe('20261021');
    expect(orderDateInShanghai(beijingEarlyMorning)).toBe('20261021');
  });

  it('starts at one and increments the latest sequence', () => {
    const date = new Date('2026-07-15T16:18:00.000Z');

    expect(nextOrderNumber(date, null)).toBe('ORD-20260716-001');
    expect(nextOrderNumber(date, 'ORD-20260716-009')).toBe('ORD-20260716-010');
    expect(nextOrderNumber(date, 'ORD-20260716-999')).toBe('ORD-20260716-1000');
  });

  it('ignores an order number from another date', () => {
    const date = new Date('2026-07-15T16:18:00.000Z');

    expect(nextOrderNumber(date, 'ORD-20260715-999')).toBe('ORD-20260716-001');
    expect(highestSameDayOrderId(date, ['ORD-20260715-999', 'ORD-20260716-004', 'ORD-20260716-NOTE'])).toBe('ORD-20260716-004');
  });

  it('allocates the next Shanghai-day sequence from the numeric maximum, not the row count', async () => {
    const db = memoryOrders(['ORD-20261020-020', 'ORD-20261021-001', 'ORD-20261021-007']);

    await expect(allocateOrderNumber(db, beijingEarlyMorning)).resolves.toBe('ORD-20261021-008');
    await expect(allocateOrderNumber(memoryOrders([]), shanghaiMidnight)).resolves.toBe('ORD-20261021-001');
    await expect(allocateOrderNumber(memoryOrders(['ORD-20261021-999', 'ORD-20261021-1000']), beijingEarlyMorning)).resolves.toBe('ORD-20261021-1001');
  });

  it('keeps cart, quote acceptance, and admin creates on the same sequence', async () => {
    const ids = ['ORD-20261020-009'];
    const db = memoryOrders(ids);
    const cart = await allocateOrderNumber(db, beijingEarlyMorning);
    ids.push(cart);
    const quote = await allocateOrderNumber(db, beijingEarlyMorning);
    ids.push(quote);
    const admin = await allocateOrderNumber(db, beijingEarlyMorning);

    expect([cart, quote, admin]).toEqual([
      'ORD-20261021-001',
      'ORD-20261021-002',
      'ORD-20261021-003',
    ]);
  });

  it('rolls the sequence at Shanghai midnight instead of UTC midnight', async () => {
    const ids = ['ORD-20261020-004'];
    const db = memoryOrders(ids);

    await expect(allocateOrderNumber(db, beforeShanghaiMidnight)).resolves.toBe('ORD-20261020-005');
    await expect(allocateOrderNumber(db, shanghaiMidnight)).resolves.toBe('ORD-20261021-001');
  });

  it('retries an order-id collision inside the transaction and then continues the sequence', async () => {
    const ids: string[] = [];
    let reads = 0;
    let releaseFirstRead: () => void = () => {};
    const firstReadFinished = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const tx = {
      order: {
        findMany: async () => {
          const snapshot = ids.slice();
          reads += 1;
          if (reads === 1) await firstReadFinished;
          return snapshot.map((id) => ({ id }));
        },
        create: async ({ data }: { data: { id: string } }) => {
          if (ids.includes(data.id)) throw orderIdConflict();
          ids.push(data.id);
          if (ids.length === 1) releaseFirstRead();
          return { id: data.id };
        },
      },
    };
    const db = {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const allocate = () => withAllocatedOrderNumber(db, async (_client, orderId) => {
      await tx.order.create({ data: { id: orderId } });
      return orderId;
    }, beijingEarlyMorning);

    await expect(Promise.all([allocate(), allocate()])).resolves.toEqual([
      'ORD-20261021-002',
      'ORD-20261021-001',
    ]);
    expect(ids).toEqual(['ORD-20261021-001', 'ORD-20261021-002']);
  });

  it('does not retry business errors or checkout idempotency conflicts', async () => {
    let calls = 0;
    const db = {
      $transaction: async <T>(fn: (client: Pick<Prisma.TransactionClient, 'order'>) => Promise<T>) => fn(memoryOrders([])),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    await expect(withAllocatedOrderNumber(db, async () => {
      calls += 1;
      throw new Error('QUOTE_STALE');
    }, beijingEarlyMorning)).rejects.toThrow('QUOTE_STALE');
    expect(calls).toBe(1);

    const idempotencyConflict = new Error('Unique constraint failed on the fields: (`checkoutAttemptId`)') as Error & {
      code: 'P2002';
      meta: { target: string[] };
    };
    idempotencyConflict.code = 'P2002';
    idempotencyConflict.meta = { target: ['checkoutAttemptId'] };
    await expect(withAllocatedOrderNumber(db, async () => {
      calls += 1;
      throw idempotencyConflict;
    }, beijingEarlyMorning)).rejects.toBe(idempotencyConflict);
    expect(calls).toBe(2);
    expect(isOrderIdUniqueConflict(idempotencyConflict)).toBe(false);
    expect(isOrderIdUniqueConflict({ code: 'P2002' })).toBe(false);
  });

  it('rethrows the original order-id conflict after the attempt budget without wrapping it', async () => {
    const conflict = orderIdConflict();
    let calls = 0;
    const db = {
      $transaction: async <T>(fn: (client: Pick<Prisma.TransactionClient, 'order'>) => Promise<T>) => fn(memoryOrders([])),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    await expect(withAllocatedOrderNumber(db, async () => {
      calls += 1;
      throw conflict;
    }, beijingEarlyMorning)).rejects.toBe(conflict);
    expect(calls).toBe(ORDER_NUMBER_ALLOCATION_ATTEMPTS);
    expect(ORDER_NUMBER_BUSY_ERROR).toBe('订单提交繁忙，请稍后重试');
    expect(ORDER_NUMBER_BUSY_ERROR).not.toMatch(/P2002|Unique constraint|constraint/);
  });
});
