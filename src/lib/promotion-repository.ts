import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDatabasePath } from './databasePath';
import { parsePromotionDefinition, promotionSkuKey, validatePromotionBindings,
  type PromotionAssignment, type PromotionSkuBinding } from '@/data/promotion-foundation';
import type { BoundPromotion } from '@/data/promotion-calculation';

type PromotionRow = {
  id: string; name: string; type: string; value: number; status: PromotionAssignment['status'];
  startsAt: number | string; endsAt: number | string; priority: number; exclusive: number;
  ruleDefinition: string | null; ruleVersion: number;
};
export type ManagedPromotion = Omit<PromotionRow, 'startsAt' | 'endsAt' | 'ruleDefinition'> & {
  startsAt: string; endsAt: string; ruleDefinition: ReturnType<typeof parsePromotionDefinition> | null;
  products: Array<PromotionSkuBinding & { product: { id: string; name: string; catalogNumber: string }; variant: { id: string; catalogNumber: string; spec: string } | null }>;
};

export const foundationEnabled = () => process.env.PROMOTION_FOUNDATION_ENABLED === 'true';

/** 写操作统一经同一 SQLite immediate 事务，发布前检查与写入不可分割。 */
export class PromotionRepository {
  constructor(private db: Database.Database) {}

  list(): ManagedPromotion[] {
    return (this.db.prepare('SELECT * FROM Promotion ORDER BY createdAt DESC').all() as PromotionRow[]).map((row) => this.map(row));
  }

  get(id: string): ManagedPromotion {
    const row = this.db.prepare('SELECT * FROM Promotion WHERE id = ?').get(id) as PromotionRow | undefined;
    if (!row) throw new Error('PROMOTION_NOT_FOUND');
    return this.map(row);
  }

  private map(row: PromotionRow): ManagedPromotion {
    const bindings = this.db.prepare(`SELECT pp.productId, pp.variantId, pp.groupKey,
      p.name, p.catalogNumber, v.catalogNumber AS variantCatalog, v.spec AS variantSpec
      FROM PromotionProduct pp JOIN Product p ON p.id = pp.productId
      LEFT JOIN ProductVariant v ON v.id = pp.variantId WHERE pp.promotionId = ?`).all(row.id) as Array<PromotionSkuBinding & { name: string; catalogNumber: string; variantCatalog: string; variantSpec: string }>;
    return { id: row.id, name: row.name, type: row.type, value: row.value, status: row.status,
      startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(),
      priority: row.priority, exclusive: row.exclusive, ruleVersion: row.ruleVersion,
      ruleDefinition: row.ruleDefinition ? parsePromotionDefinition(JSON.parse(row.ruleDefinition)) : null,
      products: bindings.map((binding) => ({ productId: binding.productId, variantId: binding.variantId, groupKey: binding.groupKey,
        product: { id: binding.productId, name: binding.name, catalogNumber: binding.catalogNumber },
        variant: binding.variantId ? { id: binding.variantId, catalogNumber: binding.variantCatalog, spec: binding.variantSpec } : null,
      })),
    };
  }

  activeForProducts(productIds: string[], now = new Date()): BoundPromotion[] {
    if (!productIds.length) return [];
    const ids = [...new Set(productIds)];
    const rows = this.db.prepare(`SELECT DISTINCT p.* FROM Promotion p JOIN PromotionProduct pp ON pp.promotionId = p.id
      WHERE p.status = 'active' AND p.ruleDefinition IS NOT NULL AND pp.productId IN (${ids.map(() => '?').join(',')})`).all(...ids) as PromotionRow[];
    return rows.map((row) => this.map(row)).filter((row) => new Date(row.startsAt) <= now && new Date(row.endsAt) > now)
      .map((row) => ({ id: row.id, name: row.name, status: row.status, startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt),
        version: row.ruleVersion, priority: row.priority, exclusive: Boolean(row.exclusive), definition: row.ruleDefinition!, bindings: row.products.map(({ productId, variantId, groupKey }) => ({ productId, variantId, groupKey })),
      }));
  }

  save(input: Record<string, unknown>, actorId: string, id?: string): ManagedPromotion {
    return this.db.transaction(() => {
      const before = id ? this.get(id) : null;
      if (before?.status === 'ended') throw new Error('PROMOTION_ENDED');
      if (before?.status === 'active' && Object.keys(input).some((key) => key !== 'status')) throw new Error('PROMOTION_PAUSE_BEFORE_EDIT');
      const status = String(input.status ?? before?.status ?? 'draft') as PromotionAssignment['status'];
      const name = String(input.name ?? before?.name ?? '').trim();
      const startsAt = new Date(String(input.startsAt ?? before?.startsAt ?? ''));
      const endsAt = new Date(String(input.endsAt ?? before?.endsAt ?? ''));
      if (!name || name.length > 200 || !['draft', 'active', 'paused', 'ended'].includes(status)
        || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new Error('INVALID_PROMOTION_INPUT');
      const rawDefinition = input.ruleDefinition === undefined ? before?.ruleDefinition : input.ruleDefinition;
      const definition = rawDefinition ? parsePromotionDefinition(rawDefinition) : null;
      if (before?.ruleDefinition && !definition) throw new Error('INVALID_PROMOTION_DEFINITION');
      const type = definition ? 'rule' : String(input.type ?? before?.type ?? '');
      const value = definition ? 0 : Number(input.value ?? before?.value);
      const priority = Number(input.priority ?? before?.priority ?? 0);
      const exclusive = input.exclusive === undefined ? Boolean(before?.exclusive ?? true) : Boolean(input.exclusive);
      if (!definition && (!['fixed_price', 'discount_rate', 'amount_off'].includes(type)
        || !Number.isFinite(value) || value < 0 || (type === 'discount_rate' && (value <= 0 || value > 1)))) throw new Error('INVALID_PROMOTION_VALUE');
      if (!Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) throw new Error('INVALID_PROMOTION_PRIORITY');
      const rawBindings = input.products ?? before?.products;
      if (!Array.isArray(rawBindings) || !rawBindings.length || rawBindings.length > 2000) throw new Error('PROMOTION_PRODUCTS_REQUIRED');
      const bindings: PromotionSkuBinding[] = rawBindings.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('INVALID_PROMOTION_BINDING');
        const entry = item as Record<string, unknown>;
        if (typeof entry.productId !== 'string' || (entry.variantId != null && typeof entry.variantId !== 'string')) throw new Error('INVALID_PROMOTION_BINDING');
        return { productId: entry.productId, variantId: entry.variantId ? String(entry.variantId) : null,
          groupKey: definition ? String(entry.groupKey ?? '') : 'main' };
      });
      if (definition) validatePromotionBindings(definition, bindings);
      if (new Set(bindings.map(promotionSkuKey)).size !== bindings.length) throw new Error('DUPLICATE_PROMOTION_SKU');
      for (const binding of bindings) {
        const product = this.db.prepare('SELECT id, hazardous FROM Product WHERE id = ?').get(binding.productId) as { id: string; hazardous: number } | undefined;
        if (!product || product.hazardous) throw new Error('INVALID_PROMOTION_PRODUCT');
        if (binding.variantId && !this.db.prepare('SELECT id FROM ProductVariant WHERE id = ? AND productId = ?').get(binding.variantId, binding.productId)) throw new Error('INVALID_PROMOTION_VARIANT');
      }
      const key = id ?? randomUUID();
      const version = (before?.ruleVersion ?? 0) + 1;
      const timestamp = Date.now();
      const definitionJson = definition ? JSON.stringify(definition) : null;
      if (before) this.db.prepare(`UPDATE Promotion SET name=?, type=?, value=?, status=?, startsAt=?, endsAt=?, priority=?, exclusive=?,
        ruleDefinition=?, ruleVersion=?, updatedAt=? WHERE id=?`).run(name, type, value, status, startsAt.getTime(), endsAt.getTime(), priority, exclusive ? 1 : 0, definitionJson, version, timestamp, key);
      else this.db.prepare(`INSERT INTO Promotion (id,name,type,value,status,startsAt,endsAt,priority,exclusive,createdBy,createdAt,updatedAt,ruleDefinition,ruleVersion)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, name, type, value, status, startsAt.getTime(), endsAt.getTime(), priority, exclusive ? 1 : 0, actorId, timestamp, timestamp, definitionJson, version);
      this.db.prepare('DELETE FROM PromotionProduct WHERE promotionId=?').run(key);
      const insert = this.db.prepare('INSERT INTO PromotionProduct (id,promotionId,productId,variantId,groupKey) VALUES (?,?,?,?,?)');
      for (const binding of bindings) insert.run(randomUUID(), key, binding.productId, binding.variantId, binding.groupKey);
      const after = this.get(key);
      this.db.prepare(`INSERT INTO AuditLog (id,actorId,action,resource,targetType,targetId,beforeData,afterData,createdAt)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actorId, before ? 'promotion.update' : 'promotion.create', 'pricing', 'Promotion', key,
          before ? JSON.stringify(before) : null, JSON.stringify(after), timestamp);
      return after;
    }).immediate();
  }
}

export function withPromotionRepository<T>(action: (repository: PromotionRepository, db: Database.Database) => T): T {
  const db = new Database(getDatabasePath(), { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return action(new PromotionRepository(db), db);
  } finally { db.close(); }
}

export function promotionError(error: unknown): { error: string; status: number } {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    PROMOTION_SKU_CONFLICT: '商品在相同有效期内参加了其他活动，请调整商品绑定或活动时间',
    PROMOTION_PAUSE_BEFORE_EDIT: '请先暂停活动，再修改规则和商品',
    PROMOTION_ENDED: '活动已经结束，请新建活动',
    PROMOTION_NOT_FOUND: '活动不存在',
    PROMOTION_PRODUCTS_REQUIRED: '请选择参与商品',
    PROMOTION_GROUP_WITHOUT_SKUS: '每个参与组都需要选择商品',
    DUPLICATE_PROMOTION_SKU: '同一规格只能绑定一个参与组',
  };
  if (messages[code]) return { error: messages[code], status: code === 'PROMOTION_NOT_FOUND' ? 404 : 400 };
  if (code.startsWith('INVALID_')) return { error: '活动配置无效，请检查规则、商品规格和有效期', status: 400 };
  return { error: '促销服务暂时不可用，请稍后重试', status: 503 };
}
