export type DatedInvoicePlan = {
  id: string;
  grossCents: number;
  amendedFromPlanId: string | null;
  effectiveAt: string | null;
  closedAt: string | null;
  stoppedCents: number;
  allocations: Array<{ id: string; issuedAt: string; amountCents: number; status: string }>;
};

type Entry =
  | { kind: 'transfer'; at: number; plan: DatedInvoicePlan; from: string; depth: number }
  | { kind: 'close'; at: number; plan: DatedInvoicePlan }
  | { kind: 'invoice'; at: number; plan: DatedInvoicePlan; id: string; amountCents: number };

const priority = { transfer: 0, close: 1, invoice: 2 };

/** Actual invoices and written changes consume the same original allocation in date order. */
export function invoiceTimeline(plans: DatedInvoicePlan[], through = Infinity) {
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  const remaining = new Map(plans.map(plan => [plan.id, plan.amendedFromPlanId ? 0 : plan.grossCents]));
  const transfers = new Map<string, number>();
  const closed = new Set<string>();
  const conflicts = new Set<string>();
  const entries: Entry[] = [];
  for (const plan of plans) {
    if (plan.amendedFromPlanId && plan.effectiveAt) {
      const ancestors = new Set([plan.id]);
      let parent = byId.get(plan.amendedFromPlanId);
      while (parent && !ancestors.has(parent.id)) {
        ancestors.add(parent.id);
        parent = parent.amendedFromPlanId ? byId.get(parent.amendedFromPlanId) : undefined;
      }
      if (!parent && byId.has(plan.amendedFromPlanId)) entries.push({
        kind: 'transfer', at: Date.parse(plan.effectiveAt), plan, from: plan.amendedFromPlanId, depth: ancestors.size,
      });
    }
    if (plan.closedAt) entries.push({ kind: 'close', at: Date.parse(plan.closedAt), plan });
    for (const allocation of plan.allocations) {
      if (allocation.status !== 'voided') entries.push({
        kind: 'invoice', at: Date.parse(allocation.issuedAt), plan, id: allocation.id, amountCents: allocation.amountCents,
      });
    }
  }
  entries.sort((a, b) => a.at - b.at || priority[a.kind] - priority[b.kind]
    || (a.kind === 'transfer' && b.kind === 'transfer' ? a.depth - b.depth : 0));
  for (const entry of entries) {
    if (entry.at > through) break;
    const { plan } = entry;
    const available = remaining.get(plan.id) ?? 0;
    if (entry.kind === 'transfer') {
      const availableFrom = remaining.get(entry.from) ?? 0;
      const assigned = Math.max(0, Math.min(availableFrom, plan.grossCents));
      transfers.set(plan.id, assigned);
      remaining.set(entry.from, availableFrom - assigned);
      remaining.set(plan.id, available + assigned);
    } else if (entry.kind === 'close') {
      remaining.set(plan.id, Math.max(0, available - plan.stoppedCents));
      closed.add(plan.id);
    } else {
      if (closed.has(plan.id) || entry.amountCents > available) conflicts.add(entry.id);
      remaining.set(plan.id, available - entry.amountCents);
    }
  }
  return { transfers, conflicts, remaining: new Map(plans.map(plan => [
    plan.id, closed.has(plan.id) ? 0 : Math.max(0, remaining.get(plan.id) ?? 0),
  ])) };
}
