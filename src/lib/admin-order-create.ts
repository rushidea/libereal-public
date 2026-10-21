/**
 * 后台建单（代客下单）的费用、单价和数量校验。
 *
 * 硬规则：费用和单价必须是有限、非负、最多两位小数的数字；数量必须为正整数。
 * 不满足时由调用方返回 400。目录价偏差、小数点错位、超量等合理性问题不在这里拒绝，
 * 调用方复用 reviewCommerceLines（#167）和 classifyQuoteQuantityKind，只把警告当作提示。
 */

const MONEY_SCALE = 100;
const MONEY_EPSILON = 1e-6;
const MONEY_TEXT = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const INTEGER_TEXT = /^[1-9]\d*$/;

export type AdminOrderCreateLine = {
  /** 未传单价时留给目录价。传入后已规范成最多两位小数的非负数。 */
  price?: number;
  quantity: number;
};

export type AdminOrderCreateCharges =
  | { ok: true; platformFee: number; transferFee: number; lines: AdminOrderCreateLine[] }
  | { ok: false; error: string };

export function adminOrderMoneyMessage(label: string): string {
  return `${label}必须是有限、非负、最多两位小数的数字`;
}

export function adminOrderQuantityMessage(label: string): string {
  return `${label}数量必须为正整数`;
}

export function parseNonNegativeMoney(value: unknown): number | null {
  const numeric = finiteMoneyInput(value);
  if (numeric == null || numeric < 0) return null;
  const scaled = numeric * MONEY_SCALE;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > MONEY_EPSILON) return null;
  return rounded / MONEY_SCALE;
}

export function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!INTEGER_TEXT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseAdminOrderCreateCharges(input: {
  items: unknown;
  platformFee: unknown;
  transferFee: unknown;
}): AdminOrderCreateCharges {
  const platformFee = readRequiredMoney(input.platformFee, '平台服务费', 0);
  if (!platformFee.ok) return platformFee;
  const transferFee = readRequiredMoney(input.transferFee, '转账手续费', 0);
  if (!transferFee.ok) return transferFee;
  if (!Array.isArray(input.items)) {
    return { ok: false, error: '请至少添加一件商品' };
  }

  const lines: AdminOrderCreateLine[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    if (!isRecord(item)) {
      return { ok: false, error: `第 ${index + 1} 行商品格式不正确` };
    }
    const prefix = linePrefix(index, item.name);
    const rawPrice = item.price !== undefined ? item.price : item.unitPrice;
    let price: number | undefined;
    if (rawPrice !== undefined) {
      const parsedPrice = parseNonNegativeMoney(rawPrice);
      if (parsedPrice == null) return { ok: false, error: adminOrderMoneyMessage(`${prefix}单价`) };
      price = parsedPrice;
    }
    const quantity = parsePositiveInteger(item.quantity);
    if (quantity == null) return { ok: false, error: adminOrderQuantityMessage(prefix) };
    lines.push(price === undefined ? { quantity } : { price, quantity });
  }

  return { ok: true, platformFee: platformFee.value, transferFee: transferFee.value, lines };
}

/** 计价完成后的单价和数量仍须满足硬规则。返回 null 表示可以继续建单。 */
export function adminOrderResolvedLineError(
  index: number,
  name: string | null | undefined,
  unitPrice: unknown,
  quantity: unknown,
): string | null {
  const prefix = linePrefix(index, name);
  if (parseNonNegativeMoney(unitPrice) == null) return adminOrderMoneyMessage(`${prefix}单价`);
  if (parsePositiveInteger(quantity) == null) return adminOrderQuantityMessage(prefix);
  return null;
}

function readRequiredMoney(
  value: unknown,
  label: string,
  omitted: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: omitted };
  const parsed = parseNonNegativeMoney(value);
  if (parsed == null) return { ok: false, error: adminOrderMoneyMessage(label) };
  return { ok: true, value: parsed };
}

function finiteMoneyInput(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!MONEY_TEXT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function linePrefix(index: number, name: unknown): string {
  const label = typeof name === 'string' ? name.trim() : '';
  return label ? `第 ${index + 1} 行「${label}」` : `第 ${index + 1} 行`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
