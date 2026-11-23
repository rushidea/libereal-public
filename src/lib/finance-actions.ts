import type { Prisma } from '@prisma/client';
import { applyStockHeldAlipayPayment, previewStockHeldAlipayPayment } from '@/lib/alipay-order-settlement';
import { customerCashProjection, postVerifiedCustomerCash } from '@/lib/customer-cash';
import { refreshCreditRestrictions } from '@/lib/customer-credit';
import { datedInvoiceChargesWorsen, invoiceAuthorityAt, invoiceAuthorityTimeline, invoicesOutsideAuthority, type InvoiceAuthorityChange } from '@/lib/finance-invoice-authority';
import { invoiceCharges, invoiceCommitments, invoicePortionsFit, invoiceReservationBalances, readInvoicePortions } from '@/lib/finance-invoice-coverage';
import { invoicePeriodAt, invoicePlanStartsAt, invoiceTimeline } from '@/lib/finance-invoice-timeline';
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
  'verify_customer_invoice_scope', 'verify_invoice_coverage', 'create_plan', 'amend_plan', 'confirm_condition', 'chase_invoice', 'close_plan', 'record_invoice', 'open_correction', 'resolve_correction',
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
type InvoiceFamily = FinanceWorkspace['customerInvoiceFamilies'][number];
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

function invoiceScopeLimit(view: FinanceWorkspace, side: string, purchaseOrderId: string | null) {
  if (side === 'customer') return view.principalCents;
  const agreedCents = view.purchases.find(po => po.id === purchaseOrderId)?.agreedCents;
  if (agreedCents == null) throw new PurchaseError('须先核对当前供方合同和可收票金额');
  return agreedCents;
}

function projectedInvoiceCommitments(plans: Plan[], timeline = invoiceTimeline(plans)) {
  return plans.reduce((sum, plan) => sum
    + plan.allocations.reduce((cents, invoice) => cents + (invoice.status === 'voided' ? 0 : invoice.amountCents), 0)
    + (timeline.remaining.get(plan.id) ?? 0), 0);
}

function invoiceCommitmentFits(view: FinanceWorkspace, side: string, purchaseOrderId: string | null, scopeId: string | null,
  previousCents: number, proposedCents: number,
) {
  if (side !== 'customer' || !scopeId) return proposedCents <= invoiceScopeLimit(view, side, purchaseOrderId);
  const room = customerInvoiceScope(view, scopeId)?.roomCents;
  return room != null && proposedCents - previousCents <= room;
}

function customerInvoiceScope(view: FinanceWorkspace, scopeId: unknown, allowSingle = false) {
  if (scopeId == null && view.principalCents > 0) return null;
  const authorized = scopeId == null && allowSingle ? view.customerInvoiceScopes.filter(row => (row.authorizedCents ?? 0) > 0) : [];
  const scope = authorized.length === 1 ? authorized[0] : view.customerInvoiceScopes.find(row => row.id === scopeId);
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

function familyInvoicePlans(view: FinanceWorkspace, family: InvoiceFamily) {
  const scopeIds = new Set(family.evidence.map(row => row.id));
  return view.invoicePlans.filter(row => row.invoiceScopeId && scopeIds.has(row.invoiceScopeId));
}

type InvoiceScope = FinanceWorkspace['customerInvoiceScopes'][number];

function checkedInvoicePortions(view: FinanceWorkspace, original: InvoiceScope, raw: unknown, amountCents: number) {
  const portions = readInvoicePortions(raw, amountCents);
  if (!portions) throw new PurchaseError('请填写各份书证对应的商品行、实际数量和含税金额，合计须等于本次原票或安排金额');
  return portions.map(part => {
    const proof = customerInvoiceScope(view, part.invoiceScopeId);
    if (!proof || proof.familyId !== original.familyId || financeIdentity(proof.issuer) !== financeIdentity(original.issuer)
      || financeIdentity(proof.recipient) !== financeIdentity(original.recipient) || part.lines.some(line =>
      ![proof, original].every(scope => scope.lines.some(row => row.id === line.orderItemId && row.quantity >= line.quantity)))) {
      throw new PurchaseError('本次核对的商品和数量须同时有原安排与所选原件支持');
    }
    return { ...part, lines: part.lines.map(line => ({ ...line, name: proof.lines.find(row => row.id === line.orderItemId)?.name })),
      proof: { id: proof.id, reference: proof.reference, sha256: proof.sha256, occurredAt: proof.occurredAt } };
  });
}

function reviewedInvoiceCoverage(view: FinanceWorkspace, data: FinanceInput['data'], actor: PurchaseActor, evidence: Evidence) {
  const plan = planFor(view, data.planId, true);
  if (plan.side !== 'customer' || !plan.invoiceScopeId) throw new PurchaseError('请选有历史开票范围的原客户安排');
  const original = customerInvoiceScope(view, plan.invoiceScopeId)!;
  const family = view.customerInvoiceFamilies.find(row => row.id === original.familyId);
  if (!family) throw new PurchaseError('请先核对可追溯的原开票范围及书证');
  const allocation = data.allocationId == null ? null : plan.allocations.find(row => row.id === data.allocationId && row.status !== 'voided');
  if (data.allocationId != null && !allocation) throw new PurchaseError('请核对所选原票分配仍属于本项安排');
  const coverageAt = !allocation && data.coverageAt != null ? actualTime(data.coverageAt, '原安排核对时间') : null;
  const at = allocation?.issuedAt ?? coverageAt ?? new Date().toISOString();
  const period = invoicePeriodAt(plan.coveragePeriods, at);
  const amountCents = allocation?.amountCents ?? period?.remainingCents ?? 0;
  if (amountCents <= 0) throw new PurchaseError('本项没有待核的开票安排金额');
  const portions = checkedInvoicePortions(view, original, data.portions, amountCents);
  const plans = familyInvoicePlans(view, family);
  if (allocation) {
    const reassigned = plans.map(row => row.id !== plan.id ? row : {
      ...row, allocations: row.allocations.map(used => used.id === allocation.id ? { ...used, scopePortions: portions } : used),
    });
    const charges = invoiceCharges(reassigned);
    if (invoicesOutsideAuthority(family.timeline, charges).some(row => row.id === allocation.id)
      || datedInvoiceChargesWorsen(family.timeline, invoiceCharges(plans), charges)) {
      throw new PurchaseError('本次核对的原票金额、书证日期或其他已经占用的额度仍有冲突');
    }
  } else {
    const dated = invoiceTimeline(plans, Date.parse(at));
    const applicable = plans.map(row => ({
      ...row, allocations: row.allocations.filter(used => used.issuedAt <= at),
      scheduledRemainingCents: row.id === plan.id ? amountCents : dated.remaining.get(row.id) ?? 0,
      coverageReview: invoicePeriodAt(row.coveragePeriods, at)?.review ?? (row.coverageReview && { remaining: null }),
    }));
    const commitments = invoiceCommitments(family.timeline, applicable, at);
    const available = invoiceReservationBalances(commitments, plan.id);
    if (!invoicePortionsFit(available, portions.map(part => ({ scopeId: part.invoiceScopeId, amountCents: part.amountCents })))) {
      throw new PurchaseError('本次核对的原安排金额超过有效书证或影响其他已占用额度');
    }
  }
  return { ...evidence, action: 'verify_invoice_coverage' as const, planId: plan.id, allocationId: allocation?.id ?? null,
    invoiceId: allocation?.invoiceId ?? null, existingAllocationIds: plan.allocations.map(row => row.id), amountCents, portions,
    coverageAt, coveragePeriod: allocation ? null : period?.key,
    subject: { originalScopeId: original.id, originalReference: original.reference, planReference: plan.reference,
      invoiceNumber: allocation?.number ?? null, issuedAt: allocation?.issuedAt ?? null, documentReference: allocation?.reference ?? plan.reference },
    ownerId: actor.id };
}

function customerInvoiceScopeChange(view: FinanceWorkspace, basis: FinanceWorkspace['customerInvoiceScopes'][number],
  lines: NonNullable<ReturnType<typeof coveredCustomerInvoiceLines>>, occurredAt: string, data: FinanceInput['data'],
) {
  const family = view.customerInvoiceFamilies.find(row => row.id === basis.familyId);
  if (!family) throw new PurchaseError('须核对可追溯的原开票范围及额度');
  const restate = data.restateInvoiceCeiling === true;
  const root = customerInvoiceScope(view, basis.familyId)!;
  if (restate ? pricingContentHash(lines) !== pricingContentHash(root.lines)
    : lines.some(row => !basis.lines.some(line => line.id === row.id && row.quantity <= line.quantity))) {
    throw new PurchaseError(restate ? '核定累计可开额须覆盖整个已核范围' : '补充书证须注明原范围内实际涉及的商品和数量');
  }
  const amountCents = restate && data.grossCents === 0 ? 0 : money(data.grossCents,
    restate ? '原书证核定的新累计可开额' : '原书证明确补充的可开金额');
  let change: InvoiceAuthorityChange = { mode: restate ? 'restate' : 'increase', amountCents };
  if (data.clarifiesInvoiceEvidenceAt !== undefined) {
    const time = actualTime(data.clarifiesInvoiceEvidenceAt, '待核书证生效时间');
    const unresolved = family.timeline.find(row => row.at === time && row.needsReview);
    const confirmed = data.confirmedInvoiceEvidenceIds;
    if (!restate || !unresolved || occurredAt < time || !Array.isArray(confirmed) || !confirmed.length
      || new Set(confirmed).size !== confirmed.length
      || !confirmed.every(id => typeof id === 'string' && unresolved.evidenceIds.includes(id))) {
      throw new PurchaseError('请凭澄清书证选择原先待核的日期、实际生效的原件和确认的额度');
    }
    change = { mode: 'clarify', effectiveAt: time, amountCents, evidenceIds: unresolved.evidenceIds, confirmedEvidenceIds: confirmed };
  }
  const effectiveAt = change.mode === 'clarify' ? change.effectiveAt : occurredAt;
  const prior = family.timeline.findLast(row => row.at < effectiveAt);
  const beforeCents = prior ? prior.authorizedCents : 0;
  const grossCents = change.mode === 'clarify' ? 0 : restate ? Math.max(0, amountCents - (beforeCents ?? 0)) : amountCents;
  const projected = invoiceAuthorityTimeline([...family.evidence, { id: 'previewed-scope-change', occurredAt, grossCents, change, lines }]);
  const afterCents = invoiceAuthorityAt(projected, effectiveAt)?.authorizedCents ?? null;
  const currentCents = projected.at(-1)?.authorizedCents ?? null;
  const invoiceConflicts = invoicesOutsideAuthority(projected, invoiceCharges(familyInvoicePlans(view, family)));
  if (change.mode === 'restate' && occurredAt > (family.timeline.at(-1)?.at ?? '') && currentCents !== null && currentCents < family.plannedCents) {
    throw new PurchaseError('新累计可开额须覆盖已开票与仍有效安排，请先核清原安排');
  }
  return { grossCents, scopeChange: { ...change, familyId: family.id, basisId: basis.id, effectiveAt, beforeCents,
    deltaCents: beforeCents === null || afterCents === null ? null : afterCents - beforeCents, afterCents, currentCents,
    issuedCents: family.issuedCents, plannedCents: family.plannedCents, invoiceConflicts,
    availableCents: currentCents === null || invoiceConflicts.length ? null : Math.max(0, currentCents - family.plannedCents) } };
}

async function invoiceDocument(tx: Db, view: FinanceWorkspace, input: FinanceInput, evidence: Evidence) {
  const data = input.data;
  const plan = planFor(view, data.planId, true);
  const readyAt = plan.readyAt;
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
  const review = invoicePeriodAt(plan.coveragePeriods, issuedAt)?.review;
  const reviewedReservationId = review?.id ?? null;
  let portions: ReturnType<typeof checkedInvoicePortions> | undefined;
  if (plan.coverageReview) {
    const remaining = review?.remaining;
    if (!sourceScope || !remaining?.length) throw new PurchaseError('原安排可用金额已有变化，请先核对本次适用的商品和书证');
    const selected = data.portions ?? (remaining.reduce((sum, part) => sum + part.amountCents, 0) === amountCents ? remaining : undefined);
    portions = checkedInvoicePortions(view, sourceScope, selected, amountCents);
    if (portions.some(part => !remaining.some(original => original.invoiceScopeId === part.invoiceScopeId && part.amountCents <= original.amountCents
      && part.lines.every(line => original.lines.some(covered => line.orderItemId === covered.orderItemId && line.quantity <= covered.quantity))))) {
      throw new PurchaseError('票面商品和金额须与原安排核准的未开份额相符');
    }
  } else if (data.portions !== undefined) {
    throw new PurchaseError('请先核对原安排适用的商品和书证');
  }
  const plans = sameInvoiceScope(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId);
  const before = invoiceTimeline(plans);
  const allocationId = 'previewed-invoice';
  const trial = plans.map(row => row.id === plan.id ? { ...row, allocations: [...row.allocations, {
    id: allocationId, invoiceId: '', number, issuedAt, amountCents, grossCents, issuer, recipient,
    reference: evidence.reference, sha256: evidence.sha256, status: 'recorded', scopePortions: portions ?? null,
    coverageReviewId: null, reviewedReservationId,
  }] } : row);
  const after = invoiceTimeline(trial);
  if (after.conflicts.has(allocationId)) throw new PurchaseError('票面日期超出原安排的有效范围或可用金额');
  const family = view.customerInvoiceFamilies.find(row => row.id === sourceScope?.familyId);
  const authority = family && invoiceAuthorityAt(family.timeline, issuedAt);
  if (sourceScope && (!authority || authority.authorizedCents === null)) throw new PurchaseError('票面日期的有效开票书证待具名核对');
  if (family) {
    const actual = trial.find(row => row.id === plan.id)!.allocations.at(-1)!;
    const existing = invoiceCharges(familyInvoicePlans(view, family));
    const added = invoiceCharges([{ ...plan, allocations: [actual] }]);
    if (datedInvoiceChargesWorsen(family.timeline, existing, [...existing, ...added])) {
      throw new PurchaseError('回填将超过实际开票日期适用的书证额度，请核对票面及同一范围的原票');
    }
  }
  // Dated authority already checks actual scope use, including when the unissued arrangement was later stopped.
  if ([...after.conflicts].some(id => !before.conflicts.has(id))
    || (!family && projectedInvoiceCommitments(trial, after) > invoiceScopeLimit(view, plan.side, plan.purchaseOrderId))) {
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
    invoiceScopeId: sourceScope?.id ?? null, invoiceAuthority: authority, adjustedPlans, portions, reviewedReservationId };
}

type Evidence = { reference: string; sha256: string; description: string };

async function financeOperation(tx: Db, input: FinanceInput, actor: PurchaseActor, view: FinanceWorkspace) {
  const { action, data, orderId } = input;
  const retained = action === 'create_plan' && data.side === 'customer' && data.reference === undefined && data.sha256 === undefined
    ? customerInvoiceScope(view, data.invoiceScopeId, true) : null;
  const evidence = { reference: requiredText(retained?.reference ?? data.reference, '书面依据编号'),
    sha256: documentSha256(retained?.sha256 ?? data.sha256, '原件摘要'),
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
    const basis = data.invoiceScopeBasisId == null ? null : customerInvoiceScope(view, requiredText(data.invoiceScopeBasisId, '原核对范围'));
    const selected = data.invoiceLines ?? (Array.isArray(ids) ? ids.map(orderItemId => ({
      orderItemId, quantity: (basis?.lines ?? view.originalInvoiceLines).find(line => line.id === orderItemId)?.quantity,
    })) : basis?.lines.map(line => ({ orderItemId: line.id, quantity: line.quantity })));
    const lines = coveredCustomerInvoiceLines(view.originalInvoiceLines, selected);
    if (!lines) throw new PurchaseError('请选择可由原书证证实的实际订单行和数量');
    if (!basis && lines.some(row => row.quantity > (view.originalInvoiceLines.find(line => line.id === row.id)?.unverifiedQuantity ?? 0))) {
      throw new PurchaseError('此份书证所列数量与已核实的份额重叠，请核对尚未确认的数量');
    }
    const documentRow = data.documentRow == null ? null : money(data.documentRow, '原件实际行号');
    const prior = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM FinanceEvent WHERE action='verify_customer_invoice_scope'
        AND json_extract(detail,'$.operation.sha256')=${evidence.sha256}
        AND (${documentRow} IS NULL OR json_extract(detail,'$.operation.documentRow') IS NULL
          OR json_extract(detail,'$.operation.documentRow')=${documentRow}) LIMIT 1`;
    if (prior.length) throw new PurchaseError('此原件或该原件行已经核对过开票范围，请回到原记录');
    const occurredAt = actualTime(data.occurredAt, '原书证载明的实际确认时间');
    if (basis) checkCustomerInvoiceParties(view, basis.id, issuedBy, issuedTo);
    else if (data.restateInvoiceCeiling === true || data.clarifiesInvoiceEvidenceAt !== undefined) {
      throw new PurchaseError('修订或澄清累计可开额须选择已核实的原范围');
    }
    const amounts = basis ? customerInvoiceScopeChange(view, basis, lines, occurredAt, data)
      : { grossCents: money(data.grossCents, '原书证可开的含税金额'), scopeChange: undefined };
    return { ...evidence, action, issuer: issuedBy, recipient: issuedTo, ...amounts, occurredAt, ownerId: actor.id, documentRow,
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
    const planned = projectedInvoiceCommitments(sameInvoiceScope(view, side, po?.id ?? null, scopeId));
    if (!invoiceCommitmentFits(view, side, po?.id ?? null, scopeId, planned, planned + grossCents)) {
      throw new PurchaseError('安排金额超过原书证尚未安排的额度');
    }
    return { ...evidence, action, side, issuer, recipient, grossCents, trigger, ownerId: actor.id, purchaseOrderId: po?.id ?? null,
      partyKey: po ? 'supplier:' + financeIdentity(issuer) : view.customerKey, invoiceScopeId: scope?.id ?? null,
      invoiceEvidence: scope ? { id: scope.id, reference: scope.reference, documentRow: scope.documentRow, occurredAt: scope.occurredAt,
        lines: scope.lines, authorizedCents: scope.authorizedCents, remainingCents: scope.remainingCents,
        sharesCumulativeLimit: scope.sharesCumulativeLimit } : undefined };
  }
  if (action === 'verify_invoice_coverage') return reviewedInvoiceCoverage(view, data, actor, evidence);
  if (action === 'record_invoice') return invoiceDocument(tx, view, input, evidence);
  if (action === 'amend_plan') {
    const plan = planFor(view, data.planId);
    const amountCents = money(data.amountCents, '本次变更条件对应的未开金额');
    if (view.events.some(row => row.action === 'amend_plan' && row.planId === plan.id && row.operation.sha256 === evidence.sha256)) {
      throw new PurchaseError('这份书证已用于变更本项安排，请核对原范围');
    }
    const occurredAt = actualTime(data.occurredAt, '书面变更确认时间');
    const effectiveAt = data.effectiveAt == null ? occurredAt : purchaseTimestamp(data.effectiveAt, '书面约定生效时间');
    const startsAt = invoicePlanStartsAt(plan);
    if ((plan.amendedFromPlanId && !plan.effectiveAt) || (startsAt && effectiveAt < startsAt)) {
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
      || !invoiceCommitmentFits(view, plan.side, plan.purchaseOrderId, plan.invoiceScopeId,
        projectedInvoiceCommitments(plans, prior), projectedInvoiceCommitments(amended, next))) {
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
  const alipay = view.latePayments.find(row => row.id === sourceId && !row.refund);
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
