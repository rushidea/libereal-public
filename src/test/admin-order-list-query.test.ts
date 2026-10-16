import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adminOrderStatusCounts,
  buildAdminActiveOrderWhere,
  parseAdminOrderListQuery,
  shanghaiDayEnd,
  shanghaiDayStart,
  toAdminOrderListSearchParams,
} from '@/data/admin-order-list-query';
import { getTestDb } from './db-helpers';

describe('admin order list query', () => {
  it('parses paging, search, status, dates, and the receivable view', () => {
    const parsed = parseAdminOrderListQuery(new URLSearchParams({
      page: '2',
      pageSize: '20',
      q: ' 清华 ',
      status: 'shipped',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      receivable: 'open',
    }));
    expect(parsed).toEqual({
      ok: true,
      query: {
        page: 2,
        pageSize: 20,
        search: '清华',
        status: 'shipped',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        receivableOpen: true,
      },
    });
  });

  it('rejects invalid paging, status, and dates', () => {
    expect(parseAdminOrderListQuery(new URLSearchParams({ status: 'archived' })).ok).toBe(false);
    expect(parseAdminOrderListQuery(new URLSearchParams({ page: '0' })).ok).toBe(false);
    expect(parseAdminOrderListQuery(new URLSearchParams({ pageSize: '51' })).ok).toBe(false);
    expect(parseAdminOrderListQuery(new URLSearchParams({ dateTo: '2026-3-1' })).ok).toBe(false);
  });

  it('builds an unarchived page query and keeps unpaid Alipay orders on the unpaid filter', () => {
    const parsed = parseAdminOrderListQuery(new URLSearchParams({ status: 'unpaid', q: 'ORD-1' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const where = buildAdminActiveOrderWhere(parsed.query) as { AND: Array<Record<string, unknown>> };
    expect(where.AND[0]).toEqual({ archivedAt: null });
    expect(where.AND[1]).toEqual({
      OR: [
        { status: 'unpaid' },
        expect.objectContaining({ status: 'pending', paidAt: null, paymentMethod: expect.objectContaining({ in: expect.arrayContaining(['alipay', '支付宝']) }) }),
      ],
    });
    expect(where.AND.some((clause) => JSON.stringify(clause).includes('ORD-1'))).toBe(true);
    const params = toAdminOrderListSearchParams(parsed.query);
    expect(params.get('status')).toBe('unpaid');
    expect(params.get('q')).toBe('ORD-1');
    expect(params.get('page')).toBe('1');
  });

  it('uses inclusive Shanghai day bounds', () => {
    expect(shanghaiDayStart('2024-01-15')?.toISOString()).toBe('2024-01-14T16:00:00.000Z');
    expect(shanghaiDayEnd('2024-01-15')?.toISOString()).toBe('2024-01-15T15:59:59.999Z');
    expect(shanghaiDayStart('15-01-2024')).toBeNull();
  });

  it('moves pending unpaid Alipay orders into the unpaid count', () => {
    expect(adminOrderStatusCounts([
      { status: 'pending', count: 4 },
      { status: 'unpaid', count: 1 },
      { status: 'shipped', count: 2 },
      { status: 'mystery', count: 9 },
    ], 3)).toMatchObject({
      unpaid: 4,
      pending: 1,
      shipped: 2,
      completed: 0,
    });
  });

  it('declares the active-order list indexes in schema, migration, and the test database', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = readFileSync('prisma/migrations/20261015100000_add_admin_order_list_indexes/migration.sql', 'utf8');
    expect(schema).toContain('@@index([archivedAt, createdAt])');
    expect(schema).toContain('@@index([archivedAt, status, createdAt])');
    expect(migration).toContain('CREATE INDEX "Order_archivedAt_createdAt_idx"');
    expect(migration).toContain('CREATE INDEX "Order_archivedAt_status_createdAt_idx"');

    const db = getTestDb();
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Order'`).all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual(expect.arrayContaining([
      'Order_archivedAt_createdAt_idx',
      'Order_archivedAt_status_createdAt_idx',
    ]));
  });
});
