export type IncidentSource = { kind: 'unshipped' } | { kind: 'parcel' | 'receipt' | 'shortfall' | 'resend'; id: string };
export type IncidentQuantity = { orderItemId: string; quantity: number; source?: IncidentSource };
export type IncidentCandidate = IncidentQuantity & { source: IncidentSource; reference: string; parcelLineId?: string };

export function incidentQuantityKey(row: IncidentQuantity) {
  const source = row.source;
  return JSON.stringify([row.orderItemId, source?.kind ?? null, source && 'id' in source ? source.id : null]);
}

export function incidentLineTotals(rows: readonly IncidentQuantity[]) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.orderItemId, (totals.get(row.orderItemId) ?? 0) + row.quantity);
  return Array.from(totals, ([orderItemId,quantity]) => ({orderItemId,quantity}));
}
