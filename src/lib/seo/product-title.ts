const DEFAULT_PRODUCT_TITLE_BUDGET = 70;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/**
 * Builds a compact metadata title while keeping the complete product name when
 * it fits, and always preserving the full brand and catalog number. The 70
 * Unicode code point budget is a display-size heuristic, not a ranking guarantee.
 */
export function buildProductSeoTitle(
  productName: string,
  brand: string,
  catalogNumber: string,
  maxLength = DEFAULT_PRODUCT_TITLE_BUDGET,
): string {
  const name = normalizeWhitespace(productName);
  const normalizedBrand = normalizeWhitespace(brand);
  const normalizedCatalogNumber = normalizeWhitespace(catalogNumber);
  const suffix = `| ${normalizedBrand} Cat#${normalizedCatalogNumber}`;
  const fullTitle = name ? `${name} ${suffix}` : suffix;
  const titleCharacters = Array.from(fullTitle);

  if (titleCharacters.length <= maxLength) return fullTitle;

  const suffixLength = Array.from(suffix).length;
  const nameBudget = maxLength - suffixLength - 2; // reserve a space and one code point for the ellipsis
  if (nameBudget < 1) return suffix;

  const nameCharacters = Array.from(name);
  if (nameCharacters.length <= nameBudget) return fullTitle;
  return `${nameCharacters.slice(0, nameBudget).join('')}… ${suffix}`;
}
