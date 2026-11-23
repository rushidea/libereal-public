import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject } from '@/lib/purchase-activity';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { afterSaleChannels, afterSaleIssues, afterSaleRemedies, hasChoice } from '@/lib/after-sale-options';
import { cents, choice, condition, quantity, salePermission, saleProof, type SaleActor, type SaleAuthorization, type SaleEvidence, type SaleInput } from '@/lib/after-sale-records';
import { activeRefundSourceReview, actualRefunded, refundStep, releaseRefundSource, reviewRefundSource } from '@/lib/after-sale-refunds';
import { afterSaleCaseInclude, afterSaleWorkspace, caseEvents, currentSaleAgreement, lastCaseEvent, originalSaleParcel, originalSaleParcelShares, saleOperation, supplierProgress, type AfterSaleWorkspace, type SaleCase } from '@/lib/after-sale-workspace';

import { invoiceAgreement, invoiceOutcome, invoiceReissue, invoiceReissueBeforeClose, reviseInvoiceReissue, verifyInvoiceLine } from '@/lib/after-sale-invoices';
import { supplierAfterSale } from '@/lib/after-sale-supplier';
import { approveAfterSaleExchange } from '@/lib/after-sale-exchanges';
import { transferReference } from '@/lib/after-sale-transfers';

type Plan = { operation: Record<string, unknown>; customerState?: string; supplierState?: string; ownerId?: string; shortfallId?: string };
type OpenRow = { orderItemId: string; quantity: number; relatedCents: number | null; issue: string; channel: string; report: string; shortfallId: string | null; originalParcelLineId?: string; sourceKey: string };
const technicalIssue = (issue: string) => issue === 'quality' || issue === 'technical';

function openRow(view: AfterSaleWorkspace, data: Record<string, unknown>, evidence: SaleEvidence, customer: boolean): OpenRow {
  const line = view.lines.find(item => item.id === data.orderItemId);
  condition(line, '请选择原订单中的商品行');
  const units = quantity(data.quantity);
  condition(units <= line.quantity, '售后数量超出原订单行');
  if (!hasChoice(afterSaleIssues, data.issue) || !hasChoice(afterSaleChannels, data.channel)) throw new PurchaseError('请选择真实问题和来源', 400);
  condition(customer ? data.channel === 'account' : data.channel !== 'account', '请保留客户消息或内部移交的真实来源');
  const shortfallId = data.shortfallId ? requiredText(data.shortfallId, '原短失记录') : null;
  if (shortfallId) {
    const loss = view.shortfalls.find(item => item.resolutionId === shortfallId && item.orderItemId === line.id);
    condition(!customer && loss && loss.sha256 && units <= loss.quantity - loss.claimed, '原短失记录不存在或已关联足量售后');
    condition(data.issue === 'shortage' || data.issue === 'incorrect' || data.issue === 'return', '请核对原履约凭据对应的问题');
    if (data.channel === 'fulfillment') condition(evidence.sha256 === loss.sha256 && evidence.reference === loss.reference
      && evidence.documentRow === loss.documentRow && evidence.occurredAt === loss.occurredAt, '请选用原履约记录的具体凭据、行号和发生时间');
  } else condition(data.channel !== 'fulfillment', '请选择对应的原履约记录');
  const original = data.originalParcelLineId ? view.deliveries.find(item => item.id === data.originalParcelLineId
    && item.orderItemId === line.id && item.route !== 'supplier_to_libereal') : null;
  condition(!data.originalParcelLineId || original && original.quantity >= units, '请选择本案实际受影响的原包裹行和数量');
  const sourceKey = pricingContentHash({ channel: data.channel, orderId: view.order.id, line: line.id, shortfallId,
    source: evidence.sha256, row: evidence.documentRow });
  return { orderItemId: line.id, quantity: units, relatedCents: data.relatedCents == null ? null : cents(data.relatedCents, true),
    issue: data.issue, channel: data.channel, report: requiredText(data.note, '售后情况'), shortfallId, originalParcelLineId: original?.id, sourceKey };
}

function originalReceipt(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence): Plan {
  const parcel = view.deliveries.find(item => item.id === data.parcelLineId && item.orderItemId === row.orderItemId
    && item.route !== 'supplier_to_libereal' && !item.afterSaleApprovalId);
  condition(parcel && !originalSaleParcel(row), '请选择实际对客包裹行，并保留原案已经指定的整笔来源');
  const amount = quantity(data.quantity);
  const received = parcel.receipts.filter(item => item.at <= Date.parse(proof.occurredAt)).reduce((sum, item) => sum + item.quantity, 0);
  const shares = originalSaleParcelShares(row);
  const allocated = view.cases.filter(item => item.id !== row.id).flatMap(item => {
    const decision = currentSaleAgreement(item);
    const withoutRemedy = item.customerState === 'closed' && decision && ['keep', 'follow_up'].includes(String(saleOperation(decision).remedy))
      && !caseEvents(item,'physical').length && !caseEvents(item,'approve_exchange').length;
    return withoutRemedy ? [] : originalSaleParcelShares(item);
  }).concat(shares);
  condition(amount <= row.quantity - shares.reduce((sum, item) => sum + item.quantity, 0)
    && amount <= received - allocated.filter(item => item.parcelLineId === parcel.id).reduce((sum, item) => sum + item.quantity, 0),
    '本案剩余份额或这一包裹实际已签收的可关联数量不足');
  const share = { parcelLineId:parcel.id, quantity:amount };
  const supplierState = supplierProgress(row,view.deliveries,view.shortfalls.find(loss=>loss.resolutionId===row.shortfallId),undefined,share).state;
  return { operation: { ...share, orderItemId:row.orderItemId,purchaseOrderId:parcel.purchaseOrderId,
    receivedQuantity:received,waybill:parcel.reference,note:requiredText(data.note,'原包裹与本案件数的核对依据') }, supplierState };

}

function replacementPurchases(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>,
  originals: { parcelLineId: string; quantity: number }[]) {
  const inputs = data.replacementPurchaseShares ?? (data.replacementPurchaseOrderId
    ? [{ purchaseOrderId: data.replacementPurchaseOrderId, quantity: row.quantity }] : []);
  condition(Array.isArray(inputs), '请选择实际采购来源及分配的件数');
  if (!inputs.length) return [];
  const sources = new Map<string,number>();
  for (const part of originals) {
    const purchase = view.deliveries.find(item => item.id === part.parcelLineId)?.purchaseOrderId;
    if (purchase) sources.set(purchase, (sources.get(purchase) ?? 0) + part.quantity);
  }
  const seen = new Set<string>();
  const replacements = inputs.map(purchaseObject).map(input => {
    const amount = quantity(input.quantity);
    const linked = view.replacements.find(item => item.purchaseOrderId === input.purchaseOrderId && item.orderItemId === row.orderItemId
      && (row.shortfallId ? item.shortfallId === row.shortfallId : sources.has(item.fromPurchaseOrderId)));
    condition(linked && !seen.has(linked.id) && amount <= linked.quantity,
      '请选择已有实际批准且对应本案原货的独立补采购行和数量');
    if (!row.shortfallId) {
      const left = (sources.get(linked.fromPurchaseOrderId) ?? 0) - amount;
      condition(left >= 0, '替代采购数量超出本案该原供方的归属份额');
      sources.set(linked.fromPurchaseOrderId,left);
    }
    const promisedElsewhere = view.cases.filter(item => item.id !== row.id).flatMap(item => {
      const effective = currentSaleAgreement(item);
      return effective ? agreedPurchases(saleOperation(effective)) : [];
    }).reduce((sum, entry) => entry.id === linked.id ? sum + quantity(entry.quantity ?? view.replacements.find(item => item.id === entry.id)?.quantity) : sum, 0);
    condition(amount + promisedElsewhere <= linked.quantity, '该采购行的批准数量已归入其他售后');
    seen.add(linked.id);
    return { ...linked, quantity: amount };
  });
  condition(replacements.reduce((sum, item) => sum + item.quantity, 0) === row.quantity, '各采购份额须合计覆盖本案实际件数');
  return replacements;
}
function agreedPurchases(decision: Record<string,unknown>) {
  return Array.isArray(decision.replacements) ? decision.replacements.map(purchaseObject)
    : decision.replacement ? [purchaseObject(decision.replacement)] : [];
}

async function agreement(tx: Db, view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence): Promise<Plan> {
  if (!hasChoice(afterSaleRemedies, data.remedy)) throw new PurchaseError('请选择客户书面同意的处理方式', 400);
  const remedy = data.remedy;
  const earlier = currentSaleAgreement(row);
  const decision = requiredText(data.customerDecision, '客户确认的条件、范围和费用责任');
  const operation: Record<string,unknown> = { remedy, decision, quantity: row.quantity };
  if (remedy === 'refund') Object.assign(operation, { amountCents: cents(data.amountCents),
    recipient: requiredText(data.recipient, '退款收款人'), destination: requiredText(data.destination, '收款去向的核验标识'),
    method: choice(data.method, ['bank','alipay','other'] as const, '退款渠道'), currency: 'CNY' });
  if (earlier) {
    condition(earlier.sha256 !== proof.sha256 || earlier.documentRow !== proof.documentRow, '变更已确认条件须取得新的客户书证');
    const latestDate = earlier.occurredAt.toISOString();
    if (proof.occurredAt < latestDate) return { operation: { ...operation, historical:true, effectiveAgreementId:earlier.id } };
    condition(proof.occurredAt > latestDate && data.revisesAgreementId === earlier.id,
      '要修订当前客户决定，须选择其版本并提供实际发生在后的明确书面决定');
  }
  const previousInvoice = purchaseObject(earlier && saleOperation(earlier).invoice);
  if (row.customerState === 'awaiting_invoice_reissue' || row.customerState === 'awaiting_close' && previousInvoice.expectedOutcome==='reissue') {
    condition(remedy === 'invoice' && actualRefunded(row) === 0, '请仅修订原票待办的重开条件');
    const revised = await reviseInvoiceReissue(tx,row,view.cases,data,proof);
    return { operation: { ...operation, revisesAgreementId: earlier?.id, invoice: revised.invoice }, customerState: revised.customerState };
  }
  condition(remedy!=='invoice' || !caseEvents(row,'invoice_reissue').length,
    '替代票已经实际签发并核对，请保留原案结果，新事项可另行登记');
  condition(['reviewing','awaiting_customer','awaiting_technical','awaiting_fulfillment','awaiting_refund','refund_prepared',
    'refund_followup','awaiting_invoice','awaiting_close'].includes(row.customerState), '该事项已有须先核对的实际结果或有效的退款批准');
  const technical = lastCaseEvent(row, 'technical');
  if (technicalIssue(row.issue) && !['follow_up','keep','refund_withdraw'].includes(remedy)) condition(technical && Date.parse(proof.occurredAt) >= technical.occurredAt.getTime(),
    '质量与使用问题须先核实供应商或品牌技术意见，并取得客户对该意见的后续决定');
  operation.technicalId = technical?.id ?? null;
  operation.revisesAgreementId = earlier?.id ?? null;
  const priorStop = lastCaseEvent(row,'stop_refund');
  const physicalResults = caseEvents(row,'physical').map(saleOperation);
  const returned = physicalResults.filter(result=>result.result==='return').reduce((sum,result)=>sum+quantity(result.quantity),0);
  const recorded = actualRefunded(row);
  if (row.customerState === 'refund_followup') {
    condition(priorStop && Date.parse(proof.occurredAt) >= priorStop.occurredAt.getTime()
      && (remedy === 'refund' || remedy === 'refund_withdraw'), '须先核对原指令终止，再书面确认新退款或取消未付余额');
    operation.originalRefundStopId = priorStop.id;
    operation.previouslyRefundedCents = recorded;
  } else condition(remedy !== 'refund_withdraw' && recorded === 0, '有实际退款或未决余额，请先核对原退款指令');
  const exchangeIds = new Set(caseEvents(row,'approve_exchange').map(event => event.id));
  condition(!view.deliveries.some(item => item.afterSaleApprovalId && exchangeIds.has(item.afterSaleApprovalId)),
    '该版已发生换货发运，请保留原决定并按实际结果核对');
  condition(!physicalResults.length || ((remedy==='refund'||remedy==='refund_withdraw') && returned>0
    && physicalResults.every(result=>result.result==='return')), '已有实物结果，须谨慎沿原实退范围办理');
  if (remedy === 'refund_withdraw') return { operation: { ...operation, releasedCents:saleOperation(priorStop!).stoppedCents }, customerState:'awaiting_close' };
  if (remedy === 'refund') {
    const allowed = returned ? Math.min(returned,row.quantity) : row.quantity;
    const units = data.refundQuantity===undefined ? allowed : quantity(data.refundQuantity);
    condition(units<=allowed,'本次退款件数超过原事项或已核实的实际退回范围');
    operation.refundQuantity = units;
    if (returned) operation.originalReturns = caseEvents(row,'physical').filter(event=>saleOperation(event).result==='return').map(event=>event.id);
    return { operation, customerState: 'awaiting_refund' };
  }
  const pinned = originalSaleParcel(row);
  const originals = originalSaleParcelShares(row);
  const originalId = data.originalParcelLineId ?? pinned;
  if (originalId) {
    const original = view.deliveries.find(item=>item.id===originalId && item.orderItemId===row.orderItemId && item.route!=='supplier_to_libereal');
    condition(original && original.quantity>=row.quantity && (!originals.length || originals.every(part => part.parcelLineId === original.id)
      && originals.reduce((sum, part) => sum + part.quantity,0) === row.quantity),
      '请选择原客户书证和售后明细对应的实际包裹');
    operation.originalParcelLineId=original.id;
    if (!originals.length) originals.push({ parcelLineId: original.id, quantity: row.quantity, evidenceEventId: null });
  }
  if (originals.length) operation.originalParcelShares = originals;
  if (remedy === 'resend' || remedy === 'exchange') {
    const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
    const approval = data.resendApprovalId ? loss?.approved.find(item => item.id === data.resendApprovalId) : null;
    if (data.resendApprovalId) condition(approval && approval.quantity >= row.quantity, '原双方书证未覆盖此短失和数量');
    operation.resendApprovalId = approval?.id ?? null;
    if (remedy === 'exchange' && !loss) {
      condition(originals.reduce((sum, item) => sum + item.quantity, 0) === row.quantity
        && originals.every(part => view.deliveries.some(item => item.id === part.parcelLineId && !item.afterSaleApprovalId
          && item.receipts.filter(receipt=>receipt.at<=Date.parse(proof.occurredAt)).reduce((sum,receipt)=>sum+receipt.quantity,0)
            >= originals.filter(other => other.parcelLineId === part.parcelLineId).reduce((sum,other) => sum + other.quantity,0))),
        '换货须按件核对本案实际签收的原包裹');
      operation.returnRequirement=choice(data.returnRequirement,['required','waived'] as const,'客户和供方书证确定的退回要求');
    }
    const replacements = replacementPurchases(view, row, data, originals);
    if (replacements.length) {
      condition(!approval, '请分别以已有免费补发批准或独立采购约定核对同一批件数');
      operation.replacements = replacements;
      if (replacements.length === 1) operation.replacement = replacements[0];
    }
  }
  if (remedy === 'invoice') operation.invoice=await invoiceAgreement(tx,row,data);
  const state = remedy === 'invoice' ? 'awaiting_invoice' : ['return','exchange','resend','cancel'].includes(remedy)
    ? 'awaiting_fulfillment' : remedy === 'follow_up' ? 'awaiting_customer' : 'awaiting_close';
  return { operation, customerState: state };
}

function attributeResend(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence): Plan {
  const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
  const line = view.deliveries.find(item => item.id===data.parcelLineId && item.orderItemId===row.orderItemId && item.route!=='supplier_to_libereal');
  const source = view.resendShipments.find(item=>item.parcelLineId===line?.sourceParcelLineId);
  const approval = loss?.approved.find(item=>item.id===line?.approvalId);
  const units = quantity(data.quantity);
  condition(row.customerState!=='closed' && loss && line && source?.ambiguous && approval && data.approvalId===approval.id
    && loss.purchaseOrderId===line.purchaseOrderId && line.dispatchedAt<=proof.occurredAt,
  '请选择该处实际补件运单、原批准及本案真实短失');
  const parcelUse=source.allocations.reduce((sum,part)=>sum+part.quantity,0);
  const customerUse=line.resendAttributions?.reduce((sum,part)=>sum+part.quantity,0) ?? 0;
  const caseUse=caseEvents(row,'attribute_resend').reduce((sum,part)=>sum+quantity(saleOperation(part).quantity),0);
  condition(units<=source.quantity-parcelUse && units<=line.quantity-customerUse && units<=row.quantity-caseUse
    && units<=approval.quantity-approval.dispatched, '本次归属超过原批准、包裹或本案尚未核对的实际件数');
  return { operation:{ approvalId:approval.id, shortfallId:loss.resolutionId, parcelLineId:line.id, sourceParcelLineId:source.parcelLineId,
    quantity:units, reference:line.reference, note:requiredText(data.note,'书证确定的份额和经办核对结果') } };
}

function physical(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, evidence: SaleEvidence): Plan {
  condition(row.customerState === 'awaiting_fulfillment', '请先核对客户或原双方书面决定');
  const decision = currentSaleAgreement(row);
  const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
  const approved = purchaseObject(decision && saleOperation(decision));
  const remedy = approved.remedy ?? (loss?.approved.length ? 'resend' : '');
  if (remedy === 'cancel') {
    condition(['cancelled','closed'].includes(view.order.status), '原订单尚无已完成的取消处理');
    return { operation: { remedy, orderStatus: view.order.status, note: requiredText(data.note, '取消结果和票款后续') }, customerState: 'awaiting_close' };
  }
  condition(remedy === 'return' || remedy === 'exchange' || remedy === 'resend', '请核对本次实物处理方式');
  const step = choice(data.result, ['return','delivery'] as const, '实物处理结果');
  condition((step !== 'return' || remedy !== 'resend') && (step !== 'delivery' || remedy !== 'return'), '本次实物结果与客户决定不符');
  const line = view.deliveries.find(item => item.id === data.parcelLineId && item.orderItemId === row.orderItemId && item.route !== 'supplier_to_libereal');
  condition(line, '请选择对应原订单行的实际对客包裹');
  const units = quantity(data.quantity);
  const at = Date.parse(evidence.occurredAt);
  const used = view.cases.flatMap(item => caseEvents(item,'physical').map(saleOperation))
    .filter(op => op.result === step && op.parcelLineId === line.id && (step !== 'return' || op.resolutionId === data.resolutionId))
    .reduce((sum, op) => sum + quantity(op.quantity), 0);
  const previous = caseEvents(row,'physical').map(saleOperation);
  const done = (kind: string) => previous.filter(op => op.result === kind).reduce((sum, op) => sum + quantity(op.quantity), 0);
  condition(units <= row.quantity - done(step), '实际处理超出本售后行尚未办理的数量');
  let resolutionId: string | null = null;
  let attributedPurchase: Record<string,unknown> | undefined;
  if (step === 'return') {
    const originalShares = originalSaleParcelShares(row);
    const possible = view.deliveries.filter(item=>item.orderItemId===row.orderItemId && !item.afterSaleApprovalId && item.receipts.length);
    const allocated = originalShares.filter(item => item.parcelLineId === line.id).reduce((sum,item) => sum + item.quantity,0);
    const returnedFromLine = previous.filter(op => op.result === 'return' && op.parcelLineId === line.id)
      .reduce((sum, op) => sum + quantity(op.quantity), 0);
    condition(originalShares.length ? allocated - returnedFromLine >= units : possible.length===1 && possible[0].id===line.id,
      '退回凭据须属于本案指定的原实际包裹，分批签收时请先核对原运单和份额');
    const result = line.returns.find(item => item.id === data.resolutionId && Date.parse(item.occurredAt) <= at);
    condition(result && result.quantity - used >= units, '须有对应实收商品的原退回凭据和足够的未引用数量');
    resolutionId = result.id;
  } else {
    const exchange = caseEvents(row,'approve_exchange').find(event=>event.id===line.afterSaleApprovalId
      && saleOperation(event).agreementId===decision?.id);
    const purchaseShares = agreedPurchases(approved);
    if (purchaseShares.length) {
      const requested = purchaseShares.find(part => part.purchaseOrderId === line.purchaseOrderId);
      const purchased = requested && view.replacements.find(item => item.purchaseOrderId === line.purchaseOrderId && item.orderItemId === row.orderItemId
        && item.id === requested.id && item.authorizationId === requested.authorizationId && item.commitmentId === requested.commitmentId
        && (requested.approvalId === undefined || item.approvalId === requested.approvalId));
      const usedFromPurchase = previous.filter(part => part.result === 'delivery' && purchaseObject(part.replacement).id === purchased?.id)
        .reduce((sum, part) => sum + quantity(part.quantity),0);
      condition(!line.afterSaleApprovalId && !line.approvalId && purchased && quantity(requested.quantity ?? row.quantity) - usedFromPurchase >= units,
        '请选择书面决定中已归行的独立采购补件和剩余份额');
      attributedPurchase = { ...purchased, quantity: units };
    } else if (!exchange) {
      const approval = loss?.approved.find(item => item.id === (approved.resendApprovalId ?? data.resendApprovalId));
      const attributed = line.resendAttributions?.filter(part=>part.shortfallId===loss?.resolutionId && part.approvalId===approval?.id)
        .reduce((sum,part)=>sum+part.quantity,0) ?? 0;
      const prior = view.cases.filter(item=>item.shortfallId===row.shortfallId).flatMap(item=>caseEvents(item,'physical').map(saleOperation))
        .filter(result=>result.result==='delivery' && result.parcelLineId===line.id).reduce((sum,result)=>sum+quantity(result.quantity),0);
      condition(approval && attributed-prior>=units, '请选择本笔短失真正已获批准、归行并发出的补件');
    }
    condition(line.receipts.filter(receipt => receipt.at <= at).reduce((sum, receipt) => sum + receipt.quantity, 0) - used >= units,
      '该补件尚无足量的客户实际签收');
  }
  const returned = done('return') + (step === 'return' ? units : 0);
  const delivered = done('delivery') + (step === 'delivery' ? units : 0);
  const complete = (remedy === 'resend' || remedy === 'exchange' && approved.returnRequirement === 'waived' || returned === row.quantity) && (remedy === 'return' || delivered === row.quantity);
  return { operation: { remedy, result: step, parcelLineId: line.id, resolutionId, quantity: units, reference: line.reference,
    resendApprovalId: line.approvalId, afterSaleApprovalId:line.afterSaleApprovalId, replacement:attributedPurchase, decisionId: decision?.id ?? null, note: requiredText(data.note, '实物回执核对说明') },
    customerState: complete ? 'awaiting_close' : 'awaiting_fulfillment' };
}

async function planAction(tx: Db, view: AfterSaleWorkspace, row: SaleCase, input: SaleInput, actor: SaleActor, proof: SaleEvidence): Promise<Plan> {
  const { action, data } = input;
  if (action === 'claim') {
    const existing = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
    const usable = existing?.approved.filter(item => item.quantity >= row.quantity) ?? [];
    const next = usable.length === 1 ? 'awaiting_fulfillment' : technicalIssue(row.issue) ? 'awaiting_technical' : 'reviewing';
    return { operation: { previousOwner: row.ownerId, owner: actor.id, originalApprovals: usable.map(item => item.id), note: requiredText(data.note, '接手事项') },
      ownerId: actor.id, customerState: row.customerState === 'reported' ? next : row.customerState };
  }
  condition(row.ownerId, '请先由经办人接手售后');
  if (action === 'link_shortfall') {
    condition(!row.shortfallId && row.customerState !== 'closed', '请保留原先关联的履约事实');
    const loss = view.shortfalls.find(item => item.resolutionId === data.shortfallId && item.orderItemId === row.orderItemId);
    condition(loss && loss.quantity - loss.claimed >= row.quantity && loss.sha256 === proof.sha256 && loss.documentRow === proof.documentRow
      && proof.reference === loss.reference && proof.occurredAt === loss.occurredAt, '履约原件、商品行或剩余可关联数量不符');
    return { operation: { shortfallId: loss.resolutionId, purchaseOrderId: loss.purchaseOrderId, quantity: row.quantity,
      note: requiredText(data.note, '关联说明') }, shortfallId: loss.resolutionId };
  }
  if (action === 'add_evidence') return { operation: { note: requiredText(data.note, '往来记录'), channel: choice(data.channel,
    ['email','koncket','handoff'] as const, '实际沟通来源') } };
  if (action === 'supplier') return supplierAfterSale(tx,view,row,data,proof,actor.id);
  if (action === 'agreement') return agreement(tx,view,row,data,proof);
  if (action === 'release_refund_source') return releaseRefundSource(tx,view,row,data,proof);
  condition(row.customerState !== 'closed','该客户事项已经办结，新增事项请另行登记并引用原单');
  if (action === 'technical') {
    condition(technicalIssue(row.issue) && ['reviewing','awaiting_technical','awaiting_customer'].includes(row.customerState),'当前事项无待核的技术意见');
    return { operation: { authority: choice(data.authority,['supplier','brand'] as const,'书面判断来源'), party: requiredText(data.party,'供应商或品牌技术部门'),
      contact: requiredText(data.contact,'出具意见的技术联系人'), note: requiredText(data.note,'技术方实际书面意见') }, customerState: 'awaiting_customer' };
  }
  if (action === 'bind_original_parcel') return originalReceipt(view,row,data,proof);
  if (action === 'approve_exchange') return approveAfterSaleExchange(tx,view,row,data,proof);
  if (action === 'attribute_resend') return attributeResend(view,row,data,proof);
  if (action === 'review_refund_source') return reviewRefundSource(tx,view,row,data,proof);
  if (action === 'physical') return physical(view,row,data,proof);
  if (action === 'prepare_refund' || action === 'approve_refund' || action === 'refund_result' || action === 'stop_refund') return refundStep(tx,view,row,action,data,proof);
  if (action === 'verify_invoice_line') return verifyInvoiceLine(tx,row,data,proof);
  if (action === 'invoice_outcome') return invoiceOutcome(tx,row,data,proof);
  if (action === 'invoice_reissue') return invoiceReissue(tx,row,view.cases,data,proof);
  condition(action==='close','须先取得本案所需的实际办理结果');
  const invoice = await invoiceReissueBeforeClose(tx,row,view.cases);
  condition(invoice ? invoice.ready : row.customerState==='awaiting_close','须先取得本案所需的有效替代票或其他实际办理结果');
  const latestDecision = currentSaleAgreement(row);
  condition(!latestDecision || saleOperation(latestDecision).remedy !== 'keep' || !activeRefundSourceReview(row),
    '请先由财务核对并解除这笔未实际发出的退款预留');
  return { operation: { note: requiredText(data.note,'办结依据、客户答复和实际处理结果'), reissueVersion:invoice?.version, supplierState: supplierProgress(row,view.deliveries,view.shortfalls.find(loss=>loss.resolutionId===row.shortfallId)).state }, customerState: 'closed' };
}

export async function afterSaleAction(tx: Db, input: SaleInput, actor: SaleActor, confirmation?: {
  hash: string; authorization?: SaleAuthorization; customer?: boolean;
}, customer = false) {
  const { orderId, caseId, action, requestId, data } = input;
  const proof = saleProof(data);
  const requestKey = pricingContentHash({ action: 'after_sale', actor: actor.id, requestId });
  const intentHash = pricingContentHash({ action, orderId, caseId, data, actor: actor.id, customer });
  const exchangeCase = action === 'approve_exchange' ? await tx.afterSaleCase.findFirst({ where: { id:caseId,orderId },include:afterSaleCaseInclude }) : null;
  const shares = exchangeCase ? originalSaleParcelShares(exchangeCase) : [];
  const exchangeParcel = data.parcelLineId ?? (shares.length===1 ? shares[0].parcelLineId : null);
  const natural = action === 'refund_result' && data.result === 'paid'
    ? { action, caseId, trace: transferReference(data.referenceNo) }
    : action === 'supplier' && data.outcome === 'financial_result' ? {
      action,caseId,trace:transferReference(data.referenceNo),purchaseOrderId:data.purchaseOrderId??null,
      parcelLineId:data.originalParcelLineId??null,allocationReference:typeof data.allocationReference==='string'?data.allocationReference.normalize('NFKC').trim():null }
    : { action, orderId, caseId, source: proof.sha256, row: proof.documentRow,
      ...(action === 'open' ? { item: data.orderItemId, shortfall: data.shortfallId ?? null }
        : action === 'bind_original_parcel' ? { parcelLineId: data.parcelLineId }
        : action === 'approve_exchange' ? { parcelLineId:exchangeParcel }
        : action === 'supplier' ? { purchaseOrderId:data.purchaseOrderId??null, parcelLineId:data.originalParcelLineId??null }
        : action === 'invoice_reissue' ? { allocationId:data.invoiceAllocationId }
        : action === 'physical' ? { parcelLineId: data.parcelLineId, resolutionId: data.resolutionId ?? null } : {}) };
  const businessKey = pricingContentHash(natural);
  const prior = await tx.afterSaleEvent.findMany({ where: { OR: [{requestKey},{businessKey}] } });
  if (!prior.length && (action==='invoice_reissue' || action==='supplier' && data.outcome==='financial_result')) {
    const oldKey = action==='invoice_reissue' ? {action,orderId,caseId,source:proof.sha256,row:proof.documentRow}
      : {action,caseId,trace:transferReference(data.referenceNo)};
    const replay = await tx.afterSaleEvent.findFirst({where:{businessKey:pricingContentHash(oldKey),intentHash}});
    if (replay) prior.push(replay);
  }
  if (!prior.length && exchangeCase) {
    const legacy = caseEvents(exchangeCase,'approve_exchange').find(event=>event.sha256===proof.sha256
      && event.documentRow===proof.documentRow && saleOperation(event).originalParcelLineId===exchangeParcel);
    if (legacy) prior.push(legacy);
  }
  if (prior.length) {
    const saved = prior[0];
    condition(prior.length === 1 && saved.intentHash === intentHash, '这项操作或凭据已用于其他内容，请查看原记录');
    if (confirmation) condition(confirmation.hash === saved.approvedHash, '应使用实际确认的原预览');
    return { actionHash: saved.approvedHash, snapshot: purchaseObject(JSON.parse(saved.detail)).snapshot, caseId: saved.caseId, eventId: saved.id, repeated: true };
  }
  const view = await afterSaleWorkspace(tx,orderId);
  const row = view.cases.find(item => item.id === caseId);
  if (action !== 'open') condition(row,'原订单下没有这笔售后');
  condition(!customer || action === 'open','客户仅可通过订单页登记自己的售后请求');
  const opened = action === 'open' ? openRow(view,data,proof,customer) : null;
  const plan: Plan = opened ? { operation: { ...opened } } : await planAction(tx,view,row!,input,actor,proof);
  const operation = plan.operation;
  const itemId = opened?.orderItemId ?? row!.orderItemId;
  const line = view.lines.find(item => item.id === itemId)!;
  const currentSupplierState = row && supplierProgress(row,view.deliveries,view.shortfalls.find(loss=>loss.resolutionId===row.shortfallId)).state;
  const snapshot = { action, orderId, caseId: row?.id ?? null, revision: row?.revision ?? null, item: line, owner: row?.ownerId ?? null,
    customer: { id: view.order.customerId, organization: view.order.organizationId, scope: view.order.ownerScope, email: view.order.email },
    orderTerms: view.order.termsVersion, previousState: row?.customerState ?? null, nextState: plan.customerState ?? row?.customerState ?? 'reported',
    nextSupplierState: plan.supplierState ?? currentSupplierState ?? 'unreviewed', scopeQuantity: opened?.quantity ?? row!.quantity,
    actor: actor.id, proof, operation };
  const actionHash = pricingContentHash(snapshot);
  if (!confirmation) return { actionHash, snapshot, caseId: row?.id ?? null, eventId: null, repeated: false };
  condition(confirmation.hash === actionHash,'原订单、售后进度或批准内容已变化，请重新预览');
  if (!customer) condition(confirmation.authorization?.permission === salePermission(input),'缺少服务端核实的经办权限和身份验证');
  const saved = opened ? await tx.afterSaleCase.create({ data: { orderItemId:opened.orderItemId, quantity:opened.quantity,
    issue:opened.issue, channel:opened.channel, report:opened.report, shortfallId:opened.shortfallId, sourceKey:opened.sourceKey,
    relatedCents: opened.relatedCents == null ? null : BigInt(opened.relatedCents), orderId, reportedAt: new Date(proof.occurredAt),
    sourceReference: proof.reference, sourceRow: proof.documentRow, sourceSha256: proof.sha256, createdBy: actor.id } }) : row!;
  if (!opened) {
    const updated = await tx.afterSaleCase.updateMany({ where: { id: saved.id, orderId, revision: saved.revision },
      data: { revision: { increment: 1 }, customerState: plan.customerState, supplierState: plan.supplierState ?? currentSupplierState, ownerId: plan.ownerId, shortfallId: plan.shortfallId } });
    condition(updated.count === 1,'售后记录已变化，请重新读取');
  }
  const event = await tx.afterSaleEvent.create({ data: { caseId: saved.id, action, actorId: actor.id, requestKey, businessKey, intentHash, approvedHash: actionHash,
    occurredAt: new Date(proof.occurredAt), reference: proof.reference, sha256: proof.sha256, documentRow: proof.documentRow,
    detail: JSON.stringify({ operation, snapshot, authorization: confirmation.authorization ?? null }) } });
  return { actionHash, snapshot, caseId: saved.id, eventId: event.id, repeated: false };
}
