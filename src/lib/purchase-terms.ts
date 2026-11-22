import type { PurchaseSource } from '@/lib/purchase-source';

export type PurchaseTerms = {
  supplier?: string; payee?: string; paymentTerms?: string; currency?: 'CNY';
  unitPriceCents?: number; linePayableCents?: number; taxBasis?: 'included' | 'excluded';
  freightTerms?: string; leadTime?: string; validUntil?: string; sourceReference?: string;
  settlementReference?: string; coordinationReference?: string; amountBreakdown?: string;
};
export class PurchaseError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) throw new PurchaseError(`请填写${label}`, 400);
  return value.trim();
}
export function positiveCents(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function normalizePurchaseTerms(raw: unknown): PurchaseTerms {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PurchaseError('请核对本行采购资料', 400);
  const input = raw as Record<string, unknown>;
  const terms: PurchaseTerms = {};
  const textKeys = ['supplier','payee','paymentTerms','freightTerms','leadTime','sourceReference','settlementReference','coordinationReference','amountBreakdown'] as const;
  for (const key of textKeys) {
    if (input[key] != null && input[key] !== '') terms[key] = requiredText(input[key], '有效的采购资料');
  }
  for (const key of ['unitPriceCents','linePayableCents'] as const) {
    if (input[key] == null || input[key] === '') continue;
    if (!positiveCents(input[key])) throw new PurchaseError('采购金额须为大于零的整分金额', 400);
    terms[key] = input[key] as number;
  }
  if (input.currency) {
    if (input.currency !== 'CNY') throw new PurchaseError('此采购结算流程仅支持人民币', 400);
    terms.currency = input.currency;
  }
  if (input.taxBasis) {
    if (input.taxBasis !== 'included' && input.taxBasis !== 'excluded') throw new PurchaseError('请核实含税口径', 400);
    terms.taxBasis = input.taxBasis;
  }
  if (input.validUntil) {
    const text = requiredText(input.validUntil, '带时区的有效期');
    if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(text) || !Number.isFinite(Date.parse(text))) throw new PurchaseError('有效期须包含日期、时间和时区', 400);
    terms.validUntil = new Date(text).toISOString();
  }
  return terms;
}

export function initialPurchaseTerms(source: PurchaseSource): PurchaseTerms {
  const w = source.written;
  if (!w) return {};
  return { unitPriceCents: w.unitPriceCents, currency: w.currency, taxBasis: w.taxBasis, leadTime: w.leadTime,
    validUntil: w.validUntil, sourceReference: w.reference };
}

export function missingPurchaseTerms(terms: PurchaseTerms, source: PurchaseSource): string[] {
  const missing: string[] = [];
  const required = { supplier: '供货方全称', payee: '收款方', paymentTerms: '供应商付款条件', unitPriceCents: '采购单价',
    linePayableCents: '本行含税应付合计', currency: '币种', taxBasis: '税费口径', freightTerms: '运费条件', leadTime: '供货期',
    validUntil: '报价有效期', sourceReference: '供应商书面依据', coordinationReference: '本单交期及客户条件核实依据' } as const;
  for (const [key,label] of Object.entries(required)) {
    if (!terms[key as keyof PurchaseTerms]) missing.push(label);
  }
  if (terms.validUntil && Date.parse(terms.validUntil) <= Date.now()) missing.push('有效期内的新报价');
  if (terms.unitPriceCents && terms.linePayableCents && terms.unitPriceCents * source.quantity !== terms.linePayableCents
    && !terms.amountBreakdown) missing.push('税费、运费或其他行金额差额的计算依据');
  const w = source.written;
  if (w && w.reference === terms.sourceReference) {
    if (!terms.settlementReference) missing.push('收款方及付款条件的补充依据');
    if (terms.unitPriceCents !== w.unitPriceCents || terms.taxBasis !== w.taxBasis || terms.validUntil !== w.validUntil
      || terms.currency !== w.currency || terms.leadTime !== w.leadTime) missing.push('覆盖变更后条款的新供应商书面依据');
  }
  return missing;
}
