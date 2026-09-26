import Database from 'better-sqlite3';
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
  db.exec(`CREATE TABLE Product (id TEXT PRIMARY KEY, name TEXT, catalogNumber TEXT, hazardous INTEGER);
    CREATE TABLE ProductVariant (id TEXT PRIMARY KEY, productId TEXT, catalogNumber TEXT, spec TEXT);
    CREATE TABLE Promotion (id TEXT PRIMARY KEY,name TEXT,type TEXT,value REAL,status TEXT,startsAt INTEGER,endsAt INTEGER,priority INTEGER,exclusive INTEGER,createdBy TEXT,createdAt INTEGER,updatedAt INTEGER,ruleDefinition TEXT,ruleVersion INTEGER);
    CREATE TABLE PromotionProduct (id TEXT PRIMARY KEY,promotionId TEXT,productId TEXT,variantId TEXT,groupKey TEXT);
    CREATE TABLE AuditLog (id TEXT PRIMARY KEY,actorId TEXT,action TEXT,resource TEXT,targetType TEXT,targetId TEXT,beforeData TEXT,afterData TEXT,createdAt INTEGER);
    INSERT INTO Product VALUES ('sample-main','凝胶','GEL',0),('sample-addon','膜','PVDF',0);
    INSERT INTO ProductVariant VALUES ('roll','sample-addon','PVDF-ROLL','卷');`);
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
it('旧活动与新规则可以同时保留候选关系', () => {
  repository.save({ ...input, ruleDefinition: null, type: 'fixed_price', value: 10,
    products: [{ productId: 'sample-addon', variantId: null }], status: 'active' }, 'admin');
  expect(repository.save({ ...input, status: 'active' }, 'admin').status).toBe('active');
});
