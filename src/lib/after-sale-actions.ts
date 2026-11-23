import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { afterSaleChannels, afterSaleIssues, afterSaleRemedies, hasChoice } from '@/lib/after-sale-options';
import { cents, choice, condition, quantity, salePermission, saleProof, type SaleActor, type SaleAuthorization, type SaleEvidence, type SaleInput } from '@/lib/after-sale-records';
import { actualRefunded, refundStep } from '@/lib/after-sale-refunds';
import { afterSaleWorkspace, caseEvents, lastCaseEvent, saleOperation, type AfterSaleWorkspace, type SaleCase } from '@/lib/after-sale-workspace';

type Plan = { operation: Record<string, unknown>; customerState?: string; supplierState?: string; ownerId?: string; shortfallId?: string };
type OpenRow = { orderItemId: string; quantity: number; relatedCents: number | null; issue: string; channel: string; report: string; shortfallId: string | null; sourceKey: string };
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
  const sourceKey = pricingContentHash({ channel: data.channel, orderId: view.order.id, line: line.id, shortfallId,
    source: evidence.sha256, row: evidence.documentRow });
  return { orderItemId: line.id, quantity: units, relatedCents: data.relatedCents == null ? null : cents(data.relatedCents, true),
    issue: data.issue, channel: data.channel, report: requiredText(data.note, '售后情况'), shortfallId, sourceKey };
}

function agreement(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence): Plan {
  condition(['reviewing','awaiting_customer','awaiting_technical','awaiting_fulfillment','awaiting_refund','refund_prepared','awaiting_invoice','awaiting_close'].includes(row.customerState),
    '该事项已有须先核对的实际结果或有效的退款批准');
  if (!hasChoice(afterSaleRemedies, data.remedy)) throw new PurchaseError('请选择客户书面同意的处理方式', 400);
  const remedy = data.remedy;
  const technical = lastCaseEvent(row, 'technical');
  if (technicalIssue(row.issue) && !['follow_up','keep'].includes(remedy)) condition(technical && Date.parse(proof.occurredAt) >= technical.occurredAt.getTime(),
    '质量与使用问题须先核实供应商或品牌技术意见，并取得客户对该意见的后续决定');
  const earlier = lastCaseEvent(row, 'agreement');
  if (earlier) condition(earlier.sha256 !== proof.sha256 || earlier.documentRow !== proof.documentRow, '变更已确认条件须取得新的客户书证');
  condition(!caseEvents(row, 'physical').length && actualRefunded(row) === 0, '已有实物或款项结果，请核对原处理记录的未决部分');
  const decision = requiredText(data.customerDecision, '客户确认的条件、范围和费用责任');
  const operation: Record<string,unknown> = { remedy, decision, quantity: row.quantity, technicalId: technical?.id ?? null };
  if (remedy === 'refund') {
    Object.assign(operation, { amountCents: cents(data.amountCents), recipient: requiredText(data.recipient, '退款收款人'),
      destination: requiredText(data.destination, '收款去向的核验标识'), method: choice(data.method, ['bank','alipay','other'] as const, '退款渠道'), currency: 'CNY' });
    return { operation, customerState: 'awaiting_refund' };
  }
  if (remedy === 'resend' || remedy === 'exchange') {
    const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
    const approval = data.resendApprovalId ? loss?.approved.find(item => item.id === data.resendApprovalId) : null;
    if (data.resendApprovalId) condition(approval && approval.quantity >= row.quantity, '原双方书证未覆盖此短失和数量');
    operation.resendApprovalId = approval?.id ?? null;
  }
  const state = remedy === 'invoice' ? 'awaiting_invoice' : ['return','exchange','resend','cancel'].includes(remedy)
    ? 'awaiting_fulfillment' : remedy === 'follow_up' ? 'awaiting_customer' : 'awaiting_close';
  return { operation, customerState: state };
}

function physical(view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, evidence: SaleEvidence): Plan {
  condition(row.customerState === 'awaiting_fulfillment', '请先核对客户或原双方书面决定');
  const decision = lastCaseEvent(row, 'agreement');
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
  if (step === 'return') {
    const result = line.returns.find(item => item.id === data.resolutionId && Date.parse(item.occurredAt) <= at);
    condition(result && result.quantity - used >= units, '须有对应实收商品的原退回凭据和足够的未引用数量');
    resolutionId = result.id;
  } else {
    const approval = loss?.approved.find(item => item.id === (approved.resendApprovalId ?? data.resendApprovalId));
    condition(approval && !approval.ambiguous && approval.parcelLineIds.includes(line.id), '请选择本笔短失经采购批准后实际发出的补件，原运单不能作为补发签收');
    condition(line.receipts.filter(receipt => receipt.at <= at).reduce((sum, receipt) => sum + receipt.quantity, 0) - used >= units,
      '该补件尚无足量的客户实际签收');
  }
  const returned = done('return') + (step === 'return' ? units : 0);
  const delivered = done('delivery') + (step === 'delivery' ? units : 0);
  const complete = (remedy === 'resend' || returned === row.quantity) && (remedy === 'return' || delivered === row.quantity);
  return { operation: { remedy, result: step, parcelLineId: line.id, resolutionId, quantity: units, reference: line.reference,
    resendApprovalId: line.approvalId, decisionId: decision?.id ?? null, note: requiredText(data.note, '实物回执核对说明') },
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
  if (action === 'supplier') {
    const outcome = choice(data.outcome,['following','no_claim','resolved','financial_result'] as const,'供应商处理结果');
    const purchaseId = data.purchaseOrderId ? requiredText(data.purchaseOrderId, '对应采购单') : null;
    if (!purchaseId && outcome === 'no_claim') {
      const linked = await tx.purchaseOrder.count({ where: { orderId: view.order.id, OR: [
        {lines:{some:{orderItemId:row.orderItemId}}},{replacements:{some:{orderItemId:row.orderItemId}}}] } });
      condition(linked === 0, '本行有原采购记录，请选择对应供方核对');
      return { operation: { outcome, purchaseOrderId: null, note: requiredText(data.note,'无需向供方追偿的依据') }, supplierState: 'no_claim' };
    }
    condition(purchaseId, '请选择本行对应的采购单');
    const source = await tx.purchaseOrder.findFirst({ where: {id: purchaseId, orderId: view.order.id,
      OR: [{lines: {some: {orderItemId: row.orderItemId}}},{replacements: {some: {orderItemId: row.orderItemId}}}] }, select: { id: true } });
    condition(source, '这张采购单不属于原售后商品行');
    const financial = outcome === 'financial_result';
    return { operation: { outcome, purchaseOrderId: source.id, supplier: requiredText(data.supplier, '供应商主体'),
      ...(financial ? { amountCents: cents(data.amountCents), method: requiredText(data.method, '供方退款或抵扣方式'),
        referenceNo: requiredText(data.referenceNo, '供方实际回执号') } : {}), note: requiredText(data.note, '供应商独立处理凭据及结果') },
      supplierState: outcome === 'financial_result' ? 'resolved' : outcome };
  }
  condition(row.customerState !== 'closed','该客户事项已经办结，新增事项请另行登记并引用原单');
  if (action === 'technical') {
    condition(technicalIssue(row.issue) && ['reviewing','awaiting_technical','awaiting_customer'].includes(row.customerState),'当前事项无待核的技术意见');
    return { operation: { authority: choice(data.authority,['supplier','brand'] as const,'书面判断来源'), party: requiredText(data.party,'供应商或品牌技术部门'),
      contact: requiredText(data.contact,'出具意见的技术联系人'), note: requiredText(data.note,'技术方实际书面意见') }, customerState: 'awaiting_customer' };
  }
  if (action === 'agreement') return agreement(view,row,data,proof);
  if (action === 'physical') return physical(view,row,data,proof);
  if (action === 'prepare_refund' || action === 'approve_refund' || action === 'refund_result') return refundStep(tx,view,row,action,data,proof);
  if (action === 'invoice_outcome') {
    condition(row.customerState === 'awaiting_invoice','请先核对客户确认的票据处理要求');
    const financeEventId = requiredText(data.financeEventId,'已办完的票据更正记录');
    const outcome = await tx.financeEvent.findFirst({ where: { id: financeEventId, action: 'resolve_correction',
      invoice: { side: 'customer', allocations: { some: { plan: {orderId: view.order.id} } } } }, include: { invoice: true } });
    const confirmed = outcome && purchaseObject(jsonObject(outcome.detail).operation);
    condition(outcome?.invoice && confirmed?.sha256 === proof.sha256 && confirmed.occurredAt === proof.occurredAt && confirmed.reference === proof.reference,
      '请在票款页先登记实际票面处理，然后关联该原票的处理回执');
    return { operation: { financeEventId, originalNumber: outcome.invoice.number, issuer: outcome.invoice.issuer,
      result: confirmed.outcome, note: requiredText(data.note,'本行与实际票面处理的核对') }, customerState: 'awaiting_close' };
  }
  condition(action === 'close' && row.customerState === 'awaiting_close','须先取得本案所需的实际办理结果');
  return { operation: { note: requiredText(data.note,'办结依据、客户答复和实际处理结果'), supplierState: row.supplierState }, customerState: 'closed' };
}

export async function afterSaleAction(tx: Db, input: SaleInput, actor: SaleActor, confirmation?: {
  hash: string; authorization?: SaleAuthorization; customer?: boolean;
}, customer = false) {
  const { orderId, caseId, action, requestId, data } = input;
  const proof = saleProof(data);
  const requestKey = pricingContentHash({ action: 'after_sale', actor: actor.id, requestId });
  const intentHash = pricingContentHash({ action, orderId, caseId, data, actor: actor.id, customer });
  const natural = action === 'refund_result' && data.result === 'paid'
    ? { action, trace: requiredText(data.referenceNo,'退款回执流水').toUpperCase() }
    : action === 'supplier' && data.outcome === 'financial_result' ? { action, trace: requiredText(data.referenceNo,'供方实际回执').toUpperCase() }
    : { action, orderId, caseId, source: proof.sha256, row: proof.documentRow,
      ...(action === 'open' ? { item: data.orderItemId, shortfall: data.shortfallId ?? null }
        : action === 'physical' ? { parcelLineId: data.parcelLineId, resolutionId: data.resolutionId ?? null } : {}) };
  const businessKey = pricingContentHash(natural);
  const prior = await tx.afterSaleEvent.findMany({ where: { OR: [{requestKey},{businessKey}] } });
  if (prior.length) {
    const saved = prior[0];
    condition(prior.length === 1 && saved.businessKey === businessKey && saved.intentHash === intentHash, '这项操作或凭据已用于其他内容，请查看原记录');
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
  const snapshot = { action, orderId, caseId: row?.id ?? null, revision: row?.revision ?? null, item: line, owner: row?.ownerId ?? null,
    customer: { id: view.order.customerId, organization: view.order.organizationId, scope: view.order.ownerScope, email: view.order.email },
    orderTerms: view.order.termsVersion, previousState: row?.customerState ?? null, nextState: plan.customerState ?? row?.customerState ?? 'reported',
    nextSupplierState: plan.supplierState ?? row?.supplierState ?? 'unreviewed', scopeQuantity: opened?.quantity ?? row!.quantity,
    actor: actor.id, proof, operation };
  const actionHash = pricingContentHash(snapshot);
  if (!confirmation) return { actionHash, snapshot, caseId: row?.id ?? null, eventId: null, repeated: false };
  condition(confirmation.hash === actionHash,'原订单、售后进度或批准内容已变化，请重新预览');
  if (!customer) condition(confirmation.authorization?.permission === salePermission(input),'缺少服务端核实的经办权限和身份验证');
  const saved = opened ? await tx.afterSaleCase.create({ data: { ...opened, relatedCents: opened.relatedCents == null ? null : BigInt(opened.relatedCents),
    orderId, reportedAt: new Date(proof.occurredAt), sourceReference: proof.reference, sourceRow: proof.documentRow, sourceSha256: proof.sha256, createdBy: actor.id } }) : row!;
  if (!opened) {
    const updated = await tx.afterSaleCase.updateMany({ where: { id: saved.id, orderId, revision: saved.revision },
      data: { revision: { increment: 1 }, customerState: plan.customerState, supplierState: plan.supplierState, ownerId: plan.ownerId, shortfallId: plan.shortfallId } });
    condition(updated.count === 1,'售后记录已变化，请重新读取');
  }
  const event = await tx.afterSaleEvent.create({ data: { caseId: saved.id, action, actorId: actor.id, requestKey, businessKey, intentHash, approvedHash: actionHash,
    occurredAt: new Date(proof.occurredAt), reference: proof.reference, sha256: proof.sha256, documentRow: proof.documentRow,
    detail: JSON.stringify({ operation, snapshot, authorization: confirmation.authorization ?? null }) } });
  return { actionHash, snapshot, caseId: saved.id, eventId: event.id, repeated: false };
}
