/** A supplier enquiry gate uses one sale package's catalogue price, not order total. */
export function requiresWrittenSupplierQuote(
  cataloguePrice: number | null | undefined,
  requiredAbove: number | null | undefined,
): boolean {
  if (requiredAbove == null) return false;
  if (!Number.isFinite(requiredAbove) || requiredAbove <= 0) throw new Error('INVALID_SUPPLIER_QUOTE_POLICY');
  // Missing catalogue input cannot establish that the package is below the gate.
  if (cataloguePrice == null || !Number.isFinite(cataloguePrice) || cataloguePrice <= 0) return true;
  return cataloguePrice > requiredAbove;
}

export const SUPPLIER_WRITTEN_QUOTE_REQUIRED = 'SUPPLIER_WRITTEN_QUOTE_REQUIRED';
