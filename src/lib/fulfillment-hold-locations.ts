import { addPurchaseActivity, purchaseOperation, readPurchaseActivities } from '@/lib/purchase-activity';
import { incidentQuantityKey, type IncidentQuantity, type IncidentSource } from '@/lib/purchase-incident-scope';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { supplyIncidentHistory } from '@/lib/purchase-incidents';
import type { HoldAssignment } from '@/lib/fulfillment-holds';
import type { FulfillmentActor, FulfillmentDb as Db } from '@/lib/fulfillment-records';

type OwnedLine = {
  purchaseOrderId: string;
  orderItemId: string;
  parcelLineId: string;
  source: IncidentSource;
  assignments: HoldAssignment[];
};
type Evidence = { occurredAt: string; reference: string; sha256: string };

export async function locateHeldDispatch(tx: Db, orderId: string, lines: OwnedLine[], {occurredAt,reference,sha256}: Evidence, actor: FulfillmentActor) {
  const touched=new Set<string>();
  for (const line of lines) for (const assignment of line.assignments) {
    const ledger=(await readPurchaseActivities(tx,orderId)).filter(row=>row.purchaseOrderId===line.purchaseOrderId);
    const history=supplyIncidentHistory(ledger);
    const original=history.find(row=>row.id===assignment.incidentId);
    const issue=original?.linkedTo ? history.find(row=>row.id===original.linkedTo) : original;
    const expected={orderItemId:line.orderItemId,source:line.source,quantity:assignment.quantity};
    const matched=issue?.outstanding?.find(row=>row.quantity>=assignment.quantity && row.orderItemId===line.orderItemId
      && (!row.source || incidentQuantityKey(row)===incidentQuantityKey(expected)));
    const from=matched ? {...matched,quantity:assignment.quantity} : expected;
    const to={...expected,source:{kind:'parcel' as const,id:line.parcelLineId}};
    await addPurchaseActivity(tx,{orderId,purchaseOrderId:line.purchaseOrderId,actor,action:'locate_held_dispatch',
      detail:{snapshot:{operation:{incidentId:matched && issue?.status==='open' ? issue.id : undefined,
        historicalIncidentId:assignment.incidentId,location:{from,to},historicalLocation:{from:expected,to},occurredAt,reference,sha256}}}});
    touched.add(line.purchaseOrderId);
  }
  for (const id of touched) await touch(tx,id,orderId);
}

export async function clearHeldDispatchShare(
  tx: Db, orderId: string, line: Omit<OwnedLine,'source'|'assignments'> & {quantity:number;receiptId?:string;resolutionId?:string}, historicalIncidentId: string, {occurredAt,reference,sha256}: Evidence, actor: FulfillmentActor,
) {
  const {purchaseOrderId,orderItemId,parcelLineId,quantity}=line;
  const ledger=(await readPurchaseActivities(tx,orderId)).filter(row=>row.purchaseOrderId===purchaseOrderId);
  const located: IncidentQuantity={orderItemId,source:{kind:'parcel',id:parcelLineId},quantity};
  const applied=ledger.filter(row=>row.action==='locate_held_dispatch').map(row=>purchaseOperation(row.detail)).find(op=>
    op.historicalIncidentId===historicalIncidentId && incidentQuantityKey((op.location as {to:IncidentQuantity}).to)===incidentQuantityKey(located));
  const history=supplyIncidentHistory(ledger);
  const earlier=history.find(issue=>issue.id===(applied?.incidentId ?? historicalIncidentId));
  const issue=earlier?.linkedTo ? history.find(issue=>issue.id===earlier.linkedTo) : earlier;
  if (issue?.status!=='open' || !issue.outstanding) return;
  const origins=line.receiptId ? [{...located,source:{kind:'receipt' as const,id:line.receiptId}},located] : [located];
  let remaining=quantity;
  for (const origin of origins) {
    const outstanding=issue.outstanding.find(item=>incidentQuantityKey(item)===incidentQuantityKey(origin));
    const affected=Math.min(remaining,outstanding?.quantity ?? 0);
    if (!affected) continue;
    const from={...origin,quantity:affected};
    const location=line.resolutionId ? {from,to:{...from,source:{kind:'shortfall' as const,id:line.resolutionId}}} : undefined;
    await addPurchaseActivity(tx,{orderId,purchaseOrderId,actor,action:'clear_held_dispatch',
      detail:{snapshot:{operation:{incidentId:issue.id,quantity:from,location,occurredAt,reference,sha256}}}});
    remaining-=affected;
  }
  if (remaining===quantity) return;
  await touch(tx,purchaseOrderId,orderId);
  const purchase=(await purchaseWorkspace(tx,orderId)).orders.find(row=>row.id===purchaseOrderId);
  if (purchase?.status==='on_hold' && purchase.orderedBefore && !purchase.incidents.length && !purchase.needsRemainingReview
    && !purchase.needsLegacyReview && (purchase.commitmentState==='ordinary' || purchase.commitmentState==='payable_verified')) {
    await tx.$executeRaw`UPDATE PurchaseOrder SET status='ordered' WHERE id=${purchaseOrderId} AND orderId=${orderId} AND status='on_hold'`;
  }
}

function touch(tx: Db, id: string, orderId: string) {
  return tx.$executeRaw`UPDATE PurchaseOrder SET revision=revision+1,updatedAt=${new Date().toISOString()} WHERE id=${id} AND orderId=${orderId}`;
}
