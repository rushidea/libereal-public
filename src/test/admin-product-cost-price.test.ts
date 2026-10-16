import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { canReadProductCostPrice } from '@/lib/admin-permissions';
import { redactProductCostPrice } from '@/lib/product-cost-price';
import { GET as listProducts, PUT as updateProduct } from '@/app/api/admin/products/route';
import { GET as getProduct } from '@/app/api/admin/products/[id]/route';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));

const authMock = auth as unknown as Mock;

function seedScopedAdmin(permissions: string[]) {
  const db = getTestDb();
  seedUser(db, { id: 'scoped_admin', email: 'scoped@example.com', role: 'admin' });
  db.prepare(`INSERT INTO AdminRole (id, key, name, description, updatedAt) VALUES ('role_scoped', 'scoped', '受限角色', '', datetime('now'))`).run();
  const insertPermission = db.prepare('INSERT OR IGNORE INTO AdminPermission (id, key, resource, action, name) VALUES (?, ?, ?, ?, ?)');
  const insertRolePermission = db.prepare('INSERT OR IGNORE INTO AdminRolePermission (roleId, permissionId) VALUES (?, ?)');
  for (const key of permissions) {
    const permissionId = `perm_${key.replace('.', '_')}`;
    const [resource, action] = key.split('.');
    insertPermission.run(permissionId, key, resource, action, key);
    insertRolePermission.run('role_scoped', permissionId);
  }
  db.prepare('INSERT INTO AdminUserRole (userId, roleId) VALUES (?, ?)').run('scoped_admin', 'role_scoped');
}

function seedPricedProduct() {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Product (
      id, catalogNumber, name, brand, price, originalPrice, costPrice, minimumSalePrice,
      applications, reactivity, inStock, promotion, hazardous, pmids, stockQuantity, createdAt, updatedAt
    ) VALUES (
      'cost_product', 'CAT-COST', '进货价样品', 'CST', 100, 120, 321.75, 88,
      '["WB"]', '["Human"]', 1, 0, 0, '[]', -1, datetime('now'), datetime('now')
    )
  `).run();
  db.prepare(`
    INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, costPrice, minimumSalePrice)
    VALUES ('variant_cost', 'cost_product', 'CAT-COST-50', '50 µL', 100, 77.25, 90)
  `).run();
  db.prepare(`
    INSERT INTO ProductPrice (id, productId, kind, amount, source, createdAt)
    VALUES ('price_cost', 'cost_product', 'cost', 321.75, '供货协议 内部结算', datetime('now')),
           ('price_list', 'cost_product', 'list', 100, 'admin', datetime('now'))
  `).run();
}

function signIn() {
  authMock.mockResolvedValue({
    user: { id: 'scoped_admin', email: 'scoped@example.com', role: 'admin', sessionId: 'session-1' },
  });
}

async function listBody() {
  const response = await listProducts(new NextRequest('http://localhost/api/admin/products?search=CAT-COST'));
  return { status: response.status, body: await response.json() };
}

async function detailBody() {
  const response = await getProduct(new NextRequest('http://localhost/api/admin/products/cost_product'), {
    params: Promise.resolve({ id: 'cost_product' }),
  });
  return { status: response.status, body: await response.json() };
}

describe('product cost price permission', () => {
  it('allows pricing or finance permissions and refuses product-only access', () => {
    expect(canReadProductCostPrice(['products.read', 'products.write'])).toBe(false);
    expect(canReadProductCostPrice(['products.read', 'pricing.read'])).toBe(true);
    expect(canReadProductCostPrice(['finance.read'])).toBe(true);
    expect(canReadProductCostPrice(['pricing.write'])).toBe(true);
    expect(canReadProductCostPrice(['finance.write'])).toBe(true);
  });

  it('removes purchase cost from the product, its packages and its price history', () => {
    const redacted = redactProductCostPrice({
      id: 'cost_product',
      price: 100,
      costPrice: 321.75,
      minimumSalePrice: 88,
      variants: [{ id: 'variant_cost', price: 100, costPrice: 77.25, minimumSalePrice: 90 }],
      prices: [
        { kind: 'cost', amount: 321.75, source: '供货协议 内部结算' },
        { kind: 'list', amount: 100 },
      ],
    });
    expect(redacted).not.toHaveProperty('costPrice');
    expect(redacted.variants?.[0]).not.toHaveProperty('costPrice');
    expect(redacted.variants?.[0]).toMatchObject({ minimumSalePrice: 90 });
    expect(redacted.prices).toEqual([{ kind: 'list', amount: 100 }]);
    expect(JSON.stringify(redacted)).not.toContain('321.75');
    expect(JSON.stringify(redacted)).not.toContain('供货协议');
  });
});

describe('admin product cost price visibility', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedPricedProduct();
    signIn();
  });

  it('omits purchase cost for a role that can only read products', async () => {
    seedScopedAdmin(['admin.access', 'products.read']);

    const list = await listBody();
    expect(list.status).toBe(200);
    expect(list.body.products[0]).toMatchObject({ catalogNumber: 'CAT-COST', price: 100, minimumSalePrice: 88 });
    expect(list.body.products[0]).not.toHaveProperty('costPrice');

    const detail = await detailBody();
    expect(detail.status).toBe(200);
    expect(detail.body.product).toMatchObject({ minimumSalePrice: 88, price: 100 });
    expect(detail.body.product).not.toHaveProperty('costPrice');
    expect(detail.body.product.variants[0]).toMatchObject({ catalogNumber: 'CAT-COST-50', minimumSalePrice: 90 });
    expect(detail.body.product.variants[0]).not.toHaveProperty('costPrice');
    expect(detail.body.product.prices.map((price: { kind: string }) => price.kind)).toEqual(['list']);

    const serialized = JSON.stringify({ list: list.body, detail: detail.body });
    expect(serialized).not.toContain('costPrice');
    expect(serialized).not.toContain('321.75');
    expect(serialized).not.toContain('77.25');
    expect(serialized).not.toContain('供货协议');
  });

  it.each([
    ['pricing.read'],
    ['finance.read'],
  ])('returns purchase cost when the role has %s', async (permission) => {
    seedScopedAdmin(['admin.access', 'products.read', permission]);

    const list = await listBody();
    expect(list.status).toBe(200);
    expect(list.body.products[0].costPrice).toBe(321.75);

    const detail = await detailBody();
    expect(detail.status).toBe(200);
    expect(detail.body.product.costPrice).toBe(321.75);
    expect(detail.body.product.variants[0].costPrice).toBe(77.25);
    expect(detail.body.product.prices.map((price: { kind: string }) => price.kind).sort()).toEqual(['cost', 'list']);
    expect(JSON.stringify(detail.body)).toContain('供货协议 内部结算');
  });

  it('keeps the stored purchase cost when a product editor saves packages without that permission', async () => {
    seedScopedAdmin(['admin.access', 'products.read', 'products.write']);
    const response = await updateProduct(new NextRequest('http://localhost/api/admin/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'cost_product',
        name: '只改名称',
        variants: [{ id: 'variant_cost', catalogNumber: 'CAT-COST-50', spec: '50 µL', price: 110 }],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.product).not.toHaveProperty('costPrice');
    expect(body.product.variants[0]).not.toHaveProperty('costPrice');
    expect(JSON.stringify(body)).not.toContain('321.75');
    expect(JSON.stringify(body)).not.toContain('77.25');

    const db = getTestDb();
    expect(db.prepare('SELECT name, costPrice FROM Product WHERE id = ?').get('cost_product')).toEqual({
      name: '只改名称',
      costPrice: 321.75,
    });
    expect(db.prepare('SELECT price, costPrice FROM ProductVariant WHERE id = ?').get('variant_cost')).toEqual({
      price: 110,
      costPrice: 77.25,
    });
  });

  it('rejects a direct purchase-cost write from a role without pricing permission', async () => {
    seedScopedAdmin(['admin.access', 'products.read', 'products.write']);
    const response = await updateProduct(new NextRequest('http://localhost/api/admin/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'cost_product', costPrice: 1 }),
    }));
    expect(response.status).toBe(403);
    expect(getTestDb().prepare('SELECT costPrice FROM Product WHERE id = ?').get('cost_product')).toEqual({ costPrice: 321.75 });
  });

  it('returns the updated purchase cost to a role that can write prices', async () => {
    seedScopedAdmin(['admin.access', 'products.read', 'products.write', 'pricing.read', 'pricing.write']);
    const response = await updateProduct(new NextRequest('http://localhost/api/admin/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'cost_product',
        costPrice: 300,
        variants: [{ id: 'variant_cost', catalogNumber: 'CAT-COST-50', spec: '50 µL', price: 110, costPrice: 70 }],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.product.costPrice).toBe(300);
    expect(body.product.variants[0].costPrice).toBe(70);
  });
});
