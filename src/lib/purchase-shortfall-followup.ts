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

function quantityOf(parts:unknown,key:string) {
  if (!Array.isArray(parts)) return undefined;
  const matches=parts.filter(part=>part && incidentQuantityKey(part)===key);
  if (matches.length===0) return 0;
  if (matches.length===1 && positiveCents(matches[0].quantity)) return matches[0].quantity as number;
  return undefined;
}

const digest = (value:unknown) => typeof value==='string' && /^[a-f\d]{64}$/i.test(value);

type LossSource = Pick<DispatchShortfall,'orderItemId'|'resolutionId'|'occurredAt'>;

function approvedDisposition(op:Record<string,unknown>,target:LossSource) {
  return Array.isArray(op.dispositions) ? op.dispositions.filter(part=>part?.orderItemId===target.orderItemId
    && positiveCents(part.quantity) && !part.revisesResendApprovalId
    && (part.shortfallId===target.resolutionId || part.forwardingLossId===target.resolutionId))
    .reduce((sum,part)=>sum+part.quantity,0) : 0;
}

function reserve(bucket:Map<string,number>,id:unknown,quantity:unknown) {
  if (typeof id==='string' && positiveCents(quantity)) bucket.set(id,(bucket.get(id) ?? 0)+quantity);
}

type SourceScope = {
  remaining: number | undefined;
  linked: number;
  assigned: number;
  unclearPlacement: number;
  chain: DecisionLink[];
  decisions: DecisionLink[];
};

function shortfallCoverage(ledger:PurchaseActivity[], target:LossSource, used:number, staged:DecisionLink[]) {
  const key=incidentQuantityKey({orderItemId:target.orderItemId,quantity:1,source:{kind:'shortfall',id:target.resolutionId}});
  const scopes=new Map<string,SourceScope>();
  const chains: DecisionLink[][]=[];
  const joined=new Map<DecisionLink[],DecisionLink[]>();
  const dispositions: DecisionLink[]=[];
  const linkedToDecision=new Map<string,number>();
  const linkedBeforeMerge: Array<{activities:Set<string>;quantity:number}>=[];
  const caseForDecision=new Map<string,SourceScope>();
  let accounted=0;

  function newChain() {
    const chain:DecisionLink[]=[];
    chains.push(chain);
    return chain;
  }

  function setRemaining(scope:SourceScope, quantity:number|undefined) {
    const stillLinked=Math.min(scope.linked,quantity ?? 0);
    const removed=scope.linked-stillLinked;
    const unclear=Math.min(scope.unclearPlacement,removed);
    accounted-=removed-unclear;
    scope.unclearPlacement-=unclear;
    scope.linked=stillLinked;
    scope.remaining=quantity;
  }

  function attach(id:unknown,quantity:unknown) {
    if (typeof id!=='string' || !positiveCents(quantity)) return 0;
    const scope=scopes.get(id);
    if (scope?.remaining===undefined) return 0;
    const assigned=Math.min(quantity,Math.max(0,scope.remaining-scope.linked));
    scope.linked+=assigned;
    scope.assigned+=assigned;
    return assigned;
  }

  for (const row of staged) reserve(linkedToDecision,row.activityId,row.quantity);
  for (const row of ledger) {
    const op=purchaseOperation(row.detail);
    const incidentId=typeof op.incidentId==='string' ? op.incidentId : undefined;
    const scope=incidentId ? scopes.get(incidentId) : undefined;
    if (row.action==='report_change') {
      scopes.set(row.id,{remaining:quantityOf(op.affectedLines,key),linked:0,assigned:0,unclearPlacement:0,chain:newChain(),decisions:[]});
    }

    const handoff=purchaseObject(op.shortfallHandoff);
    if (handoff.resolutionId===target.resolutionId && handoff.orderItemId===target.orderItemId && positiveCents(handoff.quantity)) {
      let left=handoff.quantity;
      if (Array.isArray(handoff.decisionLinks)) for (const link of handoff.decisionLinks) {
        if (typeof link?.activityId!=='string' || !positiveCents(link.quantity)) continue;
        const existing=caseForDecision.get(link.activityId);
        const quantity=Math.min(left,link.quantity);
        reserve(linkedToDecision,link.activityId,quantity);
        if (existing) existing.assigned+=quantity;
        left-=quantity;
      }
      if (Array.isArray(handoff.existingIncidents)) for (const link of handoff.existingIncidents) {
        if (positiveCents(link?.quantity)) left-=attach(link.incidentId,Math.min(left,link.quantity));
      }
      if (row.action==='report_change') left-=attach(row.id,Math.min(left,quantityOf(op.affectedLines,key) ?? 0));
      accounted+=handoff.quantity-left;
    }
    if (!scope || !incidentId) continue;

    if (row.action==='locate_held_dispatch' || row.action==='clear_held_dispatch') {
      const location=purchaseObject(op.location);
      const from=quantityOf([location.from],key) ?? 0;
      const to=quantityOf([location.to],key) ?? 0;
      if (to>from && scope.chain.length) scope.chain=newChain();
      if (scope.remaining!==undefined || to>0) setRemaining(scope,Math.max(0,(scope.remaining ?? 0)-from+to));
      if (row.action==='clear_held_dispatch' && !op.shortfallHandoffKey && to && purchaseObject(op.followup).responsibility) {
        accounted+=attach(incidentId,to);
      }
      continue;
    }

    if (row.action==='review_change_scope') {
      if (op.reviewResult==='scope_confirmed') {
        const after=quantityOf(op.outstanding,key);
        if (after===undefined || (scope.remaining!==undefined && after>scope.remaining)) scope.chain=newChain();
        setRemaining(scope,after);
      } else if (op.reviewResult==='duplicate' && typeof op.relatedIncidentId==='string') {
        const related=scopes.get(op.relatedIncidentId);
        const common=quantityOf(op.previousOutstanding,key);
        const extent=quantityOf(purchaseObject(op.relatedIncident).scope,key);
        if (related && common && extent && common<=extent && scope.remaining===common) {
          const alreadyLinked=Math.min(scope.linked,common);
          const relatedOpen=related.remaining ?? 0;
          const relatedCovered=related.chain.reduce((sum,row)=>sum+row.quantity,0);
          const openRoom=Math.max(0,relatedOpen-related.linked);
          const transferredOpen=Math.min(alreadyLinked,openRoom);
          const transferredClosed=related.decisions.length ? Math.min(alreadyLinked,Math.max(0,extent-relatedOpen)) : 0;
          // The reports can merge. Their separately handed-off physical quantities still add up.
          const moved=Math.min(alreadyLinked,Math.max(0,extent-related.assigned),transferredOpen+transferredClosed);
          const open=Math.min(moved,transferredOpen);
          const settled=moved-open;
          if (settled) linkedBeforeMerge.push({
            activities:new Set(related.decisions.map(row=>row.activityId)),quantity:settled,
          });
          // A partial merge can leave the identity of the open and settled pieces unclear.
          // Reserve the open space, and count the same uncertain assignment just once across decisions.
          const earlierUnclear=Math.min(scope.unclearPlacement,moved);
          const laterUnclear=transferredClosed ? open : Math.min(open,earlierUnclear);
          accounted+=earlierUnclear-laterUnclear;
          scope.unclearPlacement-=earlierUnclear;
          related.unclearPlacement+=laterUnclear;
          related.linked+=open;
          related.assigned+=moved;
          if (common===extent && relatedCovered+relatedOpen<=extent && scope.chain!==related.chain) joined.set(scope.chain,related.chain);
          scope.linked-=moved;
        }
        setRemaining(scope,0);
      } else if (op.reviewResult==='no_impact') setRemaining(scope,0);
      continue;
    }

    if (row.action!=='resolve_change') continue;
    const progress=purchaseObject(op.incidentProgress);
    const handled=quantityOf(progress.handled,key);
    const after=quantityOf(progress.outstanding,key);
    const statedScope=quantityOf(progress.scope,key);
    const before=scope.remaining ?? (progress.scopeBasis==='reviewed' ? statedScope : undefined);
    const factualTransition=before!==undefined && handled!==undefined && after!==undefined && statedScope!==undefined
      && before<=statedScope && before===handled+after;
    const approved=Date.parse(row.createdAt)>=Date.parse(target.occurredAt) && digest(row.detail.actionHash)
      && digest(op.supplierSha256) && digest(op.customerSha256) && op.supplierReference && op.customerReference;
    const disposition=approved ? approvedDisposition(op,target) : 0;
    if (disposition) dispositions.push({activityId:row.id,quantity:disposition});
    const quantity=approved && handled && (op.outcome==='original_terms' || disposition===handled) ? handled : 0;
    const linked=Math.min(scope.linked,handled ?? disposition);
    const unclear=Math.min(scope.unclearPlacement,linked);
    if (quantity || disposition) {
      reserve(linkedToDecision,row.id,linked);
      caseForDecision.set(row.id,scope);
      accounted+=unclear;
    } else accounted-=linked-unclear;
    scope.unclearPlacement-=unclear;
    scope.linked-=linked;
    if (!factualTransition) scope.chain=newChain();
    if (quantity) {
      const decision={activityId:row.id,quantity};
      if (factualTransition) scope.chain.push(decision);
      else if (op.outcome==='original_terms') chains.push([decision]);
      scope.decisions.push(decision);
    }
    setRemaining(scope,after);
  }

  const groups=chains.map(chain=>{
    const proof=[...chain];
    const visited=new Set([chain]);
    for (let next=joined.get(chain);next && !visited.has(next);next=joined.get(next)) {
      proof.push(...next);
      visited.add(next);
    }
    return proof;
  });
  // Approval of primary shortfall dispositions already consumes the shared physical-loss balance.
  groups.push(dispositions);
  return {groups,linkedToDecision,linkedBeforeMerge,scopes,unassigned:Math.max(0,used-accounted)};
}

function availableDecisionLinks(coverage:ReturnType<typeof shortfallCoverage>, quantity:number) {
  let strongest:DecisionLink[]=[];
  let count=0;
  const alreadyUsed=[...coverage.linkedToDecision.values()].reduce((sum,used)=>sum+used,0);
  for (const group of coverage.groups) {
    const late=coverage.linkedBeforeMerge.map(row=>({...row}));
    let matched=0;
    const possible=group.map(row=>{
      const linked=Math.min(row.quantity,coverage.linkedToDecision.get(row.activityId) ?? 0);
      matched+=linked;
      let available=row.quantity-linked;
      for (const reservation of late) {
        if (!reservation.activities.has(row.activityId)) continue;
        const assigned=Math.min(available,reservation.quantity);
        reservation.quantity-=assigned;
        available-=assigned;
      }
      return {...row,quantity:available};
    });
    // An earlier use remains spent even when a later request selects a different proof group.
    // A group outside that use must prove enough shares to cover the possible overlap.
    let unassigned=coverage.unassigned+alreadyUsed-matched
      +late.reduce((sum,row)=>sum+row.quantity,0);
    let remaining=quantity;
    const links=possible.flatMap(row=>{
      const uncertain=Math.min(row.quantity,unassigned);
      unassigned-=uncertain;
      const allocated=Math.min(remaining,row.quantity-uncertain);
      remaining-=allocated;
      return allocated>0 ? [{activityId:row.activityId,quantity:allocated}] : [];
    });
    if (quantity-remaining>count) { strongest=links;count=quantity-remaining; }
  }
  return strongest;
}

export function assertShortfallAssignmentMerge(
  ledger:PurchaseActivity[], from:SupplyIncident, into:SupplyIncident, actualLosses:LossSource[],
) {
  for (const part of from.outstanding ?? []) {
    if (part.source?.kind!=='shortfall') continue;
    const lossId=part.source.id;
    const source=actualLosses.find(loss=>loss.resolutionId===lossId && loss.orderItemId===part.orderItemId);
    if (!source) continue;
    const {scopes}=shortfallCoverage(ledger,source,0,[]);
    const moving=Math.min(part.quantity,scopes.get(from.id)?.linked ?? 0);
    const capacity=quantityOf(into.scope,incidentQuantityKey(part)) ?? 0;
    if (moving && moving+(scopes.get(into.id)?.assigned ?? 0)>capacity) {
      throw new PurchaseError('归并范围不足以覆盖已经分别接办的短失数量，请核对书面范围并保留仍待办理的份额');
    }
  }
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
  const coverage=shortfallCoverage(purchase.ledger,target,previouslyReviewed,stagedDecisionLinks);
  const decisionLinks=availableDecisionLinks(coverage,target.quantity);
  let remaining=target.quantity-decisionLinks.reduce((sum,row)=>sum+row.quantity,0);
  const transfers: Transfer[]=[];
  for (const issue of purchase.incidents) for (const part of issue.outstanding ?? []) {
    const key=incidentQuantityKey(part);
    const onOriginalParcel=key===parcelKey && issue.id===currentOriginal;
    if (key!==missingKey && !onOriginalParcel) continue;
    const alreadyLinked=onOriginalParcel ? 0 : (coverage.scopes.get(issue.id)?.linked ?? 0);
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
