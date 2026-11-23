import type { Prisma } from '@prisma/client';
import { customerCashProjection, postVerifiedCustomerCash } from '@/lib/customer-cash';
import { financeIdentity, financeWorkspace, invoiceStatus, invoiceTriggers, type FinanceWorkspace, type InvoiceTrigger } from '@/lib/finance-workspace';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { addPurchaseActivity, purchaseObject, readPurchaseActivities, type PurchaseActor, type PurchaseAuthorization } from '@/lib/purchase-activity';
import { prepareOrderPurchases } from '@/lib/purchase-orders';
import { previewBankAllocation, previewBankReceipt } from '@/lib/purchase-receipts';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
export const financeActions = ['verify_bank_receipt', 'record_customer_receipt', 'post_existing', 'restore_term', 'set_term',
  'create_plan', 'confirm_condition', 'chase_invoice', 'close_plan', 'record_invoice', 'open_correction', 'resolve_correction',
  'reconcile_supplier', 'review_payment_case', 'update_payment_case'] as const;
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
function planFor(view: FinanceWorkspace, id: unknown) {
  const plan = view.invoicePlans.find(row => row.id === id);
  if (!plan || plan.closed) throw new PurchaseError('请核对本单仍有效的发票安排');
  return plan;
}

export function invoiceReadyAt(view: FinanceWorkspace, plan: Plan) {
  const po = view.purchases.find(row => row.id === plan.purchaseOrderId);
  if (plan.trigger === 'manual') return plan.manualAt;
  if (plan.trigger === 'accepted') return po ? po.orderedAt : view.acceptedAt;
  if (plan.trigger === 'paid') return po ? po.paidInFullAt
    : view.settlementCents === view.principalCents && !view.authorityConflict ? view.paidAt : null;
  if (!po && (plan.trigger === 'dispatched' || plan.trigger === 'delivered')) return view.shipmentDates[plan.trigger];
  return null;
}

async function invoiceDocument(tx: Db, view: FinanceWorkspace, input: FinanceInput, evidence: Evidence) {
  const data = input.data;
  const plan = planFor(view, data.planId);
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
  const identityKey = pricingContentHash({ issuer: financeIdentity(issuer), number: financeIdentity(number) });
  const grossCents = money(data.grossCents, '票面含税合计');
  const amountCents = money(data.amountCents, '本次归入金额');
  if (amountCents > plan.grossCents - plan.usedCents) throw new PurchaseError('金额超过本项未开或未收余额');
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
    partyKey: plan.partyKey, issuer, recipient, identityKey, number, issuedAt, readyAt, grossCents, amountCents, allocatedBeforeCents };
}

type Evidence = { reference: string; sha256: string; description: string };

async function financeOperation(tx: Db, input: FinanceInput, actor: PurchaseActor, view: FinanceWorkspace) {
  const { action, data, orderId } = input;
  const evidence = { reference: requiredText(data.reference, '书面依据编号'), sha256: documentSha256(data.sha256, '原件摘要'),
    description: requiredText(data.description, '核对结果或业务约定') };
  if (action === 'verify_bank_receipt' || action === 'record_customer_receipt') {
    const order = await loadPurchaseOrderSource(tx, orderId);
    if (!view.acceptanceId || ['cancelled', 'closed'].includes(order.status)) throw new PurchaseError('须先核清平台接单及该笔资金的归属');
    if (action === 'verify_bank_receipt') return previewBankReceipt(tx, order, data, evidence);
    if (view.authorityConflict || view.nativePaymentId || view.paidAt || !view.paymentPlanKnown) throw new PurchaseError('请先核对本单的付款条件和已有到账来源');
    const allocation = await previewBankAllocation(tx, order, await readPurchaseActivities(tx, orderId), data, evidence,
      view.principalCents - view.verifiedCents);
    return { ...allocation, accounting: await customerCashProjection(tx, order, allocation.amountCents) };
  }
  if (action === 'post_existing') {
    const id = requiredText(data.sourceId, '待核销的既有到账记录');
    const bank = view.receipts.find(row => row.id === id && row.counted);
    const native = id === view.nativePaymentId;
    if ((!bank && !native) || view.authorityConflict || view.cash.some(row => row.bankAllocationId === id || row.paymentAttemptId === id)) {
      throw new PurchaseError('所选到账记录尚未核验、已有冲突或已经核销');
    }
    if (!native && !view.acceptanceId) throw new PurchaseError('原订单缺少平台接单依据');
    return { ...evidence, action, source: native ? { paymentAttemptId: id } : { bankAllocationId: id },
      amountCents: bank?.amountCents ?? view.principalCents,
      accounting: await customerCashProjection(tx, await loadPurchaseOrderSource(tx, orderId), bank?.amountCents ?? view.principalCents) };
  }
  if (action === 'restore_term' || action === 'set_term') {
    const ar = view.receivable;
    if (!ar || !['open', 'overdue'].includes(ar.status) || !view.acceptedAt) throw new PurchaseError('本单缺少平台接单凭据或有效应收');
    const original = action === 'restore_term';
    if (original && (ar.termStartedAt || ar.dueAt)) throw new PurchaseError('已有账期，请根据书面约定办理变更');
    const startedAt = original ? view.acceptedAt : purchaseTimestamp(data.startedAt, '约定的起算时间');
    const days = original ? ar.terms : data.days;
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 0) throw new PurchaseError('请输入该单书面约定的账期天数', 400);
    const due = new Date(Date.parse(startedAt) + days * 86400000);
    if (!Number.isFinite(due.getTime())) throw new PurchaseError('到期日无效', 400);
    return { ...evidence, action, receivableId: ar.id, acceptanceId: view.acceptanceId, before: ar,
      startedAt, days, dueAt: due.toISOString() };
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
    const trigger = data.trigger as InvoiceTrigger;
    if (!invoiceTriggers.includes(trigger) || po && (trigger === 'dispatched' || trigger === 'delivered')) {
      throw new PurchaseError('请按原书证选择开票条件，供应商的特殊交货约定可交由经办人核验', 400);
    }
    const grossCents = money(data.grossCents, '本次安排的含税金额');
    const agreed = po?.agreedCents ?? view.principalCents;
    const planned = view.invoicePlans.filter(plan => !plan.closed && plan.side === side && plan.purchaseOrderId === (po?.id ?? null))
      .reduce((sum, plan) => sum + plan.grossCents, 0);
    if (grossCents > agreed - planned) throw new PurchaseError('安排金额超过原单尚未安排的金额');
    return { ...evidence, action, side, issuer, recipient, grossCents, trigger, ownerId: actor.id, purchaseOrderId: po?.id ?? null,
      partyKey: po ? 'supplier:' + financeIdentity(issuer) : view.customerKey };
  }
  if (action === 'record_invoice') return invoiceDocument(tx, view, input, evidence);
  if (action === 'confirm_condition' || action === 'chase_invoice' || action === 'close_plan') {
    const plan = planFor(view, data.planId);
    if (action === 'close_plan' && plan.usedCents > 0) throw new PurchaseError('已回填的发票须先核对实际更正结果');
    if (action === 'chase_invoice' && (plan.side !== 'supplier' || plan.usedCents >= plan.grossCents)) throw new PurchaseError('本项没有待追的供应商发票');
    if (action === 'confirm_condition' && (plan.trigger !== 'manual' || plan.manualAt)) throw new PurchaseError('本项没有待人工核对的开票条件');
    const occurredAt = actualTime(data.occurredAt, '实际办理时间');
    const nextReviewAt = action === 'chase_invoice' ? purchaseTimestamp(data.nextReviewAt, '约定的下次跟进时间') : null;
    if (nextReviewAt && Date.parse(nextReviewAt) <= Date.parse(occurredAt)) throw new PurchaseError('下次跟进时间须晚于本次沟通');
    return { ...evidence, action, planId: plan.id, occurredAt, nextReviewAt, ownerId: actor.id };
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
  if (op.action === 'verify_bank_receipt' || op.action === 'record_customer_receipt') {
    const activityId = await addPurchaseActivity(tx, { orderId, actor, action: op.action, requestKey, referenceKey: op.receiptReferenceKey,
      amountCents: op.action === 'record_customer_receipt' ? op.amountCents : undefined, detail: { actionHash, intent: intentHash, authorization, snapshot } });
    if (op.action === 'record_customer_receipt') {
      await postVerifiedCustomerCash(tx, orderId, { bankAllocationId: activityId }, actor.id);
      await prepareOrderPurchases(tx, orderId, actor);
    }
  } else if (op.action === 'restore_term' || op.action === 'set_term') {
    await tx.accountReceivable.update({ where: { id: op.receivableId }, data: {
      termStartedAt: new Date(op.startedAt), dueAt: new Date(op.dueAt), paymentTermDaysSnapshot: op.days,
    } });
  } else if (op.action === 'post_existing') {
    await postVerifiedCustomerCash(tx, orderId, op.source, actor.id);
    await prepareOrderPurchases(tx, orderId, actor);
  } else if (op.action === 'create_plan') {
    const plan = await tx.financeInvoicePlan.create({ data: { orderId, purchaseOrderId: op.purchaseOrderId,
      side: op.side, partyKey: op.partyKey, issuer: op.issuer, recipient: op.recipient, grossCents: BigInt(op.grossCents),
      trigger: op.trigger, ownerId: actor.id, reference: op.reference, sha256: op.sha256 } });
    planId = plan.id;
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
    action: op.action, requestKey, intentHash, approvedHash: expected, detail: JSON.stringify({ operation: op, authorization }) } });
  return event.id;
}
