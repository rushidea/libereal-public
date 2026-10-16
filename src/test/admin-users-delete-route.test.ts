import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_USER_DELETE_BATCH_LIMIT, ADMIN_USER_DELETE_ERRORS } from '@/data/admin-user-delete';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin }));

import { DELETE } from '@/app/api/admin/users/route';

function makeDelete(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ensureOrganizations() {
  getTestDb().exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pending_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner_user_id TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL
    );
    DELETE FROM organizations;
  `);
}

function userRow(id: string) {
  return getTestDb().prepare('SELECT id, role, isFrozen, points FROM User WHERE id = ?').get(id) as {
    id: string;
    role: string;
    isFrozen: number;
    points: number;
  } | undefined;
}

describe('DELETE /api/admin/users', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    ensureOrganizations();
    seedAdmin(db);
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({
      id: 'admin_test_id',
      email: 'admin@test.com',
      role: 'admin',
    });
  });

  it('freezes the customer, writes an audit row, and keeps points, credit, and the order', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'u_buyer', email: 'buyer@example.com', name: '购买人', points: 40 });
    db.prepare(`UPDATE User SET points = 40 WHERE id = 'u_buyer'`).run();
    db.prepare(`
      INSERT INTO "Order" (id, email, customerId, subtotal, total, status, updatedAt)
      VALUES ('ord_buyer', 'buyer@example.com', 'u_buyer', 12, 12, 'confirmed', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO PointsLog (id, userId, delta, type, reason)
      VALUES ('pl_buyer', 'u_buyer', 40, 'admin_adjust', 'seed')
    `).run();
    db.prepare(`
      INSERT INTO CreditAccount (id, userId, baseLimit, usedAmount, status, updatedAt)
      VALUES ('ca_buyer', 'u_buyer', 1000, 12, 'active', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO AccountReceivable (id, orderId, userId, amount, status, confirmedAt, updatedAt)
      VALUES ('ar_buyer', 'ord_buyer', 'u_buyer', 12, 'open', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO PointsRedemption (id, userId, productId, productName, pointsCost, status, createdAt, updatedAt)
      VALUES ('rd_buyer', 'u_buyer', 'gift_1', '礼遇', 10, 'pending', datetime('now'), datetime('now'))
    `).run();

    const res = await DELETE(makeDelete({ userIds: ['u_buyer', 'u_buyer'] }) as unknown as Request);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deactivated: 1 });
    expect(requireAdmin).toHaveBeenCalledWith('customers.write');

    expect(userRow('u_buyer')).toMatchObject({ role: 'customer', isFrozen: 1, points: 40 });
    expect(db.prepare('SELECT customerId FROM "Order" WHERE id = ?').get('ord_buyer')).toEqual({ customerId: 'u_buyer' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog WHERE userId = ?').get('u_buyer')).toEqual({ count: 1 });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('u_buyer')).toEqual({ usedAmount: 12 });
    expect(db.prepare('SELECT status FROM AccountReceivable WHERE userId = ?').get('u_buyer')).toEqual({ status: 'open' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsRedemption WHERE userId = ?').get('u_buyer')).toEqual({ count: 1 });

    const audit = db.prepare(`
      SELECT actorId, actorEmail, action, resource, targetType, targetId, beforeData, afterData, reason, metadata
      FROM AuditLog WHERE action = 'customer.deactivated'
    `).get() as {
      actorId: string;
      actorEmail: string;
      action: string;
      resource: string;
      targetType: string;
      targetId: string;
      beforeData: string;
      afterData: string;
      reason: string;
      metadata: string;
    };
    expect(audit).toMatchObject({
      actorId: 'admin_test_id',
      actorEmail: 'admin@test.com',
      action: 'customer.deactivated',
      resource: 'customers',
      targetType: 'User',
      targetId: 'u_buyer',
      reason: '后台停用用户，保留积分流水、授信和订单',
    });
    expect(JSON.parse(audit.beforeData)).toMatchObject({ email: 'buyer@example.com', isFrozen: false, points: 40 });
    expect(JSON.parse(audit.afterData)).toMatchObject({ isFrozen: true, points: 40, hardDeleted: false });
    expect(JSON.parse(audit.metadata)).toEqual({ hardDelete: false });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'customer.deactivated'`).get()).toEqual({ count: 1 });
  });

  it('refuses a batch that includes an admin and leaves every account unchanged', async () => {
    seedUser(getTestDb(), { id: 'u_keep', email: 'keep@example.com', points: 8 });
    const res = await DELETE(makeDelete({ userIds: ['u_keep', 'admin_test_id'] }) as unknown as Request);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ADMIN_USER_DELETE_ERRORS.admin });
    expect(userRow('u_keep')).toMatchObject({ isFrozen: 0, points: 8 });
    expect(userRow('admin_test_id')).toMatchObject({ role: 'admin', isFrozen: 0 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM AdminUserRole WHERE userId = ?').get('admin_test_id')).toEqual({ count: 1 });
    expect(getTestDb().prepare(`SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'customer.deactivated'`).get()).toEqual({ count: 0 });
  });

  it('refuses the signed-in account even when that row is not an admin', async () => {
    seedUser(getTestDb(), { id: 'u_self', email: 'self@example.com' });
    requireAdmin.mockResolvedValue({ id: 'u_self', email: 'self@example.com', role: 'admin' });

    const res = await DELETE(makeDelete({ userIds: ['u_self'] }) as unknown as Request);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ADMIN_USER_DELETE_ERRORS.self });
    expect(userRow('u_self')).toMatchObject({ isFrozen: 0 });
  });

  it('refuses an organization owner without freezing the rest of the batch', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'u_owner', email: 'owner@example.com' });
    seedUser(db, { id: 'u_other', email: 'other@example.com' });
    db.prepare(`
      INSERT INTO organizations (id, name, status, owner_user_id, created_at, updated_at)
      VALUES ('org_1', '实验室', 'active', 'u_owner', datetime('now'), datetime('now'))
    `).run();

    const res = await DELETE(makeDelete({ userIds: ['u_owner', 'u_other'] }) as unknown as Request);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ADMIN_USER_DELETE_ERRORS.owner });
    expect(userRow('u_owner')?.isFrozen).toBe(0);
    expect(userRow('u_other')?.isFrozen).toBe(0);
    expect(db.prepare('SELECT id FROM organizations WHERE owner_user_id = ?').get('u_owner')).toEqual({ id: 'org_1' });
  });

  it('returns 404 and writes nothing when any id is missing', async () => {
    seedUser(getTestDb(), { id: 'u_real', email: 'real@example.com' });
    const res = await DELETE(makeDelete({ userIds: ['u_real', 'missing'] }) as unknown as Request);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: ADMIN_USER_DELETE_ERRORS.missing });
    expect(userRow('u_real')?.isFrozen).toBe(0);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 0 });
  });

  it('rejects an oversized id list before changing users', async () => {
    seedUser(getTestDb(), { id: 'u_real', email: 'real@example.com' });
    const userIds = Array.from({ length: ADMIN_USER_DELETE_BATCH_LIMIT + 1 }, (_, index) => `u_${index}`);
    const res = await DELETE(makeDelete({ userIds }) as unknown as Request);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ADMIN_USER_DELETE_ERRORS.tooMany });
    expect(userRow('u_real')?.isFrozen).toBe(0);
  });

  it('does not deactivate when the caller lacks customers.write', async () => {
    seedUser(getTestDb(), { id: 'u_real', email: 'real@example.com' });
    requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await DELETE(makeDelete({ userIds: ['u_real'] }) as unknown as Request);
    expect(res.status).toBe(403);
    expect(userRow('u_real')?.isFrozen).toBe(0);
  });
});
