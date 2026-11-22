import type { PurchaseActor } from '@/lib/purchase-activity';
import type { PurchaseSource } from '@/lib/purchase-source';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export type PurchaseTerms = {
  supplier?: string; payee?: string; paymentTerms?: string; currency?: 'CNY';
  unitPriceCents?: number; linePayableCents?: number; taxBasis?: 'included' | 'excluded';
  freightTerms?: string; leadTime?: string; validUntil?: string; sourceReference?: string;
  settlementReference?: string; coordinationReference?: string; amountBreakdown?: string;
  writtenSupplier?: string; supplierConditions?: string; sourceSha256?: string; settlementSha256?: string;
  identityReference?: string; identitySha256?: string;
  leadTimeAssessment?: 'within_agreement' | 'exception_required';
  verification?: { actorId: string; actorEmail: string; verifiedAt: string; version: string };
};

export class PurchaseError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) throw new PurchaseError(`请填写${label}`, 400);
  return value.trim();
}

export function positiveCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function documentSha256(value: unknown, label: string) {
  const sha = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new PurchaseError(`${label}须为 64 位 SHA-256 摘要`, 400);
  return sha;
}

export function purchaseTimestamp(value: unknown, label: string) {
  const text = requiredText(value, label);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/i.test(text)
    || !Number.isFinite(Date.parse(text))) throw new PurchaseError(`${label}须包含日期、时间和时区`, 400);
  const [year, month, day] = text.slice(0, 10).split('-').map(Number);
  const hours = Number(text.slice(11, 13));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hours > 23) {
    throw new PurchaseError(`${label}须为实际的日期和时间`, 400);
  }
  return new Date(text).toISOString();
}

export function normalizePurchaseTerms(raw: unknown): PurchaseTerms {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PurchaseError('请核对本行采购资料', 400);
  const input = raw as Record<string, unknown>;
  const terms: PurchaseTerms = {};
  const textKeys = ['supplier', 'payee', 'paymentTerms', 'freightTerms', 'leadTime', 'sourceReference',
    'settlementReference', 'coordinationReference', 'amountBreakdown', 'writtenSupplier',
    'supplierConditions', 'identityReference'] as const;
  for (const key of textKeys) {
    if (input[key] != null && input[key] !== '') terms[key] = requiredText(input[key], '有效的采购资料');
  }
  for (const key of ['sourceSha256', 'settlementSha256', 'identitySha256'] as const) {
    if (input[key] != null && input[key] !== '') terms[key] = documentSha256(input[key], '书面依据摘要');
  }
  for (const key of ['unitPriceCents', 'linePayableCents'] as const) {
    const value = input[key];
    if (value == null || value === '') continue;
    if (!positiveCents(value)) throw new PurchaseError('采购金额须为大于零的整分金额', 400);
    terms[key] = value;
  }
  if (input.currency) {
    if (input.currency !== 'CNY') throw new PurchaseError('此采购结算流程仅支持人民币', 400);
    terms.currency = 'CNY';
  }
  if (input.taxBasis) {
    if (input.taxBasis !== 'included' && input.taxBasis !== 'excluded') throw new PurchaseError('请核实含税口径', 400);
    terms.taxBasis = input.taxBasis;
  }
  if (input.validUntil) terms.validUntil = purchaseTimestamp(input.validUntil, '报价有效期');
  if (input.leadTimeAssessment != null && input.leadTimeAssessment !== '') {
    if (input.leadTimeAssessment !== 'within_agreement' && input.leadTimeAssessment !== 'exception_required') {
      throw new PurchaseError('请填写本单交期核对结果', 400);
    }
    terms.leadTimeAssessment = input.leadTimeAssessment;
  }
  return terms;
}

export function initialPurchaseTerms(source: PurchaseSource): PurchaseTerms {
  const reply = source.written;
  if (!reply) return {};
  return {
    unitPriceCents: reply.unitPriceCents, currency: reply.currency, taxBasis: reply.taxBasis, leadTime: reply.leadTime,
    validUntil: reply.validUntil, sourceReference: reply.reference, sourceSha256: reply.replyHash,
    writtenSupplier: reply.supplier, supplierConditions: reply.conditions,
  };
}

function termsVersion(terms: PurchaseTerms, source: PurchaseSource) {
  const { verification, ...details } = terms;
  return pricingContentHash({ source, details, reviewer: verification && {
    actorId: verification.actorId, actorEmail: verification.actorEmail, verifiedAt: verification.verifiedAt,
  } });
}

export function missingWrittenTerms(terms: PurchaseTerms, source: PurchaseSource, at = Date.now()): string[] {
  const required = {
    supplier: '供货方全称', payee: '收款方', paymentTerms: '供应商付款条件', unitPriceCents: '采购单价',
    linePayableCents: '本行含税应付合计', currency: '币种', taxBasis: '税费口径', freightTerms: '运费条件',
    leadTime: '供货期', validUntil: '报价有效期', writtenSupplier: '书面报价所列供货方',
    supplierConditions: '供应商书面供货条件', sourceReference: '供应商书面依据', sourceSha256: '供货书证摘要',
    settlementReference: '收款方及付款条件的书面依据', settlementSha256: '结算书证摘要',
    coordinationReference: '本单交期及客户条件核实依据', leadTimeAssessment: '本单交期核对结果',
  } as const;
  const missing = Object.entries(required).flatMap(([key, label]) => terms[key as keyof PurchaseTerms] ? [] : [label as string]);
  if (terms.validUntil && (!Number.isFinite(Date.parse(terms.validUntil)) || Date.parse(terms.validUntil) <= at)) missing.push('有效期内的新报价');
  if (terms.unitPriceCents && terms.linePayableCents && terms.unitPriceCents * source.quantity !== terms.linePayableCents
    && !terms.amountBreakdown) missing.push('税费、运费或其他行金额差额的计算依据');
  if (terms.writtenSupplier && terms.supplier && terms.writtenSupplier !== terms.supplier
    && (!terms.identityReference || !terms.identitySha256)) missing.push('原供货方名称对应实际法人主体的书面核对');
  const reply = source.written;
  if (reply && (reply.reference === terms.sourceReference || reply.replyHash === terms.sourceSha256)) {
    if (terms.writtenSupplier !== reply.supplier || terms.sourceSha256 !== reply.replyHash) {
      missing.push('与原函供货方及版本一致的书面依据');
    }
    if (terms.unitPriceCents !== reply.unitPriceCents || terms.taxBasis !== reply.taxBasis || terms.validUntil !== reply.validUntil
      || terms.currency !== reply.currency || terms.leadTime !== reply.leadTime || terms.supplierConditions !== reply.conditions) {
      missing.push('覆盖变更后条款的新供应商书面依据');
    }
  }
  return missing;
}

export function requireNewDocumentsForChangedTerms(previous: PurchaseTerms, next: PurchaseTerms, quantityChanged = false) {
  if (!previous.verification) return;
  const changed = (keys: Array<keyof PurchaseTerms>) => keys.some(key => previous[key] !== next[key]);
  if (previous.sourceSha256 && previous.sourceSha256 === next.sourceSha256
    && changed(['writtenSupplier', 'unitPriceCents', 'currency', 'taxBasis', 'freightTerms', 'leadTime', 'validUntil', 'supplierConditions'])) {
    throw new PurchaseError('变更供货方、价格或供货条款须核对新的供货书证');
  }
  if (previous.settlementSha256 && previous.settlementSha256 === next.settlementSha256 && changed(['supplier', 'payee', 'paymentTerms'])) {
    throw new PurchaseError('变更供货主体、收款方或付款条件须核对新的结算书证');
  }
  if (!quantityChanged && previous.sourceSha256 === next.sourceSha256 && previous.settlementSha256 === next.settlementSha256 && changed(['linePayableCents'])) {
    throw new PurchaseError('变更本行应付金额须核对新的供货或结算书证');
  }
}

export function attestPurchaseTerms(
  raw: unknown, source: PurchaseSource, actor: PurchaseActor, checked: boolean, at = new Date(),
): PurchaseTerms {
  const terms = normalizePurchaseTerms(raw);
  if (checked && !missingWrittenTerms(terms, source, at.getTime()).length) {
    terms.verification = { actorId: actor.id, actorEmail: actor.email, verifiedAt: at.toISOString(), version: '' };
    terms.verification.version = termsVersion(terms, source);
  }
  return terms;
}

export function missingPurchaseTerms(terms: PurchaseTerms, source: PurchaseSource, at = Date.now()): string[] {
  const missing = missingWrittenTerms(terms, source, at);
  if (!terms.verification || !Number.isFinite(Date.parse(terms.verification.verifiedAt)) || Date.parse(terms.verification.verifiedAt) > at || terms.verification.version !== termsVersion(terms, source)) {
    missing.push('供货、收付款及交期书证的具名核对');
  }
  return missing;
}
