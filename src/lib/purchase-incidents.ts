import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { incidentLineTotals, incidentQuantityKey, type IncidentCandidate, type IncidentQuantity, type IncidentSource } from '@/lib/purchase-incident-scope';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

type IncidentProgress = {
  scope: IncidentQuantity[];
  handled: IncidentQuantity[];
  outstanding: IncidentQuantity[];
  scopeBasis: 'recorded' | 'reviewed' | 'reviewed_disposition' | 'entire_contract';
};

export type IncidentLocation = { from: IncidentQuantity; to: IncidentQuantity };

export type IncidentReviewResult = 'scope_confirmed' | 'duplicate' | 'no_impact';

export type SupplyIncident = {
  id: string;
  reportedBy: string;
  reportVersion: string | null;
  status: 'open' | 'settled' | 'duplicate' | 'no_impact';
  linkedTo: string | null;
  reference: string;
  description: string;
  changeKind: string;
  previousStatus: string;
  responsibility: string | null;
  scope: IncidentQuantity[] | null;
  originalScope?: IncidentQuantity[] | null;
  dispatchScopeId?: string;
  outstanding: IncidentQuantity[] | null;
  lastReviewedBy: string | null;
  factReview: { reference: string; description: string; actorId: string } | null;
  shortfallFollowups?: {activityId:string;resolutionId:string;quantity:number;responsibility:string;description:string;reference:string;actorId:string}[];
};

export function locateIncidentQuantity(scope: IncidentQuantity[], {from,to}: IncidentLocation) {
  const fromKey=incidentQuantityKey(from), toKey=incidentQuantityKey(to);
  const current=scope.find(row=>incidentQuantityKey(row)===fromKey);
  if (!current || current.quantity<from.quantity || fromKey===toKey) return scope;
  const next=scope.flatMap(row=>{
    const key=incidentQuantityKey(row);
    if (key===fromKey) return row.quantity>from.quantity ? [{...row,quantity:row.quantity-from.quantity}] : [];
    return key===toKey ? [{...row,quantity:row.quantity+to.quantity}] : [row];
  });
  return scope.some(row=>incidentQuantityKey(row)===toKey) ? next : [...next,to];
}

export function supplyIncidentHistory(ledger: PurchaseActivity[]) {
  const history = new Map<string,SupplyIncident>();
  for (const row of ledger) {
    if (row.action !== 'report_change' && row.action !== 'review_change_scope' && row.action !== 'resolve_change'
      && row.action!=='locate_held_dispatch' && row.action!=='clear_held_dispatch') continue;
    const op = purchaseOperation(row.detail);
    const responsibility = typeof op.responsibility === 'string' ? op.responsibility : null;
    if (row.action === 'report_change') {
      const scope = Array.isArray(op.affectedLines) ? op.affectedLines as IncidentQuantity[] : null;
      const version = purchaseObject(row.detail.snapshot).version;
      history.set(row.id,{ id:row.id,reportedBy:row.actorId,reportVersion:typeof version==='string'?version:null,
        status:'open',linkedTo:null,reference:String(op.reference),description:String(op.description),
        changeKind:String(op.changeKind),previousStatus:String(op.previousStatus),responsibility,scope,originalScope:scope,outstanding:scope,
        lastReviewedBy:null,factReview:null });
      continue;
    }
    const incident = typeof op.incidentId === 'string' ? history.get(op.incidentId) : undefined;
    if (!incident || incident.status !== 'open') continue;
    const reviewed = {...incident,responsibility:responsibility ?? incident.responsibility,lastReviewedBy:row.actorId};
    if (row.action==='locate_held_dispatch' && incident.outstanding && incident.scope) {
      const location=op.location as IncidentLocation;
      history.set(incident.id,{...reviewed,scope:locateIncidentQuantity(incident.scope,location),
        outstanding:locateIncidentQuantity(incident.outstanding,location)});
    }
    if (row.action==='clear_held_dispatch' && incident.outstanding) {
      const location=op.location as IncidentLocation | undefined;
      const scope=location && incident.scope ? locateIncidentQuantity(incident.scope,location) : incident.scope;
      const outstanding=location ? locateIncidentQuantity(incident.outstanding,location)
        : subtractQuantities(incident.outstanding,[op.quantity as IncidentQuantity]);
      const followup=purchaseObject(op.followup);
      const shortfallFollowups=location?.to.source?.kind==='shortfall' && typeof followup.responsibility==='string'
        && typeof followup.description==='string' && typeof op.reference==='string'
        ? [...(incident.shortfallFollowups ?? []),{activityId:row.id,resolutionId:location.to.source.id,quantity:location.to.quantity,
          responsibility:followup.responsibility,description:followup.description,reference:op.reference,actorId:row.actorId}]
        : incident.shortfallFollowups;
      history.set(incident.id,{...reviewed,scope,status:outstanding.length?'open':'settled',outstanding,shortfallFollowups});
    }
    if (row.action === 'review_change_scope') {
      const factReview = {reference:String(op.reference),description:String(op.description),actorId:row.actorId};
      if (op.reviewResult === 'duplicate' || op.reviewResult === 'no_impact') {
        const linkedTo = op.reviewResult === 'duplicate' && typeof op.relatedIncidentId === 'string' ? op.relatedIncidentId : null;
        history.set(incident.id,{...reviewed,status:op.reviewResult,linkedTo,outstanding:[],factReview});
        if (linkedTo) for (const [id,entry] of history) {
          if (entry.linkedTo === incident.id) history.set(id,{...entry,linkedTo});
        }
      } else {
        history.set(incident.id,{...reviewed,scope:op.scope as IncidentQuantity[],originalScope:incident.originalScope ?? op.scope as IncidentQuantity[],outstanding:op.outstanding as IncidentQuantity[],factReview});
      }
    } else if (row.action==='resolve_change') {
      const progress = purchaseObject(op.incidentProgress) as Partial<IncidentProgress>;
      history.set(incident.id,{...reviewed,scope:progress.scope ?? incident.scope,originalScope:incident.originalScope ?? progress.scope,
        status:progress.outstanding?.length ? 'open' : 'settled',outstanding:progress.outstanding ?? []});
    }
  }
  return [...history.values()];
}

export function supplyIncidents(ledger: PurchaseActivity[]) {
  return supplyIncidentHistory(ledger).filter(row=>row.status==='open');
}

export function supplyIncidentsForDispatchAt(ledger: PurchaseActivity[], at: number) {
  const then = new Map(supplyIncidentHistory(ledger.filter(row=>Date.parse(row.createdAt)<=at)).map(row=>[row.id,row]));
  if (![...then.values()].some(row=>row.status==='open')) return [];
  const evidence = new Map(supplyIncidentHistory(ledger).map(row=>[row.id,row]));
  const links = new Map(ledger.flatMap(activity=>{
    if (activity.action!=='review_change_scope') return [];
    const op = purchaseOperation(activity.detail);
    return op.reviewResult==='duplicate' && typeof op.incidentId==='string' && typeof op.relatedIncidentId==='string'
      ? [[op.incidentId,{id:op.relatedIncidentId,scope:op.previousOutstanding as IncidentQuantity[] | null}] as const] : [];
  }));
  function historicalShares(id: string, visited=new Set<string>()): SupplyIncident[] {
    const earlier=then.get(id), known=evidence.get(id);
    const incident=earlier ?? known;
    if (!incident || earlier?.status==='settled' || earlier?.status==='no_impact') return [];
    if (visited.has(id)) return [{...incident,outstanding:null}];
    const scope=earlier?.outstanding ?? known?.originalScope ?? null;
    const link=links.get(id);
    if (!link) return scope || known?.status!=='no_impact' ? [{...incident,outstanding:scope}] : [];
    const linked=historicalShares(link.id,new Set([...visited,id]));
    if (!scope || earlier?.status==='duplicate') return linked;
    // Only the share matched at this review uses the linked history. Each other share retains its own dates.
    const common=new Map((link.scope ?? []).map(row=>[incidentQuantityKey(row),row.quantity]));
    const independent=scope.flatMap(row=>{
      const quantity=row.quantity-(common.get(incidentQuantityKey(row)) ?? 0);
      return quantity>0 ? [{...row,quantity}] : [];
    });
    const cap=new Map(scope.map(row=>[incidentQuantityKey(row),Math.min(row.quantity,common.get(incidentQuantityKey(row)) ?? 0)]));
    const shared=linked.flatMap(entry=>{
      if (!entry.outstanding) return [];
      const outstanding=entry.outstanding.flatMap(row=>{
        const key=incidentQuantityKey(row);
        const quantity=Math.min(row.quantity,cap.get(key) ?? 0);
        cap.set(key,(cap.get(key) ?? 0)-quantity);
        return quantity>0 ? [{...row,quantity}] : [];
      });
      return outstanding.length ? [{...entry,outstanding}] : [];
    });
    const unresolvedMatch=linked.some(row=>!row.outstanding) ? scope.flatMap(row=>{
      const quantity=cap.get(incidentQuantityKey(row)) ?? 0;
      return quantity>0 ? [{...row,quantity}] : [];
    }) : [];
    return [{...incident,outstanding:[...independent,...unresolvedMatch]},...shared];
  }
  const grouped = new Map<string,SupplyIncident>();
  for (const earlier of then.values()) {
    if (earlier.status!=='open') continue;
    for (const share of historicalShares(earlier.id)) {
      if (share.outstanding && !share.outstanding.length) continue;
      const current=grouped.get(share.id);
      if (!current || !share.outstanding) grouped.set(share.id,{
        ...share,id:then.has(share.id) ? share.id : earlier.id,dispatchScopeId:share.id,
      });
      else if (current.outstanding) {
        const quantities=new Map(current.outstanding.map(row=>[incidentQuantityKey(row),row]));
        for (const row of share.outstanding) {
          const key=incidentQuantityKey(row);
          if (row.quantity>(quantities.get(key)?.quantity ?? 0)) quantities.set(key,row);
        }
        grouped.set(share.id,{...current,outstanding:[...quantities.values()]});
      }
    }
  }
  for (const row of ledger) {
    if (row.action!=='review_change_scope' && row.action!=='locate_held_dispatch') continue;
    const op=purchaseOperation(row.detail);
    if (Date.parse(row.createdAt)<=at && (row.action==='review_change_scope' || op.incidentId)) continue;
    // Exact physical shares already assigned to a parcel cannot be reused by an earlier-dated entry.
    // Neither that assignment nor a warehouse lot identification changes the dates of the commercial decisions.
    const located=row.action==='locate_held_dispatch' ? [op.historicalLocation as IncidentLocation]
      : Array.isArray(op.lotLocations) ? op.lotLocations as IncidentLocation[] : [];
    const id=row.action==='locate_held_dispatch' ? op.historicalIncidentId : op.incidentId;
    for (const [key,issue] of grouped) {
      if (key!==id && issue.id!==id && key!==op.incidentId) continue;
      if (issue.outstanding) grouped.set(key,{...issue,outstanding:located.reduce(locateIncidentQuantity,issue.outstanding)});
    }
  }
  return [...grouped.values()];
}

export function incidentLink(incident: SupplyIncident, history: SupplyIncident[], relatedId: string | undefined) {
  const selected = history.find(row=>row.id===relatedId);
  const canonical = selected?.linkedTo ? history.find(row=>row.id===selected.linkedTo) : selected;
  if (!canonical || canonical.id===incident.id || (canonical.status!=='open' && canonical.status!=='settled')) {
    throw new PurchaseError('请选择同一采购单的原供货事项，不能关联本事项或无影响记录');
  }
  if (incident.outstanding?.length) {
    const coverage = canonical.scope;
    if (!coverage || incident.outstanding.some(row=>!coverage.some(original=>
      incidentQuantityKey(row)===incidentQuantityKey(original) && row.quantity<=original.quantity))) {
      throw new PurchaseError('本事项还包含原事项未覆盖的货物，请核对独立范围后再关联');
    }
  }
  return canonical;
}

function readSource(raw: unknown): IncidentSource | undefined {
  if (raw === undefined) return undefined;
  const {kind,id} = purchaseObject(raw);
  if (kind === 'unshipped' && id === undefined) return {kind};
  if ((kind === 'parcel' || kind === 'receipt' || kind === 'shortfall' || kind === 'resend') && typeof id === 'string' && id) return {kind,id};
  throw new PurchaseError('请核对这一份货物的实际来源',400);
}

export function incidentQuantities(values: unknown, available: ReadonlyArray<IncidentQuantity>, label: string) {
  if (!Array.isArray(values) || !values.length) throw new PurchaseError('请逐行填写'+label,400);
  const selected = new Map<string,number>();
  for (const raw of values) {
    const {orderItemId, quantity, source:rawSource} = purchaseObject(raw);
    if (typeof orderItemId !== 'string' || !positiveCents(quantity)) {
      throw new PurchaseError(label+'须对应本单中的实际商品行与正整数数量',400);
    }
    const source = readSource(rawSource);
    const matches = available.filter(row => row.orderItemId === orderItemId && (source === undefined
      || incidentQuantityKey(row) === incidentQuantityKey({orderItemId,quantity,source})));
    if (matches.length > 1) throw new PurchaseError('同一商品行有多份货物，请选择本次对应的实际来源');
    const match = matches[0];
    if (!match || quantity > match.quantity) throw new PurchaseError(label+'超出对应采购行或货物来源的可核对数量');
    const key = incidentQuantityKey(match);
    if (selected.has(key)) throw new PurchaseError(label+'不能重复填写同一份货物',400);
    selected.set(key,quantity);
  }
  return available.flatMap(row => {
    const quantity = selected.get(incidentQuantityKey(row));
    return quantity === undefined ? [] : [{orderItemId:row.orderItemId,quantity,...(row.source ? {source:row.source} : {})}];
  });
}

export function availableIncidentSources(candidates: readonly IncidentCandidate[], incidents: readonly SupplyIncident[], exceptId?: string) {
  const reserved = incidents.filter(row=>row.id!==exceptId).flatMap(row=>row.outstanding ?? []);
  return candidates.flatMap(row=>{
    const key = incidentQuantityKey(row);
    const used = reserved.filter(held=>incidentQuantityKey(held)===key).reduce((sum,held)=>sum+held.quantity,0);
    return row.quantity>used ? [{...row,quantity:row.quantity-used}] : [];
  });
}

function subtractQuantities(initial: readonly IncidentQuantity[], used: readonly IncidentQuantity[]) {
  const booked = new Map(used.map(row => [incidentQuantityKey(row),row.quantity]));
  return initial.flatMap(row => {
    const quantity = row.quantity-(booked.get(incidentQuantityKey(row)) ?? 0);
    return quantity > 0 ? [{...row,quantity}] : [];
  });
}

export function clarifiedIncidentScope(incident: SupplyIncident, outstanding: IncidentQuantity[]) {
  const previous = subtractQuantities(incident.scope ?? [],incident.outstanding ?? []);
  const merged = new Map(previous.map(row=>[incidentQuantityKey(row),row]));
  for (const row of outstanding) {
    const key = incidentQuantityKey(row);
    merged.set(key,{...row,quantity:row.quantity+(merged.get(key)?.quantity ?? 0)});
  }
  return [...merged.values()];
}

export function heldIncidentQuantity(incidents: readonly SupplyIncident[], orderItemId: string, source: IncidentSource) {
  const key = incidentQuantityKey({orderItemId,quantity:0,source});
  return incidents.reduce((total,incident) => total + (incident.outstanding ?? []).reduce((sum,row) => {
    if (row.orderItemId !== orderItemId) return sum;
    const olderHoldApplies = !row.source && (source.kind !== 'receipt'
      || (incident.changeKind !== 'delay' && incident.changeKind !== 'unavailable'));
    return sum + (olderHoldApplies || incidentQuantityKey(row) === key ? row.quantity : 0);
  },0),0);
}

export function resolveIncidentScope(
  incident: SupplyIncident,
  input: { affectedLines?: IncidentQuantity[]; coordinationLines?: IncidentQuantity[]; confirmsFullIncidentScope?: boolean },
  available: ReadonlyArray<IncidentQuantity>, documented: IncidentQuantity[] | undefined,
): IncidentProgress {
  const { affectedLines, coordinationLines } = input;
  const confirmsFullScope = input.confirmsFullIncidentScope === true;
  if (confirmsFullScope && (affectedLines !== undefined || !documented?.length)) {
    throw new PurchaseError('请选择一种方式核对原事项的完整范围',400);
  }
  let scopeBasis: IncidentProgress['scopeBasis'] = 'recorded';
  let scope = incident.scope;
  if (!scope) {
    const combined = documented ? incidentLineTotals(documented) : undefined;
    if (affectedLines !== undefined) {
      scope = affectedLines;
      scopeBasis = 'reviewed';
    } else if (confirmsFullScope) {
      scope = incidentQuantities(combined,available,'本次处置已涵盖的原事项范围');
      scopeBasis = 'reviewed_disposition';
    } else if (combined?.length && combined.length === available.length
      && available.every(line => combined.some(row => row.orderItemId === line.orderItemId && row.quantity === line.quantity))) {
      scope = combined;
      scopeBasis = 'entire_contract';
    } else {
      throw new PurchaseError('请先核对原供货事项全部涉及的采购行与数量，再确认本次处理范围');
    }
  } else if (affectedLines !== undefined || confirmsFullScope) {
    throw new PurchaseError('该供货事项的原影响范围已登记，请核对仍未办理的部分');
  }
  const pending = incident.outstanding ?? scope;
  const selected = coordinationLines !== undefined ? incidentQuantities(coordinationLines,pending,'本次处理数量') : undefined;
  const effects = documented && (pending.some(row=>row.source) ? documented : incidentLineTotals(documented));
  const handled = effects ? incidentQuantities(effects,pending,'实际处置数量') : selected ?? pending;
  if (selected && effects && (selected.length !== handled.length || selected.some((row,i)=>
    incidentQuantityKey(row) !== incidentQuantityKey(handled[i]) || row.quantity !== handled[i].quantity))) {
    throw new PurchaseError('本次处理数量与实际取消、替代或修订的范围不一致');
  }
  if (!effects) incidentQuantities(incidentLineTotals(handled),available,'本次协调结果涉及数量');
  return {scope,handled,outstanding:subtractQuantities(pending,handled),scopeBasis};
}
