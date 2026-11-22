import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { incidentLineTotals, incidentQuantityKey, type IncidentCandidate, type IncidentQuantity, type IncidentSource } from '@/lib/purchase-incident-scope';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

type IncidentProgress = {
  scope: IncidentQuantity[];
  handled: IncidentQuantity[];
  outstanding: IncidentQuantity[];
  scopeBasis: 'recorded' | 'reviewed' | 'reviewed_disposition' | 'entire_contract';
};

export type SupplyIncident = {
  id: string;
  reportedBy: string;
  reference: string;
  description: string;
  changeKind: string;
  previousStatus: string;
  responsibility: string | null;
  scope: IncidentQuantity[] | null;
  outstanding: IncidentQuantity[] | null;
  lastReviewedBy: string | null;
  factReview: { reference: string; description: string; actorId: string } | null;
};

export function supplyIncidents(ledger: PurchaseActivity[]) {
  const active = new Map<string,SupplyIncident>();
  for (const row of ledger) {
    if (row.action !== 'report_change' && row.action !== 'review_change_scope' && row.action !== 'resolve_change') continue;
    const op = purchaseOperation(row.detail);
    const responsibility = typeof op.responsibility === 'string' ? op.responsibility : null;
    if (row.action === 'report_change') {
      const scope = Array.isArray(op.affectedLines) ? op.affectedLines as IncidentQuantity[] : null;
      active.set(row.id,{ id:row.id,reportedBy:row.actorId,reference:String(op.reference),description:String(op.description),
        changeKind:String(op.changeKind),previousStatus:String(op.previousStatus),responsibility,scope,outstanding:scope,
        lastReviewedBy:null,factReview:null });
      continue;
    }
    const incident = typeof op.incidentId === 'string' ? active.get(op.incidentId) : undefined;
    if (!incident) continue;
    if (row.action === 'review_change_scope') {
      active.set(incident.id,{...incident,scope:op.scope as IncidentQuantity[],outstanding:op.outstanding as IncidentQuantity[],
        responsibility:responsibility ?? incident.responsibility,lastReviewedBy:row.actorId,
        factReview:{reference:String(op.reference),description:String(op.description),actorId:row.actorId}});
    } else {
      const progress = purchaseObject(op.incidentProgress) as Partial<IncidentProgress>;
      if (!progress.outstanding?.length) active.delete(incident.id);
      else active.set(incident.id,{...incident,scope:progress.scope ?? incident.scope,outstanding:progress.outstanding,
        responsibility:responsibility ?? incident.responsibility,lastReviewedBy:row.actorId});
    }
  }
  return [...active.values()];
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
