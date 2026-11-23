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
type OriginalPaymentIssue = {
  amountCents: number; paymentEvidence: PaymentEvidence; sourcePaymentId?: string; previousPaymentIssueId?: string; description: string;
};
export type PaymentIssueOutcome = 'awaiting_disposition' | 'outside_purchase' | 'no_effective_approval';
type PaymentIssueDecision = {
  paymentIssueId: string; outcome: PaymentIssueOutcome; description: string; reference: string; referenceSha256: string;
  target: { orderId: string; purchaseOrderId: string } | null;
};
type PaymentIssueRow = {
  id: string; issueId: string; purchaseOrderId: string; actorId: string; createdAt: string; action: string; detail: string; ordinal: bigint;
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
  tx: Prisma.TransactionClient, evidence: PaymentEvidence, sourcePaymentId?: string, paymentIssueId?: string, previousPaymentIssueId?: string,
) {
  const candidates = await tx.$queryRaw<Array<{ action: string; detail: string }>>`SELECT action,detail FROM PurchaseActivity
    WHERE id NOT IN (${sourcePaymentId ?? ''},${paymentIssueId ?? ''},${previousPaymentIssueId ?? ''})
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

export async function readSupplierPaymentIssues(tx: Prisma.TransactionClient, orderId: string) {
  const events = await tx.$queryRaw<PaymentIssueRow[]>`
    WITH issues AS (
      SELECT id FROM PurchaseActivity WHERE orderId=${orderId} AND action='record_payment_exception'
      UNION
      SELECT json_extract(detail,'$.snapshot.operation.paymentIssueId') FROM PurchaseActivity
        WHERE action='review_payment_exception' AND (orderId=${orderId} OR json_extract(detail,'$.snapshot.operation.target.orderId')=${orderId})
    ), history AS (
      SELECT rowid AS ordinal,id,purchaseOrderId,actorId,createdAt,action,detail,
        CASE WHEN action='record_payment_exception' THEN id ELSE json_extract(detail,'$.snapshot.operation.paymentIssueId') END AS issueId
      FROM PurchaseActivity WHERE action IN ('record_payment_exception','review_payment_exception','approve_payment_attribution',
        'record_payment','review_payment_time','correct_payment_attribution')
    )
    SELECT history.* FROM history JOIN issues ON issues.id=history.issueId ORDER BY history.ordinal`;
  const history = new Map<string, PaymentIssueRow[]>();
  for (const event of events) {
    const entries = history.get(event.issueId);
    if (entries) entries.push(event);
    else history.set(event.issueId, [event]);
  }
  return [...history.values()].flatMap(rows => {
    const original = rows.find(row => row.action === 'record_payment_exception');
    if (!original) return [];
    const reviewHistory = rows.filter(row => row.action === 'review_payment_exception').map(row => ({
      id: row.id, actorId: row.actorId, purchaseOrderId: row.purchaseOrderId, recordedAt: row.createdAt, ordinal: row.ordinal,
      operation: purchaseOperation(jsonObject(row.detail)) as PaymentIssueDecision,
    }));
    const route = reviewHistory.findLast(row => row.operation.outcome === 'outside_purchase');
    const activePurchaseOrderId = route ? route.operation.target?.purchaseOrderId ?? null : original.purchaseOrderId;
    const followup = reviewHistory.findLast(row => row.purchaseOrderId === (activePurchaseOrderId ?? original.purchaseOrderId)
      && row.ordinal > (route?.ordinal ?? original.ordinal) && row.operation.outcome !== 'outside_purchase');
    const posting = rows.find(row => row.action === 'record_payment' || row.action === 'review_payment_time' || row.action === 'correct_payment_attribution');
    const approval = rows.findLast(row => row.action === 'approve_payment_attribution' && row.purchaseOrderId === activePurchaseOrderId
      && row.ordinal > (route?.ordinal ?? original.ordinal));
    const publicReview = (row: typeof reviewHistory[number]) => ({
      id: row.id, actorId: row.actorId, purchaseOrderId: row.purchaseOrderId, recordedAt: row.recordedAt, operation: row.operation,
    });
    const latest = route ?? followup;
    return [{ id: original.id, purchaseOrderId: original.purchaseOrderId, ownerId: original.actorId, recordedAt: original.createdAt,
      original: purchaseOperation(jsonObject(original.detail)) as OriginalPaymentIssue,
      activePurchaseOrderId, review: latest ? publicReview(latest) : null, followup: followup ? publicReview(followup) : null, reviewHistory: reviewHistory.map(publicReview),
      postingId: posting?.id ?? null, postedToPurchaseOrderId: posting?.purchaseOrderId ?? null, attributionApprovalId: approval?.id ?? null }];
  });
}

export function supplierPaymentExceptions(purchaseOrderId: string, issues: Awaited<ReturnType<typeof readSupplierPaymentIssues>>) {
  return issues.flatMap(row => {
    const incoming = purchaseOrderId !== row.purchaseOrderId;
    if (incoming && !row.reviewHistory.some(decision => decision.operation.target?.purchaseOrderId === purchaseOrderId)) return [];
    const current = row.activePurchaseOrderId === purchaseOrderId;
    const awaitingTarget = !incoming && row.activePurchaseOrderId === null && !row.postingId;
    const canRoute = !row.postingId && (current || awaitingTarget);
    const pending = !row.postingId && current && row.followup?.operation.outcome !== 'no_effective_approval';
    return [{ ...row, incoming, pending, canRoute, awaitingTarget, attributionApprovalId: current ? row.attributionApprovalId : null }];
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
