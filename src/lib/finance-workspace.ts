import { Prisma } from '@prisma/client';
import { isAlipayReconciliationStatus } from '@/lib/payment-concurrency';
import { receivableOutstandingCents } from '@/lib/receivable-balance';
import { confirmedCustomerDelivery, customerShipmentRows } from '@/lib/fulfillment-accounting';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject, purchaseOperation } from '@/lib/purchase-activity';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';

type Db = Prisma.TransactionClient;

export const invoiceTriggers = ['accepted', 'dispatched', 'delivered', 'paid', 'manual'] as const;
export type InvoiceTrigger = typeof invoiceTriggers[number];
export type FinanceSide = 'customer' | 'supplier';

export function financeIdentity(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
}

const eventSelect = {
  id: true, action: true, planId: true, invoiceId: true, actorId: true, detail: true, createdAt: true,
} satisfies Prisma.FinanceEventSelect;

type EventRow = Prisma.FinanceEventGetPayload<{ select: typeof eventSelect }>;
function eventView(row: EventRow) {
  const detail = jsonObject(row.detail);
  return { id: row.id, action: row.action, planId: row.planId, invoiceId: row.invoiceId, actorId: row.actorId,
    occurredAt: row.createdAt.toISOString(), operation: purchaseObject(detail.operation) };
}

type FinanceEventView = ReturnType<typeof eventView>;

function paymentCaseReview(events: FinanceEventView[], sourceId: string) {
  const claim = events.find(row => row.action === 'review_payment_case' && row.operation.sourceId === sourceId);
  if (!claim) return null;
  const followup = events.findLast(row => row.action === 'update_payment_case' && row.operation.claimId === claim.id);
  return { claimId: claim.id, ownerId: claim.actorId, lastRecord: followup ?? claim };
}

export function invoiceStatus(events: Array<{ action: string; detail: string }>) {
  const event = events.findLast(row => row.action === 'open_correction' || row.action === 'resolve_correction');
  if (!event) return 'recorded';
  if (event.action === 'open_correction') return 'correction_pending';
  return purchaseObject(jsonObject(event.detail).operation).outcome === 'voided' ? 'voided' : 'recorded';
}

export async function financeAttention(tx: Db, now: Date) {
  const [checks, plans] = await Promise.all([
    tx.financeEvent.findMany({ where: { action: 'reconcile_supplier' },
      select: { ...eventSelect, orderId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.financeInvoicePlan.findMany({
      where: { side: 'supplier', events: { some: { action: 'chase_invoice' }, none: { action: 'close_plan' } } },
      select: { orderId: true, grossCents: true,
        events: { where: { action: 'chase_invoice' }, select: { detail: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
        allocations: { select: { amountCents: true, invoice: { select: { events: {
          where: { action: { in: ['open_correction', 'resolve_correction'] } }, select: { action: true, detail: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        } } } } },
      },
    }),
  ]);
  const byOrder = new Map<string, { supplierDifferences: number; invoiceFollowups: number }>();
  const add = (orderId: string, kind: 'supplierDifferences' | 'invoiceFollowups') => {
    const counts = byOrder.get(orderId) ?? { supplierDifferences: 0, invoiceFollowups: 0 };
    counts[kind]++;
    byOrder.set(orderId, counts);
  };
  const latestChecks = new Map<string, { orderId: string; outcome: unknown }>();
  for (const check of checks) {
    const { purchaseOrderId, outcome } = purchaseObject(jsonObject(check.detail).operation);
    if (typeof purchaseOrderId === 'string') latestChecks.set(purchaseOrderId, { orderId: check.orderId, outcome });
  }
  for (const check of latestChecks.values()) {
    if (check.outcome === 'followup') add(check.orderId, 'supplierDifferences');
  }
  for (const plan of plans) {
    const { nextReviewAt } = purchaseObject(jsonObject(plan.events[0]?.detail).operation);
    if (typeof nextReviewAt !== 'string' || !(Date.parse(nextReviewAt) <= now.getTime())) continue;
    const received = plan.allocations.reduce((total, row) => invoiceStatus(row.invoice.events) === 'voided' ? total : total + row.amountCents, BigInt(0));
    if (received < plan.grossCents) add(plan.orderId, 'invoiceFollowups');
  }
  return byOrder;
}

function lastDate(dates: (string | Date | null | undefined)[]) {
  const times = dates.flatMap(value => value ? [new Date(value).getTime()] : []);
  return times.length && times.every(Number.isFinite) ? new Date(Math.max(...times)).toISOString() : null;
}

export async function financeWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const purchase = await purchaseWorkspace(tx, orderId);
  const start = purchase.startReview;
  const customerKey = order.ownerScope === 'organization' && order.organizationId ? 'organization:' + order.organizationId
    : order.ownerScope === 'personal' && order.customerId ? 'customer:' + order.customerId : 'order:' + orderId;
  const [postings, plans, financeEvents, physical, signed] = await Promise.all([
    tx.customerCashPosting.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.financeInvoicePlan.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { allocations: { include: { invoice: { include: { events: {
        select: eventSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      } } } } } } }),
    tx.financeEvent.findMany({ where: { orderId }, select: eventSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    customerShipmentRows(tx, orderId), confirmedCustomerDelivery(tx, orderId),
  ]);
  const events = financeEvents.map(eventView);
  const movement = physical.filter(row => row.effectiveQuantity > 0);
  const allDispatched = order.orderItems.length > 0 && movement.every(row => !row.commercialPending && row.shipment.shippedAt
    && row.shipment.shippedAt.getTime() <= Date.now()) && order.orderItems.every(item =>
    movement.filter(row => row.orderItemId === item.id).reduce((sum, row) => sum + row.effectiveQuantity, 0) === item.quantity);
  const shipmentDates = { dispatched: allDispatched ? lastDate(movement.map(row => row.shipment.shippedAt)) : null,
    delivered: signed ? lastDate(movement.map(row => row.shipment.deliveredAt)) : null };
  const invoicePlans = plans.map(plan => {
    const history = events.filter(row => row.planId === plan.id);
    const allocations = plan.allocations.map(allocation => {
      const doc = allocation.invoice;
      return { id: allocation.id, invoiceId: doc.id, number: doc.number, amountCents: Number(allocation.amountCents),
        grossCents: Number(doc.grossCents), reference: doc.reference, sha256: doc.sha256,
        issuedAt: doc.issuedAt.toISOString(), issuer: doc.issuer, recipient: doc.recipient, status: invoiceStatus(doc.events) };
    });
    const usedCents = allocations.filter(row => row.status !== 'voided').reduce((sum, row) => sum + row.amountCents, 0);
    return { id: plan.id, side: plan.side, purchaseOrderId: plan.purchaseOrderId, partyKey: plan.partyKey,
      issuer: plan.issuer, recipient: plan.recipient, grossCents: Number(plan.grossCents), trigger: plan.trigger,
      ownerId: plan.ownerId, reference: plan.reference, sha256: plan.sha256, usedCents, allocations,
      closed: history.some(row => row.action === 'close_plan'),
      manualAt: history.findLast(row => row.action === 'confirm_condition')?.operation.occurredAt as string | undefined ?? null,
      lastFollowup: history.findLast(row => row.action === 'chase_invoice') ?? null };
  });
  const purchases = purchase.orders.filter(po => po.orderedBefore || po.paidCents > 0).map(po => {
    const suppliers = [...new Set(po.lines.map(line => line.terms.supplier).filter((name): name is string => Boolean(name)))];
    const payees = [...new Set(po.lines.map(line => line.terms.payee).filter((name): name is string => Boolean(name)))];
    const payments = po.ledger.filter(row => row.action === 'record_payment').map(row => ({
      id: row.id, actorId: row.actorId, reference: String(purchaseOperation(row.detail).reference ?? ''),
      amountCents: row.amountCents ?? 0, recordedAt: row.createdAt,
    }));
    const agreedCents = po.dueCents === null || po.incidents.length || po.needsRemainingReview || po.needsLegacyReview
      ? null : po.remainingScope?.totalCents ?? po.totalCents;
    const invoiceRows = invoicePlans.filter(plan => plan.purchaseOrderId === po.id);
    const invoiceAllocations = invoiceRows.flatMap(plan => plan.allocations);
    const invoicedCents = invoiceAllocations.reduce((sum, row) => sum + (row.status === 'recorded' ? row.amountCents : 0), 0);
    const underCorrectionCents = invoiceAllocations.reduce((sum, row) => sum + (row.status === 'correction_pending' ? row.amountCents : 0), 0);
    const scope = { id: po.id, revision: po.revision, contentHash: po.contentHash, supplier: suppliers.length === 1 ? suppliers[0] : null,
      payees, orderedAt: po.orderReceipt?.occurredAt ?? null, originalCents: po.totalCents, agreedCents,
      paidCents: po.paidCents, dueCents: po.dueCents, payments, invoicedCents, underCorrectionCents,
      invoices: invoiceAllocations.map(row => ({
        id: row.invoiceId, allocationId: row.id, amountCents: row.amountCents, sha256: row.sha256, status: row.status,
      })) };
    const matchVersion = pricingContentHash(scope);
    const lastMatch = events.findLast(row => row.action === 'reconcile_supplier' && row.operation.purchaseOrderId === po.id);
    return { ...scope, matchVersion,
      reconciled: lastMatch?.operation.outcome === 'matched' && lastMatch.operation.matchVersion === matchVersion,
      supplierFollowup: lastMatch?.operation.outcome === 'followup'
        ? { id: lastMatch.id, actorId: lastMatch.actorId, reference: lastMatch.operation.reference } : null,
      pendingInvoiceCents: agreedCents === null ? null : agreedCents - invoicedCents - underCorrectionCents,
      paidInFullAt: po.dueCents === 0 && agreedCents !== null && payments.length ? lastDate(payments.map(row => row.recordedAt)) : null };
  });
  const cash = postings.map(row => ({ id: row.id, amountCents: Number(row.amountCents), releasedCents: Number(row.releasedCents),
    bankAllocationId: row.bankAllocationId, paymentAttemptId: row.paymentAttemptId, actorId: row.actorId }));
  const cashCents = cash.reduce((sum, row) => sum + row.amountCents, 0);
  const native = start.payment.paymentAttemptId;
  const late = order.paymentAttempts.filter(row => row.provider === 'alipay' && isAlipayReconciliationStatus(row.status))
    .map(row => ({ id: row.id, status: row.status, outTradeNo: row.outTradeNo, tradeNo: row.tradeNo,
      amountCents: Math.round(row.amount * 100), gatewayPaidAt: row.paidAt?.toISOString() ?? null,
      notifiedAt: row.notifiedAt?.toISOString() ?? null, review: paymentCaseReview(events, row.id) }));
  const authorityConflict = Boolean(native && start.payment.allocatedCents || cash.some(post => post.bankAllocationId
    && !start.payment.receipts.some(row => row.id === post.bankAllocationId && row.counted)));
  const ar = order.receivable;
  const bankIds = start.bankReceipts.map(row => row.id);
  const totals = bankIds.length ? await tx.$queryRaw<Array<{ id: string; total: bigint }>>`SELECT
    json_extract(detail,'$.snapshot.operation.bankReceiptId') AS id, SUM(amountCents) AS total FROM PurchaseActivity
    WHERE action='record_customer_receipt' AND json_extract(detail,'$.snapshot.operation.bankReceiptId') IN (${Prisma.join(bankIds)})
    GROUP BY json_extract(detail,'$.snapshot.operation.bankReceiptId')` : [];
  const used = new Map(totals.map(row => [row.id, Number(row.total)]));
  const banks = start.bankReceipts.map(row => ({ id: row.id, payer: row.bank.payer, bankTrace: row.bank.bankTrace,
    reference: row.bank.reference, sha256: row.bank.sha256, totalCents: row.bank.receiptTotalCents,
    availableCents: row.bank.receiptTotalCents - (used.get(row.id) ?? 0), occurredAt: row.bank.occurredAt }));
  const receipts = start.payment.receipts.map(row => ({ id: row.id, bankReceiptId: row.bankReceiptId, amountCents: row.amountCents,
    counted: row.counted, reconciled: row.reconciled, occurredAt: typeof row.occurredAt === 'string' ? row.occurredAt : null,
    review: row.counted || row.reconciled ? null : paymentCaseReview(events, row.id) }));
  const state = { orderId, status: order.status, archived: Boolean(order.archivedAt), customerKey, customerEmail: order.email,
    principalCents: start.principal, acceptedAt: start.acceptance?.at ?? null, acceptanceId: start.acceptance?.id ?? null,
    acceptanceEvidenceHash: start.acceptance ? pricingContentHash({ orderId, acceptance: start.acceptance, termsVersion: start.termsVersion }) : null,
    receipts, banks, cash, cashCents, nativePaymentId: native, latePayments: late, authorityConflict,
    paidAt: order.paidAt?.toISOString() ?? null,
    verifiedCents: start.payment.receivedCents, settlementCents: native && !authorityConflict ? start.principal : cashCents,
    bankVersion: start.version, paymentPlanKnown: Boolean(start.plan), shipmentDates,
    receivable: ar && { id: ar.id, status: ar.status, originalCents: Math.round(ar.amount * 100),
      outstandingCents: receivableOutstandingCents(ar.amount, ar.status, postings, order.total),
      needsTermReview: Boolean(ar.termStartedAt && start.acceptance && ar.termStartedAt.toISOString() !== start.acceptance.at
        && !events.some(row => row.action === 'set_term' || row.action === 'restore_term')),
      terms: ar.paymentTermDaysSnapshot, termStartedAt: ar.termStartedAt?.toISOString() ?? null, dueAt: ar.dueAt?.toISOString() ?? null },
    purchases, invoicePlans, events };
  return { ...state, version: pricingContentHash(state) };
}

export type FinanceWorkspace = Awaited<ReturnType<typeof financeWorkspace>>;
