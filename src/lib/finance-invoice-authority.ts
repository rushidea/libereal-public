export type InvoiceAuthorityChange =
  | { mode: 'increase' | 'restate'; amountCents: number }
  | { mode: 'legacy'; beforeCents: number; afterCents: number }
  | { mode: 'clarify'; effectiveAt: string; amountCents: number; evidenceIds: string[]; confirmedEvidenceIds: string[] }
  | { mode: 'unknown' };

type InvoiceEvidence = {
  id: string; occurredAt: string; grossCents: number; change: InvoiceAuthorityChange | null;
  lines: ReadonlyArray<{ id: string; quantity: number }>;
};
type ScopeLimit = { id: string; cents: number; cumulativeCents?: number };

function invoiceGoods(lines: InvoiceEvidence['lines']) {
  return JSON.stringify([...lines].sort((left, right) => left.id.localeCompare(right.id)).map(line => [line.id, line.quantity]));
}

function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function readInvoiceAuthorityChange(change: Record<string, unknown>): InvoiceAuthorityChange | null {
  const { evidenceIds, confirmedEvidenceIds } = change;
  if ((change.mode === 'increase' || change.mode === 'restate') && isCents(change.amountCents)) {
    return { mode: change.mode, amountCents: change.amountCents };
  }
  if (change.mode === 'clarify' && isCents(change.amountCents) && typeof change.effectiveAt === 'string'
    && Number.isFinite(Date.parse(change.effectiveAt)) && Array.isArray(evidenceIds) && evidenceIds.every(value => typeof value === 'string')
    && Array.isArray(confirmedEvidenceIds) && confirmedEvidenceIds.length && confirmedEvidenceIds.every(value => evidenceIds.includes(value))) {
    return { mode: 'clarify', effectiveAt: change.effectiveAt, amountCents: change.amountCents,
      evidenceIds, confirmedEvidenceIds };
  }
  if (change.mode === undefined && isCents(change.beforeCents) && isCents(change.afterCents)) {
    // Earlier records did not distinguish a positive increase from a new cumulative ceiling.
    return change.afterCents < change.beforeCents
      ? { mode: 'restate', amountCents: change.afterCents }
      : { mode: 'legacy', beforeCents: change.beforeCents, afterCents: change.afterCents };
  }
  return null;
}

export function invoiceAuthorityTimeline(evidence: InvoiceEvidence[]) {
  const ordered = new Map<number, InvoiceEvidence[]>();
  const clarifications = evidence.filter(row => row.change?.mode === 'clarify');
  const original = evidence.find(row => row.change === null);
  const originalGoods = original ? invoiceGoods(original.lines) : null;
  const independentIncreases = new Set(evidence.filter(row => row.change?.mode === 'increase'
    && invoiceGoods(row.lines) !== originalGoods).map(row => row.id));
  for (const row of evidence) {
    if (row.change?.mode === 'clarify') continue;
    const at = Date.parse(row.occurredAt);
    const sameTime = ordered.get(at) ?? [];
    sameTime.push(row);
    ordered.set(at, sameTime);
  }
  let authorized: number | null = 0;
  let independent: number | null = 0;
  return [...ordered].sort(([left], [right]) => left - right).map(([at, group]) => {
    const evidenceIds = group.map(row => row.id).sort();
    const resolving = clarifications.filter(({ change }) => change?.mode === 'clarify'
      && Date.parse(change.effectiveAt) === at && JSON.stringify([...change.evidenceIds].sort()) === JSON.stringify(evidenceIds));
    const clarification = resolving.length === 1 ? resolving[0].change : null;
    const prior = authorized;
    const [proof] = group;
    const change = proof.change;
    let needsReview = false;
    if (clarification?.mode === 'clarify') {
      authorized = clarification.amountCents;
    } else if (group.length > 1 || resolving.length > 1) {
      authorized = null;
      needsReview = true;
    } else if (!change) {
      authorized = proof.grossCents;
    } else if (change.mode === 'restate') {
      authorized = change.amountCents;
    } else if (change.mode === 'increase') {
      authorized = prior === null ? null : prior + change.amountCents;
    } else if (change.mode === 'legacy') {
      authorized = prior === change.beforeCents ? change.afterCents : null;
      needsReview = authorized === null;
    } else {
      authorized = null;
      needsReview = true;
    }
    if (authorized !== null && !isCents(authorized)) {
      authorized = null;
      needsReview = true;
    }
    const confirmedEvidenceIds = clarification?.mode === 'clarify' ? clarification.confirmedEvidenceIds : needsReview ? [] : evidenceIds;
    const effective = group.filter(row => confirmedEvidenceIds.includes(row.id));
    const previouslyIndependent = independent;
    if (needsReview && group.some(row => independentIncreases.has(row.id) || row.change?.mode === 'unknown')) independent = null;
    if (independent !== null) {
      independent += effective.reduce((sum, row) => sum
        + (row.change?.mode === 'increase' && independentIncreases.has(row.id) ? row.change.amountCents : 0), 0);
      if (!isCents(independent)) independent = null;
    }
    // Only increases for different goods or quantities reserve a separate part of the total.
    const cumulativeCents = authorized === null || independent === null ? null : Math.max(0, authorized - independent);
    const scopeLimits = effective.flatMap<ScopeLimit>(row => {
      if (row.change?.mode === 'increase') {
        if (independentIncreases.has(row.id)) return [{ id: row.id, cents: row.change.amountCents }];
        return cumulativeCents === null ? [] : [{ id: row.id, cents: row.change.amountCents, cumulativeCents }];
      }
      if (cumulativeCents === null || previouslyIndependent === null) return [];
      const writtenTotal = !row.change ? row.grossCents : row.change.mode === 'restate' ? row.change.amountCents
        : row.change.mode === 'legacy' ? row.change.afterCents : authorized!;
      const writtenCumulative = Math.max(0, writtenTotal - previouslyIndependent);
      const limit = Math.min(cumulativeCents, writtenCumulative);
      return [{ id: row.id, cents: limit, cumulativeCents: limit }];
    });
    return { at: new Date(at).toISOString(), authorizedCents: authorized, needsReview, evidenceIds, confirmedEvidenceIds,
      clarificationId: clarification?.mode === 'clarify' ? resolving[0].id : null, cumulativeCents, scopeLimits };
  });
}

export type InvoiceAuthorityTimeline = ReturnType<typeof invoiceAuthorityTimeline>;

export function invoiceAuthorityAt(timeline: InvoiceAuthorityTimeline, at: string) {
  return timeline.findLast(row => row.at <= at);
}

type InvoiceScopeRoom = {
  authorizedCents: number;
  roomCents: number;
  sharesCumulativeLimit: boolean;
  cumulativeCents?: number;
  constraintKeys: string[];
};

export function invoiceAuthorityBalances(
  timeline: InvoiceAuthorityTimeline, usedByScope: ReadonlyMap<string, number>, at = timeline.at(-1)?.at,
) {
  const through = timeline.filter(row => at && row.at <= at);
  const available = through.at(-1);
  const rooms = new Map<string, InvoiceScopeRoom>();
  const used = [...usedByScope.values()].reduce((sum, amount) => sum + amount, 0);
  const familyRoom = (available?.authorizedCents ?? 0) - used;
  const constraints = new Map<string, number>([['total', familyRoom]]);
  const knownScopes = new Set<string>();
  if (available && available.authorizedCents !== null) {
    const proofs = through.flatMap(row => row.scopeLimits);
    const commonUsed = new Map<number, number>();
    for (const { id, cumulativeCents } of proofs) {
      if (cumulativeCents !== undefined) commonUsed.set(cumulativeCents, (commonUsed.get(cumulativeCents) ?? 0) + (usedByScope.get(id) ?? 0));
    }
    const ceilings = [...commonUsed.keys()].sort((left, right) => left - right);
    let cumulativeUsed = 0;
    for (const ceiling of ceilings) {
      cumulativeUsed += commonUsed.get(ceiling) ?? 0;
      constraints.set('ceiling:' + ceiling, ceiling - cumulativeUsed);
    }
    constraints.set('common', (available.cumulativeCents ?? 0) - cumulativeUsed);
    for (const { id, cents, cumulativeCents } of proofs) {
      knownScopes.add(id);
      const scopeKey = 'scope:' + id;
      constraints.set(scopeKey, cents - (usedByScope.get(id) ?? 0));
      const constraintKeys = ['total', scopeKey];
      // A commitment under a smaller ceiling also occupies the larger cumulative ceilings.
      if (cumulativeCents !== undefined) {
        if (available.cumulativeCents === null) continue;
        constraintKeys.push('common', ...ceilings.filter(ceiling => ceiling >= cumulativeCents).map(ceiling => 'ceiling:' + ceiling));
      }
      rooms.set(id, { authorizedCents: cents, roomCents: Math.min(...constraintKeys.map(key => constraints.get(key)!)),
        sharesCumulativeLimit: cumulativeCents !== undefined, cumulativeCents, constraintKeys });
    }
  }
  for (const [id, amount] of usedByScope) if (!knownScopes.has(id)) constraints.set('scope:' + id, -amount);
  return { rooms, constraints };
}

export function invoiceConstraintsWorsen(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>) {
  return [...after].some(([key, cents]) => cents < Math.min(0, before.get(key) ?? 0));
}

export type InvoiceCharge = { id: string; number: string; issuedAt: string; amountCents: number; status: string; scopeId: string | null };

export function addInvoiceCharge(used: Map<string, number>, scopeId: string | null, cents: number) {
  const key = scopeId ?? '';
  used.set(key, (used.get(key) ?? 0) + cents);
}

function invoiceChargesByDate(allocations: InvoiceCharge[]) {
  const dated = new Map<string, InvoiceCharge[]>();
  for (const row of allocations) {
    if (row.status === 'voided') continue;
    const sameDate = dated.get(row.issuedAt) ?? [];
    sameDate.push(row);
    dated.set(row.issuedAt, sameDate);
  }
  return dated;
}

function addDatedCharges(used: Map<string, number>, allocations?: InvoiceCharge[]) {
  for (const row of allocations ?? []) addInvoiceCharge(used, row.scopeId, row.amountCents);
}

export function datedInvoiceChargesWorsen(timeline: InvoiceAuthorityTimeline, before: InvoiceCharge[], after: InvoiceCharge[]) {
  const original = invoiceChargesByDate(before);
  const trial = invoiceChargesByDate(after);
  const dates = [...new Set([...original.keys(), ...trial.keys()])].sort();
  const originalUsage = new Map<string, number>();
  const trialUsage = new Map<string, number>();
  for (const at of dates) {
    addDatedCharges(originalUsage, original.get(at));
    addDatedCharges(trialUsage, trial.get(at));
    if (invoiceConstraintsWorsen(invoiceAuthorityBalances(timeline, originalUsage, at).constraints,
      invoiceAuthorityBalances(timeline, trialUsage, at).constraints)) return true;
  }
  return false;
}

export function invoicesOutsideAuthority(timeline: InvoiceAuthorityTimeline, allocations: InvoiceCharge[]) {
  const usedByScope = new Map<string, number>();
  const dated = invoiceChargesByDate(allocations);
  return [...dated.keys()].sort().flatMap(at => {
    const rows = dated.get(at)!;
    addDatedCharges(usedByScope, rows);
    const { rooms } = invoiceAuthorityBalances(timeline, usedByScope, at);
    return [...new Map(rows.filter(row => (rooms.get(row.scopeId ?? '')?.roomCents ?? -1) < 0)
      .map(row => [row.id, { id: row.id, number: row.number, issuedAt: row.issuedAt }])).values()];
  });
}
