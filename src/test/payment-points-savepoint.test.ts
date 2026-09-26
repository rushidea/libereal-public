import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { settlePaymentPoints } from '@/lib/payment-concurrency';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

describe('payment points rollback boundary with synthetic SQLite', () => {
  beforeAll(() => { getTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });
  afterAll(async () => { await prisma.$disconnect(); closeTestDb(); });
  it('rolls back an incomplete deduction while retaining the payment fact', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'synthetic-points-user', email: 'points@example.test', points: 10 });
    db.prepare(`INSERT INTO "Order" (id,email,customerId,subtotal,total,status,pointsPersonal,pointsGroup,pointsDiscount,updatedAt)
      VALUES ('synthetic-points-order','points@example.test','synthetic-points-user',20,10,'unpaid',5,5,10,datetime('now'))`).run();
    const result = await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: 'synthetic-points-order' }, data: { paidAt: new Date(), status: 'pending' } });
      return settlePaymentPoints(tx, 'synthetic-points-order');
    });
    expect(result).toMatchObject({ ok: false });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: 'synthetic-points-order' } });
    expect(order.paidAt).not.toBeNull();
    expect(order.status).toBe('pending');
    expect(order.pointsApplied).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'synthetic-points-user' } })).points).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog').get()).toEqual({ count: 0 });
  });
});
