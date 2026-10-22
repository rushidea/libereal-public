import { describe, expect, it } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  INQUIRY_ORDER_NUMBER_ATTEMPTS,
  INQUIRY_PUBLIC_ID_ATTEMPTS,
  PUBLIC_NUMBER_ALPHABET,
  allocateInquiryLinkedOrderNumber,
  generateInquiryPublicId,
  inquiryPublicIdConflict,
  isInquiryLinkedOrderConflict,
  isInquiryPublicIdConflict,
  orderNumberSharesInquiry,
  randomPublicToken,
  withAllocatedInquiryOrderNumber,
  withUniqueInquiryPublicId,
} from '@/data/inquiry-order-number';

function scripted(values: string[]) {
  let index = 0;
  return (length: number) => {
    const value = values[Math.min(index, values.length - 1)] ?? '';
    index += 1;
    if (value.length !== length) throw new Error(`scripted token length ${value.length} != ${length}`);
    return value;
  };
}

function orderIdConflict(): Error & { code: 'P2002'; meta: { target: string[] } } {
  const error = new Error('Unique constraint failed on the fields: (`id`)') as Error & { code: 'P2002'; meta: { target: string[] } };
  error.code = 'P2002';
  error.meta = { target: ['id'] };
  return error;
}

function memoryOrders(rows: Array<{ inquiryId: string; inquiryOrderSeq: number | null }>) {
  return {
    order: {
      findMany: async ({ where }: { where: { inquiryId: string } }) => rows
        .filter((row) => row.inquiryId === where.inquiryId)
        .map((row) => ({ inquiryOrderSeq: row.inquiryOrderSeq })),
    },
  } as unknown as Pick<Prisma.TransactionClient, 'order'>;
}

describe('inquiry and linked order numbers', () => {
  it('builds a public inquiry id from the unguessable alphabet', () => {
    const id = generateInquiryPublicId(scripted(['7K3M9Q2P']));
    expect(id).toBe('INQ-7K3M9Q2P');
    expect(PUBLIC_NUMBER_ALPHABET).toHaveLength(32);
    expect(PUBLIC_NUMBER_ALPHABET.includes('I')).toBe(false);
    expect(PUBLIC_NUMBER_ALPHABET.includes('O')).toBe(false);
    expect(PUBLIC_NUMBER_ALPHABET.includes('0')).toBe(false);
    expect(PUBLIC_NUMBER_ALPHABET.includes('1')).toBe(false);
    const samples = new Set(Array.from({ length: 20 }, () => randomPublicToken(8)));
    expect(samples.size).toBe(20);
    for (const sample of samples) {
      expect(sample).toMatch(new RegExp(`^[${PUBLIC_NUMBER_ALPHABET}]{8}$`));
    }
  });

  it('rejects a token outside the public alphabet', () => {
    expect(() => generateInquiryPublicId(scripted(['00000000']))).toThrow('INVALID_INQUIRY_CODE');
  });

  it('shares the inquiry id and stores the sequence separately from the public suffix', async () => {
    const legacyId = 'id_68011acc-6134-4f0a-9c2b-111111111111';
    const first = await allocateInquiryLinkedOrderNumber(memoryOrders([]), legacyId, scripted(['K7MP']));
    expect(first).toEqual({ orderId: `${legacyId}-K7MP`, inquiryOrderSeq: 1 });
    expect(orderNumberSharesInquiry(legacyId, first.orderId)).toBe(true);
    expect(orderNumberSharesInquiry(legacyId, 'ORD-20261021-001')).toBe(false);

    const second = await allocateInquiryLinkedOrderNumber(
      memoryOrders([{ inquiryId: legacyId, inquiryOrderSeq: null }]),
      legacyId,
      scripted(['R8NQ']),
    );
    expect(second.inquiryOrderSeq).toBe(2);
    expect(second.orderId).toBe(`${legacyId}-R8NQ`);

    const third = await allocateInquiryLinkedOrderNumber(
      memoryOrders([
        { inquiryId: legacyId, inquiryOrderSeq: 4 },
        { inquiryId: 'other', inquiryOrderSeq: 9 },
      ]),
      legacyId,
      scripted(['W3HX']),
    );
    expect(third.inquiryOrderSeq).toBe(5);
    expect(third.orderId.endsWith('-0005')).toBe(false);
  });

  it('does not treat a checkout idempotency conflict as a number conflict', () => {
    const checkout = new Error('Unique constraint failed on the fields: (`checkoutAttemptId`)') as Error & {
      code: 'P2002';
      meta: { target: string[] };
    };
    checkout.code = 'P2002';
    checkout.meta = { target: ['checkoutAttemptId'] };
    expect(isInquiryPublicIdConflict(checkout)).toBe(false);
    expect(isInquiryLinkedOrderConflict(checkout)).toBe(false);
    expect(isInquiryPublicIdConflict(inquiryPublicIdConflict())).toBe(true);
    expect(isInquiryLinkedOrderConflict(orderIdConflict())).toBe(true);

    const sequence = new Error('Unique constraint failed on the fields: (`inquiryId`,`inquiry_order_seq`)') as Error & {
      code: 'P2002';
      meta: { target: string[] };
    };
    sequence.code = 'P2002';
    sequence.meta = { target: ['Order_inquiryId_inquiryOrderSeq_key'] };
    expect(isInquiryLinkedOrderConflict(sequence)).toBe(true);
    expect(isInquiryPublicIdConflict(sequence)).toBe(false);
  });

  it('retries an inquiry id collision inside the transaction and then keeps the new id', async () => {
    const ids = new Set(['INQ-AAAAAAAA']);
    let reads = 0;
    const tx = {
      inquiry: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          reads += 1;
          return ids.has(where.id) ? { id: where.id } : null;
        },
      },
    };
    const db = {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const created = await withUniqueInquiryPublicId(db, async (_client, inquiryId) => {
      ids.add(inquiryId);
      return inquiryId;
    }, scripted(['AAAAAAAA', 'BBBBBBBB']));

    expect(created).toBe('INQ-BBBBBBBB');
    expect(reads).toBe(2);
    expect(INQUIRY_PUBLIC_ID_ATTEMPTS).toBe(3);
  });

  it('retries an order-number collision without retrying a business error', async () => {
    const rows: Array<{ id: string; inquiryId: string; inquiryOrderSeq: number }> = [];
    let attempts = 0;
    const tx = {
      order: {
        findMany: async () => rows.map((row) => ({ inquiryOrderSeq: row.inquiryOrderSeq })),
        findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
        create: async ({ data }: { data: { id: string; inquiryOrderSeq: number } }) => {
          if (rows.some((row) => row.id === data.id)) throw orderIdConflict();
          rows.push({ id: data.id, inquiryId: 'INQ-CCCCCCCC', inquiryOrderSeq: data.inquiryOrderSeq });
          return data;
        },
      },
    };
    const db = {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => {
        const snapshot = rows.slice();
        try {
          return await fn(tx);
        } catch (error) {
          rows.splice(0, rows.length, ...snapshot);
          throw error;
        }
      },
    } as unknown as Pick<PrismaClient, '$transaction'>;
    const token = scripted(['AAAA', 'BBBB']);

    const allocate = () => withAllocatedInquiryOrderNumber(db, 'INQ-CCCCCCCC', async (client, orderId, inquiryOrderSeq) => {
      attempts += 1;
      await tx.order.create({ data: { id: orderId, inquiryOrderSeq } });
      if (attempts === 1) {
        await tx.order.create({ data: { id: orderId, inquiryOrderSeq } });
      }
      return { orderId, inquiryOrderSeq };
    }, token);

    await expect(allocate()).resolves.toEqual({ orderId: 'INQ-CCCCCCCC-BBBB', inquiryOrderSeq: 1 });
    expect(rows.map((row) => row.id)).toEqual(['INQ-CCCCCCCC-BBBB']);
    expect(orderNumberSharesInquiry('INQ-CCCCCCCC', rows[0].id)).toBe(true);

    await expect(withAllocatedInquiryOrderNumber(db, 'INQ-CCCCCCCC', async () => {
      throw new Error('QUOTE_STALE');
    }, scripted(['CCCC']))).rejects.toThrow('QUOTE_STALE');
    expect(INQUIRY_ORDER_NUMBER_ATTEMPTS).toBe(3);
  });
});
