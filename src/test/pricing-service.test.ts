import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, verifyAndPriceItems } from '@/lib/pricing';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

function seedProduct() {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, minimumSalePrice, applications, reactivity, createdAt, updatedAt)
    VALUES ('product_1', 'CAT-1', '测试产品', 'CST', 1000, 700, '[]', '[]', datetime('now'), datetime('now'))
  `).run();
}

describe('pricing service', () => {
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid quantity %s', async (quantity) => {
    await expect(verifyAndPriceItems([{ productId: 'product_1', name: '测试', price: 1, quantity }], { strictQuantity: true })).rejects.toThrow('INVALID_QUANTITY');
  });

  it('uses canonical identity and base price for marked promotion lines', async () => {
    getTestDb().prepare("UPDATE Product SET promotionalPrice = 800, spec = '1mL' WHERE id = 'product_1'").run();
    const result = await verifyAndPriceItems([{
      productId: 'product_1', brand: 'CST', catalogNumber: 'CAT-1', name: '伪造名称', price: 0,
      promoMark: { ruleId: 'synthetic-addon-rule', price: 50 },
    }], { userId: 'user_1' });
    expect(result.verifiedItems[0]).toMatchObject({
      brand: 'CST', catalogNumber: 'CAT-1', unitPrice: 1000, source: 'db',
    });
  });
  beforeAll(() => getTestDb());
  afterAll(() => closeTestDb());
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'user_1', email: 'buyer@test.com', tier: 'standard' });
    seedProduct();
  });

  it('uses an active promotion and stores calculation evidence', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt) VALUES ('promo_1', '限时活动', 'fixed_price', 800, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), 1, 1, datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_1', 'promo_1', 'product_1')`).run();

    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    expect(result.verifiedItems[0].unitPrice).toBe(800);
    const snapshot = JSON.parse(result.verifiedItems[0].pricingSnapshot);
    expect(snapshot.appliedSource).toBe('promotion:promo_1');
    expect(snapshot.steps.some((step: { stage: string; applied: boolean }) => step.stage === 'promotion' && step.applied)).toBe(true);
  });

  it('ignores an expired promotion', async () => {
    const db = getTestDb();
    db.prepare("UPDATE User SET discountRate = 0.995 WHERE id = 'user_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt) VALUES ('promo_1', '过期活动', 'fixed_price', 500, 'active', datetime('now', '-2 day'), datetime('now', '-1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_1', 'promo_1', 'product_1')`).run();
    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    expect(result.verifiedItems[0].unitPrice).toBe(995);
  });

  it('enforces minimum sale price after an authorized manual adjustment', async () => {
    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], {
      userId: 'user_1', allowManualAdjustment: true,
      manualAdjustments: { 'CAT-1': { type: 'fixed_price', value: 600, reason: '人工报价' } },
    });
    expect(result.verifiedItems[0].unitPrice).toBe(700);
    expect(JSON.parse(result.verifiedItems[0].pricingSnapshot).minimumPriceApplied).toBe(true);
  });

  it('finds products by internal id', async () => {
    getTestDb().prepare("UPDATE User SET discountRate = 0.995 WHERE id = 'user_1'").run();
    const result = await verifyAndPriceItems([{ productId: 'product_1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    expect(result.verifiedItems[0]).toMatchObject({ productId: 'product_1', catalogNumber: 'CAT-1', unitPrice: 995 });
  });

  it('uses brand and catalog number together when catalog numbers are shared', async () => {
    getTestDb().prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, createdAt, updatedAt)
      VALUES ('product_2', 'CAT-1', '同货号产品', 'MultiSciences', 1200, '[]', '[]', datetime('now', '+1 second'), datetime('now'))
    `).run();

    const result = await verifyAndPriceItems([{
      catalogNumber: 'CAT-1', brand: 'MultiSciences', name: '同货号产品', price: 1,
    }]);

    expect(result.verifiedItems[0]).toMatchObject({ productId: 'product_2', catalogNumber: 'CAT-1', unitPrice: 1200 });
  });

  it('prioritizes an internal product id when a submitted catalog number is shared', async () => {
    getTestDb().prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, createdAt, updatedAt)
      VALUES ('product_2', 'CAT-1', '同货号产品', 'MultiSciences', 1200, '[]', '[]', datetime('now', '+1 second'), datetime('now'))
    `).run();

    const result = await verifyAndPriceItems([{
      productId: 'product_2', catalogNumber: 'CAT-1', name: '同货号产品', price: 1,
    }]);

    expect(result.verifiedItems[0]).toMatchObject({ productId: 'product_2', catalogNumber: 'CAT-1', unitPrice: 1200 });
  });

  it('rejects shared catalog numbers without a brand or internal product id', async () => {
    getTestDb().prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, createdAt, updatedAt)
      VALUES ('product_2', 'CAT-1', '同货号产品', 'MultiSciences', 1200, '[]', '[]', datetime('now', '+1 second'), datetime('now'))
    `).run();

    await expect(verifyAndPriceItems([{
      catalogNumber: 'CAT-1', name: '同货号产品', price: 1,
    }])).rejects.toThrow(AMBIGUOUS_PRODUCT_CATALOG_NUMBER);
  });

  it('uses a same-catalog package variant only when variantId is supplied', async () => {
    getTestDb().prepare("UPDATE User SET discountRate = 0.995 WHERE id = 'user_1'").run();
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_case', 'product_1', 'CAT-1', '整箱（6瓶）', 954, 3342)
    `).run();

    const base = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    const packaged = await verifyAndPriceItems([{
      catalogNumber: 'CAT-1', variantId: 'variant_case', name: '测试产品', price: 954,
    }], { userId: 'user_1' });

    expect(base.verifiedItems[0].unitPrice).toBe(995);
    expect(packaged.verifiedItems[0].unitPrice).toBe(949.23);
  });

  it('rejects inquiry-only products even when the client submits a positive price', async () => {
    getTestDb().prepare("UPDATE Product SET price = -1, pricingMode = 'inquiry' WHERE id = 'product_1'").run();

    await expect(verifyAndPriceItems([
      { catalogNumber: 'CAT-1', name: '测试产品', price: 1 },
    ], { userId: 'user_1' })).rejects.toThrow('PRODUCT_REQUIRES_INQUIRY');
  });
});
