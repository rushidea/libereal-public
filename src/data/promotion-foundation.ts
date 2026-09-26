/** 规则仅描述机制与参数，具体商品通过 PromotionProduct 绑定。金额使用分。 */
export type PromotionBenefit =
  | { kind: 'gift' }
  | { kind: 'fixed-price'; unitPriceCents: number }
  | { kind: 'amount-off'; amountCents: number }
  | { kind: 'percentage'; basisPoints: number }
  | { kind: 'group-price'; groupPriceCents: number };

export interface PromotionGroup {
  key: string;
  role: 'qualifier' | 'benefit' | 'qualifier-and-benefit';
  /** 计量单位仅作标识，禁止从商品名称推测箱、盒之间的换算。 */
  unit: string;
  quantity: number;
}

export interface PromotionDefinition {
  schemaVersion: 1;
  template: 'addon' | 'gift' | 'same-sku-gift' | 'bundle' | 'direct-price' | 'buy-n-get-m';
  groups: PromotionGroup[];
  benefit: PromotionBenefit;
  repeat: boolean;
  maxApplications: number | null;
  /** 同款买赠、买 N 免 M：quantity 为一组总件数，freeQuantity 为其中免费件数。 */
  freeQuantity?: number;
  /** 成组价必须满足完整权益组，单件价允许按可用额度购买。 */
  partialBenefit: boolean;
}

export interface PromotionSkuBinding {
  productId: string;
  variantId: string | null;
  groupKey: string;
}

export interface PromotionAssignment {
  id: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
  startsAt: Date;
  endsAt: Date;
  bindings: PromotionSkuBinding[];
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function cents(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parsePromotionDefinition(value: unknown): PromotionDefinition {
  if (!record(value) || value.schemaVersion !== 1
    || !['addon', 'gift', 'same-sku-gift', 'bundle', 'direct-price', 'buy-n-get-m'].includes(String(value.template))
    || typeof value.repeat !== 'boolean' || typeof value.partialBenefit !== 'boolean'
    || !(value.maxApplications === null || positiveInteger(value.maxApplications))
    || !Array.isArray(value.groups) || value.groups.length === 0 || !record(value.benefit)) {
    throw new Error('INVALID_PROMOTION_DEFINITION');
  }
  const keys = new Set<string>();
  for (const group of value.groups) {
    if (!record(group) || typeof group.key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(group.key)
      || keys.has(group.key) || typeof group.unit !== 'string' || !group.unit.trim()
      || !positiveInteger(group.quantity)
      || !['qualifier', 'benefit', 'qualifier-and-benefit'].includes(String(group.role))) {
      throw new Error('INVALID_PROMOTION_GROUP');
    }
    keys.add(group.key);
  }
  const definition = value as unknown as PromotionDefinition;
  const qualifiers = definition.groups.filter((group) => group.role !== 'benefit');
  const benefits = definition.groups.filter((group) => group.role !== 'qualifier');
  if (!benefits.length || (definition.template !== 'direct-price' && !qualifiers.length)) {
    throw new Error('PROMOTION_GROUPS_REQUIRED');
  }
  const benefit = value.benefit;
  const validBenefit = benefit.kind === 'gift'
    || (benefit.kind === 'fixed-price' && cents(benefit.unitPriceCents))
    || (benefit.kind === 'amount-off' && cents(benefit.amountCents))
    || (benefit.kind === 'group-price' && cents(benefit.groupPriceCents) && !definition.partialBenefit)
    || (benefit.kind === 'percentage' && positiveInteger(benefit.basisPoints) && benefit.basisPoints <= 10000);
  if (!validBenefit) throw new Error('INVALID_PROMOTION_BENEFIT');
  if (['gift', 'same-sku-gift', 'buy-n-get-m'].includes(definition.template) && benefit.kind !== 'gift') {
    throw new Error('INVALID_PROMOTION_TEMPLATE_BENEFIT');
  }
  if (['same-sku-gift', 'buy-n-get-m'].includes(definition.template)) {
    if (definition.groups.length !== 1 || definition.groups[0].role !== 'qualifier-and-benefit'
      || !positiveInteger(definition.freeQuantity) || definition.freeQuantity >= definition.groups[0].quantity) {
      throw new Error('INVALID_PROMOTION_FREE_QUANTITY');
    }
  } else if (definition.freeQuantity !== undefined) {
    throw new Error('INVALID_PROMOTION_FREE_QUANTITY');
  }
  if (['addon', 'gift'].includes(definition.template)
    && (definition.groups.some((group) => group.role === 'qualifier-and-benefit') || benefits.length !== 1)) {
    throw new Error('INVALID_PROMOTION_GROUP_ROLES');
  }
  if (definition.template === 'direct-price' && (qualifiers.length > 0 || benefits.length !== 1)) {
    throw new Error('INVALID_PROMOTION_GROUP_ROLES');
  }
  if (benefit.kind === 'group-price' && benefits.length !== 1) throw new Error('INVALID_PROMOTION_GROUP_PRICE');
  let normalizedBenefit: PromotionBenefit;
  switch (definition.benefit.kind) {
    case 'gift': normalizedBenefit = { kind: 'gift' }; break;
    case 'fixed-price': normalizedBenefit = { kind: 'fixed-price', unitPriceCents: definition.benefit.unitPriceCents }; break;
    case 'amount-off': normalizedBenefit = { kind: 'amount-off', amountCents: definition.benefit.amountCents }; break;
    case 'percentage': normalizedBenefit = { kind: 'percentage', basisPoints: definition.benefit.basisPoints }; break;
    case 'group-price': normalizedBenefit = { kind: 'group-price', groupPriceCents: definition.benefit.groupPriceCents }; break;
  }
  return {
    schemaVersion: 1, template: definition.template,
    groups: definition.groups.map(({ key, role, unit, quantity }) => ({ key, role, unit, quantity })),
    benefit: normalizedBenefit, repeat: definition.repeat, maxApplications: definition.maxApplications,
    partialBenefit: definition.partialBenefit,
    ...(definition.freeQuantity === undefined ? {} : { freeQuantity: definition.freeQuantity }),
  };
}

/** 无规格绑定指向商品本身，不代表该商品的所有规格。 */
export function promotionSkuKey(binding: Pick<PromotionSkuBinding, 'productId' | 'variantId'>): string {
  return JSON.stringify([binding.productId, binding.variantId]);
}

export function validatePromotionBindings(definition: PromotionDefinition, bindings: PromotionSkuBinding[]): void {
  parsePromotionDefinition(definition);
  const groups = new Set(definition.groups.map((group) => group.key));
  const boundGroups = new Set<string>();
  const skus = new Set<string>();
  for (const binding of bindings) {
    if (!binding || typeof binding.productId !== 'string' || !binding.productId.trim()
      || !(binding.variantId === null || (typeof binding.variantId === 'string' && binding.variantId.trim()))
      || !groups.has(binding.groupKey)) throw new Error('INVALID_PROMOTION_BINDING');
    const key = promotionSkuKey(binding);
    if (skus.has(key)) throw new Error('DUPLICATE_PROMOTION_SKU');
    skus.add(key);
    boundGroups.add(binding.groupKey);
  }
  if ([...groups].some((key) => !boundGroups.has(key))) throw new Error('PROMOTION_GROUP_WITHOUT_SKUS');
}

/** 发布事务中调用；时间采用左闭右开区间，活动交接时刻可以相同。 */
export function findPromotionConflicts(candidate: PromotionAssignment, existing: PromotionAssignment[]): string[] {
  if (!Number.isFinite(candidate.startsAt.getTime()) || !Number.isFinite(candidate.endsAt.getTime())
    || candidate.startsAt >= candidate.endsAt) throw new Error('INVALID_PROMOTION_PERIOD');
  if (candidate.status !== 'active') return [];
  if (existing.some((entry) => entry.status === 'active'
    && (!Number.isFinite(entry.startsAt.getTime()) || !Number.isFinite(entry.endsAt.getTime())
      || entry.startsAt >= entry.endsAt))) throw new Error('INVALID_PROMOTION_PERIOD');
  const skus = new Set(candidate.bindings.map(promotionSkuKey));
  return existing.filter((entry) => entry.id !== candidate.id && entry.status === 'active'
    && entry.startsAt < candidate.endsAt && entry.endsAt > candidate.startsAt
    && entry.bindings.some((binding) => skus.has(promotionSkuKey(binding))))
    .map((entry) => entry.id);
}
