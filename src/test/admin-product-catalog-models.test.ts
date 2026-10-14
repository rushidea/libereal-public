import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));

import { auth } from '@/lib/auth';
import { parseExplicitStockQuantity, stockQuantityFromInput } from '@/lib/admin-product-stock';
import { PUT as updateProduct } from '@/app/api/admin/products/route';
import { DELETE as deleteProduct, GET as getProduct } from '@/app/api/admin/products/[id]/route';
import { ProductSearchService } from '@/lib/product-search';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const authMock = auth as unknown as Mock;

function seedProduct() {
  getTestDb().prepare(`
    INSERT INTO Product (
      id, catalogNumber, name, brand, price, originalPrice, category, subcategory,
      target, host, applications, reactivity, inStock, promotion, hazardous,
      pmids, stockQuantity, createdAt, updatedAt
    ) VALUES (
      'product_1', 'CAT-1', '原产品', '原品牌', 100, 120, '一抗', 'WB抗体',
      'AKT1', 'Rabbit', '["WB"]', '["Human"]', 1, 0, 0,
      '[]', -1, datetime('now'), datetime('now')
    )
  `).run();
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'product_1', ...body }),
  });
}

function deleteRequest(id = 'product_1') {
  return new NextRequest(`http://localhost/api/admin/products/${id}`, { method: 'DELETE' });
}

function productRow() {
  return getTestDb().prepare(`
    SELECT stockQuantity, inStock, pmids, cofaUrl, storageTemp, type, lotNumber, deletedAt
    FROM Product WHERE id = 'product_1'
  `).get() as {
    stockQuantity: number;
    inStock: number;
    pmids: string;
    cofaUrl: string | null;
    storageTemp: string | null;
    type: string | null;
    lotNumber: string | null;
    deletedAt: string | null;
  };
}

function seedStoredDetails() {
  getTestDb().prepare(`
    UPDATE Product
    SET pmids = ?, stockQuantity = 8, inStock = 1, cofaUrl = ?, storageTemp = ?, type = ?, lotNumber = ?
    WHERE id = 'product_1'
  `).run('["12345678"]', 'https://example.test/existing-coa.pdf', '-20°C', '单克隆抗体', 'LOT-9');
}

function updateRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'product_1',
      catalogNumber: 'CAT-1',
      name: 'AKT1 Antibody',
      brand: 'CST',
      category: '一抗',
      subcategory: 'WB抗体',
      target: 'AKT1',
      host: 'Rabbit',
      cloneNumber: 'D9E',
      purity: 'Affinity purified',
      concentration: '1 mg/mL',
      applications: ['WB', 'IHC'],
      reactivity: ['Human', 'Mouse'],
      price: 150,
      originalPrice: 180,
      promotionalPrice: 140,
      costPrice: 90,
      promotion: true,
      hazardous: false,
      inStock: true,
      cofaUrl: 'https://example.test/coa.pdf',
      sdsUrl: 'https://example.test/sds.pdf',
      ...body,
    }),
  });
}

describe('admin product catalog models', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedProduct();
    authMock.mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } });
  });

  it('records taxonomy, generated attributes, documents and changed prices', async () => {
    const response = await updateProduct(updateRequest({}));
    expect(response.status).toBe(200);

    const db = getTestDb();
    const product = db.prepare(`
      SELECT brandRecordId, categoryRecordId, subcategoryRecordId FROM Product WHERE id = 'product_1'
    `).get() as { brandRecordId: string; categoryRecordId: string; subcategoryRecordId: string };
    expect(product.brandRecordId).toMatch(/^brand:/);
    expect(product.categoryRecordId).toMatch(/^category:/);
    expect(product.subcategoryRecordId).toMatch(/^subcategory:/);

    const attributes = db.prepare(`SELECT key, value FROM ProductAttribute WHERE productId = ? ORDER BY sortOrder`)
      .all('product_1') as Array<{ key: string; value: string }>;
    expect(attributes).toEqual(expect.arrayContaining([
      { key: 'target', value: 'AKT1' },
      { key: 'application', value: 'IHC' },
      { key: 'reactivity', value: 'Mouse' },
    ]));

    const documents = db.prepare(`SELECT type, url FROM ProductDocument WHERE productId = ? ORDER BY sortOrder`)
      .all('product_1') as Array<{ type: string; url: string }>;
    expect(documents.map((document) => document.type)).toEqual(['coa', 'sds']);

    const prices = db.prepare(`SELECT kind, amount, createdBy FROM ProductPrice WHERE productId = ? ORDER BY kind`)
      .all('product_1') as Array<{ kind: string; amount: number; createdBy: string }>;
    expect(prices).toHaveLength(4);
    expect(prices).toContainEqual({ kind: 'list', amount: 150, createdBy: 'admin_test_id' });
  });

  it('creates and updates product variants', async () => {
    const created = await updateProduct(updateRequest({
      variants: [
        { catalogNumber: 'CAT-1-50', spec: '50 µL', price: 120 },
        { catalogNumber: 'CAT-1-100', spec: '100 µL', price: 200, originalPrice: 220 },
      ],
    }));
    expect(created.status).toBe(200);
    const first = getTestDb().prepare('SELECT id FROM ProductVariant WHERE catalogNumber = ?').get('CAT-1-50') as { id: string };

    const updated = await updateProduct(updateRequest({
      variants: [{ id: first.id, catalogNumber: 'CAT-1-50', spec: '50 µL', price: 125 }],
    }));
    expect(updated.status).toBe(200);
    expect(getTestDb().prepare('SELECT catalogNumber, price FROM ProductVariant WHERE productId = ?').all('product_1')).toEqual([
      { catalogNumber: 'CAT-1-50', price: 125 },
    ]);
  });

  it('returns the aggregated product detail to administrators', async () => {
    await updateProduct(updateRequest({}));
    const response = await getProduct(new NextRequest('http://localhost/api/admin/products/product_1'), {
      params: Promise.resolve({ id: 'product_1' }),
    });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.product.brandRecord.name).toBe('CST');
    expect(json.product.attributes.length).toBeGreaterThan(0);
    expect(json.product.documents).toHaveLength(2);
    expect(json.product.prices).toHaveLength(4);
  });

  it('parses an explicit zero stock quantity and ignores unfinished input', () => {
    expect(parseExplicitStockQuantity(0)).toBe(0);
    expect(parseExplicitStockQuantity('0')).toBe(0);
    expect(parseExplicitStockQuantity(-1)).toBe(-1);
    expect(parseExplicitStockQuantity(1.5)).toBeNull();
    expect(parseExplicitStockQuantity(null)).toBeNull();
    expect(stockQuantityFromInput('0')).toBe(0);
    expect(stockQuantityFromInput('')).toBeUndefined();
    expect(stockQuantityFromInput('-2')).toBeUndefined();
  });

  it('saves stock quantity 0 and does not reset omitted stock to unlimited', async () => {
    seedStoredDetails();
    const zeroed = await updateProduct(patchRequest({ stockQuantity: 0 }));
    expect(zeroed.status).toBe(200);
    expect(productRow()).toMatchObject({ stockQuantity: 0, inStock: 0, pmids: '["12345678"]' });

    const renamed = await updateProduct(patchRequest({ name: '只改名称' }));
    expect(renamed.status).toBe(200);
    expect(productRow()).toMatchObject({
      stockQuantity: 0,
      inStock: 0,
      pmids: '["12345678"]',
      cofaUrl: 'https://example.test/existing-coa.pdf',
      storageTemp: '-20°C',
      type: '单克隆抗体',
      lotNumber: 'LOT-9',
    });
    expect((getTestDb().prepare('SELECT name FROM Product WHERE id = ?').get('product_1') as { name: string }).name).toBe('只改名称');
  });

  it('rejects non-integer stock and only stores unlimited when -1 is explicit', async () => {
    seedStoredDetails();
    const invalid = await updateProduct(patchRequest({ stockQuantity: 1.5 }));
    expect(invalid.status).toBe(400);
    expect(productRow().stockQuantity).toBe(8);

    const missing = await updateProduct(patchRequest({ stockQuantity: null }));
    expect(missing.status).toBe(400);
    expect(productRow().stockQuantity).toBe(8);

    const unlimited = await updateProduct(patchRequest({ stockQuantity: -1 }));
    expect(unlimited.status).toBe(200);
    expect(productRow()).toMatchObject({ stockQuantity: -1, inStock: 1 });
  });

  it('persists 缺货 without clearing a counted or unlimited quantity', async () => {
    seedStoredDetails();
    const counted = await updateProduct(patchRequest({ stockQuantity: 6, inStock: false }));
    expect(counted.status).toBe(200);
    expect(productRow()).toMatchObject({ stockQuantity: 6, inStock: 0 });

    const unlimited = await updateProduct(patchRequest({ stockQuantity: -1, inStock: false }));
    expect(unlimited.status).toBe(200);
    expect(productRow()).toMatchObject({ stockQuantity: -1, inStock: 0 });

    const conflict = await updateProduct(patchRequest({ stockQuantity: 0, inStock: true }));
    expect(conflict.status).toBe(400);
    expect(productRow()).toMatchObject({ stockQuantity: -1, inStock: 0 });
  });

  it('does not clear detail fields that were not sent', async () => {
    seedStoredDetails();
    const fullSave = await updateProduct(updateRequest({}));
    expect(fullSave.status).toBe(200);
    expect(productRow()).toMatchObject({
      stockQuantity: 8,
      pmids: '["12345678"]',
      storageTemp: '-20°C',
      type: '单克隆抗体',
      lotNumber: 'LOT-9',
      cofaUrl: 'https://example.test/coa.pdf',
    });
    const before = getTestDb().prepare('SELECT COUNT(*) AS count FROM ProductAttribute WHERE productId = ?').get('product_1') as { count: number };
    expect(before.count).toBeGreaterThan(0);

    const response = await updateProduct(patchRequest({ name: '保留详情' }));
    expect(response.status).toBe(200);
    const row = productRow();
    expect(row.pmids).toBe('["12345678"]');
    expect(row.cofaUrl).toBe('https://example.test/coa.pdf');
    expect(row.lotNumber).toBe('LOT-9');
    expect(row.stockQuantity).toBe(8);
    const after = getTestDb().prepare('SELECT COUNT(*) AS count FROM ProductAttribute WHERE productId = ?').get('product_1') as { count: number };
    expect(after.count).toBe(before.count);
    const documents = getTestDb().prepare('SELECT COUNT(*) AS count FROM ProductDocument WHERE productId = ?').get('product_1') as { count: number };
    expect(documents.count).toBe(2);
  });

  it('soft-deletes a product for administrators and keeps the row', async () => {
    const response = await deleteProduct(deleteRequest(), { params: Promise.resolve({ id: 'product_1' }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(productRow().deletedAt).toBeTruthy();
    expect((await ProductSearchService.search({ keyword: 'CAT-1' }, { scope: 'admin' })).pagination.total).toBe(0);
    expect((await ProductSearchService.search({ keyword: 'CAT-1' })).pagination.total).toBe(0);

    const audit = getTestDb().prepare(`SELECT action, resource, targetId, reason FROM AuditLog WHERE action = 'product.deleted'`).get() as {
      action: string;
      resource: string;
      targetId: string;
      reason: string;
    };
    expect(audit).toMatchObject({
      action: 'product.deleted',
      resource: 'products',
      targetId: 'product_1',
      reason: '后台删除产品',
    });

    const again = await deleteProduct(deleteRequest(), { params: Promise.resolve({ id: 'product_1' }) });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ success: true, alreadyDeleted: true });
    expect(getTestDb().prepare(`SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'product.deleted'`).get()).toEqual({ count: 1 });

    const detail = await getProduct(new NextRequest('http://localhost/api/admin/products/product_1'), {
      params: Promise.resolve({ id: 'product_1' }),
    });
    expect(detail.status).toBe(404);
    const saved = await updateProduct(patchRequest({ name: '不应写回' }));
    expect(saved.status).toBe(409);
    expect((getTestDb().prepare('SELECT name FROM Product WHERE id = ?').get('product_1') as { name: string }).name).toBe('原产品');
  });

  it('requires products.write before deleting a product', async () => {
    authMock.mockResolvedValue({ user: { id: 'customer_1', email: 'customer@test.com', role: 'customer', sessionId: 'session-1' } });
    const customer = await deleteProduct(deleteRequest(), { params: Promise.resolve({ id: 'product_1' }) });
    expect(customer.status).toBe(403);

    authMock.mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } });
    getTestDb().prepare('DELETE FROM AdminUserRole').run();
    const missingPermission = await deleteProduct(deleteRequest(), { params: Promise.resolve({ id: 'product_1' }) });
    expect(missingPermission.status).toBe(403);
    expect(productRow().deletedAt).toBeNull();
  });
});
