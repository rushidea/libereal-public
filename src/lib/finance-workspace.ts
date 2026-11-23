import { Prisma } from '@prisma/client';
import { isAlipayReconciliationStatus } from '@/lib/payment-concurrency';
import { receivableOutstandingCents } from '@/lib/receivable-balance';
import { invoiceTimeline } from '@/lib/finance-invoice-timeline';
import { invoiceAuthorityTimeline, invoicesOutsideAuthority, readInvoiceAuthorityChange } from '@/lib/finance-invoice-authority';
import { confirmedCustomerDelivery, customerShipmentRows } from '@/lib/fulfillment-accounting';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { alipayCancellationRequest } from '@/lib/order-payment-review';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject } from '@/lib/purchase-activity';
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
  id: true, action: true, planId: true, invoiceId: true, actorId: true, approvedHash: true, detail: true, createdAt: true,
} satisfies Prisma.FinanceEventSelect;

type EventRow = Prisma.FinanceEventGetPayload<{ select: typeof eventSelect }>;
function eventView(row: EventRow) {
  const detail = jsonObject(row.detail);
  return { id: row.id, action: row.action, planId: row.planId, invoiceId: row.invoiceId, actorId: row.actorId,
    occurredAt: row.createdAt.toISOString(), operation: purchaseObject(detail.operation),
    replacementPlanId: typeof detail.replacementPlanId === 'string' ? detail.replacementPlanId : null };
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

const eventOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.FinanceEventOrderByWithRelationInput[];
const invoicePlanInclude = { allocations: { include: { invoice: { include: { events: {
  select: eventSelect, orderBy: eventOrder,
} } } } } } satisfies Prisma.FinanceInvoicePlanInclude;
type InvoicePlanRow = Prisma.FinanceInvoicePlanGetPayload<{ include: typeof invoicePlanInclude }>;

function dateValue(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function invoicePlanViews(plans: InvoicePlanRow[], events: FinanceEventView[], now: Date) {
  const creation = new Map(events.filter(row => row.action === 'create_plan').map(row => [row.planId, row.operation.invoiceScopeId]));
  const amendments = new Map(events.filter(row => row.action === 'amend_plan' && row.replacementPlanId)
    .map(row => [row.replacementPlanId, row]));
  function scopeOf(planId: string) {
    const seen = new Set<string>();
    let id: string | null = planId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const proof = creation.get(id);
      if (typeof proof === 'string') return proof;
      id = amendments.get(id)?.planId ?? null;
    }
    return null;
  }
  const invoices = plans.map(plan => {
    const history = events.filter(row => row.planId === plan.id);
    const amendment = amendments.get(plan.id);
    const close = history.findLast(row => row.action === 'close_plan');
    const allocations = plan.allocations.map(allocation => {
      const doc = allocation.invoice;
      return { id: allocation.id, invoiceId: doc.id, number: doc.number, amountCents: Number(allocation.amountCents),
        grossCents: Number(doc.grossCents), reference: doc.reference, sha256: doc.sha256,
        issuedAt: doc.issuedAt.toISOString(), issuer: doc.issuer, recipient: doc.recipient, status: invoiceStatus(doc.events) };
    });
    return { id: plan.id, orderId: plan.orderId, side: plan.side, purchaseOrderId: plan.purchaseOrderId, partyKey: plan.partyKey,
      issuer: plan.issuer, recipient: plan.recipient, grossCents: Number(plan.grossCents), trigger: plan.trigger,
      ownerId: plan.ownerId, reference: plan.reference, sha256: plan.sha256, allocations,
      invoiceScopeId: scopeOf(plan.id),
      usedCents: allocations.filter(row => row.status !== 'voided').reduce((sum, row) => sum + row.amountCents, 0),
      amendedFromPlanId: amendment?.planId ?? null, effectiveAt: dateValue(amendment?.operation.effectiveAt ?? amendment?.operation.occurredAt),
      closed: Boolean(close), closedAt: dateValue(close?.operation.occurredAt) ?? close?.occurredAt ?? null,
      stoppedCents: Number(close?.operation.stoppedCents ?? 0),
      manualAt: dateValue(history.findLast(row => row.action === 'confirm_condition')?.operation.occurredAt),
      lastFollowup: history.findLast(row => row.action === 'chase_invoice') ?? null };
  });
  const current = invoiceTimeline(invoices, now.getTime());
  const future = invoiceTimeline(invoices);
  return invoices.map(plan => ({ ...plan, remainingCents: current.remaining.get(plan.id) ?? 0,
    recordable: !plan.effectiveAt || Date.parse(plan.effectiveAt) <= now.getTime(),
    scheduledRemainingCents: future.remaining.get(plan.id) ?? 0, effectiveAllocationCents: plan.amendedFromPlanId
      ? future.transfers.get(plan.id) ?? 0 : plan.grossCents }));
}

export async function financeAttention(tx: Db, now: Date) {
  const [checks, chaseOrders] = await Promise.all([
    tx.financeEvent.findMany({ where: { action: 'reconcile_supplier' },
      select: { ...eventSelect, orderId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.financeInvoicePlan.findMany({ where: { side: 'supplier', events: { some: { action: 'chase_invoice' } } },
      distinct: ['orderId'], select: { orderId: true } }),
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
  const chaseOrderIds = chaseOrders.map(row => row.orderId);
  if (!chaseOrderIds.length) return byOrder;
  const [plans, events] = await Promise.all([
    tx.financeInvoicePlan.findMany({ where: { side: 'supplier', orderId: { in: chaseOrderIds } }, include: invoicePlanInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.financeEvent.findMany({ where: { orderId: { in: chaseOrderIds }, action: { in: ['amend_plan', 'close_plan', 'chase_invoice'] } },
      select: eventSelect, orderBy: eventOrder }),
  ]);
  for (const plan of invoicePlanViews(plans, events.map(eventView), now)) {
    const nextReviewAt = plan.lastFollowup?.operation.nextReviewAt;
    if (typeof nextReviewAt !== 'string' || !(Date.parse(nextReviewAt) <= now.getTime())) continue;
    if (plan.remainingCents > 0) add(plan.orderId, 'invoiceFollowups');
  }
  return byOrder;
}

function lastDate(dates: (string | Date | null | undefined)[]) {
  const times = dates.flatMap(value => value ? [new Date(value).getTime()] : []);
  return times.length && times.every(Number.isFinite) ? new Date(Math.max(...times)).toISOString() : null;
}

type CustomerInvoiceLine = { id: string; name: string | null; quantity: number; unitPrice: number };

function invoiceQuantity(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function coveredCustomerInvoiceLines(originalLines: CustomerInvoiceLine[], requested: unknown) {
  if (!Array.isArray(requested) || !requested.length) return null;
  const quantities = new Map<string, number>();
  for (const row of requested) {
    const { orderItemId, quantity } = purchaseObject(row);
    if (typeof orderItemId !== 'string' || quantities.has(orderItemId) || !invoiceQuantity(quantity)) return null;
    quantities.set(orderItemId, Number(quantity));
  }
  const lines = originalLines.flatMap(line => {
    const quantity = quantities.get(line.id);
    return quantity !== undefined && quantity <= line.quantity ? [{ id: line.id, name: line.name, unitPrice: line.unitPrice, quantity }] : [];
  });
  return lines.length === quantities.size ? lines : null;
}

export function customerInvoiceScopeVersion(orderId: string, customerKey: string, acceptanceId: string, lines: CustomerInvoiceLine[]) {
  return pricingContentHash({ orderId, customerKey, acceptanceId, lines });
}

function supplierMatchVersion(scope: Record<string, unknown>) {
  const { id, contentHash, supplier, payees, orderedAt, originalCents, agreedCents, paidCents, dueCents, payments,
    disputedPaidCents = 0, invoices } = scope;
  return pricingContentHash({ id, contentHash, supplier, payees, orderedAt, originalCents, agreedCents, paidCents, dueCents, payments,
    disputedPaidCents, invoices });
}

function customerInvoiceReviews(events: EventRow[], orderId: string, customerKey: string, acceptanceId: string | null, originalLines: CustomerInvoiceLine[]) {
  if (!acceptanceId) return [];
  return events.flatMap(event => {
    if (event.action !== 'verify_customer_invoice_scope' || !event.approvedHash) return [];
    const detail = jsonObject(event.detail);
    const op = purchaseObject(detail.operation);
    const authorization = purchaseObject(detail.authorization);
    const { grossCents, issuer, recipient, reference, sha256, lineIds, occurredAt } = op;
    const recordedChange = purchaseObject(op.scopeChange);
    const familyId = typeof recordedChange.familyId === 'string' ? recordedChange.familyId : event.id;
    const change = familyId === event.id ? null : readInvoiceAuthorityChange(recordedChange) ?? { mode: 'unknown' as const };
    if (typeof grossCents !== 'number' || !Number.isSafeInteger(grossCents) || grossCents < 0 || grossCents === 0 && familyId === event.id
      || typeof issuer !== 'string' || typeof recipient !== 'string' || typeof reference !== 'string' || typeof sha256 !== 'string'
      || typeof occurredAt !== 'string' || !dateValue(occurredAt) || authorization.permission !== 'finance.write'
      || authorization.action !== 'admin_sensitive' || op.ownerId !== event.actorId) return [];
    const scopeLines = op.invoiceLines ?? (Array.isArray(lineIds) ? lineIds.map(orderItemId => ({
      orderItemId, quantity: originalLines.find(line => line.id === orderItemId)?.quantity,
    })) : null);
    const lines = coveredCustomerInvoiceLines(originalLines, scopeLines);
    if (!lines || op.scopeVersion !== customerInvoiceScopeVersion(orderId, customerKey, acceptanceId, lines)) return [];
    return [{ id: event.id, familyId, change, actorId: event.actorId, grossCents, issuer, recipient, occurredAt, reference, sha256,
      documentRow: typeof op.documentRow === 'number' ? op.documentRow : null, lines }];
  });
}

export async function financeWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const purchase = await purchaseWorkspace(tx, orderId);
  const start = purchase.startReview;
  const customerKey = order.ownerScope === 'organization' && order.organizationId ? 'organization:' + order.organizationId
    : order.ownerScope === 'personal' && order.customerId ? 'customer:' + order.customerId : 'order:' + orderId;
  const [postings, plans, financeEvents, physical, signed] = await Promise.all([
    tx.customerCashPosting.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.financeInvoicePlan.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: invoicePlanInclude }),
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
  const invoicePlans = invoicePlanViews(plans, events, new Date());
  const originalInvoiceLines = order.orderItems.map(({ id, name, quantity, unitPrice }) => ({ id, name, quantity, unitPrice }));
  const customerInvoiceReviewsFound = customerInvoiceReviews(financeEvents, orderId, customerKey, start.acceptance?.id ?? null, originalInvoiceLines);
  const customerInvoiceScopes = customerInvoiceReviewsFound.filter(row => row.grossCents > 0);
  const customerInvoiceFamilies = customerInvoiceScopes.filter(row => row.familyId === row.id).map(root => {
    const evidence = customerInvoiceReviewsFound.filter(row => row.familyId === root.id);
    const scopeIds = new Set(evidence.map(row => row.id));
    const planned = invoicePlans.filter(plan => plan.invoiceScopeId && scopeIds.has(plan.invoiceScopeId));
    const timeline = invoiceAuthorityTimeline(evidence);
    const authorizedCents = timeline.at(-1)!.authorizedCents;
    const invoiceConflicts = invoicesOutsideAuthority(timeline, planned.flatMap(plan =>
      plan.allocations.map(allocation => ({ ...allocation, scopeId: plan.invoiceScopeId }))));
    const issuedCents = planned.reduce((sum, plan) => sum + plan.usedCents, 0);
    const plannedCents = planned.reduce((sum, plan) => sum + plan.usedCents + plan.scheduledRemainingCents, 0);
    return { id: root.id, authorizedCents, issuedCents, plannedCents, invoiceConflicts, timeline, evidence,
      availableCents: authorizedCents === null || invoiceConflicts.length ? null : Math.max(0, authorizedCents - plannedCents) };
  });
  const verifiedQuantities = new Map<string, number>();
  for (const scope of customerInvoiceScopes.filter(row => row.familyId === row.id)) {
    for (const line of scope.lines) verifiedQuantities.set(line.id, (verifiedQuantities.get(line.id) ?? 0) + line.quantity);
  }
  const purchases = purchase.orders.filter(po => po.orderedBefore || po.paidCents > 0 || po.paymentExceptions.length > 0).map(po => {
    const suppliers = [...new Set(po.lines.map(line => line.terms.supplier).filter((name): name is string => Boolean(name)))];
    const payees = [...new Set(po.lines.map(line => line.terms.payee).filter((name): name is string => Boolean(name)))];
    const payments = po.payments;
    const agreedCents = (!po.orderedBefore && po.paidCents === 0) || po.dueCents === null || po.incidents.length || po.needsRemainingReview || po.needsLegacyReview
      || po.paymentExceptions.some(row => row.pending)
      ? null : po.remainingScope?.totalCents ?? po.totalCents;
    const invoiceRows = invoicePlans.filter(plan => plan.purchaseOrderId === po.id);
    const invoiceAllocations = invoiceRows.flatMap(plan => plan.allocations);
    const invoicedCents = invoiceAllocations.reduce((sum, row) => sum + (row.status === 'recorded' ? row.amountCents : 0), 0);
    const underCorrectionCents = invoiceAllocations.reduce((sum, row) => sum + (row.status === 'correction_pending' ? row.amountCents : 0), 0);
    const scope = { id: po.id, revision: po.revision, contentHash: po.contentHash, supplier: suppliers.length === 1 ? suppliers[0] : null,
      payees, orderedAt: po.orderReceipt?.occurredAt ?? null, originalCents: po.totalCents, agreedCents,
      paidCents: po.paidCents, disputedPaidCents: po.disputedPaidCents, dueCents: po.dueCents, payments, paymentExceptions: po.paymentExceptions,
      paymentCorrections: po.paymentCorrections, invoicedCents, underCorrectionCents,
      invoices: invoiceAllocations.map(row => ({
        id: row.invoiceId, allocationId: row.id, amountCents: row.amountCents, sha256: row.sha256, status: row.status,
      })) };
    const matchVersion = supplierMatchVersion(scope);
    const lastMatch = events.findLast(row => row.action === 'reconcile_supplier' && row.operation.purchaseOrderId === po.id);
    const reviewed = purchaseObject(lastMatch?.operation.purchase);
    return { ...scope, matchVersion,
      reconciled: agreedCents !== null && lastMatch?.operation.outcome === 'matched'
        && (lastMatch.operation.matchVersion === matchVersion
          || reviewed.matchVersion === lastMatch.operation.matchVersion && supplierMatchVersion(reviewed) === matchVersion),
      supplierFollowup: lastMatch?.operation.outcome === 'followup'
        ? { id: lastMatch.id, actorId: lastMatch.actorId, reference: lastMatch.operation.reference } : null,
      pendingInvoiceCents: agreedCents === null ? null : agreedCents - invoicedCents - underCorrectionCents,
      paidInFullAt: po.dueCents === 0 && agreedCents !== null && payments.length && payments.every(row => row.occurredAt)
        ? lastDate(payments.map(row => row.occurredAt)) : null };
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
    principalCents: start.principal, postingPrincipal: start.postingPrincipal, postingOutstandingCents: start.postingOutstandingCents,
    acceptedAt: start.acceptance?.at ?? null, acceptanceId: start.acceptance?.id ?? null,
    acceptanceEvidenceHash: start.acceptance ? pricingContentHash({ orderId, acceptance: start.acceptance, termsVersion: start.termsVersion }) : null,
    receipts, banks, cash, cashCents, nativePaymentId: native, latePayments: late, authorityConflict,
    cancellationRequest: late.length ? await alipayCancellationRequest(tx, orderId) : null,
    paidAt: order.paidAt?.toISOString() ?? null,
    verifiedCents: start.payment.receivedCents, settlementCents: native && !authorityConflict ? start.postingPrincipal?.cents ?? 0 : cashCents,
    customerInvoiceScope: customerInvoiceScopes[0] ?? null, customerInvoiceScopes, customerInvoiceFamilies,
    originalInvoiceLines: originalInvoiceLines.map(line => ({ ...line, unverifiedQuantity: Math.max(0, line.quantity - (verifiedQuantities.get(line.id) ?? 0)) })),
    bankVersion: start.version, paymentPlanKnown: Boolean(start.plan), shipmentDates,
    receivable: ar && { id: ar.id, status: ar.status, originalCents: Math.round(ar.amount * 100),
      outstandingCents: receivableOutstandingCents(ar.amount, ar.status, postings, start.postingPrincipal ? start.postingPrincipal.cents / 100 : order.total),
      needsPrincipalReview: !start.postingPrincipal && ar.amount > 0 && ['open', 'overdue'].includes(ar.status),
      needsTermReview: Boolean(ar.termStartedAt && start.acceptance && ar.termStartedAt.toISOString() !== start.acceptance.at
        && !events.some(row => row.action === 'set_term' || row.action === 'restore_term')),
      terms: ar.paymentTermDaysSnapshot, termStartedAt: ar.termStartedAt?.toISOString() ?? null, dueAt: ar.dueAt?.toISOString() ?? null },
    purchases, invoicePlans, events };
  return { ...state, version: pricingContentHash(state) };
}

export type FinanceWorkspace = Awaited<ReturnType<typeof financeWorkspace>>;
