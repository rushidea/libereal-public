import { financeIdentity } from '@/lib/finance-workspace';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { positiveCents, requiredText } from '@/lib/purchase-terms';
import { condition, type SaleEvidence } from '@/lib/after-sale-records';
import { afterSaleCaseInclude, caseEvents, currentSaleAgreement, originalSaleParcelShares, saleOperation, type AfterSaleWorkspace, type SaleCase } from '@/lib/after-sale-workspace';

export async function approveAfterSaleExchange(tx: Db, view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const approvedForCustomer = currentSaleAgreement(row);
  const decision = approvedForCustomer && saleOperation(approvedForCustomer);
  const shares = originalSaleParcelShares(row);
  const parcelLineId = data.parcelLineId ?? (shares.length === 1 ? shares[0].parcelLineId : null);
  const original = view.deliveries.find(line => line.id === parcelLineId && line.orderItemId === row.orderItemId && !line.afterSaleApprovalId);
  condition(row.customerState === 'awaiting_fulfillment' && view.order.acceptance && approvedForCustomer && decision?.remedy === 'exchange'
    && (!['quality','technical'].includes(row.issue) || decision.technicalId) && decision.returnRequirement && !decision.replacement && !decision.replacements && original?.purchaseOrderId,
  '请先核对原件实际签收、具名技术意见、客户的换货决定及供货来源');
  const scope = shares.filter(item => item.parcelLineId === original.id).reduce((sum,item) => sum + item.quantity,0);
  const prior = caseEvents(row, 'approve_exchange').map(saleOperation).filter(op => op.agreementId === approvedForCustomer.id
    && op.originalParcelLineId === original.id).reduce((sum, op) => sum + Number(op.quantity ?? 0),0);
  const amount = data.quantity === undefined && shares.length === 1 ? scope : data.quantity;
  condition(positiveCents(amount) && amount <= scope - prior, '本次免费换货超过该原包裹尚未批准的份额');
  condition(Date.parse(proof.occurredAt) >= approvedForCustomer.occurredAt.getTime() && data.freeOfCharge === true
    && data.returnRequirement === decision.returnRequirement, '供方书证须明确本次免费换货及与客户一致的退回条件');
  const received = original.receipts.filter(receipt => receipt.at <= Date.parse(proof.occurredAt)).reduce((sum, receipt) => sum + receipt.quantity, 0);
  const used = view.cases.flatMap(item => {
    const effective = currentSaleAgreement(item)?.id;
    return caseEvents(item,'approve_exchange').filter(event=>saleOperation(event).agreementId===effective
      || view.deliveries.some(line=>line.afterSaleApprovalId===event.id)).map(saleOperation);
  }).filter(op => op.originalParcelLineId === original.id).reduce((sum, op) => sum + Number(op.quantity ?? 0), 0);
  condition(amount <= received - used, '已获准换货数量超过该原包裹中实际签收的商品');
  if (decision.returnRequirement === 'required') {
    const returned = caseEvents(row,'physical').map(saleOperation).filter(op=>op.result==='return' && op.parcelLineId===original.id)
      .reduce((sum, op)=>sum+Number(op.quantity ?? 0), 0);
    condition(returned >= prior + amount, '客户确认的换货条件要求先核对原件实际退回');
  }
  const purchase = (await purchaseWorkspace(tx, row.orderId)).orders.find(po => po.id === original.purchaseOrderId);
  const line = purchase?.lines.find(item => item.orderItemId === row.orderItemId);
  condition(purchase && purchase.orderReceipt?.lines.some(item => item.orderItemId === row.orderItemId) && line?.terms.supplier
    && financeIdentity(line.terms.supplier) === financeIdentity(requiredText(data.supplier,'具体供货主体'))
    && (line.source.productId || line.source.catalogNumber), '换货须对应原实际供货方与可核实的原商品身份');
  return { operation: { agreementId: approvedForCustomer.id, technicalId: decision.technicalId, originalParcelLineId: original.id,
    purchaseOrderId: purchase.id, orderItemId: row.orderItemId, quantity: amount, supplier: line.terms.supplier,
    productId: line.source.productId ?? null, variantId: line.source.variantId ?? null, catalogNumber: line.source.catalogNumber ?? null,
    name: line.source.name, returnRequirement:decision.returnRequirement, freeOfCharge: true, caseId: row.id, note: requiredText(data.note, '供方免费换货的书面条件和责任') } };
}

export async function afterSaleExchangeApprovals(tx: Db, orderId: string) {
  const approvals = await tx.afterSaleEvent.findMany({ where: { action: 'approve_exchange', case: { orderId } },
    include: { case: { include: afterSaleCaseInclude }, exchangeParcels: { select: { quantity: true, sourceReceiptId: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return approvals.flatMap(event => {
    const op = saleOperation(event);
    const actor = purchaseObject(jsonObject(event.detail).authorization);
    if (!event.approvedHash || actor.permission !== 'purchases.approve' || event.case.customerState !== 'awaiting_fulfillment'
      || currentSaleAgreement(event.case)?.id !== op.agreementId || op.orderItemId !== event.case.orderItemId || !positiveCents(op.quantity)
      || typeof op.purchaseOrderId !== 'string' || typeof op.supplier !== 'string' || typeof op.name !== 'string'
      || op.freeOfCharge !== true) return [];
    const shipped = event.exchangeParcels.filter(line => !line.sourceReceiptId).reduce((sum,line)=>sum+line.quantity,0);
    return [{ id: event.id, caseId: event.caseId, orderItemId: event.case.orderItemId, purchaseOrderId: op.purchaseOrderId,
      supplier: op.supplier, name: op.name, productId: typeof op.productId === 'string' ? op.productId : null,
      variantId: typeof op.variantId === 'string' ? op.variantId : null, catalogNumber: typeof op.catalogNumber === 'string' ? op.catalogNumber : null,
      quantity: op.quantity, available: Math.max(0, op.quantity - shipped),
      authorizedAt: new Date(Math.max(event.createdAt.getTime(), event.occurredAt.getTime())).toISOString(), version: event.approvedHash }];
  });
}
