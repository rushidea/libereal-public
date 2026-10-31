import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { PromotionRepository } from '@/lib/promotion-repository';
let db: Database.Database;
let repository: PromotionRepository;
const input = {
  name: '凝胶加购', startsAt: '2026-09-01', endsAt: '2026-10-01', status: 'draft',
  ruleDefinition: { schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'qualifier', quantity: 6, unit: '盒' }, { key: 'addon', role: 'benefit', quantity: 1, unit: '卷' }],
    benefit: { kind: 'fixed-price', unitPriceCents: 5000 } },
  products: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon' }],
};
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE Product (id TEXT PRIMARY KEY, name TEXT, catalogNumber TEXT, hazardous INTEGER, deletedAt TEXT, originalPrice REAL);
    CREATE TABLE ProductVariant (id TEXT PRIMARY KEY, productId TEXT, catalogNumber TEXT, spec TEXT, originalPrice REAL);
    CREATE TABLE Promotion (id TEXT PRIMARY KEY,name TEXT,type TEXT,value REAL,status TEXT,startsAt INTEGER,endsAt INTEGER,priority INTEGER,exclusive INTEGER,createdBy TEXT,createdAt INTEGER,updatedAt INTEGER,ruleDefinition TEXT,ruleVersion INTEGER);
    CREATE TABLE PromotionProduct (id TEXT PRIMARY KEY,promotionId TEXT,productId TEXT,variantId TEXT,groupKey TEXT);
    CREATE TABLE AuditLog (id TEXT PRIMARY KEY,actorId TEXT,action TEXT,resource TEXT,targetType TEXT,targetId TEXT,beforeData TEXT,afterData TEXT,createdAt INTEGER);
    INSERT INTO Product VALUES ('sample-main','凝胶','GEL',0,NULL,100),('sample-addon','膜','PVDF',0,NULL,100);
    INSERT INTO ProductVariant VALUES ('roll','sample-addon','PVDF-ROLL','卷',200);`);
  db.exec(readFileSync('prisma/migrations/20261030100000_add_promotion_create_receipt/migration.sql', 'utf8'));
  db.exec(readFileSync('prisma/migrations/20261030110000_add_promotion_catalog_selection/migration.sql', 'utf8'));
  repository = new PromotionRepository(db);
});
afterEach(() => db.close());
it('草稿保存、发布与版本变更均留下审计记录', () => {
  const draft = repository.save(input, 'admin');
  expect(draft.ruleVersion).toBe(1);
  expect(repository.activeForProducts(['sample-main'], new Date('2026-09-05'))).toHaveLength(0);
  const active = repository.save({ status: 'active' }, 'admin', draft.id);
  expect(active.ruleVersion).toBe(2);
  expect(repository.activeForProducts(['sample-main'], new Date('2026-09-05'))).toHaveLength(1);
  expect(db.prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 2 });
});
it('同 SKU 可以成为多条有效活动的候选', () => {
  repository.save({ ...input, status: 'active' }, 'admin');
  const draft = repository.save(input, 'admin');
  repository.save({ status: 'active' }, 'admin', draft.id);
  expect(repository.get(draft.id).status).toBe('active');
  expect(repository.activeForProducts(['sample-main'], new Date('2026-09-05'))).toHaveLength(2);
});
it('篡改规格所属商品、重复绑定及缺失组均被拒绝', () => {
  expect(() => repository.save({ ...input, products: [{ ...input.products[0], variantId: 'roll' }, input.products[1]] }, 'admin')).toThrow('INVALID_PROMOTION_VARIANT');
  expect(() => repository.save({ ...input, products: [...input.products, input.products[0]] }, 'admin')).toThrow('DUPLICATE_PROMOTION_SKU');
  expect(() => repository.save({ ...input, products: [input.products[0]] }, 'admin')).toThrow('PROMOTION_GROUP_WITHOUT_SKUS');
  expect(repository.list()).toHaveLength(0);
});
it('有效活动需要先暂停再编辑，结束活动保留历史', () => {
  const active = repository.save({ ...input, status: 'active' }, 'admin');
  expect(() => repository.save({ name: '修改' }, 'admin', active.id)).toThrow('PROMOTION_PAUSE_BEFORE_EDIT');
  repository.save({ status: 'paused' }, 'admin', active.id);
  expect(repository.save({ name: '修改' }, 'admin', active.id).name).toBe('修改');
  repository.save({ status: 'ended' }, 'admin', active.id);
  expect(repository.get(active.id).products).toHaveLength(2);
});
it('审计写入失败会回滚整个发布事务', () => {
  db.exec('DROP TABLE AuditLog');
  expect(() => repository.save(input, 'admin')).toThrow();
  expect(repository.list()).toHaveLength(0);
});
it('已删除商品不能再绑定到活动', () => {
  db.prepare('UPDATE Product SET deletedAt = ? WHERE id = ?').run('2026-10-13T00:00:00.000Z', 'sample-main');
  expect(() => repository.save(input, 'admin')).toThrow('INVALID_PROMOTION_PRODUCT');
  expect(repository.list()).toHaveLength(0);
});
it('旧活动与新规则可以同时保留候选关系', () => {
  repository.save({ ...input, ruleDefinition: null, type: 'fixed_price', value: 10,
    products: [{ productId: 'sample-addon', variantId: null }], status: 'active' }, 'admin');
  expect(repository.save({ ...input, status: 'active' }, 'admin').status).toBe('active');
});
it('过期版本不能覆盖新的活动编辑或状态变更', () => {
  const initial = repository.save(input, 'admin');
  const changed = repository.save({ name: '新名称', expectedVersion: initial.ruleVersion }, 'admin', initial.id);
  expect(() => repository.save({ name: '过期覆盖', expectedVersion: initial.ruleVersion }, 'admin', initial.id)).toThrow('PROMOTION_VERSION_CONFLICT');
  expect(() => repository.save({ status: 'active', expectedVersion: initial.ruleVersion }, 'admin', initial.id)).toThrow('PROMOTION_VERSION_CONFLICT');
  expect(repository.get(initial.id).name).toBe('新名称');
  const active = repository.save({ status: 'active', expectedVersion: changed.ruleVersion }, 'admin', initial.id);
  expect(repository.save({ status: 'paused', expectedVersion: active.ruleVersion }, 'admin', initial.id).status).toBe('paused');
  expect(db.prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 4 });
});
it('编辑和状态更新保留旧式活动绑定的原始分组', () => {
  const legacy = repository.save({ ...input, ruleDefinition: null, type: 'discount_rate', value: 0.6 }, 'admin');
  db.prepare('UPDATE PromotionProduct SET groupKey = ? WHERE promotionId = ? AND productId = ?').run('historic', legacy.id, 'sample-addon');
  const before = repository.get(legacy.id);
  const edited = repository.save({ name: 'renamed', expectedVersion: before.ruleVersion }, 'admin', legacy.id);
  expect(edited.products.find((entry) => entry.productId === 'sample-addon')?.groupKey).toBe('historic');
  const active = repository.save({ status: 'active', expectedVersion: edited.ruleVersion }, 'admin', legacy.id);
  expect(active.products.find((entry) => entry.productId === 'sample-addon')?.groupKey).toBe('historic');
});
it('按操作人和请求键幂等创建，重试不重复写入，内容冲突拒绝', () => {
  const first = repository.save(input, 'admin', undefined, 'request-1');
  const retry = repository.save({ products: input.products, ruleDefinition: input.ruleDefinition,
    status: input.status, endsAt: input.endsAt, startsAt: input.startsAt, name: input.name }, 'admin', undefined, 'request-1');
  expect(retry).toEqual(first);
  expect(() => repository.save({ ...input, name: 'changed' }, 'admin', undefined, 'request-1')).toThrow('PROMOTION_IDEMPOTENCY_CONFLICT');
  expect(repository.save(input, 'other-admin', undefined, 'request-1').id).not.toBe(first.id);
  expect(db.prepare('SELECT COUNT(*) AS count FROM Promotion').get()).toEqual({ count: 2 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 2 });
});
it('幂等回执和活动、审计一起回滚', () => {
  db.exec('DROP TABLE AuditLog');
  expect(() => repository.save(input, 'admin', undefined, 'request-2')).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS count FROM PromotionCreateReceipt').get()).toEqual({ count: 0 });
  expect(repository.list()).toHaveLength(0);
});
it('幂等请求拒绝非 JSON 类型而不是合并不同的输入', () => {
  expect(() => repository.save({ ...input, startsAt: new Date('2030-01-01') }, 'admin', undefined, 'request-date')).toThrow('INVALID_PROMOTION_INPUT');
  expect(repository.list()).toHaveLength(0);
});
it('目录价活动发布在事务内校验规格价格且在共享计价完成前保持关闭', () => {
  const catalogDefinition = { ...input.ruleDefinition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } };
  const draft = repository.save({ ...input, ruleDefinition: catalogDefinition }, 'admin');
  expect(draft.ruleDefinition?.priceBasis).toBe('catalog');
  db.prepare('UPDATE ProductVariant SET originalPrice = NULL WHERE id = ?').run('roll');
  expect(() => repository.save({ status: 'active', expectedVersion: draft.ruleVersion }, 'admin', draft.id)).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
  db.prepare('UPDATE ProductVariant SET originalPrice = 200 WHERE id = ?').run('roll');
  expect(() => repository.save({ status: 'active', expectedVersion: draft.ruleVersion }, 'admin', draft.id)).toThrow('PROMOTION_CATALOG_RUNTIME_NOT_READY');
  expect(repository.get(draft.id).status).toBe('draft');
});
it('目录价草稿保留全部规格意图，发布时重新解析但未接通时全部回滚', () => {
  const catalogDefinition = { ...input.ruleDefinition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } };
  const selections = [{ productId: 'sample-main', variantId: null, groupKey: 'main' },
    { productId: 'sample-addon', allVariants: true, groupKey: 'addon' }];
  const draft = repository.save({ ...input, ruleDefinition: catalogDefinition, catalogSelections: selections }, 'admin');
  expect(draft.catalogSelections).toEqual(selections);
  db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?, ?, ?)').run('sheet', 'sample-addon', 'PVDF-SHEET', '片', 250);
  expect(() => repository.save({ status: 'active', expectedVersion: draft.ruleVersion }, 'admin', draft.id)).toThrow('PROMOTION_CATALOG_RUNTIME_NOT_READY');
  const after = repository.get(draft.id);
  expect(after.status).toBe('draft');
  expect(after.catalogSelections).toEqual(selections);
  expect(after.products.map((item) => item.variantId)).not.toContain('sheet');
});
it('旧式 products 不接受 allVariants 通配以防误变商品级绑定', () => {
  expect(() => repository.save({ ...input, products: [{ productId: 'sample-main', allVariants: true, groupKey: 'main' }] }, 'admin')).toThrow('INVALID_PROMOTION_BINDING');
});
it('目录价草稿传入明确 products 更新时替换原选择意图', () => {
  const catalogDefinition = { ...input.ruleDefinition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } };
  const draft = repository.save({ ...input, ruleDefinition: catalogDefinition,
    catalogSelections: [{ productId: 'sample-main', variantId: null, groupKey: 'main' },
      { productId: 'sample-addon', allVariants: true, groupKey: 'addon' }] }, 'admin');
  const explicit = [{ productId: 'sample-main', variantId: null, groupKey: 'main' },
    { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon' }];
  const updated = repository.save({ products: explicit, expectedVersion: draft.ruleVersion }, 'admin', draft.id);
  expect(updated.catalogSelections).toEqual(explicit);
});
it('发布事务冻结 allVariants 的当时规格及独立参考价，暂停重发沿用规格集合', () => {
  const catalogDefinition = { ...input.ruleDefinition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } };
  const runtimeReadyRepository = new PromotionRepository(db, () => true);
  const draft = runtimeReadyRepository.save({ ...input, ruleDefinition: catalogDefinition,
    catalogSelections: [{ productId: 'sample-main', variantId: null, groupKey: 'main' },
      { productId: 'sample-addon', allVariants: true, groupKey: 'addon' }] }, 'admin');
  db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?, ?, ?)').run('sheet', 'sample-addon', 'PVDF-SHEET', '片', 250);

  const published = runtimeReadyRepository.save({ status: 'active', expectedVersion: draft.ruleVersion }, 'admin', draft.id);
  expect(published.frozenCatalogSelections).toEqual([
    { productId: 'sample-main', variantId: null, groupKey: 'main', referenceCents: 10000 },
    { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon', referenceCents: 20000 },
    { productId: 'sample-addon', variantId: 'sheet', groupKey: 'addon', referenceCents: 25000 },
  ]);

  runtimeReadyRepository.save({ status: 'paused' }, 'admin', published.id);
  runtimeReadyRepository.save({ name: '仅修改名称', products: published.products.map(({ productId, variantId, groupKey }) => ({ productId, variantId, groupKey })),
    catalogSelections: published.catalogSelections }, 'admin', published.id);
  db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?, ?, ?)').run('tube', 'sample-addon', 'PVDF-TUBE', '管', 300);
  db.prepare('UPDATE ProductVariant SET originalPrice = ? WHERE id = ?').run(275, 'roll');
  const republished = runtimeReadyRepository.save({ status: 'active' }, 'admin', published.id);
  expect(republished.frozenCatalogSelections?.map(({ variantId }) => variantId)).toEqual([null, 'roll', 'sheet']);
  expect(republished.frozenCatalogSelections?.find(({ variantId }) => variantId === 'roll')?.referenceCents).toBe(27500);
});
it('暂停期间显式更改选择后，重新发布建立新的规格冻结', () => {
  const catalogDefinition = { ...input.ruleDefinition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } };
  const runtimeReadyRepository = new PromotionRepository(db, () => true);
  const draft = runtimeReadyRepository.save({ ...input, ruleDefinition: catalogDefinition,
    catalogSelections: [{ productId: 'sample-main', variantId: null, groupKey: 'main' },
      { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon' }] }, 'admin');
  const published = runtimeReadyRepository.save({ status: 'active' }, 'admin', draft.id);
  runtimeReadyRepository.save({ status: 'paused' }, 'admin', published.id);
  db.prepare('INSERT INTO ProductVariant VALUES (?, ?, ?, ?, ?)').run('sheet', 'sample-addon', 'PVDF-SHEET', '片', 250);
  const changed = runtimeReadyRepository.save({ products: [
    { productId: 'sample-main', variantId: null, groupKey: 'main' },
    { productId: 'sample-addon', variantId: 'sheet', groupKey: 'addon' },
  ] }, 'admin', published.id);
  expect(changed.frozenCatalogSelections).toBeUndefined();
  const republished = runtimeReadyRepository.save({ status: 'active' }, 'admin', changed.id);
  expect(republished.frozenCatalogSelections).toEqual([
    { productId: 'sample-main', variantId: null, groupKey: 'main', referenceCents: 10000 },
    { productId: 'sample-addon', variantId: 'sheet', groupKey: 'addon', referenceCents: 25000 },
  ]);
});
