import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));
vi.mock('@/lib/background-tasks', () => ({ enqueueBackgroundTask: vi.fn() }));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));
vi.mock('@/lib/security/mfa-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/mfa-config')>();
  return {
    ...actual,
    isMfaAdminRequired: vi.fn(() => false),
    isMfaPhase1Enabled: vi.fn(() => false),
  };
});
vi.mock('@/lib/pricing-adjustment-template', () => ({
  readPricingAdjustmentTemplate: vi.fn(() => ({
    fileName: '商品集中调价导入模板.xlsx',
    buffer: Buffer.from('xlsx-bytes'),
  })),
}));

import { auth } from '@/lib/auth';
import { requiresAdminMfaForPermission } from '@/lib/admin-mfa-settings';
import { isMfaAdminRequired, isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { readPricingAdjustmentTemplate } from '@/lib/pricing-adjustment-template';
import { POST as previewPricing } from '@/app/api/admin/pricing-adjustments/preview/route';
import { POST as applyPricing } from '@/app/api/admin/pricing-adjustments/apply/route';
import { POST as matchPricing } from '@/app/api/admin/pricing-adjustments/match/route';
import { POST as createMissingPricing } from '@/app/api/admin/pricing-adjustments/create-missing/route';
import { POST as classifyPreviewPricing } from '@/app/api/admin/pricing-adjustments/classify-preview/route';
import { GET as downloadPricingTemplate } from '@/app/api/admin/pricing-adjustments/template/route';
import { MAX_CLASSIFY_PREVIEW } from '@/lib/product-smart-classify-catalog';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const authMock = auth as unknown as Mock;
const mfaRequiredMock = requiresAdminMfaForPermission as unknown as Mock;
const adminMfaRequiredMock = isMfaAdminRequired as unknown as Mock;
const phase1EnabledMock = isMfaPhase1Enabled as unknown as Mock;
const readTemplateMock = readPricingAdjustmentTemplate as unknown as Mock;

function seedProduct(overrides: {
  id: string;
  catalogNumber: string;
  price: number;
  pricingMode?: string;
  costPrice?: number;
  minimumSalePrice?: number | null;
  promotionalPrice?: number | null;
  brand?: string;
}) {
  getTestDb().prepare(`
    INSERT INTO Product (
      id, catalogNumber, name, brand, price, pricingMode, originalPrice, category, subcategory,
      applications, reactivity, inStock, promotion, hazardous, costPrice, minimumSalePrice,
      promotionalPrice, pmids, stockQuantity, createdAt, updatedAt
    ) VALUES (
      ?, ?, '测试抗体', ?, ?, ?, 120, '抗体', '一抗',
      '[]', '[]', 1, 0, 0, ?, ?,
      ?, '[]', -1, datetime('now'), datetime('now')
    )
  `).run(
    overrides.id,
    overrides.catalogNumber,
    overrides.brand ?? 'CST',
    overrides.price,
    overrides.pricingMode ?? 'fixed',
    overrides.costPrice ?? 40,
    overrides.minimumSalePrice ?? null,
    overrides.promotionalPrice ?? null,
  );
}

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brand: 'CST',
      scope: 'category',
      category: '抗体',
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      reason: '供应商调价',
      ...body,
    }),
  });
}

describe('admin pricing adjustment routes', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedProduct({ id: 'product_1', catalogNumber: 'CAT-1', price: 100, costPrice: 40, minimumSalePrice: 90 });
    seedProduct({ id: 'product_2', catalogNumber: 'CAT-2', price: 50, pricingMode: 'inquiry', costPrice: 20 });
    authMock.mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } });
    mfaRequiredMock.mockResolvedValue(false);
    adminMfaRequiredMock.mockReturnValue(false);
    phase1EnabledMock.mockReturnValue(false);
    readTemplateMock.mockReturnValue({
      fileName: '商品集中调价导入模板.xlsx',
      buffer: Buffer.from('xlsx-bytes'),
    });
  });

  it('previews public price changes and skips inquiry items', async () => {
    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.skippedInquiryCount).toBe(1);
    expect(body.preview.samples[0]).toMatchObject({ catalogNumber: 'CAT-1', currentPrice: 100, nextPrice: 110 });
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('applies public prices, keeps cost price unchanged, and floors to minimum sale price', async () => {
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'percent',
      direction: 'decrease',
      amount: 20,
    }));
    const response = await applyPricing(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'decrease',
      amount: 20,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.updatedCount).toBe(1);
    expect(body.result.flooredCount).toBe(1);

    const row = getTestDb().prepare('SELECT price, costPrice, minimumSalePrice FROM Product WHERE id = ?').get('product_1') as {
      price: number;
      costPrice: number;
      minimumSalePrice: number;
    };
    expect(row.price).toBe(90);
    expect(row.costPrice).toBe(40);
    expect(row.minimumSalePrice).toBe(90);
  });

  it('allows preview without MFA and asks for MFA before apply when pricing.write requires step-up', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);

    const preview = await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    expect(preview.status).toBe(200);

    const apply = await applyPricing(request('/api/admin/pricing-adjustments/apply', {}));
    expect(apply.status).toBe(403);
    const body = await apply.json();
    expect(body.error).toMatch(/MFA|authenticator|验证/i);
  });

  it('asks for MFA again when apply sends a used step-up token', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    const apply = await applyPricing(request('/api/admin/pricing-adjustments/apply', {
      stepUpToken: 'already-used',
    }));
    expect(apply.status).toBe(403);
    expect((await apply.json()).error).toBe('Admin MFA required');
  });

  it('ignores leftover step-up tokens when pricing.write does not require MFA', async () => {
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'percent',
      direction: 'decrease',
      amount: 10,
    }));
    const apply = await applyPricing(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'decrease',
      amount: 10,
      stepUpToken: 'leftover',
    }));
    expect(apply.status).toBe(200);
    expect((await apply.json()).result.updatedCount).toBe(1);
  });

  it('asks for MFA before apply when step-up is enabled even if admin MFA policy is off', async () => {
    phase1EnabledMock.mockReturnValue(true);
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    const apply = await applyPricing(request('/api/admin/pricing-adjustments/apply', {}));
    expect(apply.status).toBe(403);
    expect((await apply.json()).error).toBe('Admin MFA required');
  });

  it('lets catalog matching run without MFA when pricing.write requires step-up', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'CST', catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).matches[0]).toMatchObject({ catalogNumber: 'CAT-1', matched: true });
  });

  it('matches file catalogs without a brand and reviews duplicates across brands', async () => {
    seedProduct({ id: 'product_abcam', catalogNumber: 'CAT-1', price: 80, brand: 'Abcam' });
    const match = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(match.status).toBe(200);
    expect((await match.json()).matches[0]).toMatchObject({
      catalogNumber: 'CAT-1',
      matched: false,
      ambiguous: true,
    });

    const scoped = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogItems: [{ catalogNumber: 'CAT-1', brand: 'CST' }] }),
    }));
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).matches[0]).toMatchObject({ catalogNumber: 'CAT-1', matched: true });

    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        mode: 'file',
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'CAT-2', price: 66 }],
      }),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.changeCount).toBe(1);
  });

  it('lets set mode assign a public price to inquiry products', async () => {
    const preview = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'set',
      amount: 88,
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(2);
    expect(previewBody.preview.skippedInquiryCount).toBe(0);

    const apply = await applyPricing(request('/api/admin/pricing-adjustments/apply', {
      mode: 'set',
      amount: 88,
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT price, pricingMode FROM Product WHERE id = ?').get('product_2') as {
      price: number;
      pricingMode: string;
    };
    expect(row.price).toBe(88);
    expect(row.pricingMode).toBe('fixed');
  });

  it('skips inquiry product variants during preview', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_inquiry', 'product_2', 'CAT-2-V', '100ul', 50, 50)
    `).run();

    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      includeVariants: true,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.skippedInquiryCount).toBeGreaterThanOrEqual(2);
  });

  it('matches imported catalog numbers without regard to letter case', async () => {
    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      scope: 'catalog',
      catalogNumbers: ['cat-1'],
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.unmatchedCatalogs).toEqual([]);
  });

  it('does not stack percent changes when apply is retried', async () => {
    const previewBody = {
      mode: 'percent',
      direction: 'increase',
      amount: 10,
    };
    await previewPricing(request('/api/admin/pricing-adjustments/preview', previewBody));
    const first = await applyPricing(request('/api/admin/pricing-adjustments/apply', previewBody));
    expect(first.status).toBe(200);
    expect((await first.json()).result.updatedCount).toBe(1);

    const second = await applyPricing(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'increase',
      amount: 10,
    }));
    expect(second.status).toBe(200);
    expect((await second.json()).result.updatedCount).toBe(0);

    const row = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(row.price).toBe(110);
  });

  it('writes catalog, market, promo, cost and floor prices from imported rows, including specs', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, promotionalPrice, costPrice, minimumSalePrice)
      VALUES ('variant_1', 'product_1', 'CAT-1-100', '100ul', 50, 60, NULL, 20, 40)
    `).run();

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        {
          catalogNumber: 'CAT-1',
          originalPrice: 130,
          price: 70,
          promotionalPrice: 65,
          costPrice: 45,
          minimumSalePrice: 90,
        },
        {
          catalogNumber: 'CAT-1',
          spec: '100ul',
          price: 88,
          costPrice: 30,
        },
      ],
    };

    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(2);
    expect(previewBody.preview.flooredCount).toBe(1);
    expect(previewBody.preview.samples.some((sample: { fieldLabel?: string }) => sample.fieldLabel === '目录价')).toBe(true);
    expect(previewBody.preview.samples.some((sample: { fieldLabel?: string }) => sample.fieldLabel === '进货价')).toBe(true);
    expect(JSON.stringify(previewBody)).not.toContain('costPrice');

    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    expect((await apply.json()).result.updatedCount).toBe(2);

    const product = getTestDb().prepare('SELECT price, originalPrice, promotionalPrice, costPrice, minimumSalePrice, pricingMode FROM Product WHERE id = ?').get('product_1') as {
      price: number;
      originalPrice: number;
      promotionalPrice: number;
      costPrice: number;
      minimumSalePrice: number;
      pricingMode: string;
    };
    expect(product.price).toBe(90);
    expect(product.originalPrice).toBe(130);
    expect(product.promotionalPrice).toBe(90);
    expect(product.costPrice).toBe(45);
    expect(product.minimumSalePrice).toBe(90);

    const variant = getTestDb().prepare('SELECT price, costPrice, originalPrice FROM ProductVariant WHERE id = ?').get('variant_1') as {
      price: number;
      costPrice: number;
      originalPrice: number;
    };
    expect(variant.price).toBe(88);
    expect(variant.costPrice).toBe(30);
    expect(variant.originalPrice).toBe(60);
  });

  it('rejects unauthenticated template downloads', async () => {
    authMock.mockResolvedValue(null);
    const response = await downloadPricingTemplate();
    expect(response.status).toBe(401);
    expect(readTemplateMock).not.toHaveBeenCalled();
  });

  it('returns the spreadsheet only to pricing admins', async () => {
    const response = await downloadPricingTemplate();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('商品集中调价导入模板.xlsx'));
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('xlsx-bytes');
  });

  it('rejects apply when preview has not been generated', async () => {
    const response = await applyPricing(request('/api/admin/pricing-adjustments/apply', {}));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('预览');
  });

  it('does not write a shared spec name onto another product', async () => {
    seedProduct({ id: 'product_3', catalogNumber: 'CAT-3', price: 200, costPrice: 80, minimumSalePrice: null });
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_3', 'product_3', 'CAT-3-100', '100ul', 55, 60)
    `).run();

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 999 },
        { catalogNumber: 'CAT-3', price: 200 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.preview.unmatchedCatalogs).toContain('CAT-1 / 100ul');

    await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const variant = getTestDb().prepare('SELECT price FROM ProductVariant WHERE id = ?').get('variant_3') as { price: number };
    expect(variant.price).toBe(55);
  });

  it('does not treat another product catalog as a spec of the imported row', async () => {
    seedProduct({ id: 'product_3', catalogNumber: 'CAT-3', price: 200, costPrice: 80, minimumSalePrice: null });

    const match = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [{ catalogNumber: 'CAT-1', spec: 'CAT-3' }],
      }),
    }));
    expect(match.status).toBe(200);
    expect((await match.json()).matches).toEqual([
      { catalogNumber: 'CAT-1', spec: 'CAT-3', matched: false, name: null, productName: null },
    ]);

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', spec: 'CAT-3', price: 999 }],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.unmatchedCatalogs).toContain('CAT-1 / CAT-3');

    await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const row = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_3') as { price: number };
    expect(row.price).toBe(200);
  });

  it('keeps promotional price at zero instead of flooring it to the minimum sale price', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', promotionalPrice: 0 }],
    };
    await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT promotionalPrice, promotion, price FROM Product WHERE id = ?').get('product_1') as {
      promotionalPrice: number | null;
      promotion: number;
      price: number;
    };
    expect(row.promotionalPrice).toBe(0);
    expect(row.promotion).toBe(0);
    expect(row.price).toBe(100);
  });

  it('merges two file rows that resolve to the same pack', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, costPrice)
      VALUES ('variant_same', 'product_1', 'CAT-1-100', '100ul', 50, 60, 20)
    `).run();
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 88 },
        { catalogNumber: 'CAT-1', spec: 'CAT-1-100', costPrice: 33 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const body = await preview.json();
    expect(body.preview.changeCount).toBe(1);

    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect((await apply.json()).result.updatedCount).toBe(1);
    const variant = getTestDb().prepare('SELECT price, costPrice FROM ProductVariant WHERE id = ?').get('variant_same') as {
      price: number;
      costPrice: number;
    };
    expect(variant.price).toBe(88);
    expect(variant.costPrice).toBe(33);
  });

  it('re-floors a merged selling price against the combined minimum sale price', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, costPrice, minimumSalePrice)
      VALUES ('variant_floor_merge', 'product_1', 'CAT-1-100', '100ul', 50, 60, 20, 40)
    `).run();
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 88 },
        { catalogNumber: 'CAT-1', spec: 'CAT-1-100', minimumSalePrice: 90 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.flooredCount).toBe(1);

    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const variant = getTestDb().prepare('SELECT price, minimumSalePrice FROM ProductVariant WHERE id = ?').get('variant_floor_merge') as {
      price: number;
      minimumSalePrice: number;
    };
    expect(variant.price).toBe(90);
    expect(variant.minimumSalePrice).toBe(90);
  });

  it('lets file mode assign a public price to inquiry products', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-2', price: 88 }],
    };
    await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT price, pricingMode FROM Product WHERE id = ?').get('product_2') as {
      price: number;
      pricingMode: string;
    };
    expect(row.price).toBe(88);
    expect(row.pricingMode).toBe('fixed');
  });

  it('matches imported catalogs without requiring an adjustment amount', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_match', 'product_1', 'CAT-1-100', '100ul', 50, 60)
    `).run();

    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [
          { catalogNumber: 'CAT-1' },
          { catalogNumber: 'CAT-1', spec: '100ul' },
          { catalogNumber: 'MISSING' },
        ],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toEqual([
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体', productName: '测试抗体' },
      { catalogNumber: 'CAT-1', spec: '100ul', matched: true, name: '测试抗体 / 100ul', productName: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: false, name: null, productName: null },
    ]);
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('flags catalog number collisions when imported names do not overlap', async () => {
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [
          { catalogNumber: 'CAT-1', name: '另一商品' },
          { catalogNumber: 'CAT-1', name: '测试抗体 一抗' },
        ],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toEqual([
      { catalogNumber: 'CAT-1', spec: '', matched: false, name: '测试抗体', productName: '测试抗体', nameConflict: true },
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体', productName: '测试抗体' },
    ]);
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('skips writing file prices when the catalog number hits a different product name', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', name: '另一商品', price: 999 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(0);
    expect(previewBody.preview.reviewCount).toBe(1);
    expect(previewBody.preview.reviewItems).toEqual([
      { catalogNumber: 'CAT-1', spec: '', importedName: '另一商品', productName: '测试抗体' },
    ]);
    expect(previewBody.preview.unmatchedCatalogs).toEqual([]);
    expect(JSON.stringify(previewBody)).not.toContain('costPrice');

    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const product = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(product.price).toBe(100);
  });

  it('skips percent catalog updates when imported names conflict', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      priceField: 'price',
      reason: '供应商调价',
      catalogNumbers: ['CAT-1'],
      catalogItems: [{ catalogNumber: 'CAT-1', name: '另一商品' }],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(0);
    expect(previewBody.preview.reviewCount).toBe(1);
    expect(previewBody.preview.reviewItems).toEqual([
      { catalogNumber: 'CAT-1', spec: '', importedName: '另一商品', productName: '测试抗体' },
    ]);

    const apply = await applyPricing(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const product = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(product.price).toBe(100);
  });

  it('creates catalog products that were missing during import', async () => {
    const response = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        category: '抗体',
        subcategory: '一抗',
        drafts: [{
          catalogNumber: 'NEW-1',
          name: '新抗体',
          spec: '',
          originalPrice: 120,
          price: 88,
          promotionalPrice: 80,
          costPrice: 40,
          minimumSalePrice: 70,
          variants: [{
            catalogNumber: 'NEW-1-100ul',
            spec: '100ul',
            price: 160,
            costPrice: 70,
          }],
        }],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ createdCount: 1, skippedCount: 0, createdCatalogs: ['NEW-1'] });
    expect(JSON.stringify(body)).not.toContain('costPrice');

    const product = getTestDb().prepare('SELECT name, price, originalPrice, promotionalPrice, costPrice, minimumSalePrice, pricingMode, category FROM Product WHERE catalogNumber = ?').get('NEW-1') as {
      name: string;
      price: number;
      originalPrice: number;
      promotionalPrice: number;
      costPrice: number;
      minimumSalePrice: number;
      pricingMode: string;
      category: string;
    };
    expect(product).toMatchObject({
      name: '新抗体',
      price: 88,
      originalPrice: 120,
      promotionalPrice: 80,
      costPrice: 40,
      minimumSalePrice: 70,
      pricingMode: 'fixed',
      category: '抗体',
    });
    const variant = getTestDb().prepare('SELECT spec, price, costPrice FROM ProductVariant WHERE catalogNumber = ?').get('NEW-1-100ul') as {
      spec: string;
      price: number;
      costPrice: number;
    };
    expect(variant).toEqual({ spec: '100ul', price: 160, costPrice: 70 });

    const again = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        category: '抗体',
        drafts: [{ catalogNumber: 'NEW-1', name: '新抗体', price: 99 }],
      }),
    }));
    expect((await again.json()).result).toMatchObject({ createdCount: 0, skippedCount: 1 });
  });

  it('auto-classifies missing catalog products onto the current category tree', async () => {
    const response = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        autoClassify: true,
        drafts: [{
          catalogNumber: 'SEC-1',
          name: 'Goat Anti-Rabbit IgG H&L (HRP)',
          price: 88,
        }],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ createdCount: 1, classifiedCount: 1, createdCatalogs: ['SEC-1'] });
    const product = getTestDb().prepare('SELECT category, subcategory FROM Product WHERE catalogNumber = ?').get('SEC-1') as {
      category: string;
      subcategory: string;
    };
    expect(product).toEqual({ category: '二抗', subcategory: 'HRP偶联二抗' });
  });

  it('classifies missing catalog drafts with the same catalog index as create-missing', async () => {
    const missingBrand = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ name: 'Goat Anti-Rabbit IgG H&L (HRP)', catalogNumber: 'SEC-1' }],
      }),
    }));
    expect(missingBrand.status).toBe(200);

    const tooMany = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        items: Array.from({ length: MAX_CLASSIFY_PREVIEW + 1 }, (_, index) => ({
          name: `商品 ${index + 1}`,
          catalogNumber: `ITEM-${index + 1}`,
        })),
      }),
    }));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toContain('200');

    const response = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        items: [{
          name: 'Goat Anti-Rabbit IgG H&L (HRP)',
          catalogNumber: 'SEC-1',
          spec: '',
        }],
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      suggestions: [{
        catalogNumber: 'SEC-1',
        spec: '',
        ok: true,
        category: '二抗',
        subcategory: 'HRP偶联二抗',
      }],
    });
  });

  it('rejects unauthenticated catalog matching', async () => {
    authMock.mockResolvedValue(null);
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'CST', catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(response.status).toBe(401);
  });
});
