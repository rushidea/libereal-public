import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  isInquiryLinkedOrderConflict,
  isInquiryPublicIdConflict,
  withAllocatedInquiryOrderNumber,
  withUniqueInquiryPublicId,
} from '@/data/inquiry-order-number';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

function inquiry(id: string, email: string) {
  return prisma.inquiry.create({
    data: { id, name: '询价人', email, phone: '13800000000', institution: '实验室' },
  });
}

describe('inquiry linked numbers on SQLite', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('replaces a colliding inquiry id inside the create transaction', async () => {
    await inquiry('INQ-AAAAAAAA', 'a@test.com');
    const codes = ['AAAAAAAA', 'AAAAAAAA', 'BBBBBBBB'];
    let index = 0;

    const created = await withUniqueInquiryPublicId(prisma, async (tx, inquiryId) => {
      await tx.inquiry.create({
        data: { id: inquiryId, name: '新询价', email: 'b@test.com', phone: '13800000000', institution: '实验室' },
      });
      return inquiryId;
    }, () => codes[index++] ?? 'CCCCCCCC');

    expect(created).toBe('INQ-BBBBBBBB');
    const rows = await prisma.inquiry.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => row.id)).toEqual(['INQ-AAAAAAAA', 'INQ-BBBBBBBB']);
  });

  it('treats a real inquiry-order sequence conflict as retryable and leaves checkout conflicts alone', async () => {
    await inquiry('INQ-CCCCCCCC', 'a@test.com');
    await prisma.order.create({
      data: { id: 'INQ-CCCCCCCC-AAAA', inquiryId: 'INQ-CCCCCCCC', inquiryOrderSeq: 1, email: 'a@test.com', subtotal: 1, total: 1 },
    });
    const duplicateSeq = prisma.order.create({
      data: { id: 'INQ-CCCCCCCC-BBBB', inquiryId: 'INQ-CCCCCCCC', inquiryOrderSeq: 1, email: 'a@test.com', subtotal: 1, total: 1 },
    });
    await expect(duplicateSeq).rejects.toSatisfy(isInquiryLinkedOrderConflict);
    await expect(duplicateSeq).rejects.toSatisfy((error: unknown) => !isInquiryPublicIdConflict(error));

    await prisma.order.create({
      data: { id: 'ORD-FIRST', email: 'a@test.com', subtotal: 1, total: 1, checkoutAttemptId: 'attempt-1' },
    });
    const checkout = prisma.order.create({
      data: { id: 'ORD-OTHER', email: 'b@test.com', subtotal: 1, total: 1, checkoutAttemptId: 'attempt-1' },
    });
    await expect(checkout).rejects.toSatisfy((error: unknown) => !isInquiryLinkedOrderConflict(error) && !isInquiryPublicIdConflict(error));
  });

  it('rolls back a collided order number and allocates the next suffix with the same sequence', async () => {
    await inquiry('id_68011acc-6134-4f0a-9c2b-111111111111', 'buyer@test.com');
    const suffixes = ['DDDD', 'EEEE'];
    let index = 0;
    let attempts = 0;

    const created = await withAllocatedInquiryOrderNumber(prisma, 'id_68011acc-6134-4f0a-9c2b-111111111111', async (tx, orderId, inquiryOrderSeq) => {
      attempts += 1;
      await tx.order.create({
        data: {
          id: orderId,
          inquiryId: 'id_68011acc-6134-4f0a-9c2b-111111111111',
          inquiryOrderSeq,
          email: 'buyer@test.com',
          subtotal: 10,
          total: 10,
        },
      });
      if (attempts === 1) {
        await tx.order.create({
          data: { id: orderId, email: 'buyer@test.com', subtotal: 10, total: 10 },
        });
      }
      return { orderId, inquiryOrderSeq };
    }, () => suffixes[index++] ?? 'FFFF');

    expect(attempts).toBe(2);
    expect(created).toEqual({
      orderId: 'id_68011acc-6134-4f0a-9c2b-111111111111-EEEE',
      inquiryOrderSeq: 1,
    });
    const stored = await prisma.order.findMany({ select: { id: true, inquiryOrderSeq: true } });
    expect(stored).toEqual([{ id: created.orderId, inquiryOrderSeq: 1 }]);
  });
});
