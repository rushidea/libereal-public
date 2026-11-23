import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import { positiveCents, requiredText } from '@/lib/purchase-terms';
import { cents, condition, type SaleEvidence } from '@/lib/after-sale-records';

export function transferReference(value: unknown) {
  return requiredText(value, '实际交易流水').normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
}

type SupplierTransferScope = { orderId: string; purchaseOrderId: string; orderItemId: string; originalParcelLineId: string | null; shortfallId: string | null };
type ActualTransfer = { method: string; party: string; destination: string; referenceNo: string } & (
  { direction: 'customer_refund' } | { direction: 'supplier_return'; supplierScope?: SupplierTransferScope }
);

function overlapsSupplierShare(scope: SupplierTransferScope, orderId: string, op: Record<string,unknown>) {
  if (orderId!==scope.orderId || op.purchaseOrderId!==scope.purchaseOrderId || op.orderItemId!==scope.orderItemId) return false;
  // An old transfer with no proved parcel or shortfall cannot release any unproved share of this purchase line.
  if (!op.originalParcelLineId && !op.shortfallId || !scope.originalParcelLineId && !scope.shortfallId) return true;
  if (op.shortfallId && scope.shortfallId) return op.shortfallId===scope.shortfallId;
  if (op.originalParcelLineId && scope.originalParcelLineId) return op.originalParcelLineId===scope.originalParcelLineId;
  return true;
}

export async function allocateAfterSaleTransfer(tx: Db, terms: ActualTransfer, data: Record<string, unknown>,
  evidence: SaleEvidence, amountCents: number,
) {
  const trace = transferReference(terms.referenceNo);
  const totalCents = data.transferTotalCents == null ? amountCents : cents(data.transferTotalCents);
  const allocationReference = data.allocationReference == null && totalCents === amountCents
    ? terms.referenceNo : requiredText(data.allocationReference, '该笔实际款的本行分摊依据');
  const rows = await tx.afterSaleEvent.findMany({ where: { action: { in: ['refund_result', 'supplier'] } },
    select: { id: true, action: true, sha256: true, documentRow: true, occurredAt: true, detail: true, case:{select:{orderId:true}} } });
  const candidates = rows.flatMap(row => {
    const op = purchaseObject(jsonObject(row.detail).operation);
    if (!(row.action === 'refund_result' ? op.result === 'paid' : op.outcome === 'financial_result')) return [];
    const actual = purchaseObject(op.transfer);
    const sameSource = row.sha256 === evidence.sha256 && row.documentRow === evidence.documentRow;
    const sameTrace = typeof op.referenceNo === 'string' && transferReference(op.referenceNo) === trace;
    if (!(sameSource || sameTrace)) return [];
    return [{ row, op, actual }];
  });
  let allocatedBeforeCents = 0;
  for (const { row, op, actual } of candidates) {
    condition(actual.trace === trace && actual.direction === terms.direction && actual.method === terms.method
      && actual.party === terms.party && actual.destination === terms.destination && actual.totalCents === totalCents
      && row.sha256 === evidence.sha256 && row.documentRow === evidence.documentRow && row.occurredAt.toISOString() === evidence.occurredAt,
    '该流水或原件行已有记录，须按同笔实收或实退的原金额、日期、对方及去向核对');
    condition(actual.allocationReference !== allocationReference.normalize('NFKC').trim(), '该笔实际款的这条分摊依据已登记');
    if (terms.direction==='supplier_return' && terms.supplierScope) {
      condition(!overlapsSupplierShare(terms.supplierScope,row.case.orderId,op), '该笔供方流水已用于这个采购及原包裹份额，请核对原记录');
    }
    condition(positiveCents(op.amountCents), '原分摊金额待财务核对');
    allocatedBeforeCents += op.amountCents;
  }
  condition(allocatedBeforeCents + amountCents <= totalCents, '分摊合计超过同一笔凭据的真实交易总额');
  return { ...terms, trace, totalCents, allocatedBeforeCents, allocationReference: allocationReference.normalize('NFKC').trim(),
    unallocatedAfterCents: totalCents - allocatedBeforeCents - amountCents };
}
