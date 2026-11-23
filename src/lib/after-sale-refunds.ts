import { financeWorkspace } from '@/lib/finance-workspace';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { caseEvents, lastCaseEvent, saleOperation, type SaleCase, type AfterSaleWorkspace } from '@/lib/after-sale-workspace';

type RefundTerms = { amountCents: number; recipient: string; destination: string; method: string; currency: 'CNY'; agreementId: string };
export function refundTerms(row: SaleCase): RefundTerms {
  const agreement = lastCaseEvent(row, 'agreement');
  condition(agreement && saleOperation(agreement).remedy === 'refund', '这条明细尚缺客户对本版退款条件的明确同意');
  const op = saleOperation(agreement);
  return { amountCents: cents(op.amountCents), recipient: requiredText(op.recipient, '退款收款人'),
    destination: requiredText(op.destination, '已核实的退款去向'), method: requiredText(op.method, '退款方式'), currency: 'CNY', agreementId: agreement.id };
}
export function actualRefunded(row: SaleCase) {
  return caseEvents(row, 'refund_result').reduce((sum, event) => {
    const op = saleOperation(event);
    return op.result === 'paid' ? sum + cents(op.amountCents) : sum;
  }, 0);
}
function reserved(row: SaleCase) {
  const paid = actualRefunded(row);
  const approval = lastCaseEvent(row, 'approve_refund');
  if (approval && row.customerState === 'refund_approved') return Math.max(paid, cents(saleOperation(approval).amountCents));
  return paid;
}
export async function refundPosition(tx: Db, view: AfterSaleWorkspace, row: SaleCase) {
  const finance = await financeWorkspace(tx, view.order.id);
  const other = view.cases.filter(item => item.id !== row.id);
  const used = other.reduce((sum, item) => sum + reserved(item), 0);
  const onLine = other.filter(item => item.orderItemId === row.orderItemId).reduce((sum, item) => sum + reserved(item), 0);
  const line = view.lines.find(item => item.id === row.orderItemId)!;
  const gross = Math.round(line.unitPrice * line.quantity * 100);
  const caseGoodsCents = Math.round(line.unitPrice * row.quantity * 100);
  condition(Number.isSafeInteger(gross) && gross >= 0, '请先核对原订单行金额');
  return { paidCents: finance.settlementCents, usedCents: used, originalLineCents: gross, caseGoodsCents, lineUsedCents: onLine,
    originalAcceptance: finance.acceptanceId, authorityConflict: finance.authorityConflict, recordedCents: actualRefunded(row),
    originalPointsBasisYuan: view.order.pointsRefundedCash, originalCash: finance.cash.map(item => [item.id, item.amountCents]),
    originalPaymentId: finance.nativePaymentId };
}
export async function refundStep(tx: Db, view: AfterSaleWorkspace, row: SaleCase, action: string, data: Record<string, unknown>, evidence: SaleEvidence) {
  const terms = refundTerms(row);
  const position = await refundPosition(tx, view, row);
  const approval = lastCaseEvent(row, 'approve_refund');
  if (action === 'refund_result') {
    condition(row.customerState === 'refund_approved' && approval, '须先取得本版退款批准，再登记实际结果');
    const approved = saleOperation(approval);
    condition(approved.agreementId === terms.agreementId, '退款条件已变化，请重新核对批准');
    condition(Date.parse(evidence.occurredAt) >= approval.createdAt.getTime(), '实际退款不能早于人工批准');
    const result = choice(data.result, ['paid','failed','pending'] as const, '实际结果');
    const referenceNo = requiredText(data.referenceNo, '银行或原支付渠道的回执流水');
    condition(data.recipient === terms.recipient && data.destination === terms.destination && data.method === terms.method,
      '实际回执的收款人、去向和渠道须与人工批准一致');
    const amountCents = result === 'paid' ? cents(data.amountCents) : 0;
    condition(!amountCents || amountCents <= terms.amountCents - position.recordedCents, '实际退款超出本次批准的剩余金额');
    return { operation: { ...terms, approvedCents: terms.amountCents, amountCents, result, referenceNo, approvalId: approval.id,
      note: requiredText(data.note, '实际回执说明'), previouslyRecordedCents: position.recordedCents },
      customerState: result === 'paid' && amountCents + position.recordedCents === terms.amountCents ? 'awaiting_close' : 'refund_approved' };
  }
  condition(!position.authorityConflict && position.originalAcceptance, '原单接单或回款归属待财务核对');
  condition(terms.amountCents <= position.paidCents - position.usedCents && terms.amountCents <= position.originalLineCents - position.lineUsedCents && terms.amountCents <= position.caseGoodsCents,
    '退款超过已核实的剩余实收款或原商品行范围');
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
