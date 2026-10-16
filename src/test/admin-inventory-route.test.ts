import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin }));

import { GET, PATCH, POST } from '@/app/api/admin/inventory/route';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

function seedProduct(id: string, catalogNumber: string, name: string, brand: string) {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 100, 8, datetime('now'), datetime('now'))
  `).run(id, catalogNumber, name, brand);
}

describe('admin inventory route', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    mocks.requireAdmin.mockResolvedValue({ id: 'admin_test_id' });
  });

  it('rejects readers before querying inventory', async () => {
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const response = await GET(new NextRequest('http://localhost/api/admin/inventory'));
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('inventory.read');
  });

  it('returns batch counts in the list and keeps batch rows for the account request', async () => {
    seedProduct('p1', 'CAT-1', 'AKT1 Antibody', 'CST');
    seedProduct('p2', 'CAT-2', '缓冲液', 'Biosharp');
    await prisma.inventoryAccount.create({
      data: {
        id: 'acc-1',
        productId: 'p1',
        actualQuantity: 8,
        availableQuantity: 8,
        batches: {
          create: [
            { id: 'b1', batchNumber: 'LOT-SECRET', quantity: 5, expiryDate: new Date('2027-06-01T00:00:00.000Z') },
            { id: 'b2', batchNumber: 'LOT-LATER', quantity: 3, expiryDate: new Date('2028-01-01T00:00:00.000Z') },
          ],
        },
        transactions: {
          create: {
            id: 't1', type: 'receipt', quantity: 5, reason: '内部入库备注',
            actualBefore: 0, actualAfter: 5, availableBefore: 0, availableAfter: 5,
            reservedBefore: 0, reservedAfter: 0, inboundBefore: 0, inboundAfter: 0,
            shippedBefore: 0, shippedAfter: 0,
          },
        },
      },
    });
    await prisma.inventoryAccount.create({
      data: { id: 'acc-2', productId: 'p2', actualQuantity: 2, availableQuantity: 2 },
    });

    const list = await GET(new NextRequest('http://localhost/api/admin/inventory?search=AKT'));
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.accounts).toHaveLength(1);
    expect(listBody.accounts[0]).toMatchObject({ id: 'acc-1', batchCount: 2, product: { name: 'AKT1 Antibody' } });
    expect(listBody.accounts[0].batches).toBeUndefined();
    expect(listBody.accounts[0].transactions).toBeUndefined();
    expect(JSON.stringify(listBody)).not.toContain('LOT-SECRET');
    expect(JSON.stringify(listBody)).not.toContain('内部入库备注');

    const missing = await GET(new NextRequest('http://localhost/api/admin/inventory?accountId=missing'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: '库存账户不存在' });

    const detail = await GET(new NextRequest('http://localhost/api/admin/inventory?accountId=acc-1'));
    const detailBody = await detail.json();
    expect(detail.status).toBe(200);
    expect(detailBody.account.batches.map((batch: { batchNumber: string }) => batch.batchNumber)).toEqual(['LOT-SECRET', 'LOT-LATER']);
    expect(detailBody.account.transactions).toMatchObject([{ reason: '内部入库备注', quantity: 5 }]);
  });

  it('keeps adjustment and receipt behavior, including the reserved-stock rejection', async () => {
    seedProduct('p1', 'CAT-1', 'AKT1 Antibody', 'CST');
    await prisma.inventoryAccount.create({
      data: { id: 'acc-1', productId: 'p1', actualQuantity: 10, availableQuantity: 5, reservedQuantity: 5 },
    });

    const rejected = await PATCH(new NextRequest('http://localhost/api/admin/inventory', {
      method: 'PATCH',
      body: JSON.stringify({ productId: 'p1', actualQuantity: 1, reason: '盘点' }),
    }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: 'INVENTORY_BELOW_RESERVED' });
    expect(mocks.requireAdmin).toHaveBeenCalledWith('inventory.write');
    expect(await prisma.inventoryAccount.findUnique({ where: { id: 'acc-1' } })).toMatchObject({ actualQuantity: 10 });

    const received = await POST(new NextRequest('http://localhost/api/admin/inventory', {
      method: 'POST',
      body: JSON.stringify({ productId: 'p1', batchNumber: 'LOT-NEW', quantity: 4, expiryDate: '2028-01-01' }),
    }));
    expect(received.status).toBe(201);
    const detail = await GET(new NextRequest('http://localhost/api/admin/inventory?accountId=acc-1'));
    const body = await detail.json();
    expect(body.account.batches).toMatchObject([{ batchNumber: 'LOT-NEW', quantity: 4 }]);
    expect(body.account.actualQuantity).toBe(14);
  });
});
