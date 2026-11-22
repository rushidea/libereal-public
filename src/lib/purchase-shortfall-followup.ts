import { addPurchaseActivity, purchaseObject, purchaseOperation, type PurchaseActivity, type PurchaseActor } from '@/lib/purchase-activity';
import { incidentQuantityKey, type IncidentQuantity } from '@/lib/purchase-incident-scope';
import type { SupplyIncident } from '@/lib/purchase-incidents';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';

export type DispatchShortfall = {
  purchaseOrderId: string;
  orderItemId: string;
  parcelId: string;
  parcelLineId: string;
  incidentId: string;
  originalIncidentId?: string;
  resolutionId: string;
  quantity: number;
  occurredAt: string;
};
export type SavedDispatchShortfall = DispatchShortfall & {
  key: string;
  reviewEventId: string;
  reference: string;
  sha256: string;
};

type Purchase = {
  id: string;
  version: string;
  revision: number;
  status: string;
  orderedBefore: boolean;
  ledger: PurchaseActivity[];
  incidents: SupplyIncident[];
  incidentHistory: SupplyIncident[];
};

export function shortfallPart(target: DispatchShortfall, quantity=target.quantity): IncidentQuantity {
  return { orderItemId:target.orderItemId,quantity,source:{kind:'shortfall',id:target.resolutionId} };
}

export function dispatchShortfallKey(reviewEventId: string, target: DispatchShortfall) {
  const { purchaseOrderId,parcelLineId,incidentId,resolutionId }=target;
  return pricingContentHash({reviewEventId,purchaseOrderId,parcelLineId,incidentId,resolutionId});
}

type DecisionLink = { activityId:string; quantity:number };
type Transfer = { incidentId:string; from:IncidentQuantity };

function finishedDecisions(ledger: PurchaseActivity[], target: DispatchShortfall) {
  const documented: Array<DecisionLink & {incidentId:string}>=[];
  const originalTerms=new Map<string,typeof documented>();
  const targetKey=incidentQuantityKey(shortfallPart(target));
  const digest=(value:unknown)=>typeof value==='string' && /^[a-f\d]{64}$/i.test(value);
  for (const row of ledger) {
    if (row.action!=='resolve_change' || Date.parse(row.createdAt)<Date.parse(target.occurredAt) || !digest(row.detail.actionHash)) continue;
    const op=purchaseOperation(row.detail);
    if (typeof op.incidentId!=='string' || !digest(op.supplierSha256) || !digest(op.customerSha256)
      || !op.supplierReference || !op.customerReference) continue;
    if (op.outcome==='original_terms') {
      const handled=purchaseObject(op.incidentProgress).handled;
      if (!Array.isArray(handled)) continue;
      const amount=handled.filter(part=>positiveCents(part?.quantity) && incidentQuantityKey(part)===targetKey)
        .reduce((sum,part)=>sum+part.quantity,0);
      if (amount) originalTerms.set(op.incidentId,[...(originalTerms.get(op.incidentId) ?? []),{activityId:row.id,incidentId:op.incidentId,quantity:amount}]);
    } else if (Array.isArray(op.dispositions)) {
      const amount=op.dispositions.filter(part=>part?.orderItemId===target.orderItemId && positiveCents(part.quantity)
        && !part.revisesResendApprovalId && (part.shortfallId===target.resolutionId || part.forwardingLossId===target.resolutionId))
        .reduce((sum,part)=>sum+part.quantity,0);
      if (amount) documented.push({activityId:row.id,incidentId:op.incidentId,quantity:amount});
    }
  }
  const total=(rows:typeof documented)=>rows.reduce((sum,row)=>sum+row.quantity,0);
  // A terms confirmation and a replacement disposition may both refer to the same pieces.
  return [...originalTerms.values()].reduce((best,rows)=>total(rows)>total(best) ? rows : best,documented);
}

function remainingDecisionLinks(purchase: Purchase, target: DispatchShortfall, used: number, staged:DecisionLink[]) {
  const knownDecisions=new Map<string,number>();
  const knownIncidents=new Map<string,number>();
  function reserve(bucket:Map<string,number>,id:unknown,quantity:unknown) {
    if (typeof id==='string' && positiveCents(quantity)) bucket.set(id,(bucket.get(id) ?? 0)+quantity);
  }
  for (const row of staged) reserve(knownDecisions,row.activityId,row.quantity);
  let explained=0;
  for (const row of purchase.ledger) {
    const op=purchaseOperation(row.detail);
    const previous=purchaseObject(op.shortfallHandoff);
    if (previous.resolutionId!==target.resolutionId || previous.parcelLineId!==target.parcelLineId || !positiveCents(previous.quantity)) continue;
    explained+=previous.quantity;
    if (Array.isArray(previous.decisionLinks)) for (const link of previous.decisionLinks) reserve(knownDecisions,link.activityId,link.quantity);
    if (Array.isArray(previous.existingIncidents)) for (const link of previous.existingIncidents) reserve(knownIncidents,link.incidentId,link.quantity);
    if (row.action==='report_change' && Array.isArray(op.affectedLines)) reserve(knownIncidents,row.id,op.affectedLines[0]?.quantity);
  }
  let remaining=target.quantity;
  let unassigned=Math.max(0,used-explained);
  return finishedDecisions(purchase.ledger,target).flatMap(row=>{
    const reserved=Math.min(row.quantity,knownDecisions.get(row.activityId) ?? 0);
    const caseBalance=knownIncidents.get(row.incidentId) ?? 0;
    const caseReserved=Math.min(row.quantity-reserved,caseBalance);
    knownIncidents.set(row.incidentId,caseBalance-caseReserved);
    const notAttributed=Math.min(unassigned,row.quantity-reserved-caseReserved);
    unassigned-=notAttributed;
    const quantity=Math.min(remaining,row.quantity-reserved-caseReserved-notAttributed);
    remaining-=quantity;
    return quantity>0 ? [{activityId:row.activityId,quantity}] : [];
  });
}

function boundOutstanding(ledger: PurchaseActivity[], issue:SupplyIncident, sourceKey:string, resolutionId:string) {
  const links=new Map((issue.shortfallFollowups ?? []).filter(row=>row.resolutionId===resolutionId)
    .map(row=>[row.activityId,row.quantity]));
  let remaining=0;
  for (const row of ledger) {
    remaining+=links.get(row.id) ?? 0;
    if (!remaining || row.action!=='resolve_change') continue;
    const op=purchaseOperation(row.detail);
    const handled=purchaseObject(op.incidentProgress).handled;
    if (op.incidentId!==issue.id || !Array.isArray(handled)) continue;
    const quantity=handled.filter(part=>positiveCents(part?.quantity) && incidentQuantityKey(part)===sourceKey)
      .reduce((sum,part)=>sum+part.quantity,0);
    remaining=Math.max(0,remaining-quantity);
  }
  return remaining;
}

export function planShortfallFollowup(purchase: Purchase, target: DispatchShortfall, previouslyReviewed: number,
  stagedTransfers: Transfer[] = [], stagedDecisionLinks: DecisionLink[] = [],
) {
  if (!purchase.orderedBefore || purchase.id!==target.purchaseOrderId) throw new PurchaseError('请核对短失实际对应的原采购单');
  const missing=shortfallPart(target);
  const missingKey=incidentQuantityKey(missing);
  const parcel: IncidentQuantity={...missing,source:{kind:'parcel',id:target.parcelLineId}};
  const parcelKey=incidentQuantityKey(parcel);
  const location=purchase.ledger.filter(row=>row.action==='locate_held_dispatch').map(row=>purchaseOperation(row.detail)).find(op=>
    op.historicalIncidentId===target.incidentId && incidentQuantityKey((op.location as {to:IncidentQuantity}).to)===parcelKey);
  const original=purchase.incidentHistory.find(row=>row.id===(location?.incidentId ?? target.incidentId));
  const currentOriginal=original?.linkedTo ?? original?.id;
  const decisionLinks=remainingDecisionLinks(purchase,target,previouslyReviewed,stagedDecisionLinks);
  let remaining=target.quantity-decisionLinks.reduce((sum,row)=>sum+row.quantity,0);
  const transfers: Transfer[]=[];
  for (const issue of purchase.incidents) for (const part of issue.outstanding ?? []) {
    const key=incidentQuantityKey(part);
    const onOriginalParcel=key===parcelKey && issue.id===currentOriginal;
    if (key!==missingKey && !onOriginalParcel) continue;
    const alreadyLinked=onOriginalParcel ? 0 : boundOutstanding(purchase.ledger,issue,missingKey,target.resolutionId);
    const reservedQuantity=stagedTransfers.filter(row=>row.incidentId===issue.id && incidentQuantityKey(row.from)===key)
      .reduce((sum,row)=>sum+row.from.quantity,0);
    const quantity=Math.min(remaining,Math.max(0,part.quantity-alreadyLinked-reservedQuantity));
    if (!quantity) continue;
    transfers.push({incidentId:issue.id,from:{...part,quantity}});
    remaining-=quantity;
  }
  return { target,previousStatus:purchase.status,version:purchase.version,revision:purchase.revision,
    decisionLinks,transfers,reportQuantity:remaining };
}

export type ShortfallFollowupPlan = ReturnType<typeof planShortfallFollowup>;
type FollowupProof = { reference:string;description:string;responsibility:string;occurredAt:string;sha256?:string };

export async function recordShortfallFollowup(
  tx: Db, orderId:string, plan:ShortfallFollowupPlan, reviewEventId:string, evidence:FollowupProof, actor:PurchaseActor,
  metadata?:{requestKey:string;detail:Record<string,unknown>},
) {
  const {target,previousStatus,revision,reportQuantity,transfers,decisionLinks}=plan;
  const {purchaseOrderId,orderItemId}=target;
  const key=dispatchShortfallKey(reviewEventId,target);
  const shortfallHandoff={key,reviewEventId,...target,decisionLinks,
    existingIncidents:transfers.map(row=>({incidentId:row.incidentId,quantity:row.from.quantity}))};
  const changed=await tx.$executeRaw`UPDATE PurchaseOrder
    SET status=CASE WHEN ${reportQuantity}>0 THEN 'on_hold' ELSE status END,revision=revision+1,updatedAt=${new Date().toISOString()}
    WHERE id=${purchaseOrderId} AND orderId=${orderId} AND revision=${revision}`;
  if (changed!==1) throw new PurchaseError('采购单或依据已有变化，请刷新并核对当前版本');
  const {reference,occurredAt,sha256,responsibility,description}=evidence;
  for (const row of transfers) {
    const to=shortfallPart(target,row.from.quantity);
    await addPurchaseActivity(tx,{orderId,purchaseOrderId,orderItemId,actor,action:'clear_held_dispatch',
      detail:{snapshot:{operation:{incidentId:row.incidentId,quantity:row.from,location:{from:row.from,to},reference,occurredAt,sha256,
        shortfallHandoffKey:key,followup:{responsibility,description}}}}});
  }
  const action=reportQuantity ? 'report_change' : 'link_dispatch_shortfall';
  const operation={ action,changeKind:'other',previousStatus,...evidence,shortfallHandoff,
    affectedLines:reportQuantity ? [shortfallPart(target,reportQuantity)] : undefined };
  return addPurchaseActivity(tx,{orderId,purchaseOrderId,orderItemId,actor,action,requestKey:metadata?.requestKey,
    detail:{...metadata?.detail,authorizedPreview:metadata?.detail.snapshot,
      snapshot:{...purchaseObject(metadata?.detail.snapshot),version:plan.version,operation}}});
}

export function unlinkedShortfall(review: SavedDispatchShortfall, ledger: PurchaseActivity[], used: Map<string,number>) {
  const expected=incidentQuantityKey(shortfallPart(review));
  let quantity=review.quantity;
  for (const row of ledger) {
    if (row.purchaseOrderId!==review.purchaseOrderId) continue;
    const op=purchaseOperation(row.detail);
    if (purchaseObject(op.shortfallHandoff).key===review.key) return undefined;
    if (row.action!=='clear_held_dispatch' || op.shortfallHandoffKey || op.reference!==review.reference || op.sha256!==review.sha256
      || !purchaseObject(op.followup).responsibility) continue;
    const to=purchaseObject(op.location).to as IncidentQuantity | undefined;
    if (!to || !positiveCents(to.quantity) || incidentQuantityKey(to)!==expected) continue;
    const consumed=used.get(row.id) ?? 0;
    const linked=Math.min(quantity,Math.max(0,to.quantity-consumed));
    used.set(row.id,consumed+linked);
    quantity-=linked;
  }
  return quantity>0 ? {...review,quantity} : undefined;
}
