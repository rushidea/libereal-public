import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freezeCatalogPromotionSelection } from '@/lib/promotion-selection';
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE Product (id TEXT PRIMARY KEY, originalPrice REAL, hazardous INTEGER, deletedAt TEXT);
    CREATE TABLE ProductVariant (id TEXT PRIMARY KEY, productId TEXT, originalPrice REAL);
    INSERT INTO Product VALUES ('p1', 500, 0, NULL), ('p2', 1000, 0, NULL);
    INSERT INTO ProductVariant VALUES ('v1', 'p1', 100), ('v2', 'p1', 200);`);
});
afterEach(() => db.close());
describe('freeze catalog promotion selection', () => {
  it('freezes all existing variants and a different product independently', () => {
    const frozen = freezeCatalogPromotionSelection(db, [{ productId: 'p1', allVariants: true, groupKey: 'main' }, { productId: 'p2', variantId: null, groupKey: 'main' }]);
    expect(frozen).toEqual([{ productId: 'p1', variantId: 'v1', groupKey: 'main', referenceCents: 10000 },
      { productId: 'p1', variantId: 'v2', groupKey: 'main', referenceCents: 20000 },
      { productId: 'p2', variantId: null, groupKey: 'main', referenceCents: 100000 }]);
    db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?)').run('v3', 'p1', 300);
    expect(frozen).toHaveLength(3);
  });
  it('rejects missing variant prices rather than falling back to the parent', () => {
    db.prepare('UPDATE ProductVariant SET originalPrice = NULL WHERE id = ?').run('v1');
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p1', allVariants: true, groupKey: 'main' }])).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
    db.prepare('UPDATE ProductVariant SET originalPrice = 0 WHERE id = ?').run('v1');
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p1', variantId: 'v1', groupKey: 'main' }])).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
  });
  it('rejects cross-product and duplicate bindings', () => {
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p2', variantId: 'v1', groupKey: 'main' }])).toThrow('INVALID_PROMOTION_VARIANT');
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p1', allVariants: true, groupKey: 'main' }, { productId: 'p1', variantId: 'v1', groupKey: 'main' }])).toThrow('DUPLICATE_PROMOTION_SKU');
  });
  it('rejects a positive reference that rounds to zero cents', () => {
    db.prepare('UPDATE ProductVariant SET originalPrice = ? WHERE id = ?').run(0.001, 'v1');
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p1', variantId: 'v1', groupKey: 'main' }])).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
  });
  it('rejects a selection larger than the maximum instead of returning a partial snapshot', () => {
    const insert = db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?)');
    db.transaction(() => { for (let i = 0; i < 2000; i++) insert.run(`extra-${i}`, 'p1', 10); })();
    expect(() => freezeCatalogPromotionSelection(db, [{ productId: 'p1', allVariants: true, groupKey: 'main' }])).toThrow('INVALID_PROMOTION_SELECTION');
  });
});
