/**
 * 报价接受数量规则。
 *
 * 报价行只保存一个成交单价 `QuoteItem.unitPrice`，行金额是该单价乘以报价数量。
 * `pricingSnapshot` 是报价当时的单价快照。目录阶梯价 `ProductPriceBreak` 不会写入报价，
 * 接受时也不再按新数量重算单价。
 *
 * 因此：
 * - 接受数量可以少于或多于报价数量，总额按报价单价 × 接受数量重算。
 * - 接受数量仍须为不小于 1 的整数；报价行记录了兼容的起订量或包装倍数时一并遵守。
 * - 报价数量 `QuoteItem.quantity` 不因加量改写。`orderedQty` 只记录已被接受覆盖的报价数量，上限就是报价数量。
 *   本次接受数量达到或超过报价剩余时，该行视为全部完成，`orderedQty` 记到报价数量，剩余为 0，不会出现负数。
 *   实际下单数量记在订单行和确认明细里，不写进 `orderedQty`。未覆盖完报价剩余的部分接受仍按实际数量累加。
 *   行一旦完成，不能再次接受。
 * - 接受时不抵扣积分。之后的授信占用、库存预占和回款积分都使用订单上的接受数量与重算金额。
 */
export const QUOTE_ACCEPTANCE_RULES = {
  unitPrice: 'quoted-unit-price',
  exceedQuotedQuantity: true,
  pointsRedeemedAtAcceptance: false,
  orderedQtyCappedAtQuotedQuantity: true,
  reason: 'QuoteItem stores one negotiated unitPrice. ProductPriceBreak tiers are not stored on the quote and are not re-evaluated at acceptance. Quantities may exceed the quote; orderedQty never exceeds the quoted quantity, so remaining is never negative.',
} as const;

export type QuoteQuantityConstraint = {
  minQuantity: number;
  quantityStep: number;
};

export type AcceptedQuantityCode = 'INVALID_QUANTITY' | 'BELOW_MINIMUM' | 'NOT_PACKAGE_MULTIPLE';

export type AcceptedQuantityResult =
  | { ok: true; quantity: number }
  | { ok: false; code: AcceptedQuantityCode };

const QUANTITY_ERRORS: Record<AcceptedQuantityCode, string> = {
  INVALID_QUANTITY: '接受数量必须为不小于 1 的整数。',
  BELOW_MINIMUM: '接受数量低于报价起订量。',
  NOT_PACKAGE_MULTIPLE: '接受数量必须符合报价包装倍数。',
};

export function acceptanceQuantityError(code: AcceptedQuantityCode): string {
  return QUANTITY_ERRORS[code];
}

export function positiveQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readExplicitQuantityConstraint(source: Record<string, unknown> | null | undefined): {
  minQuantity: number | null;
  quantityStep: number | null;
} {
  if (!source) return { minQuantity: null, quantityStep: null };
  return {
    minQuantity: positiveQuantity(source.minQuantity ?? source.moq ?? source.minimumOrderQuantity),
    quantityStep: positiveQuantity(source.quantityStep ?? source.packageQuantity ?? source.packageSize),
  };
}

export function readQuoteQuantityConstraint(metadata: string | null | undefined): QuoteQuantityConstraint {
  let parsed: Record<string, unknown> | null = null;
  if (metadata) {
    try {
      const value = JSON.parse(metadata) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const explicit = readExplicitQuantityConstraint(parsed);
  return {
    minQuantity: explicit.minQuantity ?? 1,
    quantityStep: explicit.quantityStep ?? 1,
  };
}

/** 报价数量自己不满足的起订量或包装倍数不生效，避免历史报价无法下单。 */
export function constraintCompatibleWithQuote(quotedQuantity: number, constraint: QuoteQuantityConstraint): QuoteQuantityConstraint {
  const minQuantity = constraint.minQuantity > 1 && quotedQuantity >= constraint.minQuantity ? constraint.minQuantity : 1;
  const quantityStep = constraint.quantityStep > 1 && quotedQuantity % constraint.quantityStep === 0 ? constraint.quantityStep : 1;
  return { minQuantity, quantityStep };
}

export function effectiveQuoteQuantityConstraint(
  quotedQuantity: number,
  metadata?: string | null,
  explicit?: { minQuantity?: number | null; quantityStep?: number | null },
): QuoteQuantityConstraint {
  const fromMetadata = readQuoteQuantityConstraint(metadata);
  const minQuantity = explicit?.minQuantity ?? fromMetadata.minQuantity;
  const quantityStep = explicit?.quantityStep ?? fromMetadata.quantityStep;
  return constraintCompatibleWithQuote(quotedQuantity, {
    minQuantity: minQuantity > 0 ? minQuantity : 1,
    quantityStep: quantityStep > 0 ? quantityStep : 1,
  });
}

export function validateAcceptedQuantity(input: {
  quotedQuantity: number;
  orderedQty: number;
  requested: number;
  metadata?: string | null;
  minQuantity?: number | null;
  quantityStep?: number | null;
}): AcceptedQuantityResult {
  const { quotedQuantity, orderedQty, requested } = input;
  if (!Number.isInteger(quotedQuantity) || quotedQuantity < 1) return { ok: false, code: 'INVALID_QUANTITY' };
  if (!Number.isInteger(orderedQty) || orderedQty < 0 || orderedQty > quotedQuantity) return { ok: false, code: 'INVALID_QUANTITY' };
  if (!Number.isInteger(requested) || requested < 1) return { ok: false, code: 'INVALID_QUANTITY' };
  if (orderedQty >= quotedQuantity) return { ok: false, code: 'INVALID_QUANTITY' };
  const { minQuantity, quantityStep } = effectiveQuoteQuantityConstraint(quotedQuantity, input.metadata, {
    minQuantity: input.minQuantity,
    quantityStep: input.quantityStep,
  });
  if (requested < minQuantity) return { ok: false, code: 'BELOW_MINIMUM' };
  if (quantityStep > 1 && requested % quantityStep !== 0) return { ok: false, code: 'NOT_PACKAGE_MULTIPLE' };
  return { ok: true, quantity: requested };
}

export function lineTotalForAcceptedQuantity(unitPrice: number, quantity: number): number {
  return Math.round((unitPrice * quantity + Number.EPSILON) * 100) / 100;
}

/** 加量或恰好订完时封顶到报价数量；部分接受只累加实际数量。剩余不为负。 */
export function quoteLineFulfillment(input: {
  quotedQuantity: number;
  orderedQty: number;
  acceptedQuantity: number;
}): { orderedQty: number; remaining: number; fulfilled: boolean } {
  const remainingBefore = Math.max(0, input.quotedQuantity - input.orderedQty);
  const fulfilled = input.acceptedQuantity >= remainingBefore;
  const orderedQty = fulfilled ? input.quotedQuantity : input.orderedQty + input.acceptedQuantity;
  return {
    orderedQty,
    remaining: Math.max(0, input.quotedQuantity - orderedQty),
    fulfilled,
  };
}

export function draftQuantity(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function packageConstraintFromVariant(variant: { packageType?: string | null; baseQuantity?: number | null } | null | undefined): {
  minQuantity: number | null;
  quantityStep: number | null;
} {
  if (!variant) return { minQuantity: null, quantityStep: null };
  const packaged = variant.packageType === 'box' || variant.packageType === 'case' || variant.packageType === 'tier';
  if (!packaged || !Number.isInteger(variant.baseQuantity) || (variant.baseQuantity ?? 0) <= 1) {
    return { minQuantity: null, quantityStep: null };
  }
  return { minQuantity: variant.baseQuantity ?? null, quantityStep: variant.baseQuantity ?? null };
}

export function mergeQuoteConstraintMetadata(
  metadata: string | null | undefined,
  constraint: { minQuantity?: number | null; quantityStep?: number | null },
  quotedQuantity: number,
): string | null {
  let parsed: Record<string, unknown> = {};
  if (metadata) {
    try {
      const value = JSON.parse(metadata) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = { ...(value as Record<string, unknown>) };
    } catch {
      parsed = {};
    }
  }
  const compatible = constraintCompatibleWithQuote(quotedQuantity, {
    minQuantity: constraint.minQuantity && constraint.minQuantity > 0 ? constraint.minQuantity : 1,
    quantityStep: constraint.quantityStep && constraint.quantityStep > 0 ? constraint.quantityStep : 1,
  });
  if (compatible.minQuantity > 1) parsed.minQuantity = compatible.minQuantity;
  else delete parsed.minQuantity;
  if (compatible.quantityStep > 1) parsed.quantityStep = compatible.quantityStep;
  else delete parsed.quantityStep;
  delete parsed.moq;
  delete parsed.minimumOrderQuantity;
  delete parsed.packageQuantity;
  delete parsed.packageSize;
  return Object.keys(parsed).length ? JSON.stringify(parsed) : null;
}

export function requestedQuantityFromBody(quantities: unknown, index: number, remaining: number): number | null {
  if (quantities == null) return remaining;
  if (typeof quantities !== 'object' || Array.isArray(quantities)) return null;
  const record = quantities as Record<string, unknown>;
  const key = String(index);
  if (!Object.prototype.hasOwnProperty.call(record, key)) return remaining;
  const raw = record[key];
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10);
  return null;
}
