export type InvoiceAuthorityChange =
  | { mode: 'increase' | 'restate'; amountCents: number }
  | { mode: 'legacy'; beforeCents: number; afterCents: number }
  | { mode: 'clarify'; effectiveAt: string; amountCents: number; evidenceIds: string[]; confirmedEvidenceIds: string[] }
  | { mode: 'unknown' };

type InvoiceEvidence = {
  id: string; occurredAt: string; grossCents: number; change: InvoiceAuthorityChange | null;
};

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
  for (const row of evidence) {
    if (row.change?.mode === 'clarify') continue;
    const at = Date.parse(row.occurredAt);
    const sameTime = ordered.get(at) ?? [];
    sameTime.push(row);
    ordered.set(at, sameTime);
  }
  let authorized: number | null = 0;
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
    return { at: new Date(at).toISOString(), authorizedCents: authorized, needsReview, evidenceIds, confirmedEvidenceIds,
      clarificationId: clarification?.mode === 'clarify' ? resolving[0].id : null };
  });
}

export type InvoiceAuthorityTimeline = ReturnType<typeof invoiceAuthorityTimeline>;

export function invoiceAuthorityAt(timeline: InvoiceAuthorityTimeline, at: string) {
  return timeline.findLast(row => row.at <= at);
}

export function invoicesOutsideAuthority(timeline: InvoiceAuthorityTimeline, allocations: Array<{
  id: string; number: string; issuedAt: string; amountCents: number; status: string; scopeId: string | null;
}>) {
  const effective = allocations.filter(row => row.status !== 'voided');
  const totals = new Map<string, number>();
  for (const row of effective) totals.set(row.issuedAt, (totals.get(row.issuedAt) ?? 0) + row.amountCents);
  let used = 0;
  const conflicts = new Set<string>();
  for (const [at, amount] of [...totals].sort(([left], [right]) => left.localeCompare(right))) {
    used += amount;
    const authority = invoiceAuthorityAt(timeline, at);
    if (!authority || authority.authorizedCents === null || used > authority.authorizedCents) conflicts.add(at);
  }
  const approved = new Set(timeline.flatMap(row => row.confirmedEvidenceIds));
  return effective.filter(row => conflicts.has(row.issuedAt) || !row.scopeId || !approved.has(row.scopeId))
    .map(row => ({ id: row.id, number: row.number, issuedAt: row.issuedAt }));
}
