import { purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { jsonObject } from '@/lib/order-catalog-repricing';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export type ShortfallDecision = 'free_resend' | 'change_contract' | 'new_purchase';
type DecisionRow = {
  orderItemId: string; quantity: number; shortfallId?: string; shortfallDecision?: ShortfallDecision;
  forwardingLossId?: string; revisesResendApprovalId?: string;
};
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
        orderItemId: line.orderItemId, authorizedAt: row.createdAt, shortfallId, kind, quantity: line.quantity,
        revisesResendApprovalId: line.revisesResendApprovalId }] : [];
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
  const replacements = await tx.purchaseReplacementLine.findMany({ where: { orderId },
    select: { purchaseOrderId: true, orderItemId: true, fromPurchaseOrderId: true, authorizationId: true } });
  const approved = new Map(decisions.map(row => [sourceKey(row.approvalId,row.orderItemId),row]));
  const replacementOrigins = new Map<string,string>();
  for (const row of replacements) {
    const decision = approved.get(sourceKey(row.authorizationId,row.orderItemId));
    if (decision?.purchaseOrderId === row.fromPurchaseOrderId && decision.kind !== 'free_resend') {
      replacementOrigins.set(sourceKey(row.purchaseOrderId,row.orderItemId),decision.shortfallId);
    }
  }
  const companyParcels = parcels.flatMap(parcel => parcel.lines.flatMap(line => line.purchaseOrderId
    ? [{ parcel, line, purchaseOrderId: line.purchaseOrderId }] : []));
  const supplied = new Map<string,SourceQuantity>();
  const resendDispatches = new Map<string,number>();
  const diverted = new Map<string,number>();
  const complimentaryLines = new Set<string>();
  const followupOrigins = new Map<string,string>();
  for (const {parcel,line,purchaseOrderId} of companyParcels) {
    if (parcel.route === 'libereal_to_customer') continue;
    const { lines } = jsonObject(parcel.events[0]?.details);
    const dispatch = Array.isArray(lines) ? lines.find(row => row?.purchaseOrderId === purchaseOrderId && row.orderItemId === line.orderItemId
      && (!row.parcelLineId || row.parcelLineId === line.id)) : undefined;
    if (dispatch?.resendApprovalId) {
      const key = sourceKey(dispatch.resendApprovalId,line.orderItemId);
      const authorization = approved.get(key);
      if (authorization?.kind !== 'free_resend' || authorization.purchaseOrderId !== purchaseOrderId) {
        throw new PurchaseError('补发包裹缺少对应的采购批准');
      }
      resendDispatches.set(key,(resendDispatches.get(key) ?? 0) + line.quantity);
      complimentaryLines.add(line.id);
      followupOrigins.set(line.id,authorization.shortfallId);
    } else {
      const key = sourceKey(purchaseOrderId,line.orderItemId);
      supplied.set(key,{ purchaseOrderId, orderItemId: line.orderItemId, quantity: (supplied.get(key)?.quantity ?? 0)+line.quantity });
      const origin = replacementOrigins.get(key);
      if (origin) followupOrigins.set(line.id,origin);
    }
  }
  for (const decision of decisions) {
    if (!decision.revisesResendApprovalId) continue;
    const key = sourceKey(decision.revisesResendApprovalId,decision.orderItemId);
    const previous = approved.get(key);
    if (decision.kind === 'free_resend' || previous?.kind !== 'free_resend' || previous.purchaseOrderId !== decision.purchaseOrderId
      || previous.shortfallId !== decision.shortfallId) throw new PurchaseError('改办记录缺少对应的原免费重发批准');
    diverted.set(key,(diverted.get(key) ?? 0) + decision.quantity);
  }

  const resolutionOrigins = new Map(companyParcels.flatMap(({parcel,line}) => line.resolutions.map(row => [
    row.id, { route: parcel.route, kind: row.kind, previous: followupOrigins.get(line.id) },
  ] as const)));
  // Direct dispatch and warehouse receipt have already replaced the original reservation.
  // Unreceived inbound goods inherit the reservation history from the exact earlier shortfall, if any.
  function originalHoldAlreadyMoved(shortfallId: string) {
    const seen = new Set<string>();
    let current: string | undefined = shortfallId;
    while (current) {
      const origin = resolutionOrigins.get(current);
      if (!origin || seen.has(current)) throw new PurchaseError('补货缺少可回查的原物流短失依据');
      if (origin.route !== 'supplier_to_libereal' || origin.kind === 'return') return true;
      seen.add(current);
      current = origin.previous;
    }
    return false;
  }
  const parcelLinesWithPriorHoldTransfer = [...followupOrigins].filter(([,origin]) => originalHoldAlreadyMoved(origin)).map(([lineId]) => lineId);
  const replacementsWithPriorHoldTransfer = replacements.filter(row => {
    const origin = replacementOrigins.get(sourceKey(row.purchaseOrderId,row.orderItemId));
    return origin ? originalHoldAlreadyMoved(origin) : false;
  }).map(({purchaseOrderId,orderItemId}) => ({purchaseOrderId,orderItemId}));

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
    const claimed = tied.reduce((sum,row) => sum + (row.revisesResendApprovalId ? 0 : row.quantity),0);
    return { resolutionId: resolution.id, orderItemId: line.orderItemId, purchaseOrderId, route: parcel.route, originalContract,
      quantity: resolution.quantity, reference: resolution.event.reference, occurredAt: resolution.event.occurredAt.toISOString(),
      available: Math.max(0,resolution.quantity - claimed),
      independentlyReplaced: tied.filter(row => row.kind === 'new_purchase').reduce((sum,row) => sum+row.quantity,0) };
  }));
  const freeResends = decisions.filter(row => row.kind === 'free_resend').map(row => {
    const key = sourceKey(row.approvalId,row.orderItemId);
    const dispatched = resendDispatches.get(key) ?? 0;
    const redirected = diverted.get(key) ?? 0;
    const available = row.quantity - dispatched - redirected;
    if (available < 0) throw new PurchaseError('已登记的免费重发或改办超过书面核准数量');
    return { ...row, dispatched, redirected, available, originalHoldAlreadyMoved: originalHoldAlreadyMoved(row.shortfallId) };
  });
  return { supplierDispatched: [...supplied.values()], shortfalls, freeResends, parcelLinesWithPriorHoldTransfer, replacementsWithPriorHoldTransfer };
}
