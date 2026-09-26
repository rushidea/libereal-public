import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));

import { auth } from '@/lib/auth';
import { PUT as updateProduct } from '@/app/api/admin/products/route';
import { GET as getProduct } from '@/app/api/admin/products/[id]/route';
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
});
