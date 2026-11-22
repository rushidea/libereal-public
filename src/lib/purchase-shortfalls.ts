import { purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { jsonObject } from '@/lib/order-catalog-repricing';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export type ShortfallDecision = 'free_resend' | 'change_contract' | 'new_purchase';
type DecisionRow = { orderItemId: string; quantity: number; shortfallId?: string; shortfallDecision?: ShortfallDecision; forwardingLossId?: string };
type SourceQuantity = { purchaseOrderId: string; orderItemId: string; quantity: number };
const sourceKey = (purchaseOrderId: string, orderItemId: string) => JSON.stringify([purchaseOrderId,orderItemId]);

export async function purchaseShortfalls(tx: Db, orderId: string, activities: PurchaseActivity[]) {
  const decisions = activities.flatMap(row => {
    if (!row.purchaseOrderId || row.action !== 'resolve_change') return [];
    const operation = purchaseOperation(row.detail);
    if (!Array.isArray(operation.dispositions)) return [];
    return (operation.dispositions as DecisionRow[]).flatMap(line => {
      const shortfallId = line.shortfallId ?? line.forwardingLossId;
      const kind = line.shortfallDecision ?? (line.forwardingLossId ? 'new_purchase' : null);
      return shortfallId && kind && positiveCents(line.quantity) ? [{ approvalId: row.id, purchaseOrderId: row.purchaseOrderId!,
        orderItemId: line.orderItemId, authorizedAt: row.createdAt, shortfallId, kind, quantity: line.quantity }] : [];
    });
  });
  const parcels = await tx.fulfillmentParcel.findMany({ where: { orderId, route: {
    in: ['supplier_to_customer','supplier_to_libereal','libereal_to_customer'],
  } }, include: {
    lines: { include: { sourceReceipt: { select: { parcelLineId: true } }, resolutions: { include: {
      event: { select: { occurredAt: true, reference: true } },
    } } } },
    events: { where: { kind: 'dispatch', status: 'applied' }, select: { details: true } },
  }, orderBy: [{ dispatchedAt: 'asc' }, { id: 'asc' }] });
  const supplied = new Map<string,SourceQuantity>();
  const companyParcels = parcels.flatMap(parcel => parcel.lines.flatMap(line => line.purchaseOrderId
    ? [{ parcel, line, purchaseOrderId: line.purchaseOrderId }] : []));
  const free = decisions.filter(row => row.kind === 'free_resend');
  const resent = new Map<string,number>();
  const complimentaryLines = new Set<string>();
  for (const {parcel,line,purchaseOrderId} of companyParcels) {
    if (parcel.route === 'libereal_to_customer') continue;
    const { lines } = jsonObject(parcel.events[0]?.details);
    const dispatch = Array.isArray(lines) ? lines.find(row => row?.purchaseOrderId === purchaseOrderId && row.orderItemId === line.orderItemId
      && (!row.parcelLineId || row.parcelLineId === line.id)) : undefined;
    if (dispatch?.resendApprovalId) {
      const authorized = free.find(row => row.approvalId === dispatch.resendApprovalId && row.purchaseOrderId === purchaseOrderId
        && row.orderItemId === line.orderItemId);
      if (!authorized) throw new PurchaseError('补发包裹缺少对应的采购批准');
      const key = sourceKey(authorized.approvalId,line.orderItemId);
      const quantity = (resent.get(key) ?? 0) + line.quantity;
      if (quantity > authorized.quantity) throw new PurchaseError('已登记的补发超过书面核准数量');
      resent.set(key,quantity);
      complimentaryLines.add(line.id);
    } else {
      const key = sourceKey(purchaseOrderId,line.orderItemId);
      supplied.set(key,{ purchaseOrderId, orderItemId: line.orderItemId, quantity: (supplied.get(key)?.quantity ?? 0)+line.quantity });
    }
  }
  const shortfalls = companyParcels.flatMap(({ parcel,line,purchaseOrderId }) => line.resolutions.map(resolution => {
    const tied = decisions.filter(row => row.shortfallId === resolution.id && row.purchaseOrderId === purchaseOrderId
      && row.orderItemId === line.orderItemId);
    const originalContract = !complimentaryLines.has(line.sourceReceipt?.parcelLineId ?? line.id);
    const amended = tied.filter(row => row.kind === 'change_contract').reduce((sum,row) => sum+row.quantity,0);
    if (amended && originalContract) {
      const source = supplied.get(sourceKey(purchaseOrderId,line.orderItemId));
      if (!source || amended > source.quantity) throw new PurchaseError('合同变更数量超出原采购书证');
      source.quantity -= amended;
    }
    return { resolutionId: resolution.id, orderItemId: line.orderItemId, purchaseOrderId, route: parcel.route, originalContract,
      quantity: resolution.quantity, reference: resolution.event.reference, occurredAt: resolution.event.occurredAt.toISOString(),
      available: Math.max(0,resolution.quantity - tied.reduce((sum,row) => sum+row.quantity,0)),
      independentlyReplaced: tied.filter(row => row.kind === 'new_purchase').reduce((sum,row) => sum+row.quantity,0) };
  }));
  return { supplierDispatched: [...supplied.values()], shortfalls,
    freeResends: free.map(row => ({ ...row, available: Math.max(0,row.quantity - (resent.get(sourceKey(row.approvalId,row.orderItemId)) ?? 0)) })) };
}
