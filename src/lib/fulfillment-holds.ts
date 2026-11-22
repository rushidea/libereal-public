import { availableReceipt } from '@/lib/fulfillment-records';
import { purchaseObject } from '@/lib/purchase-activity';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export type HoldAssignment = { incidentId: string; quantity: number };
type Event = { kind: string; status: string; details: string; createdAt: Date };

export function readHoldAssignments(raw: unknown): HoldAssignment[] | undefined {
  if (raw===undefined) return undefined;
  if (!Array.isArray(raw) || !raw.length) throw new PurchaseError('请指定实际发出的暂停份额和原事项',400);
  const assignments=raw.map(item=>{
    const {incidentId,quantity}=purchaseObject(item);
    if (typeof incidentId!=='string' || !incidentId || !positiveCents(quantity)) throw new PurchaseError('暂停份额须对应原供货事项和实际数量',400);
    return {incidentId,quantity};
  });
  if (new Set(assignments.map(row=>row.incidentId)).size!==assignments.length) throw new PurchaseError('同一份暂停数量只需登记一次',400);
  return assignments.sort((a,b)=>a.incidentId.localeCompare(b.incidentId));
}

function details(event: Event | undefined) {
  return event ? purchaseObject(JSON.parse(event.details)) : {};
}

export function dispatchHoldFacts(events: Event[]) {
  const dispatch=details(events.find(row=>row.kind==='dispatch' && row.status==='applied'));
  const isPending=purchaseObject(dispatch.holdReview).status==='pending';
  const decisions=events.filter(row=>row.kind==='review_dispatch_hold' && row.status==='applied').flatMap(row=>{
    const facts=details(row).holdDecisions;
    return Array.isArray(facts) ? facts.map(item=>({...item,recordedAt:row.createdAt})) : [];
  });
  return Array.isArray(dispatch.lines) ? dispatch.lines.flatMap(raw=>{
    const line=purchaseObject(raw);
    const old=purchaseObject(line.unreleased);
    if (typeof line.parcelLineId!=='string' || !positiveCents(old.quantity) || !Array.isArray(old.incidentIds)) return [];
    const matched=decisions.filter(row=>row.parcelLineId===line.parcelLineId);
    const assigned=Array.isArray(line.holdAssignments) ? line.holdAssignments as HoldAssignment[]
      : matched.find(row=>row.outcome==='identify')?.assignments as HoldAssignment[] | undefined;
    const resolved=matched.filter(row=>row.outcome!=='identify');
    const quantity=old.quantity;
    const pending=isPending ? Math.max(0,quantity-resolved.reduce((sum,row)=>sum+row.quantity,0)) : 0;
    const pendingAssignments=isPending ? assigned?.flatMap(part=>{
      const remaining=part.quantity-resolved.filter(row=>row.incidentId===part.incidentId).reduce((sum,row)=>sum+row.quantity,0);
      return remaining>0 ? [{incidentId:part.incidentId,quantity:remaining}] : [];
    }) : [];
    return [{parcelLineId:line.parcelLineId,quantity,pending,isPending,incidentIds:old.incidentIds as string[],
      assignments:assigned,pendingAssignments,resendApprovalId:typeof line.resendApprovalId==='string'?line.resendApprovalId:undefined,
      decisions:resolved as Array<{receiptId?:string;resolutionId?:string;incidentId?:string;quantity:number;outcome:string;recordedAt:Date}>}];
  }) : [];
}

export function forwardableHeldReceipt(
  facts: ReturnType<typeof dispatchHoldFacts>[number] | undefined,
  receipt: {id:string;quantity:number;forwardedQuantity:number;releasedQuantity:number},
  at?: number,
) {
  const physicallyAvailable=availableReceipt(receipt);
  if (!facts?.isPending) return physicallyAvailable;
  const associated=facts.decisions.filter(row=>row.receiptId===receipt.id && (at===undefined || row.recordedAt.getTime()<=at));
  const agreed=associated.filter(row=>row.outcome==='continue').reduce((sum,row)=>sum+row.quantity,0);
  const resolvedOutsideOrder=associated.filter(row=>row.outcome==='return' || row.outcome==='release_to_stock')
    .reduce((sum,row)=>sum+row.quantity,0);
  const releasedFromAgreed=Math.max(0,receipt.releasedQuantity-resolvedOutsideOrder);
  return Math.max(0,Math.min(physicallyAvailable,agreed-receipt.forwardedQuantity-releasedFromAgreed));
}
