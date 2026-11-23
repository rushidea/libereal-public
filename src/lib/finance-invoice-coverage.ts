import { addInvoiceCharge, invoiceAuthorityBalances, type InvoiceAuthorityTimeline } from '@/lib/finance-invoice-authority';
import { purchaseObject } from '@/lib/purchase-activity';
import { positiveCents } from '@/lib/purchase-terms';

export type InvoiceCoveragePortion = {
  invoiceScopeId: string;
  amountCents: number;
  lines: Array<{ orderItemId: string; quantity: number }>;
};

export function readInvoicePortions(raw: unknown, expectedCents: number) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const seen = new Set<string>();
  const portions: InvoiceCoveragePortion[] = [];
  for (const entry of raw) {
    const { invoiceScopeId, amountCents, lines } = purchaseObject(entry);
    if (typeof invoiceScopeId !== 'string' || !invoiceScopeId || seen.has(invoiceScopeId) || !positiveCents(amountCents)
      || !Array.isArray(lines) || !lines.length) return null;
    const goods = new Set<string>();
    const checked = [];
    for (const line of lines) {
      const { orderItemId, quantity } = purchaseObject(line);
      if (typeof orderItemId !== 'string' || !orderItemId || goods.has(orderItemId) || !positiveCents(quantity)) return null;
      goods.add(orderItemId);
      checked.push({ orderItemId, quantity });
    }
    seen.add(invoiceScopeId);
    portions.push({ invoiceScopeId, amountCents, lines: checked.sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)) });
  }
  return portions.reduce((sum, row) => sum + row.amountCents, 0) === expectedCents
    ? portions.sort((a, b) => a.invoiceScopeId.localeCompare(b.invoiceScopeId)) : null;
}

type InvoiceUse = {
  id: string; number: string; issuedAt: string; amountCents: number; status: string;
  scopePortions?: InvoiceCoveragePortion[] | null;
  reviewedReservationId?: string | null;
};
type ScopedPlan = {
  id: string;
  invoiceScopeId: string | null;
  scheduledRemainingCents: number;
  allocations: InvoiceUse[];
  coverageReview?: { remaining: InvoiceCoveragePortion[] | null } | null;
};

export function invoiceCoverageRemaining(id: string, portions: InvoiceCoveragePortion[], existingIds: string[], allocations: InvoiceUse[]) {
  const existing = new Set(existingIds);
  const coveredScopes = new Set(portions.map(part => part.invoiceScopeId));
  const used = new Map<string, number>();
  for (const row of allocations) {
    if (existing.has(row.id) || row.status === 'voided') continue;
    if (row.reviewedReservationId !== id || !row.scopePortions || row.scopePortions.some(part => !coveredScopes.has(part.invoiceScopeId))) return null;
    for (const part of row.scopePortions) used.set(part.invoiceScopeId, (used.get(part.invoiceScopeId) ?? 0) + part.amountCents);
  }
  const remaining = portions.map(part => ({ ...part, amountCents: part.amountCents - (used.get(part.invoiceScopeId) ?? 0) }));
  return remaining.some(part => part.amountCents < 0) ? null : remaining.filter(part => part.amountCents > 0);
}

export function invoiceCharges(plans: ScopedPlan[]) {
  return plans.flatMap(plan => plan.allocations.flatMap(allocation => {
    const parts = allocation.scopePortions ?? [{ invoiceScopeId: plan.invoiceScopeId, amountCents: allocation.amountCents }];
    return parts.map(part => ({ id: allocation.id, number: allocation.number, issuedAt: allocation.issuedAt,
      status: allocation.status, amountCents: part.amountCents, scopeId: part.invoiceScopeId }));
  }));
}

function pendingInvoiceAmounts(plan: ScopedPlan) {
  const parts = plan.coverageReview?.remaining;
  if (parts?.reduce((sum, part) => sum + part.amountCents, 0) === plan.scheduledRemainingCents) {
    return parts.map(part => ({ scopeId: part.invoiceScopeId, amountCents: part.amountCents }));
  }
  return [{ scopeId: plan.coverageReview ? null : plan.invoiceScopeId, amountCents: plan.scheduledRemainingCents }];
}

export function invoiceCommitments(timeline: InvoiceAuthorityTimeline, plans: ScopedPlan[], at: string) {
  const actual = new Map<string, number>();
  for (const row of invoiceCharges(plans)) {
    if (row.status !== 'voided' && row.issuedAt <= at) addInvoiceCharge(actual, row.scopeId, row.amountCents);
  }
  const pending = new Map(plans.filter(plan => plan.scheduledRemainingCents > 0)
    .map(plan => [plan.id, pendingInvoiceAmounts(plan)]));
  return { actual: invoiceAuthorityBalances(timeline, actual, at), pending };
}

/** Count reservations up to what their signed scopes can still cover, without choosing who gets a shared balance. */
export function invoiceReservationBalances(commitments: ReturnType<typeof invoiceCommitments>, exceptPlanId?: string) {
  const { actual, pending } = commitments;
  const requested = new Map<string, number>();
  for (const [planId, parts] of pending) {
    if (planId !== exceptPlanId) for (const part of parts) addInvoiceCharge(requested, part.scopeId, part.amountCents);
  }
  const constraints = new Map(actual.constraints);
  const sharedDemand = new Map<number, number>();
  let otherReservations = 0;
  for (const [id, amount] of requested) {
    const room = actual.rooms.get(id);
    if (!room) {
      // Preserve unresolved claims against the total until Finance identifies their actual scope.
      otherReservations += amount;
      continue;
    }
    const held = Math.min(amount, Math.max(0, room.roomCents));
    const scopeKey = 'scope:' + id;
    constraints.set(scopeKey, constraints.get(scopeKey)! - held);
    if (room.cumulativeCents === undefined) otherReservations += held;
    else sharedDemand.set(room.cumulativeCents, (sharedDemand.get(room.cumulativeCents) ?? 0) + held);
  }

  // Shared ceilings are nested. Overlapping plans reserve their common capacity once.
  const ceilings = [...actual.constraints.keys()].filter(key => key.startsWith('ceiling:'));
  const sharedLimit = actual.constraints.get('common') ?? 0;
  let upperLimit = Math.max(0, sharedLimit);
  const capacities = new Map<string, number>();
  for (const key of ceilings.toReversed()) {
    upperLimit = Math.min(upperLimit, Math.max(0, actual.constraints.get(key)!));
    capacities.set(key, upperLimit);
  }
  let sharedReserved = 0;
  for (const key of ceilings) {
    sharedReserved = Math.min(capacities.get(key)!, sharedReserved + (sharedDemand.get(Number(key.slice('ceiling:'.length))) ?? 0));
    constraints.set(key, actual.constraints.get(key)! - sharedReserved);
  }
  if (actual.constraints.has('common')) constraints.set('common', sharedLimit - sharedReserved);
  const total = actual.constraints.get('total')!;
  constraints.set('total', total - Math.min(Math.max(0, total), otherReservations + sharedReserved));
  const rooms = new Map([...actual.rooms].map(([id, scope]) => [id, {
    ...scope, roomCents: Math.min(...scope.constraintKeys.map(key => constraints.get(key)!)),
  }]));
  return { constraints, rooms };
}

export function invoicePortionsFit(
  balances: { constraints: ReadonlyMap<string, number>; rooms: ReadonlyMap<string, { constraintKeys: readonly string[] }> },
  parts: { scopeId: string | null; amountCents: number }[],
) {
  const required = new Map<string, number>();
  for (const part of parts) {
    const room = part.scopeId ? balances.rooms.get(part.scopeId) : undefined;
    if (!room) return false;
    for (const key of room.constraintKeys) addInvoiceCharge(required, key, part.amountCents);
  }
  return [...required].every(([key, amount]) => amount <= (balances.constraints.get(key) ?? 0));
}

export function invoiceIssuableAmount(commitments: ReturnType<typeof invoiceCommitments>, plan: ScopedPlan) {
  if (plan.scheduledRemainingCents <= 0) return 0;
  const parts = pendingInvoiceAmounts(plan);
  const balances = invoiceReservationBalances(commitments, plan.id);
  if (parts.length === 1 && parts[0].scopeId) {
    const room = balances.rooms.get(parts[0].scopeId)?.roomCents;
    return room === undefined ? null : Math.min(parts[0].amountCents, Math.max(0, room));
  }
  // Finance must identify any smaller split from the written goods and amounts.
  return invoicePortionsFit(balances, parts) ? plan.scheduledRemainingCents : null;
}
