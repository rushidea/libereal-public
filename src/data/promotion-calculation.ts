import { parsePromotionDefinition, promotionSkuKey, validatePromotionBindings,
  type PromotionAssignment, type PromotionDefinition } from './promotion-foundation';

export interface BoundPromotion extends PromotionAssignment {
  name: string;
  version: number;
  priority?: number;
  exclusive?: boolean;
  definition: PromotionDefinition;
}
export interface PromotionPricingLine {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceCents: number;
  basePriceCents: number;
}
export interface PromotionStatus {
  id: string;
  name: string;
  version: number;
  qualified: boolean;
  groups: Array<{ key: string; unit: string; current: number; required: number; remaining: number }>;
  discountedQuantity: number;
  discountCents: number;
  message: string;
}
export interface PromotionCalculation {
  discountCents: number;
  lineDiscounts: Record<string, number>;
  lineRules: Record<string, { id: string; version: number }>;
  lineAllocations: Record<string, Array<{ id: string; version: number; quantity: number; discountCents: number }>>;
  appliedRules: Record<string, number>;
  statuses: PromotionStatus[];
}

function integer(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('INVALID_PROMOTION_AMOUNT');
  return value;
}

/** 商品身份与基准价格须由服务端核验。此函数只分配优惠，从不增添购物车商品。 */
export function calculateBoundPromotions(lines: PromotionPricingLine[], campaigns: BoundPromotion[], now = new Date()): PromotionCalculation {
  const result: PromotionCalculation = { discountCents: 0, lineDiscounts: {}, lineRules: {}, lineAllocations: {}, appliedRules: {}, statuses: [] };
  const ids = new Set<string>();
  for (const line of lines) {
    if (ids.has(line.id)) throw new Error('DUPLICATE_PROMOTION_LINE');
    ids.add(line.id);
    integer(line.quantity, 1); integer(line.unitPriceCents); integer(line.basePriceCents);
    integer(line.quantity * Math.max(line.unitPriceCents, line.basePriceCents));
  }
  const remaining = new Map(lines.map((line) => [line.id, line.quantity]));
  const active = campaigns.filter((campaign) => campaign.status === 'active'
    && campaign.startsAt <= now && campaign.endsAt > now)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  for (const campaign of active) {
    validatePromotionBindings(campaign.definition, campaign.bindings);
  }
  for (const campaign of active) {
    const beforeCampaign = new Map(remaining);
    const definition = parsePromotionDefinition(campaign.definition);
    const bindings = new Map(campaign.bindings.map((binding) => [promotionSkuKey(binding), binding.groupKey]));
    const participating = lines.filter((line) => bindings.has(promotionSkuKey(line)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!participating.length) continue;
    const groupLines = (key: string) => participating.filter((line) => bindings.get(promotionSkuKey(line)) === key);
    const availableQuantity = (line: PromotionPricingLine) => remaining.get(line.id) ?? 0;
    const groups = definition.groups.map((group) => {
      const current = groupLines(group.key).reduce((sum, line) => sum + availableQuantity(line), 0);
      return { key: group.key, unit: group.unit, current, required: group.quantity, remaining: Math.max(0, group.quantity - current) };
    });
    const qualifiers = definition.groups.filter((group) => group.role !== 'benefit');
    let applications = qualifiers.length ? Math.min(...qualifiers.map((group) =>
      Math.floor(groupLines(group.key).reduce((sum, line) => sum + availableQuantity(line), 0) / group.quantity))) : 1;
    if (!definition.repeat) applications = Math.min(applications, 1);
    if (definition.maxApplications !== null) applications = Math.min(applications, definition.maxApplications);
    if (!['direct-price', 'same-sku-gift', 'buy-n-get-m'].includes(definition.template)) {
      for (const group of definition.groups.filter((entry) => entry.role === 'benefit')) {
        const count = groupLines(group.key).reduce((sum, line) => sum + availableQuantity(line), 0);
        const benefitApplications = definition.partialBenefit
          ? (count > 0 ? Math.ceil(count / group.quantity) : 0)
          : Math.floor(count / group.quantity);
        applications = Math.min(applications, benefitApplications);
      }
    }
    let discountCents = 0;
    let discountedQuantity = 0;
    const allocationDiscounts = new Map<string, number>();
    const allocations = new Map<string, number>();
    const reserve = (candidates: PromotionPricingLine[], quantity: number) => {
      for (const line of candidates) {
        const count = Math.min(quantity, availableQuantity(line));
        if (!count) continue;
        remaining.set(line.id, availableQuantity(line) - count);
        allocations.set(line.id, (allocations.get(line.id) ?? 0) + count);
        quantity -= count;
        if (!quantity) break;
      }
      return quantity === 0;
    };
    const apply = (line: PromotionPricingLine, quantity: number, promotionalTotal: number) => {
      const saving = Math.max(0, integer(line.unitPriceCents * quantity) - integer(promotionalTotal));
      if (saving > 0) result.lineDiscounts[line.id] = integer((result.lineDiscounts[line.id] ?? 0) + saving);
      discountCents = integer(discountCents + saving);
      discountedQuantity += quantity;
      allocationDiscounts.set(line.id, integer((allocationDiscounts.get(line.id) ?? 0) + saving));
    };
    const sameSku = definition.template === 'same-sku-gift';
    const buyN = definition.template === 'buy-n-get-m';
    if (sameSku || buyN) {
      const size = definition.groups[0].quantity;
      const free = definition.freeQuantity!;
      const batches = sameSku ? [...new Set(participating.map(promotionSkuKey))].map((key) =>
        participating.filter((line) => promotionSkuKey(line) === key)) : [participating];
      let remainingApplications = definition.repeat ? definition.maxApplications ?? Number.MAX_SAFE_INTEGER : 1;
      applications = 0;
      for (const batch of batches) {
        const count = batch.reduce((sum, line) => sum + availableQuantity(line), 0);
        const allowed = Math.min(Math.floor(count / size), remainingApplications);
        remainingApplications -= allowed;
        applications += allowed;
        let offset = 0;
        const freeBefore = (position: number) => Math.floor(position / size) * free + Math.max(0, position % size - (size - free));
        for (const line of [...batch].sort((a, b) => b.unitPriceCents - a.unitPriceCents || a.id.localeCompare(b.id))) {
          const lineQuantity = availableQuantity(line);
          const end = Math.min(offset + lineQuantity, allowed * size);
          const start = Math.min(offset, allowed * size);
          apply(line, freeBefore(end) - freeBefore(start), 0);
          offset += lineQuantity;
        }
        reserve(batch, allowed * size);
      }
    } else if (applications > 0) {
      for (const group of qualifiers) {
        reserve(groupLines(group.key), applications * group.quantity);
      }
      for (const group of definition.groups.filter((entry) => entry.role !== 'qualifier')) {
        const available = groupLines(group.key);
        const count = group.role === 'qualifier-and-benefit'
          ? available.reduce((sum, line) => sum + (allocations.get(line.id) ?? 0), 0)
          : available.reduce((sum, line) => sum + availableQuantity(line), 0);
        let quota = definition.template === 'direct-price'
          ? Math.min(count, definition.repeat ? (definition.maxApplications ?? count) * group.quantity : group.quantity)
          : applications * group.quantity;
        if (!definition.partialBenefit) quota = Math.min(quota, Math.floor(count / group.quantity) * group.quantity);
        const selected: Array<{ line: PromotionPricingLine; quantity: number }> = [];
        for (const line of available) {
          const quantity = Math.min(quota, group.role === 'qualifier-and-benefit'
            ? allocations.get(line.id) ?? 0 : availableQuantity(line));
          quota -= quantity;
          if (quantity) selected.push({ line, quantity });
        }
        if (group.role === 'benefit') reserve(available, selected.reduce((sum, item) => sum + item.quantity, 0));
        if (definition.benefit.kind === 'group-price') {
          const total = selected.reduce((sum, item) => sum + item.line.unitPriceCents * item.quantity, 0);
          if (total === 0) continue;
          const selectedCount = selected.reduce((sum, item) => sum + item.quantity, 0);
          const target = Math.min(total, definition.benefit.groupPriceCents * (selectedCount / group.quantity));
          let remainingTarget = target;
          selected.forEach(({ line, quantity }, index) => {
            const price = index === selected.length - 1 ? remainingTarget : Math.floor(target * (line.unitPriceCents * quantity / total));
            remainingTarget -= price;
            apply(line, quantity, price);
          });
        } else {
          for (const { line, quantity } of selected) {
            const benefit = definition.benefit;
            const price = benefit.kind === 'gift' ? 0
              : benefit.kind === 'fixed-price' ? benefit.unitPriceCents
                : benefit.kind === 'amount-off' ? Math.max(0, line.basePriceCents - benefit.amountCents)
                  : Math.round(line.basePriceCents * benefit.basisPoints / 10000);
            apply(line, quantity, price * quantity);
          }
        }
      }
    }
    const qualified = applications > 0;
    if (discountCents === 0) {
      remaining.clear();
      beforeCampaign.forEach((quantity, lineId) => remaining.set(lineId, quantity));
      allocations.clear();
    }
    if (qualified && allocations.size) {
      result.appliedRules[campaign.id] = campaign.version;
      for (const [lineId, quantity] of allocations) {
        result.lineRules[lineId] ??= { id: campaign.id, version: campaign.version };
        result.lineAllocations[lineId] ??= [];
        result.lineAllocations[lineId].push({ id: campaign.id, version: campaign.version, quantity,
          discountCents: allocationDiscounts.get(lineId) ?? 0 });
      }
    }
    const remainingGroups = groups.filter((group) => qualifiers.some((entry) => entry.key === group.key) && group.remaining > 0);
    result.statuses.push({ id: campaign.id, name: campaign.name, version: campaign.version, qualified,
      groups, discountedQuantity, discountCents,
      message: discountCents > 0 ? `按活动价计算 ${discountedQuantity} 件，其余商品按普通价格计算`
        : !qualified ? remainingGroups.length ? `还需${remainingGroups.map((group) => `${group.remaining} ${group.unit}`).join('、')}` : '同款商品数量尚未满足条件'
          : '主品满足条件，当前所选商品未产生活动优惠',
    });
    result.discountCents = integer(result.discountCents + discountCents);
  }
  return result;
}
