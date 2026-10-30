import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { getDatabasePath } from './databasePath';
import { parsePromotionDefinition, promotionSkuKey, validatePromotionBindings,
  type PromotionAssignment, type PromotionSkuBinding } from '@/data/promotion-foundation';
import type { BoundPromotion } from '@/data/promotion-calculation';
import { freezeCatalogPromotionSelection, resolvePromotionSelection, type FrozenPromotionSelection, type PromotionSelection } from '@/lib/promotion-selection';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';

type PromotionRow = {
  id: string; name: string; type: string; value: number; status: PromotionAssignment['status'];
  startsAt: number | string; endsAt: number | string; priority: number; exclusive: number;
  ruleDefinition: string | null; ruleVersion: number;
};
export type ManagedPromotion = Omit<PromotionRow, 'startsAt' | 'endsAt' | 'ruleDefinition'> & {
  startsAt: string; endsAt: string; ruleDefinition: ReturnType<typeof parsePromotionDefinition> | null;
  catalogSelections?: PromotionSelection[];
  frozenCatalogSelections?: FrozenPromotionSelection[];
  products: Array<PromotionSkuBinding & { product: { id: string; name: string; catalogNumber: string }; variant: { id: string; catalogNumber: string; spec: string } | null }>;
};

export const foundationEnabled = () => process.env.PROMOTION_FOUNDATION_ENABLED === 'true';

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('INVALID_PROMOTION_INPUT');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error('INVALID_PROMOTION_INPUT');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, (item) => canonicalJson(item, ancestors)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key], ancestors)}`).join(',')}}`;
  } finally { ancestors.delete(value); }
}

function sameSelectionIntent(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const normalize = (items: unknown[]) => items.map((item) => {
    if (!item || typeof item !== 'object') return JSON.stringify(item);
    const entry = item as Record<string, unknown>;
    return JSON.stringify('allVariants' in entry
      ? [entry.productId, entry.groupKey, 'allVariants']
      : [entry.productId, entry.groupKey, entry.variantId]);
  }).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function sameBindings(left: PromotionSkuBinding[], right: PromotionSkuBinding[]): boolean {
  const normalize = (items: PromotionSkuBinding[]) => items
    .map(({ productId, variantId, groupKey }) => JSON.stringify([productId, variantId ?? null, groupKey]))
    .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/** 写操作统一经同一 SQLite immediate 事务，发布前检查与写入不可分割。 */
export class PromotionRepository {
  constructor(private db: Database.Database, private readonly catalogRuntimeReady: () => boolean = unifiedPromotionRuntimeEnabled) {}

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
    const definition = row.ruleDefinition ? parsePromotionDefinition(JSON.parse(row.ruleDefinition)) : null;
    const selectionRow = definition?.priceBasis === 'catalog'
      ? this.db.prepare('SELECT selectorsJson, frozenJson FROM PromotionCatalogSelection WHERE promotionId = ?').get(row.id) as { selectorsJson: string; frozenJson: string | null } | undefined
      : undefined;
    return { id: row.id, name: row.name, type: row.type, value: row.value, status: row.status,
      startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(),
      priority: row.priority, exclusive: row.exclusive, ruleVersion: row.ruleVersion,
      ruleDefinition: definition,
      ...(selectionRow ? { catalogSelections: JSON.parse(selectionRow.selectorsJson) as PromotionSelection[],
        ...(selectionRow.frozenJson ? { frozenCatalogSelections: JSON.parse(selectionRow.frozenJson) as FrozenPromotionSelection[] } : {}) } : {}),
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

  save(input: Record<string, unknown>, actorId: string, id?: string, requestKey?: string): ManagedPromotion {
    return this.db.transaction(() => {
      let requestHash: string | undefined;
      if (requestKey !== undefined) {
        if (id || !actorId || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey)) throw new Error('INVALID_PROMOTION_IDEMPOTENCY_KEY');
        requestHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
        const receipt = this.db.prepare('SELECT requestHash, resultJson FROM PromotionCreateReceipt WHERE actorId = ? AND requestKey = ?')
          .get(actorId, requestKey) as { requestHash: string; resultJson: string } | undefined;
        if (receipt) {
          if (receipt.requestHash !== requestHash) throw new Error('PROMOTION_IDEMPOTENCY_CONFLICT');
          return JSON.parse(receipt.resultJson) as ManagedPromotion;
        }
      }
      const before = id ? this.get(id) : null;
      if (input.expectedVersion !== undefined) {
        if (!before || typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== before.ruleVersion) {
          throw new Error('PROMOTION_VERSION_CONFLICT');
        }
      }
      if (before?.status === 'ended') throw new Error('PROMOTION_ENDED');
      if (before?.status === 'active' && Object.keys(input).some((key) => key !== 'status' && key !== 'expectedVersion')) throw new Error('PROMOTION_PAUSE_BEFORE_EDIT');
      const status = String(input.status ?? before?.status ?? 'draft') as PromotionAssignment['status'];
      const name = String(input.name ?? before?.name ?? '').trim();
      const startsAt = new Date(String(input.startsAt ?? before?.startsAt ?? ''));
      const endsAt = new Date(String(input.endsAt ?? before?.endsAt ?? ''));
      if (!name || name.length > 200 || !['draft', 'active', 'paused', 'ended'].includes(status)
        || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new Error('INVALID_PROMOTION_INPUT');
      const rawDefinition = input.ruleDefinition === undefined ? before?.ruleDefinition : input.ruleDefinition;
      const definition = rawDefinition ? parsePromotionDefinition(rawDefinition) : null;
      if (input.catalogSelections !== undefined && definition?.priceBasis !== 'catalog') throw new Error('INVALID_PROMOTION_SELECTION');
      if (before?.ruleDefinition && !definition) throw new Error('INVALID_PROMOTION_DEFINITION');
      const type = definition ? 'rule' : String(input.type ?? before?.type ?? '');
      const value = definition ? 0 : Number(input.value ?? before?.value);
      const priority = Number(input.priority ?? before?.priority ?? 0);
      const exclusive = input.exclusive === undefined ? Boolean(before?.exclusive ?? true) : Boolean(input.exclusive);
      if (!definition && (!['fixed_price', 'discount_rate', 'amount_off'].includes(type)
        || !Number.isFinite(value) || value < 0 || (type === 'discount_rate' && (value <= 0 || value > 1)))) throw new Error('INVALID_PROMOTION_VALUE');
      if (!Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) throw new Error('INVALID_PROMOTION_PRIORITY');
      const catalogSelectionRow = definition?.priceBasis === 'catalog' && before
        ? this.db.prepare('SELECT frozenJson FROM PromotionCatalogSelection WHERE promotionId = ?').get(before.id) as { frozenJson: string | null } | undefined
        : undefined;
      const rawSelections = definition?.priceBasis === 'catalog'
        ? input.catalogSelections ?? (input.products === undefined
          ? (status === 'active' && catalogSelectionRow?.frozenJson
            ? JSON.parse(catalogSelectionRow.frozenJson).map(({ productId, variantId, groupKey }: FrozenPromotionSelection) => ({ productId, variantId, groupKey }))
            : before?.catalogSelections)
          : undefined) : undefined;
      const selections = rawSelections === undefined ? undefined : rawSelections as PromotionSelection[];
      const rawBindings = selections === undefined ? input.products ?? before?.products : resolvePromotionSelection(this.db, selections);
      if (!Array.isArray(rawBindings) || !rawBindings.length || rawBindings.length > 2000) throw new Error('PROMOTION_PRODUCTS_REQUIRED');
      const bindings: PromotionSkuBinding[] = rawBindings.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('INVALID_PROMOTION_BINDING');
        const entry = item as Record<string, unknown>;
        if ('allVariants' in entry) throw new Error('INVALID_PROMOTION_BINDING');
        if (typeof entry.productId !== 'string' || (entry.variantId != null && typeof entry.variantId !== 'string')) throw new Error('INVALID_PROMOTION_BINDING');
        const productId = entry.productId;
        const variantId = entry.variantId ? String(entry.variantId) : null;
        const previous = before?.products.find((binding) => binding.productId === productId && binding.variantId === variantId);
        return { productId, variantId, groupKey: definition ? String(entry.groupKey ?? '') : (previous?.groupKey ?? 'main') };
      });
      const explicitSelectionChange = definition?.priceBasis === 'catalog' && (input.catalogSelections !== undefined
        ? !sameSelectionIntent(input.catalogSelections, before?.catalogSelections)
        : input.products !== undefined && !sameBindings(bindings, before?.products ?? []));
      if (definition) validatePromotionBindings(definition, bindings);
      if (new Set(bindings.map(promotionSkuKey)).size !== bindings.length) throw new Error('DUPLICATE_PROMOTION_SKU');
      for (const binding of bindings) {
        const product = this.db.prepare('SELECT id, hazardous, deletedAt FROM Product WHERE id = ?').get(binding.productId) as { id: string; hazardous: number; deletedAt: string | null } | undefined;
        if (!product || product.hazardous || product.deletedAt) throw new Error('INVALID_PROMOTION_PRODUCT');
        if (binding.variantId && !this.db.prepare('SELECT id FROM ProductVariant WHERE id = ? AND productId = ?').get(binding.variantId, binding.productId)) throw new Error('INVALID_PROMOTION_VARIANT');
      }
      const frozenForPublish = definition?.priceBasis === 'catalog' && status === 'active'
        ? freezeCatalogPromotionSelection(this.db, selections ?? bindings) : undefined;
      const publishedBindings = frozenForPublish
        ? frozenForPublish.map(({ productId, variantId, groupKey }) => ({ productId, variantId, groupKey }))
        : bindings;
      if (definition) validatePromotionBindings(definition, publishedBindings);
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
      for (const binding of publishedBindings) insert.run(randomUUID(), key, binding.productId, binding.variantId, binding.groupKey);
      if (definition?.priceBasis === 'catalog') {
        const storedSelections = frozenForPublish
          ? frozenForPublish.map(({ productId, variantId, groupKey }) => ({ productId, variantId, groupKey }))
          : (selections ?? bindings);
        const frozenJson = frozenForPublish ? JSON.stringify(frozenForPublish) : (explicitSelectionChange ? null : catalogSelectionRow?.frozenJson ?? null);
        this.db.prepare(`INSERT INTO PromotionCatalogSelection (promotionId, selectorsJson, frozenJson) VALUES (?, ?, ?)
          ON CONFLICT(promotionId) DO UPDATE SET selectorsJson = excluded.selectorsJson, frozenJson = excluded.frozenJson`)
          .run(key, JSON.stringify(storedSelections), frozenJson);
      } else if (before?.ruleDefinition?.priceBasis === 'catalog') {
        this.db.prepare('DELETE FROM PromotionCatalogSelection WHERE promotionId = ?').run(key);
      }
      const after = this.get(key);
      this.db.prepare(`INSERT INTO AuditLog (id,actorId,action,resource,targetType,targetId,beforeData,afterData,createdAt)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actorId, before ? 'promotion.update' : 'promotion.create', 'pricing', 'Promotion', key,
          before ? JSON.stringify(before) : null, JSON.stringify(after), timestamp);
      if (requestKey !== undefined && requestHash !== undefined) {
        this.db.prepare('INSERT INTO PromotionCreateReceipt (actorId, requestKey, requestHash, resultJson, createdAt) VALUES (?, ?, ?, ?, ?)')
          .run(actorId, requestKey, requestHash, JSON.stringify(after), timestamp);
      }
      // Keep catalog publication closed by default until checkout uses the shared
      // coordinator and rechecks current reference prices against this snapshot.
      if (frozenForPublish && !this.catalogRuntimeReady()) throw new Error('PROMOTION_CATALOG_RUNTIME_NOT_READY');
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
  if (code === 'PROMOTION_VERSION_CONFLICT') return { error: '活动已被其他操作修改，请刷新后重试', status: 409 };
  if (code === 'PROMOTION_IDEMPOTENCY_CONFLICT') return { error: '重复请求的内容不一致', status: 409 };
  if (code === 'PROMOTION_CATALOG_RUNTIME_NOT_READY') return { error: '目录价活动暂未开放发布', status: 503 };
  if (code === 'PROMOTION_CATALOG_PRICE_REQUIRED') return { error: '所选商品或规格缺少有效目录价', status: 400 };
  if (code === 'PROMOTION_ENUMERATION_LIMIT' || code === 'PROMOTION_SOLVER_LIMIT') return { error: '促销组合过多，无法完成精确试算，请减少所选商品或调整活动', status: 409 };
  if (code === 'UNIFIED_PROMOTION_ID_COLLISION') return { error: '促销标识冲突，请联系管理员处理', status: 409 };
  if (code === 'PROMOTION_PRICE_COVERAGE_REQUIRED') return { error: '部分商品没有可用价格，请询价或重新确认促销', status: 409 };
  if (code.startsWith('INVALID_')) return { error: '活动配置无效，请检查规则、商品规格和有效期', status: 400 };
  return { error: '促销服务暂时不可用，请稍后重试', status: 503 };
}
