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

export function invoiceCommitments(plans: ScopedPlan[]) {
  const commitments = new Map<string, number>();
  const add = (id: string | null, amount: number) => {
    const key = id ?? '';
    commitments.set(key, (commitments.get(key) ?? 0) + amount);
  };
  for (const row of invoiceCharges(plans)) if (row.status !== 'voided') add(row.scopeId, row.amountCents);
  for (const plan of plans) {
    if (plan.scheduledRemainingCents <= 0) continue;
    if (plan.coverageReview?.remaining) {
      for (const part of plan.coverageReview.remaining) add(part.invoiceScopeId, part.amountCents);
    } else {
      add(plan.coverageReview ? null : plan.invoiceScopeId, plan.scheduledRemainingCents);
    }
  }
  return commitments;
}
