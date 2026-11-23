import type { Prisma } from '@prisma/client';
import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type PaymentEvidence = {
  reference: string; bankTrace: string; traceKey: string; sha256: string; payee: string; occurredAt: string;
};
type PaymentEvidenceInput = { reference?: string; referenceSha256?: string; bankTrace?: string; payee?: string; occurredAt?: string };

export function supplierPaymentEvidence(input: PaymentEvidenceInput, payee: string | null | undefined): PaymentEvidence {
  const originalPayee = requiredText(input.payee, '银行凭证所列收款方');
  if (!payee || originalPayee !== payee) throw new PurchaseError('银行凭证收款方须与原采购付款依据相符');
  const occurredAt = purchaseTimestamp(input.occurredAt, '银行实际付款时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('实际付款时间不能晚于登记时间', 400);
  const bankTrace = requiredText(input.bankTrace, '银行付款流水号');
  return { reference: requiredText(input.reference, '付款凭证档案出处'), bankTrace,
    traceKey: bankTrace.normalize('NFKC').replace(/\s+/gu, '').toUpperCase(),
    sha256: documentSha256(input.referenceSha256, '银行付款凭证摘要'), payee: originalPayee, occurredAt };
}

export async function assertUnusedSupplierPayment(tx: Prisma.TransactionClient, evidence: PaymentEvidence) {
  const duplicate = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM PurchaseActivity
    WHERE action IN ('record_payment','review_payment_time')
    AND (json_extract(detail,'$.snapshot.operation.paymentEvidence.traceKey')=${evidence.traceKey}
      OR json_extract(detail,'$.snapshot.operation.paymentEvidence.sha256')=${evidence.sha256})
    LIMIT 1`;
  if (duplicate.length) throw new PurchaseError('这笔银行付款或同一凭证已登记，请核对原付款');
}

function originalPaymentPayee(row: PurchaseActivity) {
  const lines = purchaseObject(row.detail.snapshot).lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  const payees = new Set(lines.map(line => purchaseObject(purchaseObject(line).terms).payee));
  const [payee] = payees;
  return payees.size === 1 && typeof payee === 'string' && payee ? payee : null;
}

export function purchasePaymentRecords(ledger: PurchaseActivity[]) {
  const reviews = new Map(ledger.filter(row => row.action === 'review_payment_time')
    .map(row => [purchaseOperation(row.detail).sourcePaymentId, row]));
  return ledger.filter(row => row.action === 'record_payment').map(row => {
    const original = purchaseOperation(row.detail);
    const review = reviews.get(row.id);
    const proof = purchaseObject((review ? purchaseOperation(review.detail) : original).paymentEvidence);
    const occurredAt = typeof proof.occurredAt === 'string' && Number.isFinite(Date.parse(proof.occurredAt)) ? proof.occurredAt : null;
    const payee = originalPaymentPayee(row);
    const reference = typeof original.reference === 'string' ? original.reference : null;
    return { id: row.id, actorId: row.actorId, amountCents: row.amountCents ?? 0, reference, payee, recordedAt: row.createdAt,
      occurredAt, bankTrace: typeof proof.bankTrace === 'string' ? proof.bankTrace : null,
      evidenceSha256: typeof proof.sha256 === 'string' ? proof.sha256 : null,
      reviewId: review?.id ?? null, reviewedBy: review?.actorId ?? null,
      canReviewTime: !occurredAt && Boolean(payee && reference && positiveCents(row.amountCents) && original.amountCents === row.amountCents) };
  });
}
