/**
 * 优惠券适用范围。
 *
 * 一张券只选一种范围：全站、指定品牌、指定品类、指定商品/规格。
 * 结算时只有范围内、且未下架的商品小计参与门槛判断和抵扣上限。
 * 促销标记行与快速下单行仍不计入，与原券策略一致。
 */

/** 券资格判断需要的行字段。购物车行可直接传入。 */
export type CouponScopeLine = {
  isQuickOrder?: boolean;
  promoMark?: unknown;
  quantity: number;
  product: {
    id: string;
    variantId?: string;
    brand: string;
    price: number | null;
    category?: string | null;
    subcategory?: string | null;
    delisted?: boolean;
    promotionIdentity?: CouponPromotionIdentity;
  };
};

export const COUPON_SCOPE_TYPES = ['all', 'brand', 'category', 'product'] as const;
export type CouponScopeType = (typeof COUPON_SCOPE_TYPES)[number];

export type CouponProductTarget = {
  productId: string;
  /** 空表示该商品全部规格。 */
  variantId: string | null;
  label?: string;
};

export type CouponScope =
  | { type: 'all' }
  | { type: 'brand'; brands: string[] }
  | { type: 'category'; categories: string[] }
  | { type: 'product'; products: CouponProductTarget[] };

/** Server-owned promotion policy for coupon eligibility. Omitted means legacy behavior. */
export type CouponPromotionPolicy =
  | { state: 'knownnone' }
  | { state: 'restricted'; promotionIds: string[] }
  | { state: 'unknown' };

/** Trusted result of resolving a line's winning promotion identity. */
export type CouponPromotionIdentity =
  | { state: 'knownnone' }
  | { state: 'restricted'; promotionId: string }
  | { state: 'unknown' };

export const COUPON_SCOPE_EMPTY_MESSAGE = '订单中没有符合该优惠券适用范围的商品';

const MAX_TARGETS = 50;
const MAX_NAME_LENGTH = 80;

export function isCouponScopeType(value: unknown): value is CouponScopeType {
  return typeof value === 'string' && (COUPON_SCOPE_TYPES as readonly string[]).includes(value);
}

function parseTargetArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringTargets(value: unknown): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of parseTargetArray(value)) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function productTargets(value: unknown): CouponProductTarget[] {
  const seen = new Set<string>();
  const products: CouponProductTarget[] = [];
  for (const item of parseTargetArray(value)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { productId?: unknown; variantId?: unknown; label?: unknown };
    if (typeof record.productId !== 'string' || record.productId.trim() === '') continue;
    const productId = record.productId.trim();
    const variantId = typeof record.variantId === 'string' && record.variantId.trim() !== ''
      ? record.variantId.trim()
      : null;
    const key = `${productId}\0${variantId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    products.push({ productId, variantId, ...(label ? { label } : {}) });
  }
  return collapseWholeProductTargets(products);
}

/** 已选「全部规格」时，同一商品的单个规格目标是多余的。 */
function collapseWholeProductTargets(products: CouponProductTarget[]): CouponProductTarget[] {
  const wholeProductIds = new Set(products.filter((item) => item.variantId == null).map((item) => item.productId));
  return products.filter((item) => item.variantId == null || !wholeProductIds.has(item.productId));
}

/**
 * 读取库里的范围。缺省、空值和 all 都按全站。
 * 无法识别的 scopeType 不回落成全站，避免脏数据放大成全站抵扣。
 */
export function parseCouponScope(scopeType: unknown, scopeTargets?: unknown): CouponScope {
  const type = typeof scopeType === 'string' ? scopeType.trim() : '';
  if (type === '' || type === 'all') return { type: 'all' };
  if (type === 'brand') return { type: 'brand', brands: stringTargets(scopeTargets) };
  if (type === 'category') return { type: 'category', categories: stringTargets(scopeTargets) };
  if (type === 'product') return { type: 'product', products: productTargets(scopeTargets) };
  return { type: 'product', products: [] };
}

export function serializeCouponScope(scope: CouponScope): { scopeType: CouponScopeType; scopeTargets: string } {
  if (scope.type === 'all') return { scopeType: 'all', scopeTargets: '[]' };
  if (scope.type === 'brand') return { scopeType: 'brand', scopeTargets: JSON.stringify(scope.brands) };
  if (scope.type === 'category') return { scopeType: 'category', scopeTargets: JSON.stringify(scope.categories) };
  return { scopeType: 'product', scopeTargets: JSON.stringify(scope.products) };
}

export function formatCouponScopeLabel(scope: CouponScope): string {
  if (scope.type === 'all') return '全站商品';
  if (scope.type === 'brand') {
    if (scope.brands.length === 0) return '仅限指定品牌';
    return `仅限 ${scope.brands.join('、')} 品牌`;
  }
  if (scope.type === 'category') {
    if (scope.categories.length === 0) return '仅限指定品类';
    return `仅限 ${scope.categories.join('、')} 品类`;
  }
  const labels = scope.products.map((item) => item.label?.trim() || item.productId);
  if (labels.length === 0) return '仅限指定商品';
  if (labels.length <= 3) return `仅限 ${labels.join('、')}`;
  return `仅限 ${labels.slice(0, 3).join('、')} 等 ${labels.length} 个商品`;
}

export type CouponScopeWriteResult =
  | { ok: true; scopeType: CouponScopeType; scopeTargets: string; scope: CouponScope }
  | { ok: false; error: string };

function uniqueNames(value: unknown, label: string): { ok: true; names: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: `请至少选择一个${label}` };
  }
  if (value.length > MAX_TARGETS) {
    return { ok: false, error: `${label}最多选择 ${MAX_TARGETS} 个` };
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: `${label}格式无效` };
    const name = item.trim();
    if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, error: `${label}名称无效` };
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (names.length === 0) return { ok: false, error: `请至少选择一个${label}` };
  return { ok: true, names };
}

/**
 * 校验管理端提交的范围。未传 scopeType 时保持全站，方便旧的创建请求。
 * 商品标签在这里只做形状整理，落库前仍要用数据库里的商品名覆盖。
 */
export function normalizeCouponScopeInput(body: {
  scopeType?: unknown;
  scopeTargets?: unknown;
} | null | undefined): CouponScopeWriteResult {
  if (!body || body.scopeType == null || body.scopeType === '') {
    const scope: CouponScope = { type: 'all' };
    return { ok: true, ...serializeCouponScope(scope), scope };
  }
  if (!isCouponScopeType(body.scopeType)) {
    return { ok: false, error: '适用范围类型无效' };
  }
  if (body.scopeType === 'all') {
    const scope: CouponScope = { type: 'all' };
    return { ok: true, ...serializeCouponScope(scope), scope };
  }
  if (body.scopeType === 'brand') {
    const names = uniqueNames(body.scopeTargets, '品牌');
    if (!names.ok) return names;
    const scope: CouponScope = { type: 'brand', brands: names.names };
    return { ok: true, ...serializeCouponScope(scope), scope };
  }
  if (body.scopeType === 'category') {
    const names = uniqueNames(body.scopeTargets, '品类');
    if (!names.ok) return names;
    const scope: CouponScope = { type: 'category', categories: names.names };
    return { ok: true, ...serializeCouponScope(scope), scope };
  }
  if (!Array.isArray(body.scopeTargets) || body.scopeTargets.length === 0) {
    return { ok: false, error: '请至少选择一个商品' };
  }
  if (body.scopeTargets.length > MAX_TARGETS) {
    return { ok: false, error: `商品最多选择 ${MAX_TARGETS} 个` };
  }
  const products: CouponProductTarget[] = [];
  const seen = new Set<string>();
  for (const item of body.scopeTargets) {
    if (!item || typeof item !== 'object') return { ok: false, error: '商品范围格式无效' };
    const record = item as { productId?: unknown; variantId?: unknown; label?: unknown };
    if (typeof record.productId !== 'string' || record.productId.trim() === '' || record.productId.trim().length > 80) {
      return { ok: false, error: '商品范围格式无效' };
    }
    const variantId = record.variantId == null || record.variantId === ''
      ? null
      : record.variantId;
    if (variantId != null && (typeof variantId !== 'string' || variantId.trim() === '' || variantId.trim().length > 80)) {
      return { ok: false, error: '商品规格格式无效' };
    }
    const productId = record.productId.trim();
    const normalizedVariantId = typeof variantId === 'string' ? variantId.trim() : null;
    const key = `${productId}\0${normalizedVariantId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 160) : '';
    products.push({ productId, variantId: normalizedVariantId, ...(label ? { label } : {}) });
  }
  const collapsed = collapseWholeProductTargets(products);
  if (collapsed.length === 0) return { ok: false, error: '请至少选择一个商品' };
  const scope: CouponScope = { type: 'product', products: collapsed };
  return { ok: true, ...serializeCouponScope(scope), scope };
}

export function lineMatchesCouponScope(line: CouponScopeLine, scope: CouponScope): boolean {
  if (line.product.delisted) return false;
  if (scope.type === 'all') return true;
  if (scope.type === 'brand') return scope.brands.includes(line.product.brand);
  if (scope.type === 'category') {
    const category = line.product.category?.trim() ?? '';
    const subcategory = line.product.subcategory?.trim() ?? '';
    return (category !== '' && scope.categories.includes(category))
      || (subcategory !== '' && scope.categories.includes(subcategory));
  }
  return scope.products.some((target) => {
    if (target.productId !== line.product.id) return false;
    if (!target.variantId) return true;
    return line.product.variantId === target.variantId;
  });
}

/** 参与券门槛和抵扣的行：排除快速下单、促销标记行，再按范围和下架状态过滤。 */
export function couponScopedLines(items: CouponScopeLine[], scope: CouponScope): {
  subtotal: number;
  inScopeCount: number;
  baseCount: number;
} {
  const base = items.filter((item) => !item.isQuickOrder && !item.promoMark);
  const inScope = base.filter((item) => lineMatchesCouponScope(item, scope));
  const subtotal = inScope.reduce((sum, item) => sum + (item.product.price ?? 0) * item.quantity, 0);
  return { subtotal, inScopeCount: inScope.length, baseCount: base.length };
}

export function couponLineIsInScope(item: CouponScopeLine, scope: CouponScope): boolean {
  return !item.product.delisted && lineMatchesCouponScope(item, scope);
}

/** Trusted line evidence for the exact items that can change this coupon's subtotal. */
export function couponPromotionEvidenceForScope<T extends CouponScopeLine & {
  product: CouponScopeLine['product'] & { promotionPricingEvidence?: unknown };
}>(items: T[], scope: CouponScope): unknown[] {
  return items
    .filter((item) => !item.isQuickOrder && !item.promoMark && couponLineIsInScope(item, scope))
    .map((item) => item.product.promotionPricingEvidence);
}

/** Evaluate the configured promotion policy before applying this coupon's own scope. */
export function couponPolicyScopedLines(
  items: CouponScopeLine[],
  scope: CouponScope,
  policy?: CouponPromotionPolicy,
): { subtotal: number; inScopeCount: number; baseCount: number; error?: 'unknown_promotion_identity' } {
  if (!policy) return couponScopedLines(items, scope);
  if (policy.state === 'knownnone') return couponScopedLines(items, scope);

  const base = items.filter((item) => !item.isQuickOrder && !item.promoMark);
  const inScope = base.filter((item) => couponLineIsInScope(item, scope));
  if (policy.state === 'unknown') {
    return inScope.length === 0
      ? { subtotal: 0, inScopeCount: 0, baseCount: base.length }
      : { subtotal: 0, inScopeCount: 0, baseCount: base.length, error: 'unknown_promotion_identity' };
  }
  const permitted: CouponScopeLine[] = [];
  for (const item of inScope) {
    const identity = item.product.promotionIdentity;
    if (!identity || identity.state === 'unknown') {
      return { subtotal: 0, inScopeCount: 0, baseCount: base.length, error: 'unknown_promotion_identity' };
    }
    if (policy.state === 'restricted' && identity.state === 'restricted'
      && policy.promotionIds.includes(identity.promotionId)) continue;
    permitted.push(item);
  }
  const subtotal = permitted.reduce((sum, item) => sum + (item.product.price ?? 0) * item.quantity, 0);
  return { subtotal, inScopeCount: permitted.length, baseCount: base.length };
}
