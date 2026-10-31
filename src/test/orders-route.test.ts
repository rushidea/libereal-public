import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyAndPriceItems: vi.fn(),
  revalidateReferencePriceEvidence: vi.fn(),
  capturePromoLines: vi.fn(),
  userFindUnique: vi.fn(),
  orderFindFirst: vi.fn(),
  orderFindUnique: vi.fn(),
  orderCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationFindMany: vi.fn(),
  getRequiredLegalConsent: vi.fn(),
  validateAcceptedLegalIds: vi.fn(),
  sendAdminOperationalEmail: vi.fn(),
  previewPointsRedeem: vi.fn(),
  applyOrderPointsDeduction: vi.fn(),
  requireActiveSession: vi.fn(),
  transactionRunner: null as null | ((fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
}));
const sampleRules = vi.hoisted(() => ({ sample: { id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture only.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] } }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRules.sample], CART_ADDON_RULES: [sampleRules.sample], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));


vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/cart-promotions/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cart-promotions/service')>();
  return {
    ...actual,
    computePromoAdjustments: (lines: Parameters<typeof actual.computePromoAdjustments>[0], now?: Date) => {
      mocks.capturePromoLines(lines);
      return actual.computePromoAdjustments(lines, now);
    },
  };
});
vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return {
    ...actual,
    verifyAndPriceItems: mocks.verifyAndPriceItems,
    revalidateReferencePriceEvidence: mocks.revalidateReferencePriceEvidence,
  };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    order: {
      findFirst: mocks.orderFindFirst,
      findUnique: mocks.orderFindUnique,
      create: mocks.orderCreate,
    },
    notification: { create: mocks.notificationCreate, findMany: mocks.notificationFindMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => mocks.transactionRunner ? mocks.transactionRunner(fn) : fn({
      order: { create: mocks.orderCreate },
      notification: { create: mocks.notificationCreate },
    }),
  },
}));
vi.mock('@/lib/legal-documents', () => ({
  getRequiredLegalConsent: mocks.getRequiredLegalConsent,
  validateAcceptedLegalIds: mocks.validateAcceptedLegalIds,
}));
vi.mock('@/lib/mail', () => ({ sendAdminOperationalEmail: mocks.sendAdminOperationalEmail }));
vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/points-checkout-service', () => ({
  previewPointsRedeem: mocks.previewPointsRedeem,
  applyOrderPointsDeduction: mocks.applyOrderPointsDeduction,
}));
vi.mock('@/data/order-number', () => ({
  orderDateInShanghai: () => '20260723',
  nextOrderNumber: () => 'ORD-20260723-001',
  allocateOrderNumber: async () => 'ORD-20260723-001',
  ORDER_NUMBER_ALLOCATION_ATTEMPTS: 3,
  ORDER_NUMBER_BUSY_ERROR: '订单提交繁忙，请稍后重试',
  isUniqueConstraintError: (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002',
  isOrderIdUniqueConflict: (error: unknown) => {
    if (typeof error !== 'object' || error === null || !('code' in error) || (error as { code?: string }).code !== 'P2002') return false;
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return Array.isArray(target) && target.map(String).includes('id');
  },
  withAllocatedOrderNumber: async (
    db: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> },
    run: (tx: unknown, orderId: string) => Promise<unknown>,
  ) => db.$transaction(async (tx) => run(tx, 'ORD-20260723-001')),
}));
vi.mock('@/lib/inventory', () => ({
  assertVariantCheckoutStock: vi.fn(),
  reserveOrderInventory: vi.fn(),
  isVariantStockInsufficientError: (error: unknown) => error instanceof Error && error.message === 'VARIANT_INSUFFICIENT_STOCK',
  VARIANT_STOCK_INSUFFICIENT: 'VARIANT_INSUFFICIENT_STOCK',
  VARIANT_STOCK_INSUFFICIENT_MESSAGE: '所选规格库存不足',
}));

import { POST } from '@/app/api/orders/route';
import { POST as pricingPreviewPOST } from '@/app/api/orders/pricing-preview/route';
import { promotionLines, submittedPromotion, verifiedPromotion } from './cart-promotion-fixtures';
import { buildCheckoutRevision } from '@/lib/checkout-revision';
import { buildCheckoutRequestFingerprint } from '@/lib/checkout-idempotency';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

function request(body: object) {
  return new Request('https://libereal.cn/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function unifiedCheckoutDependencies(stockQuantity = 10, noOrdinaryPrice = false) {
  const identity = { id: JSON.stringify(['product-1', null]), productId: 'product-1', variantId: null, quantity: 2,
    catalogNumber: 'CAT-1', name: '数据库商品', brand: 'BrandX', category: 'Lab', subcategory: null, deletedAt: null,
    pricingMode: 'standard', available: true, stockQuantity, leadTime: null, spec: null };
  const promotion = { id: 'campaign-1', name: '合成活动', type: noOrdinaryPrice ? 'catalog_discount' : 'fixed_price', value: 50, status: 'active',
    startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z', priority: 1, exclusive: true,
    ruleDefinition: null, ruleVersion: 1, bindings: [{ bindingId: 'binding-1', productId: 'product-1', variantId: null, groupKey: 'benefit' }] };
  const snapshot = {
    items: [identity], evidenceHash: 'a'.repeat(64),
    evidence: { at: '2026-10-30T12:00:00.000Z', userId: 'user-1', referencePricePromotionId: null,
      products: [{ id: 'product-1', pricingMode: 'standard', price: noOrdinaryPrice ? 0 : 1, promotionalPrice: null, minimumSalePrice: null,
        originalPrice: 100, brand: 'BrandX', subBrand: null, variants: [],
        promotionLinks: [{ id: 'binding-1', promotionId: 'campaign-1', productId: 'product-1', variantId: null, groupKey: 'benefit' }] }],
      user: { tier: 'none', discountRate: null, brandDiscounts: null, isFrozen: false }, promotions: [promotion], campaigns: [],
      legacyPromotions: [], lines: [{ id: identity.id, productId: 'product-1', variantId: null, quantity: 2,
        unitPriceCents: noOrdinaryPrice ? 0 : 100, basePriceCents: noOrdinaryPrice ? 0 : 100, catalogReferenceCents: 10000 }], ordinaryUnitPricesCents: [noOrdinaryPrice ? null : 100] },
    pricing: { totalCents: 150, promotionIds: ['campaign-1'], allocationIds: ['campaign-1'],
      lines: [{ productId: 'product-1', variantId: null, quantity: 2, totalAfterCents: 150, promotionId: 'campaign-1',
        priceBands: noOrdinaryPrice ? [{ quantity: 2, unitCents: 75, source: 'promotion' }] : [{ quantity: 1, unitCents: 100, source: 'ordinary' }, { quantity: 1, unitCents: 50, source: 'promotion' }] }] },
    unitPriceAllocations: [{ productId: 'product-1', variantId: null, quantity: 2, ordinaryUnitPriceCents: 100, reconstructable: true,
      priceBands: [{ quantity: 1, unitPriceCents: 100, promotionId: null }, { quantity: 1, unitPriceCents: 50, promotionId: 'campaign-1' }] }],
  };
  return {
    client: { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}) },
    resolveIdentities: async (_tx: unknown, input: { lines: Array<{ quantity: number }> }) => ({ items: input.lines.map((line) => ({ ...identity, quantity: line.quantity })) }),
    createSnapshot: vi.fn(async (_tx: unknown, input: { now?: Date }) => ({ ...snapshot,
      evidence: { ...snapshot.evidence, at: input.now?.toISOString() ?? snapshot.evidence.at } }),
    ),
  };
}

describe('POST /api/orders', () => {

  it('uses production POST with all gates and retains legacy paths when any gate is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'unified-order-'));
    const path = join(dir, 'fixture.sqlite');
    const sqlite = new Database(path);
    sqlite.exec(`
      CREATE TABLE Product (id TEXT PRIMARY KEY, catalogNumber TEXT NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL, price REAL NOT NULL,
        pricingMode TEXT NOT NULL DEFAULT 'fixed', originalPrice REAL, category TEXT, subcategory TEXT, inStock BOOLEAN NOT NULL DEFAULT 1,
        promotionalPrice REAL, promotion BOOLEAN NOT NULL DEFAULT 0, costPrice REAL, minimumSalePrice REAL, subBrand TEXT, leadTime TEXT,
        hazardous BOOLEAN NOT NULL DEFAULT 0, stockQuantity INTEGER NOT NULL DEFAULT -1, deletedAt DATETIME);
      CREATE TABLE ProductVariant (id TEXT PRIMARY KEY, productId TEXT NOT NULL, catalogNumber TEXT NOT NULL, spec TEXT NOT NULL,
        price REAL NOT NULL, originalPrice REAL, promotionalPrice REAL, costPrice REAL, minimumSalePrice REAL);
      CREATE TABLE Promotion (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, value REAL NOT NULL, ruleDefinition TEXT,
        ruleVersion INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, startsAt DATETIME NOT NULL, endsAt DATETIME NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, exclusive BOOLEAN NOT NULL DEFAULT 1, createdBy TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE PromotionProduct (id TEXT PRIMARY KEY, promotionId TEXT NOT NULL, productId TEXT NOT NULL, variantId TEXT, groupKey TEXT NOT NULL);
      CREATE TABLE InventoryAccount (id TEXT PRIMARY KEY, productId TEXT NOT NULL, variantId TEXT, availableQuantity INTEGER NOT NULL DEFAULT -1);
      CREATE TABLE User (id TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'standard', discountRate REAL, brandDiscounts TEXT, isFrozen BOOLEAN NOT NULL DEFAULT 0);
      INSERT INTO User(id) VALUES ('user-1');
      INSERT INTO Product(id,catalogNumber,name,brand,price,originalPrice,stockQuantity) VALUES
        ('main','SAMPLE-MAIN-1','Synthetic main','Sample',100,100,100),
        ('addon','SAMPLE-ADDON-1','Synthetic add-on','Sample',100,100,100);
    `);
    sqlite.close();
    const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) });
    mocks.transactionRunner = (fn) => db.$transaction(async (tx) => fn(new Proxy(tx, {
      get(target, property, receiver) { return property === 'order' ? { create: mocks.orderCreate } : Reflect.get(target, property, receiver); },
    })));
    const flagNames = ['PROMOTION_UNIFIED_ENABLED', 'PROMOTION_FOUNDATION_ENABLED', 'PROMOTION_CREATE_IDEMPOTENCY_ENABLED', 'PROMOTION_VERSION_CHECK_ENABLED'] as const;
    const originalFlags = flagNames.map((name) => process.env[name]);
    for (const name of flagNames) process.env[name] = 'true';
    const input = { items: [
      { productId: 'main', quantity: 6 },
      { productId: 'addon', quantity: 1 },
      { productId: 'addon', quantity: 1, promoMark: { ruleId: 'sample-addon-rule', price: 50 } },
    ], paymentMethod: 'bank_transfer' };
    try {
      const preview = await pricingPreviewPOST(request(input) as never);
      const previewData = await preview.json();
      expect(preview.status, JSON.stringify(previewData)).toBe(200);
      expect(previewData.subtotal).toBe(750);
      expect(previewData.items[2]).toMatchObject({ originalUnitPrice: 100, includedPromotionDiscount: 50, finalLineTotal: 50 });
      expect(previewData.total).toBe(750);
      const result = await POST(request({ ...input, acceptedLegalIds: ['checkout-terms'], checkoutRevision: previewData.checkoutRevision }) as never);
      const body = await result.json();
      expect(result.status, JSON.stringify(body)).toBe(200);
      expect(mocks.orderCreate.mock.calls[0]?.[0].data).toMatchObject({ subtotal: 750, total: 750 });
      expect(mocks.capturePromoLines).not.toHaveBeenCalled();
      mocks.orderCreate.mockClear();
      mocks.transactionRunner = async (fn) => {
        await db.$executeRaw`UPDATE Product SET price = 110 WHERE id = 'addon'`;
        return db.$transaction(async (tx) => fn(new Proxy(tx, {
          get(target, property, receiver) { return property === 'order' ? { create: mocks.orderCreate } : Reflect.get(target, property, receiver); },
        })));
      };
      const changed = await POST(request({ ...input, acceptedLegalIds: ['checkout-terms'], checkoutRevision: previewData.checkoutRevision }) as never);
      expect(changed.status).toBe(409);
      expect(mocks.orderCreate).not.toHaveBeenCalled();
      for (const disabled of flagNames) {
        for (const name of flagNames) { if (name === disabled) delete process.env[name]; else process.env[name] = 'true'; }
        mocks.verifyAndPriceItems.mockClear();
        mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
        const oldInput = { items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] };
        expect((await pricingPreviewPOST(request(oldInput) as never)).status).toBe(200);
        expect(mocks.verifyAndPriceItems).toHaveBeenCalled();
        mocks.verifyAndPriceItems.mockClear();
        expect((await POST(request(oldInput) as never)).status).toBe(200);
        expect(mocks.verifyAndPriceItems).toHaveBeenCalled();
      }
    } finally {
      flagNames.forEach((name, index) => { const value = originalFlags[index]; if (value === undefined) delete process.env[name]; else process.env[name] = value; });
      mocks.transactionRunner = null;
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses one server snapshot for preview and order, preserving native integer-cent price bands', async () => {
    const dependencies = unifiedCheckoutDependencies();
    const input = { items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '伪造名称', price: 999, quantity: 2 }], paymentMethod: 'bank_transfer' };
    const preview = await pricingPreviewPOST.forTest(request(input) as never, dependencies as never);
    expect(preview.status).toBe(200);
    const previewData = await preview.json();
    expect(previewData.subtotal).toBe(1.5);
    expect(previewData.items[0]).toMatchObject({ unitPrice: null, lineTotal: 1.5, finalLineTotal: 1.5,
      priceTiers: [{ unitPrice: 1, quantity: 1 }, { unitPrice: 0.5, quantity: 1 }] });
    expect(JSON.stringify(previewData)).not.toContain('campaign-1');
    const response = await POST.forTest(request({ ...input, acceptedLegalIds: ['checkout-terms'], checkoutRevision: previewData.checkoutRevision }) as never, dependencies as never);
    expect(response.status).toBe(200);
    const created = mocks.orderCreate.mock.calls[0]?.[0] as { data: { subtotal: number; total: number; orderItems: { create: Array<{ unitPrice: number; quantity: number; catalogNumber: string }> } } };
    expect(created.data).toMatchObject({ subtotal: 1.5, total: 1.5 });
    expect(created.data.orderItems.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitPrice: 1, quantity: 1, catalogNumber: 'CAT-1' }),
      expect.objectContaining({ unitPrice: 0.5, quantity: 1, catalogNumber: 'CAT-1' }),
    ]));
    expect(mocks.orderCreate).toHaveBeenCalledTimes(1);
    expect(dependencies.createSnapshot).toHaveBeenCalledTimes(3); // preview, initial order quote, and transaction rebuild
  });

  it('checks aggregate stock across duplicate source rows before price-band splitting', async () => {
    const dependencies = unifiedCheckoutDependencies(3);
    const response = await pricingPreviewPOST.forTest(request({ items: [
      { productId: 'product-1', quantity: 2 }, { productId: 'product-1', quantity: 2 },
    ] }) as never, dependencies as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(dependencies.createSnapshot).not.toHaveBeenCalled();
  });

  it('accepts a fully covered catalog tier when the ordinary product price is zero', async () => {
    const dependencies = unifiedCheckoutDependencies(10, true);
    const input = { items: [{ productId: 'product-1', catalogNumber: 'CAT-1', price: 999, quantity: 2 }], paymentMethod: 'bank_transfer' };
    const preview = await pricingPreviewPOST.forTest(request(input) as never, dependencies as never);
    expect(preview.status).toBe(200);
    const previewData = await preview.json();
    expect(previewData.subtotal).toBe(1.5);
    expect(previewData.items[0]).toMatchObject({ unitPrice: 0.75, lineTotal: 1.5 });
    const order = await POST.forTest(request({ ...input, acceptedLegalIds: ['checkout-terms'], checkoutRevision: previewData.checkoutRevision }) as never, dependencies as never);
    expect(order.status).toBe(200);
    expect(mocks.orderCreate.mock.calls[0]?.[0].data.orderItems.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ unitPrice: 0.75, quantity: 2 }),
    ]));
  });

  it('blocks a legacy discount on an ordinary tier occupied by a unified campaign', () => {
    const overlaps = POST.campaignOverlapsLegacyDiscountsForTest as (items: unknown[], discounts: Record<string, number>) => boolean;
    expect(overlaps([{ productId: 'product-1', selectedPromotionId: null, unifiedOccupiedPromotionId: 'campaign-1' }], { '0': 1 })).toBe(true);
    expect(overlaps([{ productId: 'product-1', selectedPromotionId: null }], { '0': 1 })).toBe(false);
  });

  it('rejects a price-evidence change between the initial quote and transaction rebuild', async () => {
    const dependencies = unifiedCheckoutDependencies();
    let snapshotCall = 0;
    dependencies.createSnapshot.mockImplementation(async (_tx: unknown, input: { now?: Date }) => {
      snapshotCall += 1;
      const result = await unifiedCheckoutDependencies().createSnapshot({}, input);
      return { ...result, evidenceHash: snapshotCall === 3 ? 'b'.repeat(64) : 'a'.repeat(64) };
    });
    const input = { items: [{ productId: 'product-1', catalogNumber: 'CAT-1', quantity: 2 }], paymentMethod: 'bank_transfer' };
    const preview = await pricingPreviewPOST.forTest(request(input) as never, dependencies as never);
    const previewData = await preview.json();
    const order = await POST.forTest(request({ ...input, acceptedLegalIds: ['checkout-terms'], checkoutRevision: previewData.checkoutRevision }) as never, dependencies as never);
    expect(order.status).toBe(409);
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  function keyedRequest() {
    return { items: [{ productId: 'product-1', quantity: 1 }], paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'], checkoutAttemptId: 'synthetic-order-attempt' };
  }
  function replayRecord(body = keyedRequest()) {
    return { id: 'synthetic-existing', customerId: 'user-1', organizationId: null, ownerScope: 'personal', checkoutRequestFingerprint: buildCheckoutRequestFingerprint({ operation: 'order', actorId: 'user-1', organizationId: null, ownerScope: 'personal', request: body }) };
  }
  it('uses only verified promotion identity for order cart lines', async () => {
    const verified = verifiedPromotion();
    verified.verifiedItems[0].selectedPromotionId = 'trusted-promotion';
    verified.verifiedItems[0].promotionIdentity = { state: 'restricted', promotionId: 'trusted-promotion' };
    const submitted = submittedPromotion().map((item) => ({ ...item, selectedPromotionId: 'forged-promotion' }));
    mocks.verifyAndPriceItems.mockResolvedValue(verified);
    const response = await POST(request({
      items: submitted,
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(200);
    const [lines] = mocks.capturePromoLines.mock.calls.at(-1) as [Array<{ product: { selectedPromotionId?: string | null; promotionIdentity?: unknown } }>];
    expect(lines.map((line) => line.product.selectedPromotionId)).toEqual(['trusted-promotion', null]);
    expect(lines.map((line) => line.product.promotionIdentity)).toEqual([
      { state: 'restricted', promotionId: 'trusted-promotion' }, { state: 'unknown' },
    ]);
  });
  it('revalidates reference-price activity inside a no-coupon order transaction', async () => {
    const priced = {
      verifiedSubtotal: 100, mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100,
        quantity: 1, lineTotal: 100, pricingSnapshot: '{"finalPrice":100}', referencePriceApplied: true, referencePriceEligible: true,
        promotionPricingEvidence: {
          productId: 'product-1', variantId: null, pricedAt: '2026-10-30T12:00:00.000Z',
          identity: { state: 'restricted' as const, promotionId: 'reference-campaign' },
          product: { price: 0, originalPrice: 1000, promotionalPrice: null, minimumSalePrice: null },
          variant: null, candidates: [], referencePricePromotionId: 'reference-campaign', referencePriceApplied: true, referencePriceEligible: true,
        },
      }],
    };
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    const response = await POST(request({
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.revalidateReferencePriceEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateReferencePriceEvidence).toHaveBeenCalledWith(
      expect.anything(), [priced.verifiedItems[0].promotionPricingEvidence], expect.any(Date),
    );
  });
  it('rejects changed pricing evidence inside the order transaction even when the price is unchanged', async () => {
    const first = { verifiedSubtotal: 100, mismatchedCount: 0, verifiedItems: [{
      productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100, quantity: 1, lineTotal: 100,
      pricingSnapshot: JSON.stringify({ calculatedAt: '2030-01-01T00:00:00Z', appliedSource: 'promotion:a' }),
    }] };
    const changed = { ...first, verifiedItems: [{ ...first.verifiedItems[0],
      pricingSnapshot: JSON.stringify({ calculatedAt: '2030-01-01T00:00:01Z', appliedSource: 'promotion:b' }) }] };
    mocks.verifyAndPriceItems.mockResolvedValueOnce(first).mockResolvedValueOnce(changed);
    const response = await POST(request({ items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }) as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
    expect(mocks.verifyAndPriceItems.mock.calls[1][1]).toMatchObject({ db: expect.anything(), allowClientFallback: false });
  });
  it('returns a conflict when a reference-price rule becomes invalid in the transaction', async () => {
    const first = { verifiedSubtotal: 100, mismatchedCount: 0, verifiedItems: [{ productId: 'product-1',
      catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100, quantity: 1, lineTotal: 100, pricingSnapshot: '{}' }] };
    mocks.verifyAndPriceItems.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('REFERENCE_PRICE_PROMOTION_INVALID'));
    const response = await POST(request({ items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }) as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CHECKOUT_PRICE_DRIFT' });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
  it('rejects a no-coupon order when reference-price evidence drifts in the transaction', async () => {
    const priced = {
      verifiedSubtotal: 100, mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100,
        quantity: 1, lineTotal: 100, pricingSnapshot: '{"finalPrice":100}',
        referencePriceApplied: true, referencePriceEligible: true,
        promotionPricingEvidence: { productId: 'product-1', referencePriceEligible: true } as never,
      }],
    };
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    mocks.revalidateReferencePriceEvidence.mockResolvedValue(false);
    const response = await POST(request({
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REFERENCE_PRICE_DRIFT' });
    expect(mocks.revalidateReferencePriceEvidence).toHaveBeenCalledWith(
      expect.anything(), [priced.verifiedItems[0].promotionPricingEvidence], expect.any(Date),
    );
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
  it('replays before price verification without duplicate order or notifications', async () => {
    mocks.orderFindUnique.mockResolvedValue(replayRecord());
    const response = await POST(request(keyedRequest()) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId: 'synthetic-existing', replayed: true });
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.applyOrderPointsDeduction).not.toHaveBeenCalled();
  });
  it.each(['owner', 'intent'])('rejects a keyed %s conflict without pricing or writes', async (kind) => {
    mocks.orderFindUnique.mockResolvedValue(kind === 'owner' ? { ...replayRecord(), customerId: 'other-actor' } : { ...replayRecord(), checkoutRequestFingerprint: 'different-intent' });
    expect((await POST(request(keyedRequest()) as never)).status).toBe(409);
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
  it('rereads a unique-insert winner without sending another notification', async () => {
    mocks.orderFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(replayRecord());
    mocks.orderCreate.mockRejectedValueOnce({ code: 'P2002' });
    const response = await POST(request(keyedRequest()) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId: 'synthetic-existing', replayed: true });
    expect(mocks.orderCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.sendAdminOperationalEmail).not.toHaveBeenCalled();
  });
  it('authenticates before looking up a replay key', async () => {
    const { NextResponse } = await import('next/server');
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));
    expect((await POST(request(keyedRequest()) as never)).status).toBe(401);
    expect(mocks.orderFindUnique).not.toHaveBeenCalled();
  });

  it.each(['bank_transfer', 'rjmart'])('计算合成加购价并验证平台费用 %s', async (paymentMethod) => {
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod, acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotal: 900, total: 650,
        adjustments: { create: expect.arrayContaining([expect.objectContaining({ type: 'promotion_addon', amount: -250 })]) },
      }),
    });
  });

  it('accepts a matching checkout revision', async () => {
    const priced = verifiedPromotion();
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    const checkoutRevision = buildCheckoutRevision({
      items: priced.verifiedItems,
      adjustments: [{ type: 'promotion_addon', amount: -250 }],
      total: 650,
      points: null,
    });
    const response = await POST(request({ items: submittedPromotion(), paymentMethod: 'bank_transfer', checkoutRevision, acceptedLegalIds: ['checkout-terms'] }) as never);
    expect(response.status).toBe(200);
  });

  it('rejects stale or malformed supplied revisions before order creation', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const base = { items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] };
    expect((await POST(request({ ...base, checkoutRevision: '0'.repeat(64) }) as never)).status).toBe(409);
    expect((await POST(request({ ...base, checkoutRevision: '' }) as never)).status).toBe(400);
    expect((await POST(request({ ...base, checkoutRevision: 'invalid' }) as never)).status).toBe(400);
    expect((await POST(request({ ...base, checkoutRevision: 123 }) as never)).status).toBe(400);
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it.each(['shortfall', 'excess', 'wrongSku', 'wrongBrand', 'wrongPrice', 'unknownRule', 'fallback'])('核验合成活动资格并下单 %s', async (kind) => {
    const lines = promotionLines(kind === 'shortfall' ? 5 : 6, kind === 'excess' ? 2 : 1);
    const submitted = submittedPromotion(lines);
    const verified = verifiedPromotion(lines);
    if (kind === 'wrongSku') verified.verifiedItems[1].catalogNumber = 'OTHER';
    if (kind === 'wrongBrand') verified.verifiedItems[0].brand = 'Other';
    if (kind === 'wrongPrice') submitted[1].promoMark!.price = 0;
    if (kind === 'unknownRule') submitted[1].promoMark!.ruleId = 'unknown';
    if (kind === 'fallback') verified.verifiedItems[0].source = 'fallback';
    mocks.verifyAndPriceItems.mockResolvedValue(verified);
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submitted, paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    if (kind === 'shortfall') {
      expect(response.status).toBe(200);
      expect(mocks.orderCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ subtotal: 800, total: 800 }) });
    } else if (kind === 'excess') {
      expect(response.status).toBe(200);
      expect(mocks.orderCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ subtotal: 1200, total: 950 }) });
    } else {
      expect(response.status).toBe(400);
      expect(mocks.orderCreate).not.toHaveBeenCalled();
    }
  });

  it('拒绝非法数量', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('INVALID_QUANTITY'));
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(400);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revalidateReferencePriceEvidence.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', email: 'buyer@example.com', role: 'customer', sessionId: 'session-1' } });
    mocks.requireActiveSession.mockResolvedValue({ id: 'user-1', email: 'buyer@example.com', role: 'customer', sessionId: 'session-1' });
    mocks.userFindUnique.mockResolvedValue({
      email: 'buyer@example.com',
      isBlacklisted: false,
      isFrozen: false,
      approvalStatus: 'approved',
      creditAccount: null,
    });
    mocks.getRequiredLegalConsent.mockResolvedValue({
      requiredIds: ['checkout-terms'],
      snapshot: [{ id: 'checkout-terms', version: '2026-07-01' }],
    });
    mocks.validateAcceptedLegalIds.mockReturnValue({ ok: true });
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 100,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1',
        name: '测试产品',
        unitPrice: 100,
        clientPrice: undefined,
        quantity: 1,
        lineTotal: 100,
        pricingSnapshot: '{"finalPrice":100}',
      }],
    });
    mocks.orderFindFirst.mockResolvedValue(null);
    mocks.orderFindUnique.mockResolvedValue(null);
    mocks.orderCreate.mockResolvedValue({ id: 'ORD-20260723-001' });
    mocks.notificationCreate.mockResolvedValue({});
    mocks.notificationFindMany.mockResolvedValue([]);
    mocks.sendAdminOperationalEmail.mockResolvedValue(undefined);
    mocks.previewPointsRedeem.mockResolvedValue({
      ok: true,
      breakdown: {
        personalPoints: 10,
        groupPoints: 0,
        groupId: null,
        pointsDiscount: 10,
        payableBeforePoints: 100,
        payableAfterPoints: 90,
      },
    });
    mocks.applyOrderPointsDeduction.mockResolvedValue({ ok: true });
  });

  it('uses public fee-free defaults for third-party platform orders', async () => {
    const response = await POST(request({
      paymentMethod: 'rjmart',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subtotal: 100,
        adjustmentTotal: 0,
        total: 100,
        status: 'pending',
        paymentMethod: 'rjmart',
      }),
    });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: '新订单 ORD-20260723-001，金额 ¥100',
      }),
    });
  });

  it('rejects frozen accounts before pricing', async () => {
    mocks.userFindUnique.mockResolvedValue({
      email: 'buyer@example.com',
      isBlacklisted: false,
      isFrozen: true,
      approvalStatus: 'approved',
      creditAccount: null,
    });

    const response = await POST(request({
      paymentMethod: 'alipay',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('冻结');
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it('reserves points when an Alipay order is created', async () => {
    const response = await POST(request({
      paymentMethod: 'alipay',
      acceptedLegalIds: ['checkout-terms'],
      personalPoints: 10,
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'unpaid',
        paymentMethod: 'alipay',
      }),
    });
    expect(mocks.previewPointsRedeem).toHaveBeenCalledTimes(2);
    expect(mocks.applyOrderPointsDeduction).toHaveBeenCalledWith(expect.anything(), 'ORD-20260723-001');
  });

  it('rejects insufficient variant stock with 400 and does not create the order', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 200,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1-V',
        name: '测试产品',
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200,
        variantId: 'variant-1',
        stockQuantity: 1,
        available: true,
        pricingSnapshot: '{"finalPrice":100}',
        source: 'db',
        priceMismatch: false,
      }],
    });

    const response = await POST(request({
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', variantId: 'variant-1', catalogNumber: 'CAT-1-V', name: '测试产品', price: 100, quantity: 2 }],
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: '所选规格库存不足',
      code: 'VARIANT_INSUFFICIENT_STOCK',
      catalogNumber: 'CAT-1-V',
    });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it('keeps product-level stock rejection on the existing conflict response', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 100,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1',
        name: '测试产品',
        unitPrice: 100,
        quantity: 1,
        lineTotal: 100,
        stockQuantity: 0,
        available: true,
        pricingSnapshot: '{"finalPrice":100}',
        source: 'db',
        priceMismatch: false,
      }],
    });

    const response = await POST(request({
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: '库存不足，请刷新购物车后重试',
      code: 'INSUFFICIENT_STOCK',
    });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
});
