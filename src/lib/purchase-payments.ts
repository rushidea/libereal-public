import type { Prisma } from '@prisma/client';
import { bankDocumentScope, bankTraceKey, sameBankDocumentRow } from '@/lib/bank-document';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

export type PaymentEvidence = {
  reference: string; bankTrace: string; traceKey: string; sha256: string; payee: string; occurredAt: string;
  documentKind: 'single_receipt' | 'statement'; statementRow: number;
};
type PaymentEvidenceInput = { reference?: string; referenceSha256?: string; bankTrace?: string; payee?: string; occurredAt?: string;
  paymentDocumentKind?: unknown; paymentStatementRow?: unknown };
type OriginalPaymentIssue = { amountCents: number; paymentEvidence: PaymentEvidence; sourcePaymentId?: string; description: string };
export type PaymentIssueOutcome = 'awaiting_disposition' | 'outside_purchase' | 'no_effective_approval';
type PaymentIssueDecision = {
  paymentIssueId: string; outcome: PaymentIssueOutcome; description: string; reference: string; referenceSha256: string;
  target: { orderId: string; purchaseOrderId: string } | null;
};
type PaymentIssue = {
  id: string; purchaseOrderId: string; ownerId: string; recordedAt: string; original: OriginalPaymentIssue;
  review: { id: string; actorId: string; operation: PaymentIssueDecision } | null;
};

type PaymentCorrectionOperation = {
  source: { orderId: string; purchaseOrderId: string; paymentId: string };
  amountCents: number; paymentEvidence: PaymentEvidence;
};

export async function supplierPaymentCorrections(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; purchaseOrderId: string; actorId: string; createdAt: string; detail: string }>>`
    SELECT id,purchaseOrderId,actorId,createdAt,detail FROM PurchaseActivity WHERE action='correct_payment_attribution'
      AND (orderId=${orderId} OR json_extract(detail,'$.snapshot.operation.source.orderId')=${orderId}) ORDER BY rowid`;
  return rows.map(row => ({ id: row.id, targetPurchaseOrderId: row.purchaseOrderId, actorId: row.actorId, recordedAt: row.createdAt,
    operation: purchaseOperation(jsonObject(row.detail)) as PaymentCorrectionOperation }));
}

export type PaymentCorrection = Awaited<ReturnType<typeof supplierPaymentCorrections>>[number];

export function supplierPaymentEvidence(input: PaymentEvidenceInput, payee: string | null | undefined): PaymentEvidence {
  const originalPayee = requiredText(input.payee, '银行凭证所列收款方');
  if (!payee || originalPayee !== payee) throw new PurchaseError('银行凭证收款方须与原采购付款依据相符');
  const occurredAt = purchaseTimestamp(input.occurredAt, '银行实际付款时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('实际付款时间不能晚于登记时间', 400);
  const bankTrace = requiredText(input.bankTrace, '银行付款流水号');
  return { reference: requiredText(input.reference, '付款凭证档案出处'), bankTrace,
    ...bankDocumentScope(input.paymentDocumentKind ?? 'single_receipt', input.paymentStatementRow),
    traceKey: bankTraceKey(bankTrace),
    sha256: documentSha256(input.referenceSha256, '银行付款凭证摘要'), payee: originalPayee, occurredAt };
}

export async function assertUnusedSupplierPayment(
  tx: Prisma.TransactionClient, evidence: PaymentEvidence, sourcePaymentId?: string, paymentIssueId?: string,
) {
  const candidates = await tx.$queryRaw<Array<{ action: string; detail: string }>>`SELECT action,detail FROM PurchaseActivity
    WHERE id NOT IN (${sourcePaymentId ?? ''},${paymentIssueId ?? ''})
    AND action IN ('record_payment','review_payment_time','record_payment_exception','correct_payment_attribution')
    AND (json_extract(detail,'$.snapshot.operation.paymentEvidence.traceKey')=${evidence.traceKey}
      OR json_extract(detail,'$.snapshot.operation.paymentEvidence.sha256')=${evidence.sha256}
      OR (action='record_payment' AND json_type(detail,'$.snapshot.operation.paymentEvidence') IS NULL))`;
  for (const row of candidates) {
    const op = purchaseOperation(jsonObject(row.detail));
    if (sourcePaymentId && row.action === 'review_payment_time' && op.sourcePaymentId === sourcePaymentId) continue;
    const prior = purchaseObject(op.paymentEvidence);
    if (prior.traceKey === evidence.traceKey || sameBankDocumentRow({ sha256: prior.sha256, documentKind: prior.documentKind,
      statementRow: prior.statementRow }, evidence)
      || row.action === 'record_payment' && !op.paymentEvidence && typeof op.reference === 'string' && bankTraceKey(op.reference) === evidence.traceKey) {
      throw new PurchaseError('原银行流水或原件这一行已登记，请核对原付款');
    }
  }
}

export async function incomingSupplierPaymentIssues(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; purchaseOrderId: string; ownerId: string; recordedAt: string;
    original: string; reviewId: string; reviewerId: string; review: string }>>`
    SELECT source.id,source.purchaseOrderId,source.actorId AS ownerId,source.createdAt AS recordedAt,source.detail AS original,
      decision.id AS reviewId,decision.actorId AS reviewerId,decision.detail AS review
    FROM PurchaseActivity decision
    JOIN PurchaseActivity source ON source.id=json_extract(decision.detail,'$.snapshot.operation.paymentIssueId')
      AND source.purchaseOrderId=decision.purchaseOrderId AND source.action='record_payment_exception'
    WHERE decision.action='review_payment_exception' AND json_extract(decision.detail,'$.snapshot.operation.outcome')='outside_purchase'
      AND json_extract(decision.detail,'$.snapshot.operation.target.orderId')=${orderId}`;
  return rows.map((row): PaymentIssue => ({id: row.id, purchaseOrderId: row.purchaseOrderId, ownerId: row.ownerId, recordedAt: row.recordedAt,
    original: purchaseOperation(jsonObject(row.original)) as OriginalPaymentIssue,
    review: { id: row.reviewId, actorId: row.reviewerId, operation: purchaseOperation(jsonObject(row.review)) as PaymentIssueDecision } }));
}

export function supplierPaymentExceptions(ledger: PurchaseActivity[], purchaseOrderId: string, incoming: PaymentIssue[]) {
  const local = ledger.filter(row => row.action === 'record_payment_exception').map((row): PaymentIssue => {
    const review = ledger.findLast(entry => entry.action === 'review_payment_exception' && purchaseOperation(entry.detail).paymentIssueId === row.id);
    return { id: row.id, purchaseOrderId, ownerId: row.actorId, recordedAt: row.createdAt,
      original: purchaseOperation(row.detail) as OriginalPaymentIssue,
      review: review ? { id: review.id, actorId: review.actorId, operation: purchaseOperation(review.detail) as PaymentIssueDecision } : null };
  });
  const routed = incoming.filter(row => row.review?.operation.target?.purchaseOrderId === purchaseOrderId);
  return [...local, ...routed].map(row => {
    const incoming = row.purchaseOrderId !== purchaseOrderId;
    const targetDecision = incoming ? ledger.findLast(entry => entry.action === 'review_payment_exception'
      && purchaseOperation(entry.detail).paymentIssueId === row.id) : null;
    const followup = targetDecision ? { id: targetDecision.id, actorId: targetDecision.actorId,
      operation: purchaseOperation(targetDecision.detail) as PaymentIssueDecision } : null;
    const decision = incoming ? followup : row.review;
    const posted = ledger.find(entry => (entry.action === 'record_payment' || entry.action === 'review_payment_time' || entry.action === 'correct_payment_attribution')
      && purchaseOperation(entry.detail).paymentIssueId === row.id);
    const approval = ledger.findLast(entry => entry.action === 'approve_payment_attribution' && purchaseOperation(entry.detail).paymentIssueId === row.id);
    const pending = !posted && (!decision || decision.operation.outcome === 'awaiting_disposition');
    return { ...row, incoming, followup, pending, postingId: posted?.id ?? null, attributionApprovalId: approval?.id ?? null };
  });
}

function originalPaymentPayee(row: PurchaseActivity) {
  const lines = purchaseObject(row.detail.snapshot).lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  const payees = new Set(lines.map(line => purchaseObject(purchaseObject(line).terms).payee));
  const [payee] = payees;
  return payees.size === 1 && typeof payee === 'string' && payee ? payee : null;
}

export function purchasePaymentRecords(ledger: PurchaseActivity[], purchaseOrderId: string, corrections: PaymentCorrection[]) {
  const reviews = new Map(ledger.filter(row => row.action === 'review_payment_time')
    .map(row => [purchaseOperation(row.detail).sourcePaymentId, row]));
  const movedAway = new Set(corrections.filter(row => row.operation.source.purchaseOrderId === purchaseOrderId)
    .map(row => row.operation.source.paymentId));
  const recorded = ledger.filter(row => row.action === 'record_payment' && !movedAway.has(row.id)).map(row => {
    const original = purchaseOperation(row.detail);
    const review = reviews.get(row.id);
    const proof = purchaseObject((review ? purchaseOperation(review.detail) : original).paymentEvidence);
    const occurredAt = typeof proof.occurredAt === 'string' && Number.isFinite(Date.parse(proof.occurredAt)) ? proof.occurredAt : null;
    const payee = originalPaymentPayee(row);
    const reference = typeof original.reference === 'string' ? original.reference : null;
    return { id: row.id, actorId: row.actorId, amountCents: row.amountCents ?? 0, reference, payee, recordedAt: row.createdAt,
      occurredAt, bankTrace: typeof proof.bankTrace === 'string' ? proof.bankTrace : null,
      evidenceSha256: typeof proof.sha256 === 'string' ? proof.sha256 : null,
      paymentEvidence: occurredAt ? proof as PaymentEvidence : null,
      sourcePaymentId: null as string | null,
      reviewId: review?.id ?? null, reviewedBy: review?.actorId ?? null,
      canReviewTime: !occurredAt && Boolean(payee && reference && positiveCents(row.amountCents) && original.amountCents === row.amountCents) };
  });
  const corrected = corrections.filter(row => row.targetPurchaseOrderId === purchaseOrderId).map(row => {
    const { amountCents, paymentEvidence: proof, source } = row.operation;
    return { id: row.id, actorId: row.actorId, amountCents, reference: proof.reference, payee: proof.payee, recordedAt: row.recordedAt,
      occurredAt: proof.occurredAt, bankTrace: proof.bankTrace, evidenceSha256: proof.sha256, paymentEvidence: proof,
      reviewId: row.id, reviewedBy: row.actorId, canReviewTime: false, sourcePaymentId: source.paymentId };
  });
  return [...recorded, ...corrected];
}
