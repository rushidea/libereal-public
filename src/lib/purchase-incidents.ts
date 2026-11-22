import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export type IncidentQuantity = { orderItemId: string; quantity: number };
type IncidentProgress = {
  scope: IncidentQuantity[];
  handled: IncidentQuantity[];
  outstanding: IncidentQuantity[];
  scopeBasis: 'recorded' | 'reviewed' | 'reviewed_disposition' | 'entire_contract';
};

export function supplyIncident(ledger: PurchaseActivity[]) {
  const report = ledger.findLast(row => row.action === 'report_change');
  if (!report) return null;
  const original = purchaseOperation(report.detail);
  const last = ledger.findLast(row => row.action === 'resolve_change' && purchaseOperation(row.detail).incidentId === report.id);
  const decision = last ? purchaseOperation(last.detail) : undefined;
  const progress = purchaseObject(decision?.incidentProgress) as Partial<IncidentProgress>;
  if (last && !progress.outstanding?.length) return null;
  const reported = Array.isArray(original.affectedLines) ? original.affectedLines as IncidentQuantity[] : null;
  const responsibility = decision?.responsibility ?? original.responsibility;
  return { id: report.id, reportedBy: report.actorId, reference: String(original.reference),
    changeKind: String(original.changeKind), responsibility: typeof responsibility === 'string' ? responsibility : null,
    scope: progress.scope ?? reported, outstanding: progress.outstanding ?? reported,
    lastReviewedBy: last?.actorId ?? null };
}

export function incidentQuantities(values: unknown, available: ReadonlyArray<IncidentQuantity>, label: string) {
  if (!Array.isArray(values) || !values.length) throw new PurchaseError('请逐行填写'+label,400);
  const limits = new Map(available.map(row => [row.orderItemId,row.quantity]));
  const selected = new Map<string,number>();
  for (const raw of values) {
    const {orderItemId, quantity} = purchaseObject(raw);
    if (typeof orderItemId !== 'string' || !positiveCents(quantity) || selected.has(orderItemId)) {
      throw new PurchaseError(label+'须对应本单中不重复的商品行与正整数数量',400);
    }
    if (quantity > (limits.get(orderItemId) ?? 0)) throw new PurchaseError(label+'超出对应采购行的可核对数量');
    selected.set(orderItemId,quantity);
  }
  return available.flatMap(row => selected.has(row.orderItemId)
    ? [{orderItemId:row.orderItemId,quantity:selected.get(row.orderItemId)!}] : []);
}

export function resolveIncidentScope(
  incident: NonNullable<ReturnType<typeof supplyIncident>>,
  input: { affectedLines?: unknown; coordinationLines?: unknown; confirmsFullIncidentScope?: boolean },
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
    if (affectedLines !== undefined) {
      scope = incidentQuantities(affectedLines,available,'原供货事项完整涉及范围');
      scopeBasis = 'reviewed';
    } else if (confirmsFullScope) {
      scope = incidentQuantities(documented,available,'本次处置已涵盖的原事项范围');
      scopeBasis = 'reviewed_disposition';
    } else if (documented?.length && documented.length === available.length
      && available.every(line => documented.some(row => row.orderItemId === line.orderItemId && row.quantity === line.quantity))) {
      scope = documented;
      scopeBasis = 'entire_contract';
    } else {
      throw new PurchaseError('请先核对原供货事项全部涉及的采购行与数量，再确认本次处理范围');
    }
  } else if (affectedLines !== undefined || confirmsFullScope) {
    throw new PurchaseError('该供货事项的原影响范围已登记，请核对仍未办理的部分');
  }
  const pending = incident.outstanding ?? scope;
  const selected = coordinationLines !== undefined ? incidentQuantities(coordinationLines,pending,'本次处理数量') : undefined;
  const handled = documented ? incidentQuantities(documented,pending,'实际处置数量') : selected ?? pending;
  if (selected && documented && (selected.length !== handled.length
    || selected.some((row,i) => row.orderItemId !== handled[i].orderItemId || row.quantity !== handled[i].quantity))) {
    throw new PurchaseError('本次处理数量与实际取消、替代或修订的范围不一致');
  }
  if (!documented) incidentQuantities(handled,available,'本次继续原约的数量');
  const used = new Map(handled.map(row => [row.orderItemId,row.quantity]));
  const outstanding = pending.flatMap(row => {
    const quantity = row.quantity-(used.get(row.orderItemId) ?? 0);
    return quantity > 0 ? [{orderItemId:row.orderItemId,quantity}] : [];
  });
  return { scope, handled, outstanding, scopeBasis };
}
