import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, getVerifiedInventoryError, revalidateCouponPromotionEvidence, revalidateReferencePriceEvidence, verifyAndPriceItems } from '@/lib/pricing';
import { withPromotionRepository } from '@/lib/promotion-repository';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

function seedProduct() {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, minimumSalePrice, applications, reactivity, createdAt, updatedAt)
    VALUES ('product_1', 'CAT-1', '测试产品', 'CST', 1000, 700, '[]', '[]', datetime('now'), datetime('now'))
  `).run();
}

const originalReferencePriceConfig = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;

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
  afterAll(() => {
    if (originalReferencePriceConfig === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = originalReferencePriceConfig;
    closeTestDb();
  });
  beforeEach(() => {
    delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'user_1', email: 'buyer@test.com', tier: 'standard' });
    seedProduct();
  });

  it('uses the configured promotion once as a reference-price discount and ignores legacy promotional price', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 0, originalPrice = 1000, promotionalPrice = 100, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt)
      VALUES ('reference_campaign', 'Synthetic campaign', 'discount_rate', 0.55, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), 1, 1, datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('reference_link', 'reference_campaign', 'product_1')`).run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });

    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    const item = result.verifiedItems[0];
    const snapshot = JSON.parse(item.pricingSnapshot);
    expect(item).toMatchObject({ unitPrice: 550, selectedPromotionId: 'reference_campaign' });
    expect(snapshot.appliedSource).toBe('promotion:reference_campaign');
    expect(snapshot.steps.filter((step: { stage: string; applied: boolean }) => step.stage === 'promotion' && step.applied)).toHaveLength(1);
    expect(item.promotionPricingEvidence?.referencePricePromotionId).toBe('reference_campaign');
    expect(item.promotionPricingEvidence?.identity).toEqual({ state: 'restricted', promotionId: 'reference_campaign' });
  });

  it('binds a scoped reference activity to its product, rate and exact time window', async () => {
    const db = getTestDb();
    const startsAt = '2031-02-01T00:00:00.000Z';
    const endsAt = '2031-02-03T00:00:00.000Z';
    const now = new Date('2031-02-02T00:00:00.000Z');
    db.prepare("UPDATE Product SET price = 1000, originalPrice = 1000, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('scope_campaign', 'Synthetic', 'discount_rate', 0.6, 'active', ?, ?, ?)`)
      .run(new Date(startsAt).getTime(), new Date(endsAt).getTime(), now.getTime());
    db.prepare("INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('scope_link', 'scope_campaign', 'product_1')").run();
    const scope = { promotionId: 'scope_campaign', productId: 'product_1', rate: 0.6, startsAt, endsAt };
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify(scope);
    const items = [{ productId: 'product_1', name: 'Synthetic', price: 1 }];
    const priced = await verifyAndPriceItems(items, { now });
    expect(priced.verifiedItems[0].unitPrice).toBe(600);
    const evidence = priced.verifiedItems[0].promotionPricingEvidence!;
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(tx, [evidence], now))).resolves.toBe(true);
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(tx, [evidence], new Date(endsAt)))).resolves.toBe(false);
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ ...scope, rate: 0.7 });
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(tx, [evidence], now))).resolves.toBe(false);
    await expect(verifyAndPriceItems(items, { now })).rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify(scope);
    db.prepare("DELETE FROM PromotionProduct WHERE id = 'scope_link'").run();
    await expect(verifyAndPriceItems(items, { now })).rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');
  });

  it('rejects a variant line when the configured reference-price activity targets its product', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 1000, originalPrice = 1200, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_reference', 'product_1', 'CAT-1-V', 'Synthetic variant', 900, 1100)`).run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt)
      VALUES ('reference_campaign', 'Synthetic variant reference campaign', 'discount_rate', 0.55, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), 1, 1, datetime('now'))`).run();
    db.prepare("INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('reference_link', 'reference_campaign', 'product_1')").run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });

    await expect(verifyAndPriceItems([{
      productId: 'product_1', variantId: 'variant_reference', catalogNumber: 'CAT-1-V', name: 'Synthetic variant', price: 900,
    }])).rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');
  });

  it('fails closed when reference-promotion configuration or catalog price changes after pricing', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 0, originalPrice = 1000, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('reference_campaign', 'Synthetic campaign', 'discount_rate', 0.55, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('reference_link', 'reference_campaign', 'product_1')`).run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });
    const priced = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    const evidence = priced.verifiedItems[0].promotionPricingEvidence!;

    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'different_campaign' });
    await expect(prisma.$transaction((tx) => revalidateCouponPromotionEvidence(tx, [evidence], new Date())))
      .resolves.toBe(false);

    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });
    db.prepare("UPDATE Product SET originalPrice = 1200 WHERE id = 'product_1'").run();
    await expect(prisma.$transaction((tx) => revalidateCouponPromotionEvidence(tx, [evidence], new Date())))
      .resolves.toBe(false);
  });

  it('rejects reference-price evidence when another applicable campaign starts before transaction revalidation', async () => {
    const db = getTestDb();
    const pricedAt = new Date('2030-01-01T12:00:00.000Z');
    const otherStartsAt = new Date('2030-01-02T00:00:00.000Z');
    const transactionNow = new Date('2030-01-02T12:00:00.000Z');
    db.prepare("UPDATE Product SET price = 0, originalPrice = 1000, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt)
      VALUES ('reference_campaign', 'Synthetic reference campaign', 'discount_rate', 0.55, 'active', ?, ?, 1, 1, ?),
             ('future_campaign', 'Synthetic future campaign', 'fixed_price', 900, 'active', ?, ?, 2, 0, ?)`)
      .run(new Date('2030-01-01T00:00:00.000Z').getTime(), new Date('2030-01-04T00:00:00.000Z').getTime(),
        pricedAt.getTime(), otherStartsAt.getTime(), new Date('2030-01-04T00:00:00.000Z').getTime(), pricedAt.getTime());
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES
      ('reference_link', 'reference_campaign', 'product_1'),
      ('future_link', 'future_campaign', 'product_1')`).run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });

    const priced = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }], { now: pricedAt });
    expect(priced.verifiedItems[0].referencePriceApplied).toBe(true);
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(
      tx, [priced.verifiedItems[0].promotionPricingEvidence!], transactionNow,
    ))).resolves.toBe(false);
  });

  it('revalidates a not-yet-applied eligible product row when the configured activity becomes effective', async () => {
    const db = getTestDb();
    const pricedAt = new Date('2030-01-01T12:00:00.000Z');
    const transactionNow = new Date('2030-01-03T12:00:00.000Z');
    db.prepare("UPDATE Product SET price = 1000, originalPrice = 1200, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('reference_campaign', 'Synthetic scheduled campaign', 'discount_rate', 0.55, 'active', ?, ?, ?)`)
      .run(new Date('2030-01-02T00:00:00.000Z').getTime(), new Date('2030-01-04T00:00:00.000Z').getTime(), pricedAt.getTime());
    db.prepare("INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('reference_link', 'reference_campaign', 'product_1')").run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });

    const priced = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }], { now: pricedAt });
    expect(priced.verifiedItems[0]).toMatchObject({ referencePriceApplied: false, referencePriceEligible: true });
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(
      tx, [priced.verifiedItems[0].promotionPricingEvidence!], transactionNow,
    ))).resolves.toBe(false);
  });

  it('allows an eligible non-target product without original price when the configured activity is unrelated', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 1000, originalPrice = NULL, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, minimumSalePrice, applications, reactivity, createdAt, updatedAt)
      VALUES ('product_2', 'CAT-2', 'Unrelated product', 'CST', 2000, NULL, '[]', '[]', datetime('now'), datetime('now'))`).run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('reference_campaign', 'Synthetic unrelated campaign', 'discount_rate', 0.55, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare("INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('unrelated_link', 'reference_campaign', 'product_2')").run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'reference_campaign' });

    const priced = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    expect(priced.verifiedItems[0]).toMatchObject({ referencePriceApplied: false, referencePriceEligible: true });
    await expect(prisma.$transaction((tx) => revalidateReferencePriceEvidence(
      tx, [priced.verifiedItems[0].promotionPricingEvidence!], new Date(),
    ))).resolves.toBe(true);
  });

  it('fails closed for malformed reference configuration and an invalid configured campaign', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 1000, originalPrice = 1200, minimumSalePrice = NULL WHERE id = 'product_1'").run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = '{broken-json';
    const malformedConfig = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    expect(malformedConfig.verifiedItems[0]).toMatchObject({ unitPrice: 1000, source: 'db' });
    expect(malformedConfig.verifiedItems[0].promotionIdentity).toEqual({ state: 'unknown' });

    db.prepare("UPDATE Product SET price = 0, originalPrice = 1200 WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('invalid_reference_campaign', 'Synthetic invalid campaign', 'fixed_price', 500, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('invalid_reference_link', 'invalid_reference_campaign', 'product_1')`).run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'invalid_reference_campaign' });
    await expect(verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]))
      .rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');
  });

  it('revalidates legacy pricing evidence without newly added reference-price fields', async () => {
    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    const current = result.verifiedItems[0].promotionPricingEvidence!;
    const legacy = structuredClone(current);
    delete legacy.product.originalPrice;
    delete legacy.referencePricePromotionId;
    delete legacy.referencePriceApplied;
    delete legacy.referencePriceEligible;

    await expect(prisma.$transaction((tx) => revalidateCouponPromotionEvidence(tx, [legacy], new Date())))
      .resolves.toBe(true);
  });

  it('accepts unchanged current coupon pricing evidence', async () => {
    const priced = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    const evidence = priced.verifiedItems[0].promotionPricingEvidence!;

    await expect(prisma.$transaction((tx) => revalidateCouponPromotionEvidence(tx, [evidence], new Date())))
      .resolves.toBe(true);
  });

  it('keeps ordinary pricing behavior without a valid configured active campaign and on unrelated products', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET price = 0, originalPrice = 1000, promotionalPrice = 100 WHERE id = 'product_1'").run();
    delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    const noCampaign = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    expect(noCampaign.verifiedItems[0]).toMatchObject({ unitPrice: 999, source: 'fallback', selectedPromotionId: null });

    db.prepare("INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt) VALUES ('inactive_campaign', 'Inactive synthetic campaign', 'discount_rate', 0.55, 'draft', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))").run();
    db.prepare("INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('inactive_link', 'inactive_campaign', 'product_1')").run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'inactive_campaign' });
    const inactive = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    expect(inactive.verifiedItems[0]).toMatchObject({ unitPrice: 999, source: 'fallback', selectedPromotionId: null });

    db.prepare("DELETE FROM PromotionProduct WHERE promotionId = 'inactive_campaign'").run();
    db.prepare("UPDATE Product SET promotionalPrice = NULL WHERE id = 'product_1'").run();
    delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    const noCatalogPrice = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: 'Synthetic product', price: 999 }]);
    expect(noCatalogPrice.verifiedItems[0]).toMatchObject({ unitPrice: 999, source: 'fallback' });

    db.prepare("UPDATE Product SET price = 1000, promotionalPrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, minimumSalePrice, applications, reactivity, createdAt, updatedAt)
      VALUES ('product_2', 'CAT-2', 'Other synthetic product', 'CST', 2000, NULL, '[]', '[]', datetime('now'), datetime('now'))`).run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('reference_campaign', 'Synthetic campaign', 'discount_rate', 0.55, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('other_link', 'reference_campaign', 'product_2')`).run();
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'different_reference_campaign' });
    const unrelated = await verifyAndPriceItems([{ catalogNumber: 'CAT-2', name: 'Other synthetic product', price: 999 }]);
    expect(unrelated.verifiedItems[0]).toMatchObject({ unitPrice: 1100, selectedPromotionId: 'reference_campaign' });
  });

  it('uses an active promotion and stores calculation evidence', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt) VALUES ('promo_1', '限时活动', 'fixed_price', 800, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), 1, 1, datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_1', 'promo_1', 'product_1')`).run();

    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    expect(result.verifiedItems[0].unitPrice).toBe(800);
    expect(result.verifiedItems[0].selectedPromotionId).toBe('promo_1');
    const snapshot = JSON.parse(result.verifiedItems[0].pricingSnapshot);
    expect(snapshot.appliedSource).toBe('promotion:promo_1');
    expect(snapshot.steps.some((step: { stage: string; applied: boolean }) => step.stage === 'promotion' && step.applied)).toBe(true);
  });

  it('uses the same left-closed right-open promotion boundary as foundation pricing', async () => {
    const db = getTestDb();
    db.prepare("UPDATE Product SET minimumSalePrice = NULL WHERE id = 'product_1'").run();
    const startsAt = new Date('2030-01-01T00:00:00.000Z');
    const endsAt = new Date('2030-01-02T00:00:00.000Z');
    db.prepare(`INSERT INTO Promotion
      (id, name, type, value, ruleDefinition, ruleVersion, status, startsAt, endsAt, priority, exclusive, updatedAt)
      VALUES ('promo_boundary', '边界活动', 'fixed_price', 500, ?, 1, 'active', ?, ?, 1, 1, ?)`
    ).run(JSON.stringify({
      schemaVersion: 1,
      template: 'direct-price',
      groups: [{ key: 'main', role: 'benefit', unit: '件', quantity: 1 }],
      benefit: { kind: 'fixed-price', unitPriceCents: 500 },
      repeat: false,
      maxApplications: null,
      partialBenefit: false,
    }), startsAt.getTime(), endsAt.getTime(), endsAt.getTime());
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId, groupKey)
      VALUES ('link_boundary', 'promo_boundary', 'product_1', 'main')`).run();

    const atStart = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], {
      userId: 'user_1', now: startsAt,
    });
    const atEnd = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], {
      userId: 'user_1', now: endsAt,
    });

    expect(atStart.verifiedItems[0].unitPrice).toBe(500);
    expect(atEnd.verifiedItems[0].unitPrice).toBe(1000);
    expect(withPromotionRepository((repository) => repository.activeForProducts(['product_1'], endsAt))).toEqual([]);
  });

  it('ignores an expired promotion', async () => {
    const db = getTestDb();
    db.prepare("UPDATE User SET discountRate = 0.995 WHERE id = 'user_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt) VALUES ('promo_1', '过期活动', 'fixed_price', 500, 'active', datetime('now', '-2 day'), datetime('now', '-1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_1', 'promo_1', 'product_1')`).run();
    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], { userId: 'user_1' });
    expect(result.verifiedItems[0].unitPrice).toBe(995);
    expect(result.verifiedItems[0].selectedPromotionId).toBeNull();
  });

  it('does not expose a promotion identity when another price source wins or changes it', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('promo_floor', '低价活动', 'fixed_price', 600, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_floor', 'promo_floor', 'product_1')`).run();
    const floored = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }]);
    expect(floored.verifiedItems[0]).toMatchObject({ unitPrice: 700, selectedPromotionId: null });

    db.prepare("DELETE FROM PromotionProduct WHERE promotionId = 'promo_floor'").run();
    db.prepare("UPDATE Product SET promotionalPrice = 800 WHERE id = 'product_1'").run();
    const pseudoCandidate = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }]);
    expect(pseudoCandidate.verifiedItems[0]).toMatchObject({ unitPrice: 800, selectedPromotionId: null });

    db.prepare("UPDATE Product SET minimumSalePrice = NULL WHERE id = 'product_1'").run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, updatedAt)
      VALUES ('product-promotional-price', '标识冲突活动', 'fixed_price', 600, 'active', datetime('now', '-1 day'), datetime('now', '+1 day'), datetime('now'))`).run();
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId) VALUES ('link_collision', 'product-promotional-price', 'product_1')`).run();
    const collision = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }]);
    expect(collision.verifiedItems[0]).toMatchObject({ unitPrice: 600, selectedPromotionId: null });
  });

  it('enforces minimum sale price after an authorized manual adjustment', async () => {
    const result = await verifyAndPriceItems([{ catalogNumber: 'CAT-1', name: '测试产品', price: 999 }], {
      userId: 'user_1', allowManualAdjustment: true,
      manualAdjustments: { 'CAT-1': { type: 'fixed_price', value: 600, reason: '人工报价' } },
    });
    expect(result.verifiedItems[0].unitPrice).toBe(700);
    expect(result.verifiedItems[0].selectedPromotionId).toBeNull();
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

  it('uses variant inventory accounts for checkout stock validation', async () => {
    const db = getTestDb();
    db.prepare('UPDATE Product SET stockQuantity = -1, inStock = 1 WHERE id = ?').run('product_1');
    db.prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_stock', 'product_1', 'CAT-1-V', '100 µL', 100, 100)
    `).run();
    db.prepare(`
      INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt)
      VALUES ('acc_variant', 'product_1', 'variant_stock', 1, 1, 0, 0, 0, datetime('now'), datetime('now'))
    `).run();

    const result = await verifyAndPriceItems([{
      productId: 'product_1', catalogNumber: 'CAT-1-V', variantId: 'variant_stock', name: '测试产品', price: 100, quantity: 2,
    }], { userId: 'user_1', allowClientFallback: false, strictQuantity: true });

    expect(result.verifiedItems[0].stockQuantity).toBe(1);
    expect(result.verifiedItems[0].variantId).toBe('variant_stock');
    expect(getVerifiedInventoryError(result.verifiedItems[0])).toBe('INSUFFICIENT_STOCK');
  });

  it('keeps product stock validation when the line has no variant', async () => {
    getTestDb().prepare('UPDATE Product SET stockQuantity = 1, inStock = 1 WHERE id = ?').run('product_1');
    const result = await verifyAndPriceItems([{
      productId: 'product_1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 2,
    }], { userId: 'user_1', allowClientFallback: false, strictQuantity: true });
    expect(result.verifiedItems[0].variantId).toBeNull();
    expect(result.verifiedItems[0].stockQuantity).toBe(1);
    expect(getVerifiedInventoryError(result.verifiedItems[0])).toBe('INSUFFICIENT_STOCK');
  });
});
