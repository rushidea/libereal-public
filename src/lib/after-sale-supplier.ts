import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { financeIdentity } from '@/lib/finance-workspace';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { type SaleCase, type AfterSaleWorkspace, originalSaleParcel, originalSaleParcelShares, caseEvents, saleOperation } from '@/lib/after-sale-workspace';
import { allocateAfterSaleTransfer } from '@/lib/after-sale-transfers';

export async function supplierAfterSale(tx: Db, view: AfterSaleWorkspace, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const outcome = choice(data.outcome, ['following','no_claim','resolved','financial_result'] as const, '供应商处理结果');
  const purchasing = await purchaseWorkspace(tx, view.order.id);
  const sources = purchasing.orders.filter(po => po.orderReceipt?.lines.some(line => line.orderItemId === row.orderItemId));
  const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
  const shares = originalSaleParcelShares(row);
  const selected = data.originalParcelLineId ?? (shares.length === 1 ? shares[0].parcelLineId : originalSaleParcel(row));
  const original = view.deliveries.find(item => item.id === selected && item.orderItemId===row.orderItemId);
  condition(!selected || original && (!shares.length || shares.some(part => part.parcelLineId === original.id)), '请核对本案指定的原实际包裹');
  const affectedPurchase = loss?.purchaseOrderId ?? original?.purchaseOrderId;
  const note = requiredText(data.note, '供应商独立处理凭据及结果');
  if (outcome === 'no_claim' && !data.purchaseOrderId) {
    condition(!affectedPurchase && !sources.length, '本行有原采购记录，请选择对应供方核对');
    return { operation: { outcome, purchaseOrderId: null, note }, supplierState: 'no_claim' };
  }
  condition(affectedPurchase || sources.length<=1, '本商品有多张原采购记录，须凭实际运单确定本案相关供方');
  const purchase = sources.find(po => po.id === data.purchaseOrderId);
  condition(purchase && (!affectedPurchase || purchase.id === affectedPurchase), '这张采购单不属于原售后商品行或本案实际来源');
  const ordered = purchase.orderReceipt?.lines.find(line => line.orderItemId === row.orderItemId);
  const line = purchase?.lines.find(line => line.orderItemId === row.orderItemId);
  const supplier = requiredText(data.supplier, '供应商主体');
  condition(ordered && line?.terms.supplier
    && financeIdentity(supplier) === financeIdentity(line.terms.supplier) && purchase.orderReceipt!.occurredAt! <= proof.occurredAt,
    '对应采购承诺、履约来源、原商品行及供应商主体须一致');
  const subject = { outcome, purchaseOrderId: purchase.id, orderItemId: row.orderItemId, supplier: line.terms.supplier,
    originalParcelLineId: original?.id ?? null, shortfallId: loss?.resolutionId ?? null,
    receipt: purchase.orderReceipt!.reference, note };
  if (outcome !== 'financial_result') return { operation: subject, supplierState: outcome };
  const money = { amountCents: cents(data.amountCents), method: requiredText(data.method, '供方退款或抵扣方式'),
    destination: requiredText(data.destination, '实收的 Libereal 去向或抵扣出处'), referenceNo: requiredText(data.referenceNo, '实际退款或抵扣流水') };
  const existing = view.cases.filter(item => item.orderItemId === row.orderItemId)
    .flatMap(item => caseEvents(item, 'supplier').map(saleOperation))
    .filter(op => op.outcome === 'financial_result' && op.purchaseOrderId === purchase.id)
    .reduce((sum, op) => sum + cents(op.amountCents), 0);
  condition(typeof ordered.payableCents === 'number' && existing + money.amountCents <= ordered.payableCents,
    '供方实际处理金额超过该采购行原书面金额，须另行核对');
  const transfer = await allocateAfterSaleTransfer(tx, {
    direction: 'supplier_return', method: money.method, party: line.terms.supplier, destination: money.destination,
    referenceNo: money.referenceNo,
  }, data, proof, money.amountCents);
  return { operation: { ...subject, ...money, transfer }, supplierState: 'resolved' };
}
