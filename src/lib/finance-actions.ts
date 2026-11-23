import type { Prisma } from '@prisma/client';
import { applyStockHeldAlipayPayment, previewStockHeldAlipayPayment } from '@/lib/alipay-order-settlement';
import { customerCashProjection, postVerifiedCustomerCash } from '@/lib/customer-cash';
import { refreshCreditRestrictions } from '@/lib/customer-credit';
import { invoiceTimeline } from '@/lib/finance-invoice-timeline';
import { coveredCustomerInvoiceLines, customerInvoiceScopeVersion, financeIdentity, financeWorkspace, invoiceStatus, invoiceTriggers,
  type FinanceWorkspace, type InvoiceTrigger } from '@/lib/finance-workspace';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { isActivePurchaseOrder } from '@/lib/purchase-acceptance';
import { addPurchaseActivity, purchaseObject, readPurchaseActivities, type PurchaseActor, type PurchaseAuthorization } from '@/lib/purchase-activity';
import { prepareOrderPurchases } from '@/lib/purchase-orders';
import { previewBankAllocation, previewBankReceipt } from '@/lib/purchase-receipts';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
export const financeActions = ['verify_bank_receipt', 'record_customer_receipt', 'post_existing', 'verify_receivable_principal', 'restore_term', 'set_term',
  'verify_customer_invoice_scope', 'create_plan', 'amend_plan', 'confirm_condition', 'chase_invoice', 'close_plan', 'record_invoice', 'open_correction', 'resolve_correction',
  'reconcile_supplier', 'review_payment_case', 'update_payment_case', 'resume_alipay_payment'] as const;
type Action = typeof financeActions[number];
export type FinanceInput = { orderId: string; action: Action; requestId: string; version: string; data: Record<string, unknown> };

function money(value: unknown, label: string) {
  if (!positiveCents(value)) throw new PurchaseError(label + '须为大于零的整分金额', 400);
  return value;
}

function actualTime(value: unknown, label: string) {
  const at = purchaseTimestamp(value, label);
  if (Date.parse(at) > Date.now()) throw new PurchaseError(label + '不能晚于当前时间', 400);
  return at;
}

type Plan = FinanceWorkspace['invoicePlans'][number];
function planFor(view: FinanceWorkspace, id: unknown, historical = false) {
  const plan = view.invoicePlans.find(row => row.id === id);
  if (!plan || plan.closed && !historical) throw new PurchaseError('请核对本单的发票安排及实际有效时间');
  return plan;
}

function sameInvoiceScope(view: FinanceWorkspace, side: Plan['side'], purchaseOrderId: string | null, scopeId: string | null) {
  return view.invoicePlans.filter(row => row.side === side && row.purchaseOrderId === purchaseOrderId && row.invoiceScopeId === scopeId);
}

function invoiceTrigger(side: Plan['side'], value: unknown) {
  const trigger = value as InvoiceTrigger;
  if (!invoiceTriggers.includes(trigger) || side === 'supplier' && (trigger === 'dispatched' || trigger === 'delivered')) {
    throw new PurchaseError('请按原书证选择开票条件，供应商的特殊交货约定可交由经办人核验', 400);
  }
  return trigger;
}

function invoiceScopeLimit(view: FinanceWorkspace, side: string, purchaseOrderId: string | null, scopeId: string | null) {
  if (side === 'customer') return customerInvoiceScope(view, scopeId)?.grossCents ?? view.principalCents;
  const agreedCents = view.purchases.find(po => po.id === purchaseOrderId)?.agreedCents;
  if (agreedCents == null) throw new PurchaseError('须先核对当前供方合同和可收票金额');
  return agreedCents;
}

function projectedInvoiceCommitments(plans: Plan[], timeline = invoiceTimeline(plans)) {
  return plans.reduce((sum, plan) => sum
    + plan.allocations.reduce((cents, invoice) => cents + (invoice.status === 'voided' ? 0 : invoice.amountCents), 0)
    + (timeline.remaining.get(plan.id) ?? 0), 0);
}

function customerInvoiceScope(view: FinanceWorkspace, scopeId: unknown, allowSingle = false) {
  if (scopeId == null && view.principalCents > 0) return null;
  const scope = scopeId == null && allowSingle && view.customerInvoiceScopes.length === 1
    ? view.customerInvoiceScopes[0] : view.customerInvoiceScopes.find(row => row.id === scopeId);
  if (!scope) throw new PurchaseError('请凭原开票书证核对并选择本次业务对应的客户可开票范围');
  return scope;
}

function checkCustomerInvoiceParties(view: FinanceWorkspace, scopeId: unknown, issuer: string, recipient: string, allowSingle = false) {
  const scope = customerInvoiceScope(view, scopeId, allowSingle);
  if (scope && (financeIdentity(issuer) !== financeIdentity(scope.issuer) || financeIdentity(recipient) !== financeIdentity(scope.recipient))) {
    throw new PurchaseError('请按原书证核对开票方与受票方');
  }
  return scope;
}

export function invoiceReadyAt(view: FinanceWorkspace, plan: Plan) {
  const po = view.purchases.find(row => row.id === plan.purchaseOrderId);
  let businessAt: string | null = null;
  if (plan.trigger === 'manual') businessAt = plan.manualAt;
  if (plan.trigger === 'accepted') businessAt = po ? po.orderedAt : view.acceptedAt;
  if (plan.trigger === 'paid') businessAt = po ? po.paidInFullAt
    : view.postingPrincipal && view.settlementCents === view.postingPrincipal.cents && !view.authorityConflict ? view.paidAt : null;
  if (!po && (plan.trigger === 'dispatched' || plan.trigger === 'delivered')) businessAt = view.shipmentDates[plan.trigger];
  if (!businessAt || !Number.isFinite(Date.parse(businessAt)) || plan.amendedFromPlanId && !plan.effectiveAt) return null;
  const originalScopeAt = plan.side === 'customer' ? customerInvoiceScope(view, plan.invoiceScopeId)?.occurredAt : null;
  return [businessAt, plan.effectiveAt, originalScopeAt].filter((time): time is string => Boolean(time)).sort().at(-1)!;
}

async function invoiceDocument(tx: Db, view: FinanceWorkspace, input: FinanceInput, evidence: Evidence) {
  const data = input.data;
  const plan = planFor(view, data.planId, true);
  const readyAt = invoiceReadyAt(view, plan);
  if (!readyAt) throw new PurchaseError('约定的开票条件尚未取得实际结果');
  const issuedAt = actualTime(data.issuedAt, '人工开票时间');
  if (Date.parse(issuedAt) < Date.parse(readyAt)) throw new PurchaseError('票面开票时间早于约定条件的实际完成时间，请核对原件或更正约定');
  const number = requiredText(data.number, '票面号码');
  const issuer = requiredText(data.issuer, '票面开票方全称');
  const recipient = requiredText(data.recipient, '票面受票方全称');
  if (financeIdentity(issuer) !== financeIdentity(plan.issuer) || financeIdentity(recipient) !== financeIdentity(plan.recipient)) {
    throw new PurchaseError('票面开票方和受票方须与本次确认的安排一致');
  }
  const sourceScope = plan.side === 'customer' ? checkCustomerInvoiceParties(view, plan.invoiceScopeId, issuer, recipient) : null;
  const identityKey = pricingContentHash({ issuer: financeIdentity(issuer), number: financeIdentity(number) });
  const grossCents = money(data.grossCents, '票面含税合计');
  const amountCents = money(data.amountCents, '本次归入金额');
  const plans = sameInvoiceScope(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId);
  const before = invoiceTimeline(plans);
  const allocationId = 'previewed-invoice';
  const trial = plans.map(row => row.id === plan.id ? { ...row, allocations: [...row.allocations, {
    id: allocationId, invoiceId: '', number, issuedAt, amountCents, grossCents, issuer, recipient,
    reference: evidence.reference, sha256: evidence.sha256, status: 'recorded',
  }] } : row);
  const after = invoiceTimeline(trial);
  if (after.conflicts.has(allocationId)) throw new PurchaseError('票面日期超出原安排的有效范围或可用金额');
  if ([...after.conflicts].some(id => !before.conflicts.has(id))
    || projectedInvoiceCommitments(trial, after) > invoiceScopeLimit(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId)) {
    throw new PurchaseError('实际票面与已占用的开票额度冲突，请核对原票和安排');
  }
  const adjustedPlans = plans.flatMap(row => {
    const previous = before.transfers.get(row.id);
    const assigned = after.transfers.get(row.id);
    return previous === undefined || previous === assigned ? [] : [{ planId: row.id, reference: row.reference, previousCents: previous, effectiveCents: assigned ?? 0 }];
  });
  const matches = await tx.financeInvoice.findMany({ where: { OR: [{ identityKey }, { sha256: evidence.sha256 }] },
    include: { allocations: true, events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
  const [doc] = matches;
  if (matches.length > 1 || doc && (doc.identityKey !== identityKey || doc.sha256 !== evidence.sha256
    || doc.side !== plan.side || doc.partyKey !== plan.partyKey || financeIdentity(doc.recipient) !== financeIdentity(recipient)
    || doc.issuedAt.toISOString() !== issuedAt || Number(doc.grossCents) !== grossCents || invoiceStatus(doc.events) !== 'recorded')) {
    throw new PurchaseError('该票号或原件已经关联不同的票面、交易方或更正记录');
  }
  if (doc?.allocations.some(row => row.planId === plan.id)) throw new PurchaseError('本发票已归入该项安排');
  const allocatedBeforeCents = doc?.allocations.reduce((sum, row) => sum + Number(row.amountCents), 0) ?? 0;
  if (allocatedBeforeCents + amountCents > grossCents) throw new PurchaseError('分配金额超过这张发票可用的票面金额');
  return { ...evidence, action: 'record_invoice' as const, planId: plan.id, invoiceId: doc?.id ?? null, side: plan.side,
    partyKey: plan.partyKey, issuer, recipient, identityKey, number, issuedAt, readyAt, grossCents, amountCents, allocatedBeforeCents,
    invoiceScopeId: sourceScope?.id ?? null, adjustedPlans };
}

type Evidence = { reference: string; sha256: string; description: string };

async function financeOperation(tx: Db, input: FinanceInput, actor: PurchaseActor, view: FinanceWorkspace) {
  const { action, data, orderId } = input;
  const evidence = { reference: requiredText(data.reference, '书面依据编号'), sha256: documentSha256(data.sha256, '原件摘要'),
    description: requiredText(data.description, '核对结果或业务约定') };
  if (action === 'verify_bank_receipt' || action === 'record_customer_receipt') {
    const order = await loadPurchaseOrderSource(tx, orderId);
    if (view.archived || ['cancelled', 'closed'].includes(order.status)) throw new PurchaseError('请核对仍可办理的原订单及回单归属');
    if (action === 'verify_bank_receipt') return previewBankReceipt(tx, order, data, evidence);
    if (view.authorityConflict || view.nativePaymentId || view.paidAt || !view.paymentPlanKnown) throw new PurchaseError('请先核对本单的付款条件和已有到账来源');
    if (view.postingOutstandingCents === null) throw new PurchaseError('原订单金额待财务核对，可先保留银行回单');
    const allocation = await previewBankAllocation(tx, order, await readPurchaseActivities(tx, orderId), data, evidence,
      view.postingOutstandingCents);
    return { ...allocation, accounting: await customerCashProjection(tx, order, allocation.amountCents) };
  }
  if (action === 'verify_receivable_principal') {
    const order = await loadPurchaseOrderSource(tx, orderId);
    const ar = order.receivable;
    if (!view.receivable?.needsPrincipalReview || !isActivePurchaseOrder(order) || !view.acceptanceId || !ar
      || order.customerId !== ar.userId || order.paidAt || ar.paidAt) {
      throw new PurchaseError('须核对已接单的原客户、未结应收及历史面额差异');
    }
    const amountCents = money(data.amountCents, '原凭证记载的应收金额');
    if (amountCents !== view.receivable.originalCents || view.cashCents > amountCents || view.verifiedCents > amountCents) {
      throw new PurchaseError('原凭证金额或已有到账与原账面不符，请留下原应收继续核对');
    }
    return { ...evidence, action, amountCents, orderId, orderFaceCents: view.principalCents, receivableId: ar.id,
      debtorId: ar.userId, acceptanceId: view.acceptanceId, ownerId: actor.id,
      occurredAt: actualTime(data.occurredAt, '原书证确认应收时间') };
  }
  if (action === 'post_existing') {
    const id = requiredText(data.sourceId, '待核销的既有到账记录');
    const bank = view.receipts.find(row => row.id === id && row.counted);
    const native = id === view.nativePaymentId;
    if ((!bank && !native) || view.authorityConflict || view.cash.some(row => row.bankAllocationId === id || row.paymentAttemptId === id)) {
      throw new PurchaseError('所选到账记录尚未核验、已有冲突或已经核销');
    }
    return { ...evidence, action, source: native ? { paymentAttemptId: id } : { bankAllocationId: id },
      amountCents: bank?.amountCents ?? view.principalCents,
      accounting: await customerCashProjection(tx, await loadPurchaseOrderSource(tx, orderId), bank?.amountCents ?? view.principalCents, native ? 'alipay' : 'bank') };
  }
  if (action === 'restore_term' || action === 'set_term') {
    const ar = view.receivable;
    if (!ar || ar.outstandingCents <= 0 || !['open', 'overdue'].includes(ar.status) || !view.acceptedAt || view.archived
      || ['closed', 'cancelled'].includes(view.status)) throw new PurchaseError('本单缺少平台接单凭据或有效应收');
    const original = action === 'restore_term';
    if (original && (ar.termStartedAt || ar.dueAt)) throw new PurchaseError('已有账期，请根据书面约定办理变更');
    const startedAt = original ? view.acceptedAt : purchaseTimestamp(data.startedAt, '约定的起算时间');
    const days = original ? ar.terms : data.days;
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 0) throw new PurchaseError('请输入该单书面约定的账期天数', 400);
    const due = new Date(Date.parse(startedAt) + days * 86400000);
    if (!Number.isFinite(due.getTime())) throw new PurchaseError('到期日无效', 400);
    return { ...evidence, action, receivableId: ar.id, acceptanceId: view.acceptanceId, before: ar,
      startedAt, days, dueAt: due.toISOString(), receivableStatus: due.getTime() < Date.now() ? 'overdue' as const : 'open' as const };
  }
  if (action === 'verify_customer_invoice_scope') {
    const { issuer, recipient } = data;
    if (view.principalCents > 0 || !view.acceptanceId || !isActivePurchaseOrder({
      status: view.status, archivedAt: view.archived ? new Date() : null,
    })) throw new PurchaseError('仅可对有原接单依据、面额待核的客户订单核实开票范围');
    const issuedBy = requiredText(issuer, '原书证开票方全称');
    const issuedTo = requiredText(recipient, '原书证受票方全称');
    if (financeIdentity(issuedBy) === financeIdentity(issuedTo)) throw new PurchaseError('请核对原书证中的购销双方');
    const ids = data.invoiceLineIds;
    const selected = data.invoiceLines ?? (Array.isArray(ids) ? ids.map(orderItemId => ({
      orderItemId, quantity: view.originalInvoiceLines.find(line => line.id === orderItemId)?.quantity,
    })) : null);
    const lines = coveredCustomerInvoiceLines(view.originalInvoiceLines, selected);
    if (!lines) throw new PurchaseError('请选择可由原书证证实的实际订单行和数量');
    if (lines.some(row => row.quantity > (view.originalInvoiceLines.find(line => line.id === row.id)?.unverifiedQuantity ?? 0))) {
      throw new PurchaseError('此份书证所列数量与已核实的份额重叠，请核对尚未确认的数量');
    }
    const documentRow = data.documentRow == null ? null : money(data.documentRow, '原件实际行号');
    const prior = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM FinanceEvent WHERE action='verify_customer_invoice_scope'
        AND json_extract(detail,'$.operation.sha256')=${evidence.sha256}
        AND (${documentRow} IS NULL OR json_extract(detail,'$.operation.documentRow') IS NULL
          OR json_extract(detail,'$.operation.documentRow')=${documentRow}) LIMIT 1`;
    if (prior.length) throw new PurchaseError('此原件或该原件行已经核对过开票范围，请回到原记录');
    const grossCents = money(data.grossCents, '原书证可开的含税金额');
    const occurredAt = actualTime(data.occurredAt, '原书证载明的实际确认时间');
    return { ...evidence, action, issuer: issuedBy, recipient: issuedTo, grossCents, occurredAt, ownerId: actor.id, documentRow,
      acceptanceId: view.acceptanceId, lines, lineIds: lines.map(row => row.id),
      invoiceLines: lines.map(row => ({ orderItemId: row.id, quantity: row.quantity })),
      scopeVersion: customerInvoiceScopeVersion(orderId, view.customerKey, view.acceptanceId, lines) };
  }
  if (action === 'create_plan') {
    if (data.side !== 'customer' && data.side !== 'supplier') throw new PurchaseError('请选择客户开票或供应商来票', 400);
    const side = data.side;
    const po = side === 'supplier' ? view.purchases.find(row => row.id === data.purchaseOrderId) : null;
    if (side === 'supplier' && (!po?.supplier || po.agreedCents === null)) throw new PurchaseError('须先核清实际采购单、供方全称和约定金额');
    if (side === 'customer' && (!view.acceptanceId || data.purchaseOrderId || ['cancelled', 'closed'].includes(view.status))) {
      throw new PurchaseError('客户开票须对应本平台已接受的原客户订单');
    }
    const issuer = requiredText(data.issuer, '约定的开票方全称');
    const recipient = requiredText(data.recipient, '约定的受票方全称');
    if (financeIdentity(issuer) === financeIdentity(recipient) || po?.supplier && financeIdentity(issuer) !== financeIdentity(po.supplier)) {
      throw new PurchaseError('请核对原始书证中的购销双方');
    }
    const trigger = invoiceTrigger(side, data.trigger);
    const grossCents = money(data.grossCents, '本次安排的含税金额');
    const scope = side === 'customer' ? checkCustomerInvoiceParties(view, data.invoiceScopeId, issuer, recipient, true) : null;
    const scopeId = scope?.id ?? null;
    const agreed = invoiceScopeLimit(view, side, po?.id ?? null, scopeId);
    const planned = projectedInvoiceCommitments(sameInvoiceScope(view, side, po?.id ?? null, scopeId));
    if (grossCents > agreed - planned) throw new PurchaseError('安排金额超过原单尚未安排的金额');
    return { ...evidence, action, side, issuer, recipient, grossCents, trigger, ownerId: actor.id, purchaseOrderId: po?.id ?? null,
      partyKey: po ? 'supplier:' + financeIdentity(issuer) : view.customerKey, invoiceScopeId: scope?.id ?? null };
  }
  if (action === 'record_invoice') return invoiceDocument(tx, view, input, evidence);
  if (action === 'amend_plan') {
    const plan = planFor(view, data.planId);
    const amountCents = money(data.amountCents, '本次变更条件对应的未开金额');
    if (view.events.some(row => row.action === 'amend_plan' && row.planId === plan.id && row.operation.sha256 === evidence.sha256)) {
      throw new PurchaseError('这份书证已用于变更本项安排，请核对原范围');
    }
    const occurredAt = actualTime(data.occurredAt, '书面变更确认时间');
    const effectiveAt = data.effectiveAt == null ? occurredAt : purchaseTimestamp(data.effectiveAt, '书面约定生效时间');
    if (plan.amendedFromPlanId && (!plan.effectiveAt || Date.parse(effectiveAt) < Date.parse(plan.effectiveAt))) {
      throw new PurchaseError('本次变更不得早于所选安排原来明确生效的时间，请核对前一份书证');
    }
    const retroactiveReference = Date.parse(effectiveAt) < Date.parse(occurredAt)
      ? requiredText(data.retroactiveReference, '原书面约定中明确追溯生效的条款') : null;
    const plans = sameInvoiceScope(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId);
    const prior = invoiceTimeline(plans);
    const replacementId = 'previewed-invoice-arrangement';
    const amended = [...plans, { ...plan, id: replacementId, grossCents: amountCents, amendedFromPlanId: plan.id,
      effectiveAt, closedAt: null, closed: false, stoppedCents: 0, allocations: [] }];
    const next = invoiceTimeline(amended);
    if (next.transfers.get(replacementId) !== amountCents
      || [...prior.transfers].some(([id, available]) => next.transfers.get(id) !== available)
      || [...next.conflicts].some(id => !prior.conflicts.has(id))
      || projectedInvoiceCommitments(amended, next) > invoiceScopeLimit(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId)) {
      throw new PurchaseError('变更金额超过本单有效的未开部分，或影响其他已经安排的额度');
    }
    return { ...evidence, action, planId: plan.id, original: plan, amountCents, retainedCents: next.remaining.get(plan.id) ?? 0,
      trigger: invoiceTrigger(plan.side, data.trigger), occurredAt, effectiveAt, retroactiveReference, ownerId: actor.id };
  }
  if (action === 'confirm_condition' || action === 'chase_invoice' || action === 'close_plan') {
    const plan = planFor(view, data.planId);
    const stoppable = Math.min(plan.remainingCents, plan.scheduledRemainingCents);
    if (action === 'close_plan' && !stoppable) throw new PurchaseError('本项没有可止用的未开或未收余额');
    if (action === 'chase_invoice' && (plan.side !== 'supplier' || !plan.remainingCents)) throw new PurchaseError('本项没有待追的供应商发票');
    if (action === 'confirm_condition' && (plan.trigger !== 'manual' || plan.manualAt)) throw new PurchaseError('本项没有待人工核对的开票条件');
    const occurredAt = actualTime(data.occurredAt, '实际办理时间');
    if (action === 'close_plan') {
      const plans = sameInvoiceScope(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId);
      const prior = invoiceTimeline(plans);
      const after = invoiceTimeline(plans.map(row => row.id === plan.id ? { ...row, closedAt: occurredAt, stoppedCents: stoppable } : row));
      if ([...after.conflicts].some(id => !prior.conflicts.has(id))
        || [...prior.transfers].some(([id, available]) => after.transfers.get(id) !== available)) {
        throw new PurchaseError('止用时间或金额与已有票面或已约定的安排冲突');
      }
    }
    const nextReviewAt = action === 'chase_invoice' ? purchaseTimestamp(data.nextReviewAt, '约定的下次跟进时间') : null;
    if (nextReviewAt && Date.parse(nextReviewAt) <= Date.parse(occurredAt)) throw new PurchaseError('下次跟进时间须晚于本次沟通');
    return { ...evidence, action, planId: plan.id, occurredAt, nextReviewAt, ownerId: actor.id,
      stoppedCents: action === 'close_plan' ? stoppable : undefined };
  }
  if (action === 'open_correction' || action === 'resolve_correction') {
    const invoiceId = requiredText(data.invoiceId, '原发票记录编号');
    const doc = await tx.financeInvoice.findUnique({ where: { id: invoiceId },
      include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, allocations: { include: { plan: true }, orderBy: { id: 'asc' } } } });
    if (!doc || !doc.allocations.some(row => row.plan.orderId === orderId)) throw new PurchaseError('原发票不属于所选订单');
    const status = invoiceStatus(doc.events);
    if (action === 'open_correction' ? status !== 'recorded' : status !== 'correction_pending') throw new PurchaseError('请核对原发票当前的更正状态');
    const affected = doc.allocations.map(row => ({ orderId: row.plan.orderId, planId: row.planId, amountCents: Number(row.amountCents) }));
    const occurredAt = actualTime(data.occurredAt, '书面处理时间');
    if (Date.parse(occurredAt) < doc.issuedAt.getTime()) throw new PurchaseError('更正时间早于原发票');
    let outcome: 'retained' | 'voided' | null = null;
    if (action === 'resolve_correction') {
      if (data.outcome !== 'retained' && data.outcome !== 'voided') throw new PurchaseError('请核对原票继续有效或已取得整张红冲、作废书证', 400);
      outcome = data.outcome;
      const opened = doc.events.findLast(row => row.action === 'open_correction');
      if (!opened || evidence.sha256 === doc.sha256 || evidence.sha256 === purchaseObject(jsonObject(opened.detail).operation).sha256
        || occurredAt < String(purchaseObject(jsonObject(opened.detail).operation).occurredAt)) throw new PurchaseError('须提供申请之后的实际办理结果原件');
      const duplicate = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM FinanceEvent WHERE action='resolve_correction'
        AND json_extract(detail,'$.operation.sha256')=${evidence.sha256} AND invoiceId<>${invoiceId} LIMIT 1`;
      if (duplicate.length) throw new PurchaseError('该份更正结果已归入其他发票，请核对涉及的原件范围');
    }
    return { ...evidence, action, invoiceId, originalNumber: doc.number, originalSha256: doc.sha256, affected, occurredAt, outcome, ownerId: actor.id };
  }
  if (action === 'reconcile_supplier') {
    const po = view.purchases.find(row => row.id === data.purchaseOrderId);
    if (!po) throw new PurchaseError('请核对本订单对应的已订购或已付款采购单');
    const outcome = data.outcome;
    if (outcome !== 'matched' && outcome !== 'followup') throw new PurchaseError('请选择核对一致或有差异待跟进');
    if (outcome === 'matched' && (po.agreedCents === null || !po.invoices.some(row => row.status === 'recorded')
      || po.invoices.some(row => row.status === 'correction_pending') || po.invoicedCents > po.agreedCents || po.paidCents > po.agreedCents)) {
      throw new PurchaseError('采购、付款和有效来票无法核对一致，请登记差异及跟进依据');
    }
    return { ...evidence, action, purchaseOrderId: po.id, matchVersion: po.matchVersion, purchase: po, outcome, ownerId: actor.id };
  }
  if (action === 'resume_alipay_payment') {
    const sourceId = requiredText(data.sourceId, '库存短少的原支付宝交易');
    const payment = await previewStockHeldAlipayPayment(tx, orderId, sourceId);
    if (payment.cancellationRequest && data.confirmContinueAfterCancellation !== true) {
      throw new PurchaseError('已收到取消或移除申请。请先核对处理结果和继续原单的书面依据');
    }
    return { ...evidence, action, sourceId, payment, caseId: view.latePayments.find(row => row.id === sourceId)?.review?.claimId ?? null };
  }
  const sourceId = requiredText(data.sourceId, '待核对的原交易');
  const alipay = view.latePayments.find(row => row.id === sourceId);
  const bank = view.receipts.find(row => row.id === sourceId && !row.counted && !row.reconciled);
  const source = alipay ? { ...alipay, kind: 'alipay' as const } : bank && { ...bank, kind: 'bank' as const };
  if (!source) throw new PurchaseError('找不到所选交易的待核对记录');
  const { review, ...originalTrade } = source;
  const occurredAt = actualTime(data.occurredAt, '实际核对时间');
  if (action === 'review_payment_case') {
    if (review) throw new PurchaseError('该交易已由经办人接手，请继续登记跟进结果');
    return { ...evidence, action, sourceId, source: originalTrade, ownerId: actor.id, occurredAt };
  }
  if (!review) throw new PurchaseError('请先领取这笔原交易的待办');
  const outcome = data.outcome;
  if (outcome !== 'awaiting_provider_evidence' && outcome !== 'awaiting_authorized_disposition') {
    throw new PurchaseError('请登记仍待核实的结果。结案须有已经批准并实际完成的原处理记录', 400);
  }
  if (occurredAt < String(review.lastRecord.operation.occurredAt ?? '')) throw new PurchaseError('核对时间早于上一条跟进记录');
  if (review.lastRecord.operation.outcome === outcome && review.lastRecord.operation.sha256 === evidence.sha256) {
    throw new PurchaseError('这份处理进展已经记录，请保留原待办');
  }
  return { ...evidence, action, sourceId, source: originalTrade, claimId: review.claimId, ownerId: review.ownerId, occurredAt, outcome };
}

export async function previewFinanceAction(tx: Db, input: FinanceInput, actor: PurchaseActor) {
  const view = await financeWorkspace(tx, input.orderId);
  if (input.version !== view.version) throw new PurchaseError('账务、票面或原单已变化，请重新查看预览');
  const operation = await financeOperation(tx, input, actor, view);
  const snapshot = { orderId: input.orderId, requestId: input.requestId, version: view.version, actor, operation };
  return { snapshot, actionHash: pricingContentHash(snapshot) };
}

export async function applyFinanceAction(tx: Db, input: FinanceInput, actor: PurchaseActor, expected: string, authorization: PurchaseAuthorization) {
  const requestKey = pricingContentHash({ orderId: input.orderId, requestId: input.requestId });
  const intentHash = pricingContentHash({ input, actor });
  const previous = await tx.financeEvent.findUnique({ where: { requestKey } });
  if (previous) {
    if (previous.approvedHash !== expected || previous.intentHash !== intentHash) throw new PurchaseError('本操作编号已用于其他内容');
    return previous.id;
  }
  const { snapshot, actionHash } = await previewFinanceAction(tx, input, actor);
  if (actionHash !== expected) throw new PurchaseError('确认内容与实际预览不一致');
  const op = snapshot.operation;
  const orderId = input.orderId;
  let planId = 'planId' in op ? op.planId : null;
  let invoiceId = 'invoiceId' in op ? op.invoiceId : null;
  let replacementPlanId: string | undefined;
  if (op.action === 'verify_bank_receipt' || op.action === 'record_customer_receipt') {
    const activityId = await addPurchaseActivity(tx, { orderId, actor, action: op.action, requestKey, referenceKey: op.receiptReferenceKey,
      amountCents: op.action === 'record_customer_receipt' ? op.amountCents : undefined, detail: { actionHash, intent: intentHash, authorization, snapshot } });
    if (op.action === 'record_customer_receipt') {
      await postVerifiedCustomerCash(tx, orderId, { bankAllocationId: activityId }, actor.id);
      await prepareOrderPurchases(tx, orderId, actor);
    }
  } else if (op.action === 'restore_term' || op.action === 'set_term') {
    const changed = await tx.accountReceivable.update({ where: { id: op.receivableId }, data: {
      termStartedAt: new Date(op.startedAt), dueAt: new Date(op.dueAt), paymentTermDaysSnapshot: op.days, status: op.receivableStatus,
    } });
    await refreshCreditRestrictions(tx, changed.userId, new Date());
    await prepareOrderPurchases(tx, orderId, actor);
  } else if (op.action === 'post_existing') {
    await postVerifiedCustomerCash(tx, orderId, op.source, actor.id);
    await prepareOrderPurchases(tx, orderId, actor);
  } else if (op.action === 'resume_alipay_payment') {
    await applyStockHeldAlipayPayment(tx, op.payment, actor);
  } else if (op.action === 'create_plan') {
    const plan = await tx.financeInvoicePlan.create({ data: { orderId, purchaseOrderId: op.purchaseOrderId,
      side: op.side, partyKey: op.partyKey, issuer: op.issuer, recipient: op.recipient, grossCents: BigInt(op.grossCents),
      trigger: op.trigger, ownerId: actor.id, reference: op.reference, sha256: op.sha256 } });
    planId = plan.id;
  } else if (op.action === 'amend_plan') {
    const { original } = op;
    const plan = await tx.financeInvoicePlan.create({ data: { orderId, purchaseOrderId: original.purchaseOrderId,
      side: original.side, partyKey: original.partyKey, issuer: original.issuer, recipient: original.recipient,
      grossCents: BigInt(op.amountCents), trigger: op.trigger, ownerId: actor.id, reference: op.reference, sha256: op.sha256 } });
    replacementPlanId = plan.id;
  } else if (op.action === 'record_invoice') {
    if (!invoiceId) {
      const doc = await tx.financeInvoice.create({ data: {
        side: op.side, partyKey: op.partyKey, issuer: op.issuer, recipient: op.recipient, number: op.number, identityKey: op.identityKey,
        grossCents: BigInt(op.grossCents), issuedAt: new Date(op.issuedAt), actorId: actor.id, sha256: op.sha256, reference: op.reference,
      } });
      invoiceId = doc.id;
    }
    await tx.financeInvoiceAllocation.create({ data: { planId: op.planId, invoiceId, amountCents: BigInt(op.amountCents) } });
  }
  const event = await tx.financeEvent.create({ data: { orderId, planId, invoiceId, actorId: actor.id,
    action: op.action, requestKey, intentHash, approvedHash: expected,
    detail: JSON.stringify({ operation: op, authorization, replacementPlanId }) } });
  if (op.action === 'verify_receivable_principal') await refreshCreditRestrictions(tx, op.debtorId, new Date());
  return event.id;
}
