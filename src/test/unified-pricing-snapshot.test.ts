import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ephemeral-store', () => ({ getEphemeralStore: () => ({ increment: async () => 1 }) }));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as cartPromotionService from '@/lib/cart-promotions/service';
import { POST as cartPreviewPost } from '@/app/api/promotions/cart/route';
import { GET as addonProductsGet } from '@/app/api/cart-promotions/addon-products/route';
import { NextRequest } from 'next/server';
import { prisma as appPrisma } from '@/lib/prisma';
import { legacyRuleVersionHash } from '@/lib/legacy-rule-version';
import { CART_ADDON_RULES, PROMOTION_RULES } from '@/lib/cart-promotions/rules';
import { createUnifiedPricingSnapshot as snapshotService, resolveUnifiedPricingIdentities as identityService,
  type UnifiedPricingClient, type UnifiedPricingRequestLine } from '@/lib/unified-pricing-snapshot';

const rule = JSON.stringify({ schemaVersion: 1, template: 'direct-price', groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }], benefit: { kind: 'percentage', basisPoints: 5000 }, repeat: false, partialBenefit: false, maxApplications: null });
type TestPromotion = { id: string; name: string; type: string; value: number; status: string; startsAt: Date; endsAt: Date; ruleVersion: number; priority: number; exclusive: boolean; ruleDefinition: string | null; products: Array<{ id: string; productId: string; variantId: string | null; groupKey: string }> };
type TestProduct = { id: string; catalogNumber: string; name: string; price: number; originalPrice: number | null; promotionalPrice: number | null; minimumSalePrice: number | null; pricingMode: string; brand: string; subBrand: string | null; category: string | null; subcategory: string | null; deletedAt: Date | null; hazardous: boolean; inStock: boolean; stockQuantity: number; leadTime: string | null; promotionLinks: Array<{ id: string; promotionId: string; productId: string; variantId: string | null; groupKey: string }>; variants: Array<{ id: string; productId: string; catalogNumber: string; spec: string; price: number; originalPrice: number | null; promotionalPrice: number | null; minimumSalePrice: number | null; inventoryAccounts: Array<{ availableQuantity: number }> }> };
function client() {
  const promotion: TestPromotion = { id: 'sale', name: 'Half price', type: 'discount_rate', value: 0.5, status: 'active', startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z'), ruleVersion: 3, priority: 1, exclusive: true, ruleDefinition: rule, products: [{ id: 'binding-sale', productId: 'p1', variantId: null, groupKey: 'benefit' }] };
  const product: TestProduct = { id: 'p1', catalogNumber: 'P-1', name: 'Product One', price: 10, originalPrice: 20, promotionalPrice: null, minimumSalePrice: null, pricingMode: 'fixed', brand: 'Acme', subBrand: null, category: 'reagents', subcategory: 'buffers', deletedAt: null, hazardous: false, inStock: true, stockQuantity: 9, leadTime: 'in stock', promotionLinks: [{ id: 'link-sale', promotionId: 'sale', productId: 'p1', variantId: null, groupKey: 'benefit' }], variants: [
    { id: 'v1', productId: 'p1', catalogNumber: 'V-1', spec: '10 ml', price: 7, originalPrice: null, promotionalPrice: null, minimumSalePrice: null, inventoryAccounts: [{ availableQuantity: 4 }] },
    { id: 'v2', productId: 'p1', catalogNumber: 'V-2', spec: '20 ml', price: 9, originalPrice: null, promotionalPrice: null, minimumSalePrice: null, inventoryAccounts: [{ availableQuantity: 2 }] },
  ] };
  return {
    product: { findMany: vi.fn(async (args: unknown) => { void args; return [product]; }) },
    user: { findUnique: vi.fn(async (args: unknown) => { void args; return null; }) },
    promotion: { findMany: vi.fn(async (args: unknown) => { void args; return [promotion]; }) },
  };
}
type MockClient = ReturnType<typeof client>;
function snapshot(db: MockClient, request: Parameters<typeof snapshotService>[1]) {
  return snapshotService(db as unknown as UnifiedPricingClient, request);
}
function resolveIdentities(db: MockClient, request: { lines: UnifiedPricingRequestLine[] }) {
  return identityService(db as unknown as UnifiedPricingClient, request);
}

function createSyntheticPrisma() {
  const directory = mkdtempSync(join(tmpdir(), 'unified-pricing-prisma-'));
  const databasePath = join(directory, 'synthetic.sqlite');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE Product (
      id TEXT PRIMARY KEY, catalogNumber TEXT NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL, price REAL NOT NULL,
      pricingMode TEXT NOT NULL DEFAULT 'fixed', originalPrice REAL, category TEXT, subcategory TEXT, spec TEXT, salesUnit TEXT, imageUrl TEXT, inStock BOOLEAN NOT NULL DEFAULT 1,
      promotionalPrice REAL, promotion BOOLEAN NOT NULL DEFAULT 0, costPrice REAL, minimumSalePrice REAL, subBrand TEXT, leadTime TEXT,
      hazardous BOOLEAN NOT NULL DEFAULT 0, stockQuantity INTEGER NOT NULL DEFAULT -1, deletedAt DATETIME
    );
    CREATE TABLE ProductVariant (
      id TEXT PRIMARY KEY, productId TEXT NOT NULL, catalogNumber TEXT NOT NULL, spec TEXT NOT NULL, price REAL NOT NULL,
      originalPrice REAL, promotionalPrice REAL, costPrice REAL, minimumSalePrice REAL,
      FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE CASCADE
    );
    CREATE TABLE Promotion (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, value REAL NOT NULL, ruleDefinition TEXT, ruleVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft', startsAt DATETIME NOT NULL, endsAt DATETIME NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
      exclusive BOOLEAN NOT NULL DEFAULT 1, createdBy TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE PromotionProduct (
      id TEXT PRIMARY KEY, promotionId TEXT NOT NULL, productId TEXT NOT NULL, variantId TEXT, groupKey TEXT NOT NULL DEFAULT 'main',
      FOREIGN KEY (promotionId) REFERENCES Promotion(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE CASCADE,
      FOREIGN KEY (variantId) REFERENCES ProductVariant(id) ON DELETE CASCADE
    );
    CREATE TABLE PromotionCatalogSelection (promotionId TEXT PRIMARY KEY, selectorsJson TEXT NOT NULL, frozenJson TEXT);
    CREATE TABLE InventoryAccount (
      id TEXT PRIMARY KEY, productId TEXT NOT NULL, variantId TEXT, availableQuantity INTEGER NOT NULL DEFAULT -1,
      FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE CASCADE,
      FOREIGN KEY (variantId) REFERENCES ProductVariant(id) ON DELETE CASCADE
    );
    CREATE TABLE User (
      id TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'standard', discountRate REAL, brandDiscounts TEXT, isFrozen BOOLEAN NOT NULL DEFAULT 0
    );
  `);
  db.close();
  const adapter = new PrismaBetterSqlite3({ url: `file:${databasePath}` });
  const prisma = new PrismaClient({ adapter });
  return { prisma, databasePath, cleanup: async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

function seedSyntheticProduct(dbPath: string, product: { id: string; catalogNumber: string; price: number; originalPrice: number | null; promotionalPrice?: number | null; minimumSalePrice?: number | null; hazardous?: boolean; variants?: Array<{ id: string; catalogNumber: string; price: number; originalPrice: number | null; availableQuantity?: number }> }) {
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO Product (id,catalogNumber,name,brand,price,pricingMode,originalPrice,promotionalPrice,minimumSalePrice,category,subcategory,inStock,stockQuantity,leadTime,hazardous)
    VALUES (@id,@catalogNumber,@name,@brand,@price,'fixed',@originalPrice,@promotionalPrice,@minimumSalePrice,'reagents','buffers',1,8,'in stock',@hazardous)`).run({
    id: product.id, catalogNumber: product.catalogNumber, name: `Name ${product.id}`, brand: 'Synthetic Brand', price: product.price,
    originalPrice: product.originalPrice, promotionalPrice: product.promotionalPrice ?? null, minimumSalePrice: product.minimumSalePrice ?? null,
    hazardous: product.hazardous ? 1 : 0,
  });
  const insertVariant = db.prepare('INSERT INTO ProductVariant (id,productId,catalogNumber,spec,price,originalPrice) VALUES (?,?,?,?,?,?)');
  const insertInventory = db.prepare('INSERT INTO InventoryAccount (id,productId,variantId,availableQuantity) VALUES (?,?,?,?)');
  for (const variant of product.variants ?? []) {
    insertVariant.run(variant.id, product.id, variant.catalogNumber, `Spec ${variant.id}`, variant.price, variant.originalPrice);
    insertInventory.run(`inventory-${variant.id}`, product.id, variant.id, variant.availableQuantity ?? 4);
  }
  db.close();
}

function seedSyntheticPromotion(dbPath: string, promotion: { id: string; type: string; value: number; ruleDefinition: string | null; bindings: Array<{ productId: string; variantId: string | null; groupKey: string }> }) {
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO Promotion (id,name,type,value,ruleDefinition,ruleVersion,status,startsAt,endsAt,priority,exclusive)
    VALUES (?, ?, ?, ?, ?, 1, 'active', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 1, 1)`)
    .run(promotion.id, `Promotion ${promotion.id}`, promotion.type, promotion.value, promotion.ruleDefinition);
  const insertBinding = db.prepare('INSERT INTO PromotionProduct (id,promotionId,productId,variantId,groupKey) VALUES (?,?,?,?,?)');
  promotion.bindings.forEach((binding, index) => insertBinding.run(`${promotion.id}-binding-${index}`, promotion.id, binding.productId, binding.variantId, binding.groupKey));
  db.close();
}

describe('real Prisma static and database promotion integration', () => {
  it('compares a multi-option activity and a database activity in one plan', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { id: 'static-options', type: 'addon' as const, name: 'Options', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 1, addonTerms: ['OPT'],
      addonOptions: [{ catalogNumber: 'OPT-A', price: 3, quantity: 2 }, { catalogNumber: 'OPT-B', price: 4, quantity: 1 }] };
    PROMOTION_RULES.push(staticRule);
    try {
      for (const [id, catalogNumber, price] of [['m1','MAIN-1',10], ['m2','MAIN-2',10], ['a','OPT-A',3], ['b','OPT-B',6], ['d','DB-1',10]] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price, originalPrice: price });
      }
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'd', variantId: null, groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'm1', quantity: 1 }, { productId: 'm2', quantity: 1 },
        { productId: 'a', quantity: 2, promoMark: { ruleId: 'static-options', choice: 'OPT-A', price: 3 } },
        { productId: 'b', quantity: 1, promoMark: { ruleId: 'static-options', choice: 'OPT-B', price: 4 } },
        { productId: 'd', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(3200);
      expect(result.pricing.lines.find((line) => line.productId === 'd')?.promotionId).toBe('db-sale');
      expect(result.pricing.lines.find((line) => line.productId === 'a')?.promotionId).toBe('legacy-cart:static-options');
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('allocates shared selection quota to separate qualifying SKUs alongside a DB promotion', async () => {
    const synthetic = createSyntheticPrisma();
    const common = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 1, addonTerms: ['OPT'], sharedQuotaGroup: 'shared' };
    const first = { ...common, id: 'shared-a', name: 'A', addonOptions: [{ catalogNumber: 'OPT-A', price: 3, quantity: 2 }] };
    const second = { ...common, id: 'shared-b', name: 'B', addonOptions: [{ catalogNumber: 'OPT-B', price: 4, quantity: 1 }] };
    PROMOTION_RULES.push(first, second);
    try {
      for (const [id, catalogNumber, price] of [['m1','MAIN-1',10], ['m2','MAIN-2',10], ['a','OPT-A',3], ['b','OPT-B',6], ['d','DB-1',10]] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price, originalPrice: price });
      }
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'd', variantId: null, groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'm1', quantity: 1 }, { productId: 'm2', quantity: 1 },
        { productId: 'a', quantity: 2, promoMark: { ruleId: 'shared-a', choice: 'OPT-A', price: 3 } },
        { productId: 'b', quantity: 1, promoMark: { ruleId: 'shared-b', choice: 'OPT-B', price: 4 } },
        { productId: 'd', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(3200);
      expect(result.pricing.lines.find((line) => line.productId === 'a')?.promotionId).toBe('legacy-cart:shared-a');
      expect(result.pricing.lines.find((line) => line.productId === 'b')?.promotionId).toBe('legacy-cart:shared-b');
      expect(result.evidence.legacyCartCandidates.some((candidate) => candidate.sharedQuota?.qualifiers.length)).toBe(true);
      const originalBuilder = cartPromotionService.buildUnifiedLegacyPromotionCandidates;
      const witnessChange = vi.spyOn(cartPromotionService, 'buildUnifiedLegacyPromotionCandidates').mockImplementation((...args) => {
        const computed = originalBuilder(...args);
        return { ...computed, candidates: computed.candidates.map((candidate) => candidate.sharedQuota
          ? { ...candidate, sharedQuota: { ...candidate.sharedQuota, scope: { ...candidate.sharedQuota.scope,
            maxAddonsPerTrigger: candidate.sharedQuota.scope.maxAddonsPerTrigger + 1 } } } : candidate) };
      });
      try {
        const changed = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
          { productId: 'm1', quantity: 1 }, { productId: 'm2', quantity: 1 },
          { productId: 'a', quantity: 2, promoMark: { ruleId: 'shared-a', choice: 'OPT-A', price: 3 } },
          { productId: 'b', quantity: 1, promoMark: { ruleId: 'shared-b', choice: 'OPT-B', price: 4 } },
          { productId: 'd', quantity: 1 },
        ] }));
        expect(changed.pricing.totalCents).toBe(result.pricing.totalCents);
        expect(changed.evidenceHash).not.toBe(result.evidenceHash);
      } finally { witnessChange.mockRestore(); }
      for (const mutation of ['unknown', 'excess'] as const) {
        const altered = vi.spyOn(cartPromotionService, 'buildUnifiedLegacyPromotionCandidates').mockImplementation((...args) => {
          const computed = originalBuilder(...args);
          return { ...computed, candidates: computed.candidates.map((candidate) => {
            if (!candidate.sharedQuota?.qualifiers.length) return candidate;
            const qualifiers = candidate.sharedQuota.qualifiers.map((entry, index) => index ? entry : mutation === 'unknown'
              ? { ...entry, sourceLineId: 'unknown-source' } : { ...entry, quantity: entry.quantity + 100 });
            return { ...candidate, sharedQuota: { ...candidate.sharedQuota, qualifiers } };
          }) };
        });
        try {
          await expect(synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
            { productId: 'm1', quantity: 1 }, { productId: 'm2', quantity: 1 },
            { productId: 'a', quantity: 2, promoMark: { ruleId: 'shared-a', choice: 'OPT-A', price: 3 } },
            { productId: 'b', quantity: 1, promoMark: { ruleId: 'shared-b', choice: 'OPT-B', price: 4 } },
            { productId: 'd', quantity: 1 },
          ] }))).rejects.toThrow('INVALID_PROMOTION_CANDIDATE');
        } finally { altered.mockRestore(); }
      }

    } finally { PROMOTION_RULES.pop(); PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('counts an unselected explicit mark when another shared activity is automatic', async () => {
    const synthetic = createSyntheticPrisma();
    const common = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      eligibleTerms: ['MAIN'], minQuantity: 1, sharedQuotaGroup: 'same', maxAddonsPerTrigger: 1 };
    const first = { ...common, id: 'marked-a', name: 'A', addonPrice: 3, addonTerms: ['OPT-A'] };
    const second = { ...common, id: 'auto-b', name: 'B', addonPrice: 2, addonTerms: ['OPT-B'] };
    PROMOTION_RULES.push(first, second);
    try {
      for (const [id, catalogNumber, price] of [['m','MAIN-1',10], ['a','OPT-A',3], ['b','OPT-B',6]] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price, originalPrice: price });
      }
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'm', quantity: 1 }, { productId: 'a', quantity: 1, promoMark: { ruleId: 'marked-a', price: 3 } },
        { productId: 'b', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(1900);
      expect(result.pricing.lines.every((line) => line.promotionId == null)).toBe(true);
    } finally { PROMOTION_RULES.pop(); PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('binds the qualifying and automatic portions of one source line to their actual quantities', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      eligibleTerms: ['DUAL'], minQuantity: 1, sharedQuotaGroup: 'split', maxAddonsPerTrigger: 1,
      id: 'split-auto', name: 'Split', addonPrice: 1, addonTerms: ['DUAL'] };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'DUAL', price: 10, originalPrice: 10 });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [{ productId: 'p', quantity: 2 }] }));
      expect(result.pricing.totalCents).toBe(1100);
      const witness = result.evidence.legacyCartCandidates.find((candidate) => candidate.sharedQuota)?.sharedQuota;
      if (!witness) throw new Error('Missing shared quota witness');
      expect(witness.qualifiers[0]).toMatchObject({ sourceLineId: '0', quantity: 1 });
      expect(witness.selections[0]).toMatchObject({ sourceLineId: '0', quantity: 1 });
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('enumerates gift quantities per source line to find the least expensive legal plan', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { type: 'gift' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      eligibleTerms: ['P'], minQuantity: 1, giftTerms: ['P'], specGifts: [{ spec: 'P', minQuantity: 3, giftQuantity: 1 }],
      id: 'gift-exact', name: 'Exact gift' };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 1, originalPrice: 1 });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'p', quantity: 3 }, { productId: 'p', quantity: 5 },
      ] }));
      expect(result.pricing.totalCents).toBe(600);
      const bands = result.pricing.lines[0].priceBands!;
      expect(bands.find((band) => band.sourceLineId === '1' && band.unitCents === 0)?.quantity).toBe(2);
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('chooses partial automatic addon quantities across a shared quota', async () => {
    const synthetic = createSyntheticPrisma();
    const common = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      minQuantity: 1, sharedQuotaGroup: 'allocation', maxAddonsPerTrigger: 1 };
    const first = { ...common, id: 'small', name: 'Small', eligibleTerms: ['X'], addonPrice: 9, addonTerms: ['OPT-A'] };
    const second = { ...common, id: 'large', name: 'Large', eligibleTerms: ['Y'], addonPrice: 1, addonTerms: ['OPT-B'] };
    PROMOTION_RULES.push(first, second);
    try {
      for (const [id, catalogNumber] of [['x','X-1'], ['y','Y-1'], ['a','OPT-A'], ['b','OPT-B']] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price: 10, originalPrice: 10 });
      }
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'x', quantity: 3 }, { productId: 'y', quantity: 3 },
        { productId: 'a', quantity: 3 }, { productId: 'b', quantity: 2 },
      ] }));
      expect(result.pricing.totalCents).toBe(9100);
      expect(result.pricing.lines.filter((line) => line.promotionId?.startsWith('legacy-cart:'))).toHaveLength(2);
    } finally { PROMOTION_RULES.pop(); PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('checks mixed shared item and selection modes', async () => {
    const synthetic = createSyntheticPrisma();
    const common = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      eligibleTerms: ['MAIN'], minQuantity: 1, sharedQuotaGroup: 'mixed', maxAddonsPerTrigger: 1 };
    const first = { ...common, id: 'pack', name: 'Pack', addonPrice: 3, addonTerms: ['OPT-A'],
      addonOptions: [{ catalogNumber: 'OPT-A', price: 3, quantity: 2 }] };
    const second = { ...common, id: 'item', name: 'Item', addonPrice: 2, addonTerms: ['OPT-B'] };
    PROMOTION_RULES.push(first, second);
    try {
      for (const [id, catalogNumber, price] of [['m1','MAIN-1',10], ['m2','MAIN-2',10], ['a','OPT-A',3], ['b','OPT-B',6]] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price, originalPrice: price });
      }
      const request = { now: new Date('2026-06-01'), lines: [
        { productId: 'm1', quantity: 1 }, { productId: 'm2', quantity: 1 },
        { productId: 'a', quantity: 2, promoMark: { ruleId: 'pack', choice: 'OPT-A', price: 3 } }, { productId: 'b', quantity: 1 },
      ] };
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, request));
      expect(result.pricing.totalCents).toBe(2900);
    } finally { PROMOTION_RULES.pop(); PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('checks different shared scopes against actual selected automatic quantities', async () => {
    const synthetic = createSyntheticPrisma();
    const common = { type: 'addon' as const, enabled: true, description: '', eligibleBrand: 'Synthetic Brand',
      minQuantity: 1, sharedQuotaGroup: 'different', maxAddonsPerTrigger: 1 };
    const first = { ...common, id: 'x-auto', name: 'X', eligibleTerms: ['X'], addonPrice: 1, addonTerms: ['OPT-A'] };
    const second = { ...common, id: 'y-auto', name: 'Y', eligibleTerms: ['Y'], addonPrice: 2, addonTerms: ['OPT-B'] };
    PROMOTION_RULES.push(first, second);
    try {
      for (const [id, catalogNumber, price] of [['x','X-1',10], ['y','Y-1',10], ['a','OPT-A',5], ['b','OPT-B',6], ['d','DB-1',10]] as const) {
        seedSyntheticProduct(synthetic.databasePath, { id, catalogNumber, price, originalPrice: price });
      }
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'd', variantId: null, groupKey: 'benefit' }] });
      const request = { now: new Date('2026-06-01'), lines: [
        { productId: 'x', quantity: 1 }, { productId: 'y', quantity: 1 }, { productId: 'a', quantity: 1 },
        { productId: 'b', quantity: 1 }, { productId: 'd', quantity: 1 },
      ] };
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, request));
      expect(result.pricing.totalCents).toBe(3200);
      expect(result.pricing.lines.filter((line) => line.promotionId?.startsWith('legacy-cart:'))).toHaveLength(1);
    } finally { PROMOTION_RULES.pop(); PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('keeps member-priced and marked base-price rows distinct for the same SKU', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { id: 'unqualified', type: 'addon' as const, name: 'Unqualified', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['P'], minQuantity: 3, addonPrice: 50, addonTerms: ['P'] };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100 });
      const db = new Database(synthetic.databasePath);
      db.prepare("INSERT INTO User (id, tier, discountRate, isFrozen) VALUES ('u', 'standard', 0.8, 0)").run(); db.close();
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), userId: 'u', lines: [
        { productId: 'p', quantity: 1 }, { productId: 'p', quantity: 1, promoMark: { ruleId: 'unqualified', price: 50 } },
      ] }));
      expect(result.pricing.totalCents).toBe(18000);
      expect(result.evidence.ordinaryUnitPricesCents).toEqual([8000, 10000]);
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('uses marked base price for an addon while the same SKU ordinary row uses a promotional price', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { id: 'marked-addon', type: 'addon' as const, name: 'Addon', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['P'], minQuantity: 1, addonPrice: 50, addonTerms: ['P'] };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100, promotionalPrice: 20 });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'p', quantity: 1 }, { productId: 'p', quantity: 1, promoMark: { ruleId: 'marked-addon', price: 50 } },
      ] }));
      expect(result.pricing.totalCents).toBe(7000);
      expect(result.evidence.ordinaryUnitPricesCents).toEqual([2000, 10000]);
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('retains the ordinary minimum guard while an authorized marked gift is free', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { id: 'marked-gift', type: 'gift' as const, name: 'Gift', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['P'], minQuantity: 1, giftTerms: ['P'] };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100, promotionalPrice: 20, minimumSalePrice: 90 });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'p', quantity: 1 }, { productId: 'p', quantity: 1, promoMark: { ruleId: 'marked-gift', price: 0 } },
      ] }));
      expect(result.pricing.totalCents).toBe(9000);
      expect(result.evidence.ordinaryUnitPricesCents).toEqual([9000, 10000]);
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('still prices a missing ordinary sale when a second noncatalog campaign cannot price it', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 0, originalPrice: 100 });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } });
      const binding = [{ productId: 'p', variantId: null, groupKey: 'benefit' }];
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog', type: 'discount_rate', value: 0.6, ruleDefinition: catalogRule, bindings: binding });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'ordinary', type: 'discount_rate', value: 0.8, ruleDefinition: rule, bindings: binding });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [{ productId: 'p', quantity: 1 }] }));
      expect(result.pricing.totalCents).toBe(6000);
      expect(result.pricing.lines[0].promotionId).toBe('catalog');
    } finally { await synthetic.cleanup(); }
  });

  it('chooses a DB direct price for one SKU while a static rule wins another', async () => {
    const synthetic = createSyntheticPrisma();
    const staticRule = { id: 'static-b', type: 'fixed-price' as const, name: 'B', enabled: true, description: '',
      terms: ['B'], priceByTerm: [{ term: 'B', price: 10 }] };
    PROMOTION_RULES.push(staticRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'a', catalogNumber: 'A', price: 100, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'b', catalogNumber: 'B', price: 100, originalPrice: 100 });
      const direct = JSON.stringify({ ...JSON.parse(rule), repeat: true, benefit: { kind: 'percentage', basisPoints: 8000 } });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-both', type: 'discount_rate', value: 0.8, ruleDefinition: direct,
        bindings: [{ productId: 'a', variantId: null, groupKey: 'benefit' }, { productId: 'b', variantId: null, groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(9000);
      expect(result.pricing.lines.find((line) => line.productId === 'a')?.promotionId).toBe('db-both');
      expect(result.pricing.lines.find((line) => line.productId === 'b')?.promotionId).toBe('legacy-cart:static-b');
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('allocates a bundle target across source minimums without losing a valid lower total', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'a', catalogNumber: 'A', price: 100, originalPrice: 100, minimumSalePrice: 90 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'b', catalogNumber: 'B', price: 100, originalPrice: 100 });
      const bundle = JSON.stringify({ schemaVersion: 1, template: 'bundle', repeat: false, maxApplications: null, partialBenefit: false,
        groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: 'each', quantity: 2 }], benefit: { kind: 'group-price', groupPriceCents: 10000 } });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'bundle', type: 'discount_rate', value: 0.5, ruleDefinition: bundle,
        bindings: [{ productId: 'a', variantId: null, groupKey: 'main' }, { productId: 'b', variantId: null, groupKey: 'main' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(10000);
      const aTotal = result.pricing.lines.find((line) => line.productId === 'a')!.totalAfterCents;
      const bTotal = result.pricing.lines.find((line) => line.productId === 'b')!.totalAfterCents;
      expect(aTotal).toBeGreaterThanOrEqual(9000);
      expect(aTotal + bTotal).toBe(10000);
    } finally { await synthetic.cleanup(); }
  });

  it('preserves source quantities and cents when redistributing a group target above minimums', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'a', catalogNumber: 'A', price: 100, originalPrice: 100, minimumSalePrice: 90.01 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'b', catalogNumber: 'B', price: 100, originalPrice: 100 });
      const bundle = JSON.stringify({ schemaVersion: 1, template: 'bundle', repeat: false, maxApplications: null, partialBenefit: false,
        groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: 'each', quantity: 3 }], benefit: { kind: 'group-price', groupPriceCents: 20001 } });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'bundle-cents', type: 'discount_rate', value: 0.5, ruleDefinition: bundle,
        bindings: [{ productId: 'a', variantId: null, groupKey: 'main' }, { productId: 'b', variantId: null, groupKey: 'main' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'a', quantity: 2 }, { productId: 'b', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(20001);
      const aBands = result.pricing.lines.find((line) => line.productId === 'a')!.priceBands!;
      const bBands = result.pricing.lines.find((line) => line.productId === 'b')!.priceBands!;
      expect(aBands.every((band) => band.sourceLineId === '0' && band.unitCents >= 9001)).toBe(true);
      expect(bBands.every((band) => band.sourceLineId === '1' && band.unitCents >= 0)).toBe(true);
      expect(aBands.reduce((sum, band) => sum + band.quantity, 0)).toBe(2);
      expect(bBands.reduce((sum, band) => sum + band.quantity, 0)).toBe(1);
      expect([...aBands, ...bBands].reduce((sum, band) => sum + band.unitCents * band.quantity, 0)).toBe(20001);
    } finally { await synthetic.cleanup(); }
  });

  it('qualifies a same-SKU gift across two distinct source rows', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100 });
      const sameSkuGift = JSON.stringify({ schemaVersion: 1, template: 'same-sku-gift', freeQuantity: 1, repeat: false,
        maxApplications: null, partialBenefit: false, groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: 'each', quantity: 2 }],
        benefit: { kind: 'gift' } });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'same-sku', type: 'discount_rate', value: 0.5, ruleDefinition: sameSkuGift,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'main' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'p', quantity: 1 }, { productId: 'p', quantity: 1 },
      ] }));
      expect(result.pricing.totalCents).toBe(10000);
      expect(result.pricing.lines[0].promotionId).toBe('same-sku');
    } finally { await synthetic.cleanup(); }
  });

  it('accepts an exclusive activity binding products that are not all in the cart', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'q', catalogNumber: 'Q', price: 100, originalPrice: 100 });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'benefit' }, { productId: 'q', variantId: null, groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [{ productId: 'p', quantity: 1 }] }));
      expect(result.pricing.totalCents).toBe(5000);
      expect(result.pricing.lines[0].promotionId).toBe('db-sale');
    } finally { await synthetic.cleanup(); }
  });

  it('uses trusted checkout pricing and classifies unpriced cart sources through the real cart API', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'a', catalogNumber: 'A', price: 100, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 0, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'q', catalogNumber: 'Q', price: 0, originalPrice: null });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog' });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog', type: 'discount_rate', value: 0.5, ruleDefinition: catalogRule,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'benefit' }] });
      const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'a', quantity: 1, price: 1 }, { productId: 'p', quantity: 1, price: 1 }, { productId: 'q', quantity: 1, price: 1 }]) }) as never,
        { client: synthetic.prisma, userId: async () => null });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.lineTotals).toEqual([10000, 5000, null]);
      expect(data.total).toBe(15000);
      expect(data.lineBands[1]).toEqual([{ quantity: 1, unitPriceCents: 5000 }]);
      expect(data.statuses[0].id).toBe('activity-0');
      expect(data).not.toHaveProperty('evidence');
    } finally { await synthetic.cleanup(); }
  });

  it('fails closed for a published catalog SKU in legacy mode without blocking an unbound variant', async () => {
    const synthetic = createSyntheticPrisma(); const oldPath = process.env.DATABASE_PATH; const oldFlag = process.env.PROMOTION_FOUNDATION_ENABLED;
    try {
      process.env.DATABASE_PATH = synthetic.databasePath; delete process.env.PROMOTION_FOUNDATION_ENABLED;
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100,
        variants: [{ id: 'v1', catalogNumber: 'P-V1', price: 100, originalPrice: 100 }, { id: 'v2', catalogNumber: 'P-V2', price: 100, originalPrice: 100 }] });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog' });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'published', type: 'discount_rate', value: 0.5, ruleDefinition: catalogRule,
        bindings: [{ productId: 'p', variantId: 'v1', groupKey: 'benefit' }] });
      const request = (variantId: string) => new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', variantId, quantity: 1 }]) }) as never;
      const blocked = await cartPreviewPost(request('v1'));
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toMatchObject({ code: 'PROMOTION_UNIFIED_RUNTIME_REQUIRED' });
      const marked = (variantId: string) => new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', variantId, quantity: 1, promoMark: { ruleId: 'addon', price: 50 } }]) }) as never;
      expect((await cartPreviewPost(marked('v1'))).status).toBe(503);
      expect((await cartPreviewPost(marked('v2'))).status).toBe(200);
      const unaffected = await cartPreviewPost(request('v2'));
      expect(unaffected.status).toBe(200);
      expect(await unaffected.json()).toEqual({ enabled: false });
    } finally {
      if (oldPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = oldPath;
      if (oldFlag === undefined) delete process.env.PROMOTION_FOUNDATION_ENABLED; else process.env.PROMOTION_FOUNDATION_ENABLED = oldFlag;
      await synthetic.cleanup();
    }
  });

  it('uses the real production cart handler only when all four gates are enabled', async () => {
    const synthetic = createSyntheticPrisma(); const oldPath = process.env.DATABASE_PATH;
    const flags = ['PROMOTION_UNIFIED_ENABLED', 'PROMOTION_FOUNDATION_ENABLED', 'PROMOTION_CREATE_IDEMPOTENCY_ENABLED', 'PROMOTION_VERSION_CHECK_ENABLED'] as const;
    const oldFlags = flags.map((name) => process.env[name]);
    const transaction = vi.spyOn(appPrisma, '$transaction').mockImplementation((async (action: unknown) => synthetic.prisma.$transaction(action as never)) as never);
    try {
      process.env.DATABASE_PATH = synthetic.databasePath;
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 200 });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog' });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog', type: 'discount_rate', value: 0.5, ruleDefinition: catalogRule,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'benefit' }] });
      for (const flag of flags) process.env[flag] = 'true';
      const request = () => new Request('https://example.test/api/promotions/cart', { method: 'POST', body: JSON.stringify([{ productId: 'p', quantity: 1, price: 0.01 }]) }) as never;
      process.env.PROMOTION_VERSION_CHECK_ENABLED = 'false';
      expect((await cartPreviewPost(request())).status).toBe(503);
      expect(transaction).not.toHaveBeenCalled();
      process.env.PROMOTION_VERSION_CHECK_ENABLED = 'true';
      const response = await cartPreviewPost(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ unified: true, lineTotals: [10000], total: 10000 });
      expect(transaction).toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
      if (oldPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = oldPath;
      flags.forEach((flag, index) => { if (oldFlags[index] === undefined) delete process.env[flag]; else process.env[flag] = oldFlags[index]; });
      await synthetic.cleanup();
    }
  });

  it('classifies an unpriced multi-SKU bundle only after all groups qualify', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 0, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'q', catalogNumber: 'Q', price: 0, originalPrice: 100 });
      const bundle = JSON.stringify({ schemaVersion: 1, template: 'bundle', repeat: false, maxApplications: null, partialBenefit: false,
        priceBasis: 'catalog', groups: [{ key: 'a', role: 'qualifier-and-benefit', unit: 'each', quantity: 1 },
          { key: 'b', role: 'qualifier-and-benefit', unit: 'each', quantity: 1 }], benefit: { kind: 'percentage', basisPoints: 5000 } });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog-bundle', type: 'discount_rate', value: 0.5, ruleDefinition: bundle,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'a' }, { productId: 'q', variantId: null, groupKey: 'b' }] });
      const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', quantity: 1 }, { productId: 'q', quantity: 1 }]) }) as never,
        { client: synthetic.prisma, userId: async () => null });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ lineTotals: [5000, 5000], total: 10000 });
    } finally { await synthetic.cleanup(); }
  });

  it('returns a conflict instead of guessing between incomparable covered inquiry items', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 0, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'q', catalogNumber: 'Q', price: 0, originalPrice: 100 });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog' });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'one-only', type: 'discount_rate', value: 0.5, ruleDefinition: catalogRule,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'benefit' }, { productId: 'q', variantId: null, groupKey: 'benefit' }] });
      const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', quantity: 1 }, { productId: 'q', quantity: 1 }]) }) as never,
        { client: synthetic.prisma, userId: async () => null });
      expect(response.status).toBe(409);
    } finally { await synthetic.cleanup(); }
  });

  it('uses the signed-in member and the variant price, not a client-provided price', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100,
        variants: [{ id: 'v', catalogNumber: 'P-V', price: 50, originalPrice: 50 }] });
      const db = new Database(synthetic.databasePath); db.prepare("INSERT INTO User (id,tier,discountRate,isFrozen) VALUES ('u','standard',0.8,0)").run(); db.close();
      const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', variantId: 'v', quantity: 1, price: 0.01 }]) }) as never,
        { client: synthetic.prisma, userId: async () => 'u' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ lineTotals: [4000], total: 4000 });
    } finally { await synthetic.cleanup(); }
  });

  it('rejects aggregated stock shortage across duplicate cart rows', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100 });
      const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST',
        body: JSON.stringify([{ productId: 'p', quantity: 5 }, { productId: 'p', quantity: 4 }]) }) as never,
        { client: synthetic.prisma, userId: async () => null });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'UNIFIED_INSUFFICIENT_STOCK' });
    } finally { await synthetic.cleanup(); }
  });

  it('counts selected automatic addons even when one selected source gets no discount', async () => {
    const synthetic = createSyntheticPrisma();
    const base = { id: 'auto-equal', type: 'addon' as const, name: 'Auto', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 100, addonTerms: ['ADD'] };
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'm', catalogNumber: 'MAIN', price: 100, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'a', catalogNumber: 'ADD-A', price: 200, originalPrice: 200 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'b', catalogNumber: 'ADD-B', price: 100, originalPrice: 100 });
      for (const group of [undefined, 'shared'] as const) {
        const staticRule = { ...base, ...(group ? { sharedQuotaGroup: group } : {}) };
        CART_ADDON_RULES.push(staticRule); PROMOTION_RULES.push(staticRule);
        try {
          const request = [{ productId: 'm', quantity: 2 }, { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 }];
          const pricing = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: request }));
          const chosen = pricing.evidence.legacyCartCandidates.find((candidate) => candidate.promotionId === pricing.pricing.promotionIds[0]
            && candidate.allocationId === pricing.pricing.allocationIds[0]);
          expect(chosen?.addonSelection?.selections.map((entry) => entry.sourceLineId).sort()).toEqual(['1', '2']);
          const response = await cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST', body: JSON.stringify(request) }) as never,
            { client: synthetic.prisma, userId: async () => null });
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.total).toBe(40000);
          expect(data.qualifications[0]).toMatchObject({ canChooseAddon: false, qualification: { selectedQuantity: 2, remainingQuota: 0 } });
        } finally { PROMOTION_RULES.pop(); CART_ADDON_RULES.pop(); }
      }
    } finally { await synthetic.cleanup(); }
  });

  it('selects a real variant option by exact SKU and returns its package intent without base prices', async () => {
    const synthetic = createSyntheticPrisma();
    const optionRule = { id: 'selection', type: 'addon' as const, name: 'Selection', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 9, addonTerms: ['P'],
      addonOptions: [{ catalogNumber: 'P-V1', price: 30, quantity: 2 }] };
    CART_ADDON_RULES.push(optionRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100,
        variants: [{ id: 'v1', catalogNumber: 'P-V1', price: 50, originalPrice: 80, availableQuantity: 3 },
          { id: 'v2', catalogNumber: 'P-V2', price: 60, originalPrice: 90, availableQuantity: 3 }] });
      const response = await addonProductsGet.forTest(new NextRequest('https://example.test/api/cart-promotions/addon-products?ruleId=selection'), synthetic.prisma, async () => false);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.products).toHaveLength(1);
      expect(data.products[0]).toMatchObject({ id: 'p', variantId: 'v1', catalogNumber: 'P-V1', addonOption: { price: 30, quantity: 2 } });
      expect(data.products[0]).not.toHaveProperty('price');
      expect(data.products[0]).not.toHaveProperty('originalPrice');
      optionRule.addonOptions.push({ catalogNumber: 'P-V2', price: 300, quantity: 2 });
      const tooExpensive = await addonProductsGet.forTest(new NextRequest('https://example.test/api/cart-promotions/addon-products?ruleId=selection'), synthetic.prisma, async () => false);
      expect((await tooExpensive.json()).products.map((item: { catalogNumber: string }) => item.catalogNumber)).toEqual(['P-V1']);
      const ordinaryRule = { ...optionRule, id: 'ordinary-variant', addonOptions: undefined, addonTerms: ['P-V'] };
      CART_ADDON_RULES.push(ordinaryRule);
      try {
        const ordinary = await addonProductsGet.forTest(new NextRequest('https://example.test/api/cart-promotions/addon-products?ruleId=ordinary-variant'), synthetic.prisma, async () => false);
        const variants = (await ordinary.json()).products as Array<{ catalogNumber: string; variantId?: string }>;
        expect(variants.map((item) => item.catalogNumber)).toEqual(['P-V1', 'P-V2']);
        expect(variants.map((item) => item.variantId)).toEqual(['v1', 'v2']);
      } finally { CART_ADDON_RULES.pop(); }

    } finally { CART_ADDON_RULES.pop(); await synthetic.cleanup(); }
  });

  it('returns trusted qualification and then prices a selected variant package', async () => {
    const synthetic = createSyntheticPrisma();
    const optionRule = { id: 'selection', type: 'addon' as const, name: 'Selection', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, addonPrice: 9, addonTerms: ['P'],
      addonOptions: [{ catalogNumber: 'P-V1', price: 30, quantity: 2 }] };
    CART_ADDON_RULES.push(optionRule); PROMOTION_RULES.push(optionRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'm', catalogNumber: 'MAIN', price: 100, originalPrice: 100 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 100,
        variants: [{ id: 'v1', catalogNumber: 'P-V1', price: 50, originalPrice: 80, availableQuantity: 3 }] });
      const call = (items: unknown[]) => cartPreviewPost.forTest(new Request('https://example.test/api/promotions/cart', { method: 'POST', body: JSON.stringify(items) }) as never,
        { client: synthetic.prisma, userId: async () => null });
      const first = await call([{ productId: 'm', quantity: 1, price: 0.01 }]);
      expect(first.status).toBe(200);
      const available = await first.json();
      expect(available.qualifications[0]).toMatchObject({ ruleId: 'selection', canChooseAddon: true,
        qualification: { currentQuantity: 1, remainingQuota: 1 }, options: [{ catalogNumber: 'P-V1', price: 30, quantity: 2 }] });
      const second = await call([{ productId: 'm', quantity: 1 }, { productId: 'p', variantId: 'v1', quantity: 2,
        promoMark: { ruleId: 'selection', price: 30, choice: 'P-V1' } }]);
      expect(second.status).toBe(200);
      const selected = await second.json();
      expect(selected.lineTotals).toEqual([10000, 3000]);
      expect(selected.qualifications[0]).toMatchObject({ canChooseAddon: false, qualification: { selectedQuantity: 1, remainingQuota: 0 } });
      optionRule.addonOptions[0].price = 0.01;
      const split = await call([{ productId: 'm', quantity: 1 }, { productId: 'p', variantId: 'v1', quantity: 2,
        promoMark: { ruleId: 'selection', price: 0.01, choice: 'P-V1' } }]);
      expect(split.status).toBe(200);
      const splitData = await split.json();
      expect(splitData.lineBands[1]).toEqual(expect.arrayContaining([{ quantity: 1, unitPriceCents: 1 }, { quantity: 1, unitPriceCents: 0 }]));
      expect(splitData.qualifications[0]).toMatchObject({ status: 'limit-reached', qualification: { selectedQuantity: 1, remainingQuota: 0 } });
      const forged = await call([{ productId: 'm', quantity: 1 }, { productId: 'p', variantId: 'v1', quantity: 2,
        promoMark: { ruleId: 'selection', price: 1, choice: 'P-V1' } }]);
      expect(forged.status).not.toBe(200);
    } finally { PROMOTION_RULES.pop(); CART_ADDON_RULES.pop(); await synthetic.cleanup(); }
  });

  it('retains the parent minimum-sale guard when the variant minimum is null', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'P', price: 100, originalPrice: 200, minimumSalePrice: 90,
        variants: [{ id: 'v', catalogNumber: 'P-V', price: 100, originalPrice: 200 }] });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'p', variantId: 'v', groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [{ productId: 'p', variantId: 'v', quantity: 1 }] }));
      expect(result.pricing.totalCents).toBe(9000);
      expect(result.evidence.lines[0].minimumUnitCents).toBe(9000);
      expect(result.evidence.lines[0].catalogReferenceCents).toBe(20000);
    } finally { await synthetic.cleanup(); }
  });

  it('compares each ordinary static rule type against a real database promotion', async () => {
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p', catalogNumber: 'CAT-1', price: 10, originalPrice: 10 });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'db-sale', type: 'discount_rate', value: 0.5, ruleDefinition: rule,
        bindings: [{ productId: 'p', variantId: null, groupKey: 'benefit' }] });
      const common = { enabled: true, description: '', name: 'Static' };
      const cases = [
        { rule: { ...common, id: 'stack', type: 'stack-discount' as const, terms: ['CAT'], discountRate: 0.6 }, expected: 1800 },
        { rule: { ...common, id: 'fixed', type: 'fixed-price' as const, terms: ['CAT'], priceByTerm: [{ term: 'CAT', price: 4 }] }, expected: 1200 },
        { rule: { ...common, id: 'bundle', type: 'bundle' as const, items: [{ terms: ['CAT'], quantity: 3 }], discountKind: 'fixed' as const, discountValue: 7 }, expected: 2300 },
        { rule: { ...common, id: 'buy', type: 'buy-n-get-m' as const, terms: ['CAT'], groupSize: 3, freeCount: 2 }, expected: 2000 },
      ];
      for (const item of cases) {
        PROMOTION_RULES.push(item.rule);
        try {
          const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [{ productId: 'p', quantity: 3 }] }));
          expect(result.pricing.totalCents, item.rule.id).toBe(item.expected);
          expect(result.pricing.lines[0].promotionId).toBe(`legacy-cart:${item.rule.id}`);
        } finally { PROMOTION_RULES.pop(); }
      }
    } finally { await synthetic.cleanup(); }
  });

  it('does not apply an excluded catalog activity to a qualified unpriced marked gift', async () => {
    const synthetic = createSyntheticPrisma();
    const giftRule = { id: 'gift-with-catalog', type: 'gift' as const, name: 'Gift', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, giftTerms: ['GIFT'] };
    PROMOTION_RULES.push(giftRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'm', catalogNumber: 'MAIN', price: 10, originalPrice: 10 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'g', catalogNumber: 'GIFT', price: 0, originalPrice: null });
      const catalogRule = JSON.stringify({ ...JSON.parse(rule), priceBasis: 'catalog' });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog-gift', type: 'discount_rate', value: 0.5, ruleDefinition: catalogRule,
        bindings: [{ productId: 'g', variantId: null, groupKey: 'benefit' }] });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'm', quantity: 1 }, { productId: 'g', quantity: 1, promoMark: { ruleId: 'gift-with-catalog', price: 0 } },
      ] }));
      expect(result.pricing.totalCents).toBe(1000);
      expect(result.pricing.lines.find((line) => line.productId === 'g')?.promotionId).toBe('legacy-cart:gift-with-catalog');
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });

  it('uses a specification gift with no ordinary price only when fully covered', async () => {
    const synthetic = createSyntheticPrisma();
    const giftRule = { id: 'static-gift', type: 'gift' as const, name: 'Gift', enabled: true, description: '',
      eligibleBrand: 'Synthetic Brand', eligibleTerms: ['MAIN'], minQuantity: 1, giftTerms: ['GIFT'],
      specGifts: [{ spec: 'MAIN', minQuantity: 2, giftQuantity: 1 }] };
    PROMOTION_RULES.push(giftRule);
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'm', catalogNumber: 'MAIN', price: 10, originalPrice: 10 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'g', catalogNumber: 'GIFT', price: 0, originalPrice: 0 });
      const result = await synthetic.prisma.$transaction((tx) => snapshotService(tx, { now: new Date('2026-06-01'), lines: [
        { productId: 'm', quantity: 2 }, { productId: 'g', quantity: 1, promoMark: { ruleId: 'static-gift', price: 0 } },
      ] }));
      expect(result.pricing.totalCents).toBe(2000);
      expect(result.pricing.lines.find((line) => line.productId === 'g')?.promotionId).toBe('legacy-cart:static-gift');
    } finally { PROMOTION_RULES.pop(); await synthetic.cleanup(); }
  });
});

describe('createUnifiedPricingSnapshot', () => {
  it('uses server prices, complete activity bindings and stable evidence hash', async () => {
    const db = client();
    const request = { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01T00:00:00Z') };
    const first = await snapshot(db, request);
    const second = await snapshot(db, request);
    expect(first.evidenceHash).toBe(second.evidenceHash);
    expect(first.evidence.lines[0].unitPriceCents).toBe(1000);
    expect(first.evidence.campaigns).toHaveLength(1);
    expect(first.evidence.promotions[0].bindings[0].bindingId).toBe('binding-sale');
    expect(first.pricing.totalCents).toBe(500);
  });

  it('uses a specification own price and refuses variant inheritance or missing prices', async () => {
    const db = client();
    const snapshotResult = await snapshot(db, { lines: [{ productId: 'p1', variantId: 'v1', quantity: 1 }], now: new Date('2026-06-01T00:00:00Z') });
    expect(snapshotResult.evidence.lines[0].unitPriceCents).toBe(700);
    await expect(snapshot(db, { lines: [{ productId: 'p1', variantId: 'other', quantity: 1 }] })).rejects.toThrow('PRODUCT_VARIANT_MISMATCH');
  });

  it('keeps legacy promotions as competing candidates, uses the undiscounted SKU basis and handles decimal rates exactly', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].promotionLinks.push({ id: 'link-legacy', promotionId: 'legacy', productId: 'p1', variantId: null, groupKey: 'main' });
    products[0].promotionLinks.push({ id: 'link-legacy2', promotionId: 'legacy2', productId: 'p1', variantId: null, groupKey: 'main' });
    const legacy = (id: string, value: number) => ({ id, name: `Legacy ${value}`, type: 'discount_rate', value, status: 'active', startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01'), priority: 0, exclusive: true, ruleVersion: 1, ruleDefinition: null,
      products: [{ id: `${id}-binding`, productId: 'p1', variantId: null, groupKey: 'main' }] } as TestPromotion);
    const [active] = await db.promotion.findMany({});
    db.product.findMany.mockResolvedValueOnce(products);
    db.promotion.findMany.mockResolvedValueOnce([active, legacy('legacy', 0.57), legacy('legacy2', 0.29)]);
    const snapshotResult = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
    expect(snapshotResult.evidence.lines[0].unitPriceCents).toBe(1000);
    expect(snapshotResult.evidence.lines[0].basePriceCents).toBe(1000);
    expect(snapshotResult.pricing.totalCents).toBe(290);
  });

  it('allows a catalog rule to price an otherwise unpriced SKU using its own reference price', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].price = 0;
    products[0].originalPrice = 12;
    const catalogRule = JSON.stringify({ schemaVersion: 1, template: 'direct-price', groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }], benefit: { kind: 'percentage', basisPoints: 5000 }, repeat: false, partialBenefit: false, maxApplications: null, priceBasis: 'catalog' });
    const campaign = { ...((await db.promotion.findMany({}))[0]), ruleDefinition: catalogRule };
    db.product.findMany.mockResolvedValueOnce(products);
    db.promotion.findMany.mockResolvedValueOnce([campaign]);
    const snapshotResult = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
    expect(snapshotResult.evidence.lines[0].unitPriceCents).toBeNull();
    expect(snapshotResult.pricing.totalCents).toBe(600);
  });

  it('applies the server minimum sale price to the promotion candidate', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].minimumSalePrice = 6;
    db.product.findMany.mockResolvedValueOnce(products);
    const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
    expect(result.pricing.totalCents).toBe(600);
  });

  it('uses a trusted preview candidate to replace the same ID only for that calculation', async () => {
    const db = client();
    const existing = (await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') })).evidence.campaigns[0];
    const preview = { ...existing, status: 'draft' as const, definition: { ...existing.definition, benefit: { kind: 'percentage' as const, basisPoints: 8000 } } };
    const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01'), previewCampaign: preview });
    expect(result.evidence.campaigns.filter((campaign) => campaign.id === 'sale')).toHaveLength(1);
    expect(result.pricing.totalCents).toBe(800);
  });

  it('does not demand catalog reference prices for an expired catalog activity', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].originalPrice = null;
    const promotions = await db.promotion.findMany({});
    promotions[0].ruleDefinition = JSON.stringify({ schemaVersion: 1, template: 'direct-price', groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }], benefit: { kind: 'percentage', basisPoints: 5000 }, repeat: false, partialBenefit: false, maxApplications: null, priceBasis: 'catalog' });
    promotions[0].endsAt = new Date('2026-05-31T23:59:59Z');
    db.product.findMany.mockResolvedValueOnce(products);
    db.promotion.findMany.mockResolvedValueOnce(promotions);
    const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01T00:00:00Z') });
    expect(result.evidence.campaigns).toHaveLength(0);
    expect(result.pricing.totalCents).toBe(1000);
  });

  it('rejects unknown products and invalid quantity before calculating', async () => {
    const db = client();
    await expect(snapshot(db, { lines: [{ productId: 'missing', quantity: 1 }] })).rejects.toThrow('UNIFIED_PRICING_PRODUCT_NOT_FOUND');
    await expect(snapshot(db, { lines: [{ productId: 'p1', quantity: 0 }] })).rejects.toThrow('INVALID_QUANTITY');
  });

  it('resolves server metadata from a catalog number even when ordinary price is absent', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].price = 0;
    products[0].pricingMode = 'inquiry';
    db.product.findMany.mockResolvedValueOnce(products);
    const result = await resolveIdentities(db, { lines: [{ catalogNumber: 'P-1', quantity: 2 }] });
    expect(result.items[0]).toMatchObject({ productId: 'p1', variantId: null, brand: 'Acme', catalogNumber: 'P-1', category: 'reagents', subcategory: 'buffers', pricingMode: 'inquiry', stockQuantity: 9 });
    await resolveIdentities(db, { lines: [{ productId: 'p1', quantity: 1 }] });
    const lastQuery = db.product.findMany.mock.calls.at(-1)?.[0] as { select: { variants: { where: { id: { in: string[] } } } } };
    expect(lastQuery.select.variants.where.id.in).toEqual([]);
  });

  it('resolves a specification catalog number to that specification and rejects dangerous products', async () => {
    const db = client();
    const result = await resolveIdentities(db, { lines: [{ catalogNumber: 'V-1', quantity: 1 }] });
    expect(result.items[0]).toMatchObject({ productId: 'p1', variantId: 'v1', catalogNumber: 'V-1', spec: '10 ml', stockQuantity: 4 });
    const products = await db.product.findMany({});
    products[0].hazardous = true;
    db.product.findMany.mockResolvedValueOnce(products);
    await expect(resolveIdentities(db, { lines: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow('HAZARDOUS_PRODUCT_UNAVAILABLE');
  });

  it('keeps product identity when its catalog number is shared with a variant, including explicit variantId null', async () => {
    const db = client();
    const products = await db.product.findMany({});
    products[0].catalogNumber = 'SHARED';
    products[0].variants[0].catalogNumber = 'SHARED';
    db.product.findMany.mockResolvedValueOnce(products);
    const byProduct = await resolveIdentities(db, { lines: [{ productId: 'p1', catalogNumber: 'SHARED', quantity: 1 }] });
    expect(byProduct.items[0].variantId).toBeNull();
    db.product.findMany.mockResolvedValueOnce(products);
    const explicitlyProduct = await resolveIdentities(db, { lines: [{ catalogNumber: 'SHARED', variantId: null, quantity: 1 }] });
    expect(explicitlyProduct.items[0].variantId).toBeNull();
  });

  it('preserves the legacy productId-as-catalog fallback when no database ID matches', async () => {
    const db = client();
    const resolved = await resolveIdentities(db, { lines: [{ productId: 'P-1', quantity: 1 }] });
    expect(resolved.items[0]).toMatchObject({ productId: 'p1', variantId: null, catalogNumber: 'P-1' });
    const products = await db.product.findMany({});
    expect(products[0].variants?.[0]).toBeDefined();
    const variantFallback = await resolveIdentities(db, { lines: [{ productId: 'unknown-id', catalogNumber: 'V-1', quantity: 1 }] });
    expect(variantFallback.items[0]).toMatchObject({ productId: 'p1', variantId: 'v1', catalogNumber: 'V-1' });
  });

  it('uses the configured legacy reference-price campaign against originalPrice and skips product promotionalPrice', async () => {
    const previous = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'sale' });
    try {
      const db = client();
      const products = await db.product.findMany({});
      products[0].promotionalPrice = 4;
      const promotions = await db.promotion.findMany({});
      promotions[0].ruleDefinition = null;
      promotions[0].value = 0.5;
      db.product.findMany.mockResolvedValueOnce(products);
      db.promotion.findMany.mockResolvedValueOnce(promotions);
      const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.evidence.items[0].referencePriceApplied).toBe(true);
      expect(result.evidence.ordinaryUnitPricesCents[0]).toBe(2000);
      expect(result.pricing.totalCents).toBe(1000);
    } finally {
      if (previous === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previous;
    }
  });

  it('uses each SKU originalPrice for one shared reference-price activity regardless of request order', async () => {
    const previous = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'sale' });
    try {
      const calculate = async (reverse: boolean) => {
        const db = client();
        const [firstProduct] = await db.product.findMany({});
        const secondProduct: TestProduct = { ...firstProduct, id: 'p2', catalogNumber: 'P-2', name: 'Product Two', price: 8, originalPrice: 40, promotionalPrice: 3,
          promotionLinks: [{ id: 'link-sale-p2', promotionId: 'sale', productId: 'p2', variantId: null, groupKey: 'benefit' }], variants: [] };
        const products = reverse ? [secondProduct, firstProduct] : [firstProduct, secondProduct];
        const [promotion] = await db.promotion.findMany({});
        promotion.ruleDefinition = null;
        promotion.value = 0.5;
        promotion.products.push({ id: 'binding-p2', productId: 'p2', variantId: null, groupKey: 'benefit' });
        db.product.findMany.mockResolvedValueOnce(products);
        db.promotion.findMany.mockResolvedValueOnce([promotion]);
        return snapshot(db, { lines: products.map((product) => ({ productId: product.id, quantity: 1 })), now: new Date('2026-06-01') });
      };
      const normalOrder = await calculate(false);
      const reverseOrder = await calculate(true);
      expect(normalOrder.pricing.totalCents).toBe(3000);
      expect(reverseOrder.pricing.totalCents).toBe(3000);
      for (const result of [normalOrder, reverseOrder]) {
        expect(result.unitPriceAllocations.map((allocation) => [allocation.productId, allocation.priceBands?.[0]?.unitPriceCents]).sort())
          .toEqual([['p1', 1000], ['p2', 2000]]);
      }
    } finally {
      if (previous === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previous;
    }
  });

  it('preserves legacy raw-decimal reference-price rounding before cents conversion', async () => {
    const previous = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'sale' });
    try {
      const db = client();
      const products = await db.product.findMany({});
      products[0].originalPrice = 1.005;
      const promotions = await db.promotion.findMany({});
      promotions[0].ruleDefinition = null;
      db.product.findMany.mockResolvedValueOnce(products);
      db.promotion.findMany.mockResolvedValueOnce(promotions);
      const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.pricing.totalCents).toBe(50);
      expect(result.unitPriceAllocations[0].priceBands).toEqual([{ quantity: 1, unitPriceCents: 50, promotionId: 'sale', sourceLineId: '0' }]);
    } finally {
      if (previous === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previous;
    }
  });

  it('uses the same canonical static rule hash for snapshot and transaction validation', async () => {
    const rule = { id: 'synthetic-static', type: 'fixed-price' as const, name: 'Synthetic', description: '', enabled: true,
      terms: ['SYNTH'] };
    const buildStatic = vi.spyOn(cartPromotionService, 'buildUnifiedLegacyPromotionCandidates').mockReturnValue({
      candidates: [], evidence: [{ id: 'legacy-cart:synthetic-static', name: rule.name, type: rule.type,
        canonicalConfig: cartPromotionService.canonicalLegacyRule(rule), exclusive: false, stackable: false }],
    });
    try {
      const result = await snapshot(client(), { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.evidence.legacyCartPromotions[0].versionHash).toBe(legacyRuleVersionHash(rule));
    } finally { buildStatic.mockRestore(); }
  });

  it('rejects a static and database promotion sharing an identifier', async () => {
    const db = client();
    const rows = await db.promotion.findMany({});
    rows[0].id = 'legacy-cart:collision';
    db.promotion.findMany.mockResolvedValueOnce(rows);
    const products = await db.product.findMany({});
    products[0].promotionLinks[0].promotionId = 'legacy-cart:collision';
    db.product.findMany.mockResolvedValueOnce(products);
    const buildStatic = vi.spyOn(cartPromotionService, 'buildUnifiedLegacyPromotionCandidates').mockReturnValue({
      candidates: [], evidence: [{ id: 'legacy-cart:collision', name: 'Synthetic', type: 'fixed-price',
        canonicalConfig: '{}', exclusive: false, stackable: false }],
    });
    try {
      await expect(snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') }))
        .rejects.toThrow('UNIFIED_PROMOTION_ID_COLLISION');
    } finally { buildStatic.mockRestore(); }
  });

  it('compares a real static rule candidate with the database promotion in the same solver', async () => {
    const staticRule = { id: 'synthetic-static', type: 'fixed-price' as const, name: 'Synthetic', description: '', enabled: true,
      terms: ['P-'], priceByTerm: [{ term: 'P-', price: 4 }] };
    PROMOTION_RULES.push(staticRule);
    try {
      const result = await snapshot(client(), { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.pricing.totalCents).toBe(400);
      expect(result.pricing.lines[0].promotionId).toBe('legacy-cart:synthetic-static');
      expect(result.evidence.legacyCartPromotions[0].versionHash).toBe(legacyRuleVersionHash(staticRule));
    } finally { PROMOTION_RULES.pop(); }
  });

  it('keeps a trusted static fixed-price override alongside the same SKU reference-price override', async () => {
    const previous = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'sale' });
    const buildStatic = vi.spyOn(cartPromotionService, 'buildUnifiedLegacyPromotionCandidates').mockReturnValue({
      candidates: [{ promotionId: 'legacy-cart:static-fixed-price', qualified: true,
        lines: [{ productId: 'p1', variantId: null, quantity: 1, totalAfterCents: 75, priceBands: [{ sourceLineId: '0', quantity: 1, unitCents: 75, source: 'promotion' }] }] }], evidence: [],
    });
    try {
      const db = client();
      const products = await db.product.findMany({});
      products[0].originalPrice = 1.005;
      const promotions = await db.promotion.findMany({});
      promotions[0].ruleDefinition = null;
      db.product.findMany.mockResolvedValueOnce(products);
      db.promotion.findMany.mockResolvedValueOnce(promotions);
      const result = await snapshot(db, { lines: [{ productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.evidence.lines[0].legacyPromotionUnitPriceOverridesCents).toEqual({ sale: 50 });
      expect(result.pricing.totalCents).toBe(50);
      expect(result.pricing.lines[0].promotionId).toBe('sale');
    } finally {
      buildStatic.mockRestore();
      if (previous === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previous;
    }
  });

  it('does not reject a variant outside a configured variant-scoped reference-price binding', async () => {
    const previous = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'sale' });
    try {
      const db = client();
      const products = await db.product.findMany({});
      products[0].promotionLinks[0].variantId = 'v1';
      const promotions = await db.promotion.findMany({});
      promotions[0].ruleDefinition = null;
      promotions[0].products[0].variantId = 'v1';
      db.product.findMany.mockResolvedValueOnce(products);
      db.promotion.findMany.mockResolvedValueOnce(promotions);
      const result = await snapshot(db, { lines: [{ productId: 'p1', variantId: 'v2', quantity: 1 }], now: new Date('2026-06-01') });
      expect(result.evidence.items[0].referencePriceApplied).toBeUndefined();
      expect(result.pricing.totalCents).toBe(900);
    } finally {
      if (previous === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previous;
    }
  });

  it('preserves duplicate source rows while pricing their checked aggregate quantity once', async () => {
    const db = client();
    const result = await snapshot(db, { lines: [{ catalogNumber: 'P-1', quantity: 1 }, { productId: 'p1', quantity: 1 }], now: new Date('2026-06-01') });
    expect(result.items).toHaveLength(2);
    expect(result.pricing.lines).toHaveLength(1);
    expect(result.pricing.lines[0].quantity).toBe(2);
    expect(result.pricing.totalCents).toBe(1500);
    expect(result.unitPriceAllocations[0].reconstructable).toBe(true);
    expect(result.unitPriceAllocations[0].priceBands).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantity: 1, unitPriceCents: 500, promotionId: 'sale' }),
      expect.objectContaining({ quantity: 1, unitPriceCents: 1000, promotionId: null }),
    ]));
    expect(new Set(result.pricing.lines[0].priceBands?.map((band) => band.sourceLineId))).toEqual(new Set(['0', '1']));
    await expect(snapshot(db, { lines: [{ productId: 'p1', quantity: Number.MAX_SAFE_INTEGER }, { productId: 'p1', quantity: 1 }] }))
      .rejects.toThrow('INVALID_PROMOTION_AMOUNT');
  });

  it('reads trusted zero-price catalog SKUs and variants through a real Prisma transaction, then re-reads changed rules', async () => {
    const previousReferenceConfig = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    const synthetic = createSyntheticPrisma();
    const catalogRule = (basisPoints: number) => JSON.stringify({ schemaVersion: 1, template: 'direct-price',
      groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }], benefit: { kind: 'percentage', basisPoints },
      repeat: true, partialBenefit: false, maxApplications: null, priceBasis: 'catalog' });
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p-zero', catalogNumber: 'CAT-ZERO', price: 0, originalPrice: 20 });
      seedSyntheticProduct(synthetic.databasePath, { id: 'p-variant', catalogNumber: 'CAT-VARIANT', price: 0, originalPrice: 99,
        variants: [{ id: 'v-own', catalogNumber: 'CAT-VARIANT-OWN', price: 0, originalPrice: 40, availableQuantity: 3 }] });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'catalog-campaign', type: 'rule', value: 0, ruleDefinition: catalogRule(5000), bindings: [
        { productId: 'p-zero', variantId: null, groupKey: 'benefit' }, { productId: 'p-variant', variantId: 'v-own', groupKey: 'benefit' },
      ] });
      const request = { lines: [{ productId: 'p-zero', quantity: 1 }, { productId: 'p-variant', variantId: 'v-own', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z') };
      const snapshots = await synthetic.prisma.$transaction(async (tx) => {
        const before = await snapshotService(tx, request);
        await tx.promotion.update({ where: { id: 'catalog-campaign' }, data: { ruleDefinition: catalogRule(2500), ruleVersion: 2 } });
        const after = await snapshotService(tx, request);
        return { before, after };
      });
      expect(snapshots.before.items.map((item) => [item.productId, item.variantId, item.stockQuantity])).toEqual([['p-zero', null, 8], ['p-variant', 'v-own', 3]]);
      expect(snapshots.before.evidence.lines.map((line) => line.unitPriceCents)).toEqual([null, null]);
      expect(snapshots.before.pricing.totalCents).toBe(3000);
      expect(snapshots.after.pricing.totalCents).toBe(1500);
      expect(snapshots.before.evidenceHash).not.toBe(snapshots.after.evidenceHash);
    } finally {
      await synthetic.cleanup();
      if (previousReferenceConfig === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previousReferenceConfig;
    }
  });

  it('enforces configured reference-price scope against real SQLite promotion bindings', async () => {
    const previousReferenceConfig = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
    const synthetic = createSyntheticPrisma();
    try {
      seedSyntheticProduct(synthetic.databasePath, { id: 'p-ref-product', catalogNumber: 'REF-P', price: 10, originalPrice: 20, promotionalPrice: 1,
        variants: [{ id: 'v-ref-product-1', catalogNumber: 'REF-P-1', price: 5, originalPrice: 30 }, { id: 'v-ref-product-2', catalogNumber: 'REF-P-2', price: 9, originalPrice: 45 }] });
      seedSyntheticProduct(synthetic.databasePath, { id: 'p-ref-scoped', catalogNumber: 'REF-S', price: 8, originalPrice: 50,
        variants: [{ id: 'v-ref-scoped-1', catalogNumber: 'REF-S-1', price: 6, originalPrice: 60 }, { id: 'v-ref-scoped-2', catalogNumber: 'REF-S-2', price: 9, originalPrice: 90 }] });
      seedSyntheticProduct(synthetic.databasePath, { id: 'p-ref-round', catalogNumber: 'REF-R', price: 1, originalPrice: 1.005 });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'ref-product', type: 'discount_rate', value: 0.5, ruleDefinition: null,
        bindings: [{ productId: 'p-ref-product', variantId: null, groupKey: 'main' }] });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'ref-variant', type: 'discount_rate', value: 0.5, ruleDefinition: null,
        bindings: [{ productId: 'p-ref-scoped', variantId: 'v-ref-scoped-1', groupKey: 'main' }] });
      seedSyntheticPromotion(synthetic.databasePath, { id: 'ref-round', type: 'discount_rate', value: 0.5, ruleDefinition: null,
        bindings: [{ productId: 'p-ref-round', variantId: null, groupKey: 'main' }] });
      process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'ref-product' });
      const productPrice = await synthetic.prisma.$transaction((tx) => snapshotService(tx, {
        lines: [{ productId: 'p-ref-product', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z'),
      }));
      expect(productPrice.items[0].referencePriceApplied).toBe(true);
      expect(productPrice.evidence.ordinaryUnitPricesCents[0]).toBe(2000);
      expect(productPrice.pricing.totalCents).toBe(1000);
      process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'ref-round' });
      const rawDecimalPrice = await synthetic.prisma.$transaction((tx) => snapshotService(tx, {
        lines: [{ productId: 'p-ref-round', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z'),
      }));
      expect(rawDecimalPrice.pricing.totalCents).toBe(50);
      process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'ref-product' });
      await expect(synthetic.prisma.$transaction((tx) => snapshotService(tx, {
        lines: [{ productId: 'p-ref-product', variantId: 'v-ref-product-2', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z'),
      }))).rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');

      process.env.REFERENCE_PRICE_PROMOTION_CONFIG = JSON.stringify({ promotionId: 'ref-variant' });
      const outOfScope = await synthetic.prisma.$transaction((tx) => snapshotService(tx, {
        lines: [{ productId: 'p-ref-scoped', variantId: 'v-ref-scoped-2', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z'),
      }));
      expect(outOfScope.items[0].referencePriceApplied).toBeUndefined();
      expect(outOfScope.pricing.totalCents).toBe(900);
      await expect(synthetic.prisma.$transaction((tx) => snapshotService(tx, {
        lines: [{ productId: 'p-ref-scoped', variantId: 'v-ref-scoped-1', quantity: 1 }], now: new Date('2026-06-01T00:00:00.000Z'),
      }))).rejects.toThrow('REFERENCE_PRICE_PROMOTION_INVALID');
    } finally {
      await synthetic.cleanup();
      if (previousReferenceConfig === undefined) delete process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
      else process.env.REFERENCE_PRICE_PROMOTION_CONFIG = previousReferenceConfig;
    }
  });
});
