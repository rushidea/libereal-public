/**
 * 报价与订单行的规则型核对。
 *
 * 纯函数：不访问数据库、不读权限、不调用外部服务。
 * 发布报价和后台修改订单行价格都先得到 CommerceLineInput，再调用
 * reviewCommerceLines。硬错误由调用方返回 400；软警告在管理员确认后，
 * 以 confirmWarnings === true 放行，并写入审计。
 *
 * 数量分类和阈值直接使用接受报价提醒的 classifyQuoteQuantityKind
 * 与 QUOTE_QUANTITY_NUDGE_THRESHOLDS，不另写一套规则。
 * 权限和 MFA 不在本模块决定，两个入口保持原有权限。
 *
 * 将来 AI Ops 的订单核对 agent 实现 CommerceLineReviewer：
 * 读取同样的 CommerceLineInput 和规则结果，返回 CommerceLineFinding[]。
 * 调用方用 mergeCommerceLineFindings 合并。本模块不调用 agent。
 */

import {
  QUOTE_QUANTITY_KIND_LABEL,
  QUOTE_QUANTITY_NUDGE_THRESHOLDS,
  classifyQuoteQuantityKind,
} from '@/lib/quote-quantity-nudge';

export const CATALOG_PRICE_MIN_RATIO = 0.3;
export const CATALOG_PRICE_MAX_RATIO = 3;
export const DECIMAL_SHIFT_LOW_RATIO = 0.1;
export const DECIMAL_SHIFT_HIGH_RATIO = 10;
export const DECIMAL_SHIFT_RELATIVE_TOLERANCE = 0.02;

export const COMMERCE_LINE_INVALID = 'COMMERCE_LINE_INVALID';
export const COMMERCE_LINE_WARNINGS = 'COMMERCE_LINE_WARNINGS';

export type CommerceLineReviewSource = 'quote' | 'order_line';

export type CommerceLineInput = {
  lineId?: string | null;
  index?: number;
  name?: string | null;
  spec?: string | null;
  catalogNumber?: string | null;
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
  unitPrice: unknown;
  quantity: unknown;
  /** 对照用的目录/在售单价。缺失或不是正数时，跳过与价格偏差相关的软警告。 */
  catalogPrice?: unknown;
};

export type CommerceLineFindingCode =
  | 'unit_price_invalid'
  | 'unit_price_below_catalog'
  | 'unit_price_above_catalog'
  | 'unit_price_decimal_shift'
  | 'quantity_invalid'
  | 'quantity_abnormally_large';

export type CommerceLineSeverity = 'error' | 'warning';

export type CommerceLineFinding = {
  code: CommerceLineFindingCode;
  severity: CommerceLineSeverity;
  field: 'unitPrice' | 'quantity';
  message: string;
  lineId?: string | null;
  index?: number;
  details?: Record<string, unknown>;
};

export type CommerceLineReview = {
  findings: CommerceLineFinding[];
  errors: CommerceLineFinding[];
  warnings: CommerceLineFinding[];
};

export type CommerceLineDecision =
  | { ok: true; warnings: CommerceLineFinding[] }
  | { ok: false; status: 400 | 409; body: { error: string; code: string; findings?: CommerceLineFinding[]; warnings?: CommerceLineFinding[] } };

/**
 * 未来订单核对 agent 的对接面。实现方不得从本模块被自动调用。
 * 返回的 error 与规则硬错误一样会被调用方拒绝；warning 仍可经人工确认。
 */
export type CommerceLineReviewer = (input: {
  source: CommerceLineReviewSource;
  lines: CommerceLineInput[];
  ruleReview: CommerceLineReview;
}) => CommerceLineFinding[] | Promise<CommerceLineFinding[]>;

export function resolveCatalogUnitPrice(input: {
  variantPrice?: number | null;
  variantOriginalPrice?: number | null;
  productPrice?: number | null;
  productOriginalPrice?: number | null;
}): number | null {
  const candidates = [
    input.variantPrice,
    input.variantOriginalPrice,
    input.productPrice,
    input.productOriginalPrice,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed == null || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function usableCatalogPrice(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function priceRatio(unitPrice: number, catalogPrice: number): number {
  return Math.round((unitPrice / catalogPrice) * 1e6) / 1e6;
}

function yuan(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function linePrefix(input: CommerceLineInput): string {
  const name = input.name?.trim();
  const position = typeof input.index === 'number' ? `第 ${input.index + 1} 行` : '';
  if (position && name) return `${position}「${name}」`;
  if (name) return `「${name}」`;
  return position;
}

function withPrefix(input: CommerceLineInput, message: string): string {
  const prefix = linePrefix(input);
  return prefix ? `${prefix}：${message}` : message;
}

function finding(
  input: CommerceLineInput,
  code: CommerceLineFindingCode,
  severity: CommerceLineSeverity,
  field: 'unitPrice' | 'quantity',
  message: string,
  details?: Record<string, unknown>,
): CommerceLineFinding {
  return {
    code,
    severity,
    field,
    message: withPrefix(input, message),
    lineId: input.lineId ?? null,
    index: input.index,
    ...(details ? { details } : {}),
  };
}

function splitFindings(findings: CommerceLineFinding[]): CommerceLineReview {
  return {
    findings,
    errors: findings.filter((item) => item.severity === 'error'),
    warnings: findings.filter((item) => item.severity === 'warning'),
  };
}

export function reviewCommerceLine(input: CommerceLineInput): CommerceLineReview {
  const findings: CommerceLineFinding[] = [];
  const unitPrice = finiteNumber(input.unitPrice);
  const catalogPrice = usableCatalogPrice(input.catalogPrice);
  const quantity = positiveInteger(input.quantity);

  if (unitPrice == null || unitPrice <= 0) {
    findings.push(finding(
      input,
      'unit_price_invalid',
      'error',
      'unitPrice',
      '单价必须为大于 0 的数字。',
      { unitPrice: input.unitPrice ?? null },
    ));
  } else if (catalogPrice != null) {
    const ratio = priceRatio(unitPrice, catalogPrice);
    const priceDetails = { unitPrice, catalogPrice, ratio, spec: input.spec ?? null, catalogNumber: input.catalogNumber ?? null };
    if (ratio < CATALOG_PRICE_MIN_RATIO) {
      findings.push(finding(
        input,
        'unit_price_below_catalog',
        'warning',
        'unitPrice',
        `单价低于目录价的 ${Math.round(CATALOG_PRICE_MIN_RATIO * 100)}%（目录价 ${yuan(catalogPrice)}，当前 ${yuan(unitPrice)}）。`,
        priceDetails,
      ));
    }
    if (ratio > CATALOG_PRICE_MAX_RATIO) {
      findings.push(finding(
        input,
        'unit_price_above_catalog',
        'warning',
        'unitPrice',
        `单价高于目录价的 ${Math.round(CATALOG_PRICE_MAX_RATIO * 100)}%（目录价 ${yuan(catalogPrice)}，当前 ${yuan(unitPrice)}）。`,
        priceDetails,
      ));
    }
    const decimalShift = nearly(ratio, DECIMAL_SHIFT_HIGH_RATIO)
      ? '10 倍'
      : nearly(ratio, DECIMAL_SHIFT_LOW_RATIO)
        ? '0.1 倍'
        : null;
    if (decimalShift) {
      findings.push(finding(
        input,
        'unit_price_decimal_shift',
        'warning',
        'unitPrice',
        `单价约为目录价的 ${decimalShift}，可能多打或少打了一位小数（目录价 ${yuan(catalogPrice)}，当前 ${yuan(unitPrice)}）。`,
        priceDetails,
      ));
    }
  }

  if (quantity == null) {
    findings.push(finding(
      input,
      'quantity_invalid',
      'error',
      'quantity',
      '数量必须为大于 0 的整数。',
      { quantity: input.quantity ?? null },
    ));
  } else {
    const kind = classifyQuoteQuantityKind(input);
    const limit = kind ? QUOTE_QUANTITY_NUDGE_THRESHOLDS[kind] : null;
    if (kind && limit != null && quantity > limit) {
      const label = QUOTE_QUANTITY_KIND_LABEL[kind];
      findings.push(finding(
        input,
        'quantity_abnormally_large',
        'warning',
        'quantity',
        `${label}数量 ${quantity} 超过 ${limit}，请确认是否输入错误。`,
        { quantity, kind, limit, spec: input.spec ?? null },
      ));
    }
  }

  return splitFindings(findings);
}

function nearly(ratio: number, target: number): boolean {
  return Math.abs(ratio - target) / target <= DECIMAL_SHIFT_RELATIVE_TOLERANCE + 1e-9;
}

export function reviewCommerceLines(lines: CommerceLineInput[]): CommerceLineReview {
  return splitFindings(lines.flatMap((line, index) => reviewCommerceLine({ ...line, index: line.index ?? index }).findings));
}

export function mergeCommerceLineFindings(ruleReview: CommerceLineReview, extra: CommerceLineFinding[]): CommerceLineReview {
  const seen = new Set(ruleReview.findings.map(findingKey));
  const findings = [...ruleReview.findings];
  for (const item of extra) {
    const key = findingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(item);
  }
  return splitFindings(findings);
}

function findingKey(item: CommerceLineFinding): string {
  return `${item.index ?? ''}:${item.lineId ?? ''}:${item.code}`;
}

export function decideCommerceLineReview(review: CommerceLineReview, confirmWarnings: unknown): CommerceLineDecision {
  if (review.errors.length > 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: review.errors.map((item) => item.message).join('\n'),
        code: COMMERCE_LINE_INVALID,
        findings: review.errors,
      },
    };
  }
  if (review.warnings.length > 0 && confirmWarnings !== true) {
    return {
      ok: false,
      status: 409,
      body: {
        error: '价格或数量异常，确认后才能保存。',
        code: COMMERCE_LINE_WARNINGS,
        warnings: review.warnings,
      },
    };
  }
  return { ok: true, warnings: review.warnings };
}

export function commerceLineWarningList(payload: unknown): CommerceLineFinding[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { code?: unknown; warnings?: unknown };
  if (record.code !== COMMERCE_LINE_WARNINGS || !Array.isArray(record.warnings)) return null;
  return record.warnings.filter((item): item is CommerceLineFinding => Boolean(item) && typeof item === 'object' && typeof (item as CommerceLineFinding).message === 'string');
}

export function commerceLineWarningPrompt(warnings: Array<{ message?: string }>, action: string): string {
  const lines = warnings.map((warning) => warning.message).filter((message): message is string => Boolean(message));
  const detail = lines.length ? lines.join('\n') : '价格或数量异常。';
  return `${detail}\n\n确认后仍要${action}？`;
}
