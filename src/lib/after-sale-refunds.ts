import { financeWorkspace } from '@/lib/finance-workspace';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject } from '@/lib/purchase-activity';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { caseEvents, currentSaleAgreement, lastCaseEvent, saleOperation, type SaleCase, type AfterSaleWorkspace } from '@/lib/after-sale-workspace';
import { eligibleAfterSalePayment, independentAfterSalePayment, verifiedAfterSalePayment } from '@/lib/after-sale-payment-source';
import { allocateAfterSaleTransfer, transferReference } from '@/lib/after-sale-transfers';

type RefundTerms = { amountCents: number; recipient: string; destination: string; method: string; currency: 'CNY'; agreementId: string };
export function refundTerms(row: SaleCase): RefundTerms {
  const agreement = currentSaleAgreement(row);
  condition(agreement && saleOperation(agreement).remedy === 'refund', '这条明细尚缺客户对本版退款条件的明确同意');
  const op = saleOperation(agreement);
  return { amountCents: cents(op.amountCents), recipient: requiredText(op.recipient, '退款收款人'),
    destination: requiredText(op.destination, '已核实的退款去向'), method: requiredText(op.method, '退款方式'), currency: 'CNY', agreementId: agreement.id };
}

function refundedUnder(row: SaleCase, approvalId?: string) {
  const approvals = caseEvents(row, 'approve_refund');
  return caseEvents(row, 'refund_result').reduce((sum, event) => {
    const op = saleOperation(event);
    const id = op.approvalId ?? (approvals.length === 1 ? approvals[0].id : null);
    return op.result === 'paid' && (!approvalId || approvalId === id) ? sum + cents(op.amountCents) : sum;
  }, 0);
}
export const actualRefunded = (row: SaleCase) => refundedUnder(row);

function reserved(row: SaleCase) {
  const paid = actualRefunded(row);
  const approved = lastCaseEvent(row, 'approve_refund');
  if (approved && ['refund_approved','refund_followup'].includes(row.customerState)) {
    return paid + Math.max(0, cents(saleOperation(approved).amountCents) - refundedUnder(row, approved.id));
  }
  return paid;
}

export function activeRefundSourceReview(row: SaleCase) {
  const released = new Set(caseEvents(row, 'release_refund_source').map(event => saleOperation(event).reviewId));
  return caseEvents(row, 'review_refund_source').findLast(event => !released.has(event.id));
}
function sourceOf(row: SaleCase) {
  const reviewed = activeRefundSourceReview(row);
  const source = purchaseObject(reviewed && saleOperation(reviewed).originalPayment);
  return typeof source.paymentId === 'string' ? source.paymentId : null;
}

export async function refundPosition(tx: Db, view: AfterSaleWorkspace, row: SaleCase) {
  const finance = await financeWorkspace(tx, view.order.id);
  const other = view.cases.filter(item => item.id !== row.id);
  const paymentId = sourceOf(row);
  const verified = paymentId ? await verifiedAfterSalePayment(tx, view.order.id, paymentId) : null;
  const settledSource = finance.nativePaymentId;
  const sameReceipt = other.filter(item => {
    const held = sourceOf(item);
    return paymentId ? (held ?? settledSource) === paymentId : !held || held === settledSource;
  });
  const used = sameReceipt.reduce((sum, item) => sum + reserved(item), 0);
  const independentReceipt = Boolean(verified && independentAfterSalePayment(verified,finance));
  const onLine = sameReceipt.filter(item => item.orderItemId === row.orderItemId).reduce((sum, item) => sum + reserved(item), 0);
  const line = view.lines.find(item => item.id === row.orderItemId)!;
  const gross = Math.round(line.unitPrice * line.quantity * 100);
  const agreement = currentSaleAgreement(row);
  const refundQuantity = agreement && saleOperation(agreement).refundQuantity;
  const caseGoodsCents = Math.round(line.unitPrice * (typeof refundQuantity === 'number' ? refundQuantity : row.quantity) * 100);
  condition(independentReceipt || Number.isSafeInteger(gross) && gross >= 0, '请先核对原订单行金额');
  return { paidCents: verified?.amountCents ?? finance.settlementCents, usedCents: used, originalLineCents: gross, caseGoodsCents, lineUsedCents: onLine,
    originalAcceptance: finance.acceptanceId, authorityConflict: finance.authorityConflict, recordedCents: actualRefunded(row),
    originalPointsBasisYuan: view.order.pointsRefundedCash, originalCash: finance.cash.map(item => [item.id, item.amountCents] as const),
    originalPaymentId: paymentId ?? settledSource, verifiedPayment: verified, independentReceipt,
    sourceEligible: !verified || eligibleAfterSalePayment(verified, view.order, finance) };
}

export async function reviewRefundSource(tx: Db, view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  condition(row.customerState === 'awaiting_refund' && !sourceOf(row), '请核对本次客户退款所对应且尚未留证的实际到账');
  const terms = refundTerms(row);
  const source = await verifiedAfterSalePayment(tx, view.order.id, requiredText(data.paymentId, '原支付宝交易'));
  condition(eligibleAfterSalePayment(source, view.order, await financeWorkspace(tx, view.order.id)),
    '原销货款仍按原订单办理，只能在本入口核对独立的验签到账');
  condition(terms.amountCents <= source.amountCents && data.originalTradeNo === source.tradeNo
    && (source.customer.organizationId ? data.customerKey === source.customer.organizationId : data.customerKey === source.customer.customerId)
    && proof.occurredAt >= source.arrivedAt, '原付款人、平台流水、实收金额或书证时间不符');
  const cases = await tx.financeEvent.findMany({ where: { orderId: view.order.id, action: 'review_payment_case' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const b4 = cases.find(event=>purchaseObject(jsonObject(event.detail).operation).sourceId===source.paymentId);
  return { operation: { originalPayment: source, agreementId: terms.agreementId, b4ClaimId: b4?.id ?? null,
    note: requiredText(data.note, '原支付渠道、客户及实际到账核对结果') } };
}

export async function releaseRefundSource(tx: Db, view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const review = activeRefundSourceReview(row);
  const decision = currentSaleAgreement(row);
  condition(review && decision && saleOperation(decision).remedy === 'keep'
    && decision.occurredAt >= review.occurredAt && Date.parse(proof.occurredAt) >= decision.occurredAt.getTime()
    && data.reviewId === review.id && data.confirmUnsent === true, '请选择该笔原款核对和客户后来书面作出的保留原单决定');
  condition(!caseEvents(row, 'approve_refund').length && !caseEvents(row, 'refund_result').length,
    '已有退款批准、实际指令或回执，须按其真实结果核对未办余额');
  const payment = await verifiedAfterSalePayment(tx, view.order.id, sourceOf(row)!);
  condition(payment.tradeNo === purchaseObject(saleOperation(review).originalPayment).tradeNo, '原交易凭据已有变化');
  return { operation: { reviewId: review.id, agreementId: decision.id, originalPayment: payment,
    b4ClaimId: saleOperation(review).b4ClaimId, note: requiredText(data.note, '未批准、未发出退款指令及原单继续处理的核对结果') } };
}

type RefundPosition = Awaited<ReturnType<typeof refundPosition>>;

function assertRefundCapacity(position: RefundPosition, amountCents: number) {
  condition(position.verifiedPayment ? position.sourceEligible : !position.authorityConflict && position.originalAcceptance,
    '原单接单或回款归属待财务核对');
  condition(amountCents <= position.paidCents - position.usedCents - position.recordedCents,
    '退款超过已核实的剩余实收款（以本笔到账为准）');
  if (!position.independentReceipt) {
    condition(amountCents <= position.originalLineCents - position.lineUsedCents - position.recordedCents
      && amountCents <= position.caseGoodsCents - position.recordedCents, '退款超过原商品行范围');
  }
}

function pendingRefundEvents(row: SaleCase, approvalId: string) {
  const history = caseEvents(row, 'refund_result').filter(event => saleOperation(event).approvalId === approvalId)
    .sort((a,b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const latest = new Map(history.filter(event => typeof saleOperation(event).referenceNo === 'string')
    .map(event => [transferReference(saleOperation(event).referenceNo), event]));
  return { history, pending: [...latest.values()].filter(event => saleOperation(event).result === 'pending') };
}

function refundHasUnknownResult(row: SaleCase, approvalId: string) {
  const approvals = caseEvents(row, 'approve_refund');
  const results = caseEvents(row, 'refund_result').map(event => ({ event, operation: saleOperation(event) }));
  const latest = new Map<string, string>();
  for (const { operation } of results.sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime())) {
    const id = operation.approvalId ?? (approvals.length === 1 ? approvals[0].id : null);
    if (!id && operation.result === 'pending') return true;
    if (id !== approvalId) continue;
    if (typeof operation.referenceNo === 'string' && operation.referenceNo.trim()) {
      latest.set(transferReference(operation.referenceNo), String(operation.result));
    } else if (operation.result === 'pending') return true;
  }
  return [...latest.values()].includes('pending');
}

export function previewApprovedRefund(row: SaleCase, position: RefundPosition | null, amountCents: number) {
  const blockers: string[] = [];
  const agreement = currentSaleAgreement(row);
  if (!agreement || saleOperation(agreement).remedy !== 'refund') {
    return { blockers: ['REFUND_AGREEMENT_REQUIRED'], approvalId: null, approvalRemainingCents: null };
  }

  const terms = refundTerms(row);
  const approval = lastCaseEvent(row, 'approve_refund');
  const detail = jsonObject(approval?.detail);
  const approved = purchaseObject(detail.operation);
  const auth = purchaseObject(detail.authorization);
  const snapshot = purchaseObject(detail.snapshot);
  const preparedPosition = purchaseObject(approved.position);
  const prepared = caseEvents(row, 'prepare_refund').find(event => event.id === approved.preparedId);
  const approvedCurrent = approval && row.customerState === 'refund_approved'
    && approved.agreementId === terms.agreementId && approved.amountCents === terms.amountCents
    && approved.recipient === terms.recipient && approved.destination === terms.destination && approved.method === terms.method
    && prepared && saleOperation(prepared).agreementId === terms.agreementId && prepared.createdAt <= approval.createdAt
    && auth.permission === 'finance.write' && typeof auth.verifiedAt === 'string' && Number.isFinite(Date.parse(auth.verifiedAt))
    && typeof auth.sessionFingerprint === 'string' && /^[a-f0-9]{64}$/.test(auth.sessionFingerprint)
    && Date.parse(auth.verifiedAt) <= Date.now() && approval.createdAt.getTime() <= Date.now()
    && snapshot.caseId === row.id && snapshot.orderId === row.orderId
    && snapshot.actor === approval.actorId && snapshot.action === 'approve_refund'
    && snapshot.previousState === 'refund_prepared' && snapshot.nextState === 'refund_approved'
    && purchaseObject(snapshot.item).id === row.orderItemId
    && pricingContentHash(snapshot.operation) === pricingContentHash(approved)
    && pricingContentHash(snapshot) === approval.approvedHash;
  const remaining = approvedCurrent ? Math.max(0, terms.amountCents - refundedUnder(row, approval.id)) : null;
  if (!approvedCurrent) blockers.push('INDEPENDENT_REFUND_APPROVAL_REQUIRED');
  if (approvedCurrent && refundHasUnknownResult(row, approval.id)) blockers.push('REFUND_RESULT_AWAITING_RECONCILIATION');
  if (amountCents > (remaining ?? terms.amountCents)) blockers.push('AMOUNT_EXCEEDS_REFUND_APPROVAL');
  if (!position || position.paidCents <= 0) blockers.push('ORIGINAL_PAYMENT_NOT_VERIFIED');
  else {
    const reviewedPayment = purchaseObject(preparedPosition.verifiedPayment);
    const currentCash = new Map(position.originalCash);
    const originalCash = preparedPosition.originalCash;
    if (approvedCurrent && (preparedPosition.originalPaymentId !== position.originalPaymentId
      || preparedPosition.originalAcceptance !== position.originalAcceptance
      || preparedPosition.independentReceipt !== position.independentReceipt
      || (position.verifiedPayment && (reviewedPayment.auditId !== position.verifiedPayment.auditId
        || reviewedPayment.amountCents !== position.verifiedPayment.amountCents))
      || !Array.isArray(originalCash)
      || !originalCash.every(posting => Array.isArray(posting) && currentCash.get(posting[0]) === posting[1]))) {
      blockers.push('APPROVED_PAYMENT_SOURCE_CHANGED');
    }
    try {
      assertRefundCapacity(position, amountCents);
    } catch (error) {
      if (!(error instanceof PurchaseError)) throw error;
      blockers.push('REFUND_OUTSIDE_VERIFIED_PAYMENT_OR_LINE');
    }
  }
  return { blockers, approvalId: approvedCurrent ? approval.id : null, approvalRemainingCents: remaining };
}

export async function refundStep(tx: Db, view: AfterSaleWorkspace, row: SaleCase, action: string, data: Record<string, unknown>, evidence: SaleEvidence) {
  const terms = refundTerms(row);
  const position = await refundPosition(tx, view, row);
  const approval = lastCaseEvent(row, 'approve_refund');
  if (action === 'refund_result' || action === 'stop_refund') {
    condition(row.customerState === 'refund_approved' && approval, '须先取得本版退款批准，再登记实际结果');
    const approved = saleOperation(approval);
    condition(approved.agreementId === terms.agreementId, '退款条件已变化，请重新核对批准');
    condition(Date.parse(evidence.occurredAt) >= approval.createdAt.getTime(), '实际退款不能早于人工批准');
    const inApprovalCents = refundedUnder(row, approval.id);
    const outstandingCents = terms.amountCents - inApprovalCents;
    const sourcePaymentId = position.verifiedPayment?.paymentId ?? null;
    if (action === 'stop_refund') {
      const terminal = choice(data.result, ['failed','stopped'] as const, '渠道书面确认的终止结果');
      const { history, pending } = pendingRefundEvents(row, approval.id);
      const acknowledged = Array.isArray(data.pendingResultIds) ? data.pendingResultIds : [];
      condition(data.confirmStopped === true && outstandingCents > 0 && pending.length === new Set(acknowledged).size
        && pending.every(event => acknowledged.includes(event.id) && (event.sha256!==evidence.sha256 || event.documentRow!==evidence.documentRow))
        && history.every(event => event.occurredAt.getTime() <= Date.parse(evidence.occurredAt)),
      '须凭渠道书证核对整笔未退余额及所有已登记的未决指令均已终止');
      return { operation: { approvalId: approval.id, agreementId: terms.agreementId, sourcePaymentId, terminal,
        originalInstruction: requiredText(data.referenceNo, '原渠道退款指令或终止书面编号'), pendingResultIds: pending.map(event => event.id),
        paidCents: position.recordedCents, stoppedCents: outstandingCents, note: requiredText(data.note, '渠道明确确认的终止内容') },
        customerState: 'refund_followup' };
    }
    const result = choice(data.result, ['paid','failed','pending'] as const, '实际结果');
    const referenceNo = requiredText(data.referenceNo, '银行或原支付渠道的回执流水');
    condition(data.recipient === terms.recipient && data.destination === terms.destination && data.method === terms.method,
      '实际回执的收款人、去向和渠道须与人工批准一致');
    const amountCents = result === 'paid' ? cents(data.amountCents) : 0;
    condition(!amountCents || amountCents <= outstandingCents, '实际退款超出本次批准的剩余金额');
    const transfer = amountCents ? await allocateAfterSaleTransfer(tx, {
      direction: 'customer_refund', method: terms.method, party: terms.recipient, destination: terms.destination, referenceNo,
    }, data, evidence, amountCents) : undefined;
    return { operation: { ...terms, approvedCents: terms.amountCents, amountCents, result, referenceNo, approvalId: approval.id,
      sourcePaymentId, transfer, note: requiredText(data.note, '实际回执说明'), previouslyRecordedCents: position.recordedCents,
      previouslyRecordedInApprovalCents: inApprovalCents },
      customerState: result === 'paid' && amountCents === outstandingCents ? 'awaiting_close' : 'refund_approved' };
  }
  assertRefundCapacity(position, terms.amountCents);
  if (action === 'prepare_refund') {
    condition(['awaiting_refund','refund_prepared'].includes(row.customerState), '当前事项不能准备新的退款');
    const historicCheck = requiredText(data.historyReview, '财务对既有实际退款、积分处理及外部回执的核对记录');
    return { operation: { ...terms, position, historicCheck, note: requiredText(data.note, '退款准备说明') }, customerState: 'refund_prepared' };
  }
  const prepared = lastCaseEvent(row, 'prepare_refund');
  condition(row.customerState === 'refund_prepared' && prepared, '请先准备实际款项、收款人和付款渠道的资料');
  const previous = saleOperation(prepared);
  condition(previous.agreementId === terms.agreementId, '客户同意的退款条件已变化');
  return { operation: { ...terms, position, preparedId: prepared.id, historyReview: previous.historicCheck,
    note: requiredText(data.note, '批准依据') }, customerState: 'refund_approved' };
}
