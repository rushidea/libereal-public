/**
 * Product detail "选择规格" grouping rules.
 *
 * - Prefer ProductVariant rows attached to the product.
 * - Only CST uses catalogNumber prefix fallback (T/S/L size suffixes).
 * - Some brands must not use naive startsWith(catalogNumber),
 *   which merges unrelated SKUs (FT-10 → FT-100 / FT-1000, FT-1000 → FT-1000W).
 */

export function usesCatalogPrefixVariantFallback(brand: string): boolean {
  return brand === 'CST';
}

/** CST base SKU with trailing T/S/L size suffix removed. */
export function getCstBaseCatalogNumber(catalogNumber: string): string {
  return catalogNumber.replace(/[TSL]$/, '');
}

/**
 * Whether `candidate` is a plausible CST size sibling of `catalogNumber`.
 * Requires shared base after stripping T/S/L, and candidate itself ends with T/S/L
 * (or equals the base / current SKU).
 */
export function isCstCatalogSizeSibling(catalogNumber: string, candidate: string): boolean {
  const base = getCstBaseCatalogNumber(catalogNumber);
  if (candidate === catalogNumber || candidate === base) return true;
  if (!candidate.startsWith(base)) return false;
  const rest = candidate.slice(base.length);
  return /^[TSL]$/.test(rest);
}

/**
 * Detect digit-prefix collisions that naive startsWith would create.
 * Example: parent FT-10, child FT-100 / FT-1000.
 */
export function isDigitPrefixCatalogCollision(parentCatalog: string, childCatalog: string): boolean {
  if (childCatalog === parentCatalog) return false;
  if (!childCatalog.startsWith(parentCatalog)) return false;
  const rest = childCatalog.slice(parentCatalog.length);
  return /^[0-9]/.test(rest);
}
