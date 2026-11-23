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

export function invoiceScopeRooms(
  timeline: InvoiceAuthorityTimeline, usedByScope: ReadonlyMap<string, number>, at = timeline.at(-1)?.at,
) {
  const through = timeline.filter(row => at && row.at <= at);
  const available = through.at(-1);
  const rooms = new Map<string, { authorizedCents: number; roomCents: number; sharesCumulativeLimit: boolean }>();
  if (!available || available.authorizedCents === null) return rooms;
  const proofs = through.flatMap(row => row.scopeLimits);
  const used = [...usedByScope.values()].reduce((sum, amount) => sum + amount, 0);
  const familyRoom = available.authorizedCents - used;
  const commonUsed = new Map<number, number>();
  for (const { id, cumulativeCents } of proofs) {
    if (cumulativeCents !== undefined) commonUsed.set(cumulativeCents, (commonUsed.get(cumulativeCents) ?? 0) + (usedByScope.get(id) ?? 0));
  }
  const ceilings = [...commonUsed.keys()].sort((left, right) => left - right);
  let cumulativeUsed = 0;
  const remainingAtCeiling = new Map(ceilings.map(ceiling => {
    cumulativeUsed += commonUsed.get(ceiling) ?? 0;
    return [ceiling, ceiling - cumulativeUsed];
  }));
  // A commitment under a smaller ceiling also occupies the larger cumulative ceilings.
  let commonRoom = available.cumulativeCents === null ? null : available.cumulativeCents - cumulativeUsed;
  for (const ceiling of ceilings.reverse()) {
    if (commonRoom === null) break;
    commonRoom = Math.min(commonRoom, remainingAtCeiling.get(ceiling)!);
    remainingAtCeiling.set(ceiling, commonRoom);
  }
  for (const { id, cents, cumulativeCents } of proofs) {
    const ownRoom = cents - (usedByScope.get(id) ?? 0);
    const sharedRoom = cumulativeCents === undefined ? ownRoom
      : available.cumulativeCents === null ? null : remainingAtCeiling.get(cumulativeCents) ?? null;
    if (sharedRoom !== null) rooms.set(id, { authorizedCents: cents, roomCents: Math.min(familyRoom, ownRoom, sharedRoom),
      sharesCumulativeLimit: cumulativeCents !== undefined });
  }
  return rooms;
}

export function invoicesOutsideAuthority(timeline: InvoiceAuthorityTimeline, allocations: Array<{
  id: string; number: string; issuedAt: string; amountCents: number; status: string; scopeId: string | null;
}>) {
  const effective = allocations.filter(row => row.status !== 'voided').sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const usedByScope = new Map<string, number>();
  const dated = new Map<string, typeof effective>();
  for (const row of effective) {
    const sameDate = dated.get(row.issuedAt) ?? [];
    sameDate.push(row);
    dated.set(row.issuedAt, sameDate);
  }
  return [...dated].flatMap(([at, rows]) => {
    for (const row of rows) {
      const key = row.scopeId ?? '';
      usedByScope.set(key, (usedByScope.get(key) ?? 0) + row.amountCents);
    }
    const rooms = invoiceScopeRooms(timeline, usedByScope, at);
    return [...new Map(rows.filter(row => (rooms.get(row.scopeId ?? '')?.roomCents ?? -1) < 0)
      .map(row => [row.id, { id: row.id, number: row.number, issuedAt: row.issuedAt }])).values()];
  });
}
