const INTEGER_TEXT = /^-?\d+$/;

/** Accept an explicit stock quantity. -1 is unlimited. 0 is empty stock. */
export function parseExplicitStockQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < -1) return null;
    return value;
  }
  if (typeof value === 'string' && INTEGER_TEXT.test(value.trim())) {
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed < -1) return null;
    return parsed;
  }
  return null;
}

/**
 * Read the admin stock input.
 * An empty or unfinished value returns undefined so the field is left unchanged.
 */
export function stockQuantityFromInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed === '+') return undefined;
  const parsed = parseExplicitStockQuantity(trimmed);
  return parsed === null ? undefined : parsed;
}
