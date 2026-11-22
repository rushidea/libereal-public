import type { PurchaseActivity } from '@/lib/purchase-activity';
import type { PurchaseSource } from '@/lib/purchase-source';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { positiveCents, PurchaseError, type PurchaseTerms } from '@/lib/purchase-terms';

export type PurchaseStatus = 'draft' | 'approved' | 'ordered' | 'on_hold' | 'superseded';
export type PurchaseLineSource = PurchaseSource & { customerLineVersion?: string };
export type ContractLine = { orderItemId: string; source: PurchaseLineSource; terms: PurchaseTerms; revision: number };
export type RemainingScope = {
  lines: Array<{ orderItemId: string; quantity: number; payableCents: number }>;
  totalCents: number;
  appliedPaidCents: number;
  dispositionIds: string[];
  payments: Array<{ id: string; amountCents: number }>;
};

type ArchiveSnapshot = {
  actorId: string; requestId: string; orderId: string; purchaseOrderId: string; totalCents: number; paidCents: number;
  lines: ContractLine[];
  operation: {
    action?: string; occurredAt?: string; previousStatus?: PurchaseStatus; incidentId?: string; outcome?: string;
    reference?: string; amountCents?: number; conditionReference?: string;
    dispositions?: Array<{ orderItemId: string; quantity: number }>;
    scope?: RemainingScope;
    legacyApprovalId?: string;
    checkedTerms?: Array<{ orderItemId: string; terms: PurchaseTerms }>;
    execution?: { totalCents: number; lines: Array<{ orderItemId: string; source: PurchaseLineSource; quantity: number; payableCents: number }> };
  };
  eligibility?: unknown;
};

export function purchaseSnapshot(activity: PurchaseActivity | undefined) {
  return activity?.detail.snapshot as ArchiveSnapshot | undefined;
}

export function contractContent(orderId: string, purchaseOrderId: string, totalCents: number, lines: ContractLine[]) {
  return { orderId, purchaseOrderId, totalCents, lines: lines.map(({ orderItemId, source, terms, revision }) => ({ orderItemId, source, terms, revision })) };
}

export function dispositionSummary(ledger: PurchaseActivity[]) {
  const ids: string[] = [];
  const quantities = new Map<string, number>();
  for (const row of ledger) {
    if (row.action !== 'resolve_change') continue;
    const entries = purchaseSnapshot(row)?.operation.dispositions;
    if (!entries?.length) continue;
    ids.push(row.id);
    for (const { orderItemId, quantity } of entries) quantities.set(orderItemId, (quantities.get(orderItemId) ?? 0) + quantity);
  }
  return { ids, quantities };
}

export function remainingApproval(ledger: PurchaseActivity[], dispositionIds: string[]) {
  return ledger.findLast(row => row.action === 'approve_remaining'
    && pricingContentHash(purchaseSnapshot(row)?.operation.scope?.dispositionIds ?? []) === pricingContentHash(dispositionIds));
}

export function approvalAt(ledger: PurchaseActivity[], at: number) {
  let approval: PurchaseActivity | undefined;
  let suspended = false;
  for (const row of ledger) {
    if (Date.parse(row.createdAt) > at) continue;
    if (row.action === 'approve' || row.action === 'approve_remaining') {
      approval = row;
      suspended = false;
    } else if (row.action === 'report_change') {
      suspended = true;
    } else if (row.action === 'resolve_change') {
      const operation = purchaseSnapshot(row)?.operation;
      if (operation?.outcome === 'original_terms') {
        suspended = operation.previousStatus !== 'approved' && operation.previousStatus !== 'ordered';
      } else {
        approval = undefined;
      }
    }
  }
  return suspended ? undefined : approval;
}

export function legacyApproval(ledger: PurchaseActivity[]) {
  const approved = ledger.findLast(row => row.action === 'approve');
  return approved && !Object.hasOwn(approved.detail, 'customerPlanVersion') ? approved : undefined;
}

export function legacyApprovalReview(ledger: PurchaseActivity[], approvalId: string, customerPlanVersion: string) {
  return ledger.findLast(row => row.action === 'review_legacy_approval' && row.detail.customerPlanVersion === customerPlanVersion
    && purchaseSnapshot(row)?.operation.legacyApprovalId === approvalId);
}

export function legacyArchiveEvidence(orderId: string, purchaseOrderId: string, contentHash: string, approval: PurchaseActivity, ledger: PurchaseActivity[]) {
  function checkedRecord(row: PurchaseActivity) {
    const recorded = purchaseSnapshot(row);
    if (!recorded || recorded.orderId !== orderId || recorded.purchaseOrderId !== purchaseOrderId || recorded.actorId !== row.actorId
      || recorded.operation?.action !== row.action || typeof recorded.requestId !== 'string' || !recorded.requestId
      || row.requestKey !== pricingContentHash({ orderId, purchaseOrderId, requestId: recorded.requestId })
      || !Number.isFinite(Date.parse(row.createdAt)) || !Array.isArray(recorded.lines)
      || recorded.lines.some(line => !line || typeof line.orderItemId !== 'string' || !line.source || !line.terms)
      || row.detail.actionHash !== pricingContentHash(recorded)
      || contentHash !== pricingContentHash(contractContent(orderId, purchaseOrderId, recorded.totalCents, recorded.lines))) {
      throw new PurchaseError('旧批准或付款记录无法与原单和请求版本一一对应，请核对原始档案');
    }
    return { recorded, id: row.id, actorId: row.actorId, recordedAt: row.createdAt, actionHash: row.detail.actionHash, requestId: recorded.requestId };
  }

  const prior = checkedRecord(approval);
  const payments = ledger.filter(row => row.action === 'record_payment').map(row => {
    const evidence = checkedRecord(row);
    const { operation } = evidence.recorded;
    if (!positiveCents(row.amountCents) || operation.amountCents !== row.amountCents
      || typeof operation.reference !== 'string' || !operation.reference
      || !row.referenceKey || Date.parse(row.createdAt) < Date.parse(approval.createdAt)) {
      throw new PurchaseError('原付款凭证、金额和登记时间须与旧批准一致');
    }
    return { ...evidence, amountCents: row.amountCents, receiptReference: operation.reference };
  });
  return { approval: prior, payments };
}
