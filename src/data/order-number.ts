const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function orderDateInShanghai(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

export function nextOrderNumber(date: Date, latestOrderId: string | null): string {
  const datePart = orderDateInShanghai(date);
  const prefix = `ORD-${datePart}-`;
  const latestSequence = latestOrderId?.startsWith(prefix)
    ? Number.parseInt(latestOrderId.slice(prefix.length), 10)
    : 0;
  const sequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1;

  return `${prefix}${String(sequence).padStart(3, '0')}`;
}
