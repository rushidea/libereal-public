import type { Product } from '@/types/Product';

export type WbPrimarySlot = {
  target: string;
  catalogNumber: string;
  searchQuery: string;
};

export type WbPrimaryFetchPlan = {
  search: string;
  sub: string;
};

export const WB_PRIMARY_SUBCATEGORIES = ['WB抗体', '内参抗体', '磷酸化抗体'] as const;

const HOST_ALIASES: Record<string, string> = {
  rabbit: 'Rabbit',
  兔: 'Rabbit',
  mouse: 'Mouse',
  小鼠: 'Mouse',
  rat: 'Rat',
  大鼠: 'Rat',
  goat: 'Goat',
  羊: 'Goat',
  sheep: 'Sheep',
  chicken: 'Chicken',
  鸡: 'Chicken',
  hamster: 'Hamster',
  llama: 'Llama',
  human: 'Human',
};

const PHOSPHO_TARGET = /^(p[-\s]?|phospho|phosphorylated|磷酸化)/i;

const LOADING_CONTROL_TARGETS = new Set([
  'gapdh',
  'actb',
  'beta-actin',
  'β-actin',
  'tubulin',
  'alpha-tubulin',
  'vinculin',
  'loading control',
]);

export function isPhosphoTargetQuery(target: string): boolean {
  const trimmed = target.trim();
  return PHOSPHO_TARGET.test(trimmed) || /\bphospho\b/i.test(trimmed);
}

export function phosphoBaseTarget(target: string): string | null {
  const trimmed = target.trim();
  const withoutPrefix = trimmed
    .replace(/^p[-\s]?/i, '')
    .replace(/^phospho[-\s]?/i, '')
    .replace(/^phosphorylated[-\s]?/i, '')
    .replace(/^磷酸化[-\s]?/i, '')
    .trim();
  return withoutPrefix && withoutPrefix.toLowerCase() !== trimmed.toLowerCase() ? withoutPrefix : null;
}

const PRIMARY_EXCLUDE_NAME = /inhibitor|抑制剂|antagonist|agonist|protein standard|recombinant.*protein|重组.*蛋白|elisa kit|试剂盒/i;

export function resolvePrimarySelection(candidates: Product[], selectedId: string): Product | null {
  if (!selectedId) return null;
  return (
    candidates.find((product) => product.id === selectedId || product.catalogNumber === selectedId) ?? null
  );
}

export function inferAntibodyHostFromProduct(product: Product | null | undefined): string | null {
  if (!product) return null;

  const fromField = normalizeAntibodyHost(product.host);
  if (fromField) return fromField;

  const name = product.name;
  const patterns: Array<[RegExp, string]> = [
    [/\brabbit\b/i, 'Rabbit'],
    [/\bmouse\b/i, 'Mouse'],
    [/\brat\b/i, 'Rat'],
    [/\bgoat\b/i, 'Goat'],
    [/\bsheep\b/i, 'Sheep'],
    [/\bchicken\b/i, 'Chicken'],
    [/兔源|兔/i, 'Rabbit'],
    [/小鼠|鼠源/i, 'Mouse'],
    [/大鼠/i, 'Rat'],
    [/山羊|羊/i, 'Goat'],
  ];

  for (const [pattern, host] of patterns) {
    if (pattern.test(name)) return host;
  }

  return null;
}

export function normalizeAntibodyHost(host: string | null | undefined): string | null {
  if (!host?.trim()) return null;
  const trimmed = host.trim();
  const lower = trimmed.toLowerCase();
  if (HOST_ALIASES[lower]) return HOST_ALIASES[lower];
  if (HOST_ALIASES[trimmed]) return HOST_ALIASES[trimmed];
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function hostToCatalogKey(host: string): string {
  return host.replace(/\s+/g, '-').toLowerCase();
}

/** Display / note only — actual API fetch uses {@link buildPrimaryFetchPlans}. */
export function buildWbPrimarySearchQuery(target: string, species: string): string {
  const normalizedTarget = target.trim();
  const normalizedSpecies = species.trim();
  if (!normalizedTarget) return 'WB 一抗';
  if (normalizedSpecies) return `${normalizedTarget}（${normalizedSpecies}）`;
  return normalizedTarget;
}

export function buildPrimaryFetchPlans(target: string): WbPrimaryFetchPlan[] {
  const trimmed = target.trim();
  if (!trimmed) return [{ search: 'antibody', sub: 'WB抗体' }];
  return WB_PRIMARY_SUBCATEGORIES.map((sub) => ({ search: trimmed, sub }));
}

export function buildWbSecondarySearchQuery(host: string): string {
  const normalizedHost = normalizeAntibodyHost(host);
  if (!normalizedHost) return 'HRP secondary antibody';
  return `Anti-${normalizedHost} IgG HRP`;
}

export function buildWbPrimarySlots(targetMolecules: string[], species: string): WbPrimarySlot[] {
  return targetMolecules
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target, index) => ({
      target,
      catalogNumber: `SCENE-WB-PRIMARY-${index}`,
      searchQuery: buildWbPrimarySearchQuery(target, species),
    }));
}

export function isLikelyWbPrimaryAntibody(product: Product, target: string): boolean {
  const needle = target.trim().toLowerCase();
  const name = product.name.toLowerCase();
  const productTarget = product.target?.toLowerCase() ?? '';

  if (product.category === '二抗' || product.subcategory?.includes('二抗')) return false;
  if (PRIMARY_EXCLUDE_NAME.test(product.name)) return false;
  if (name.includes('goat anti-') && name.includes('igg')) return false;

  if (!needle) return true;
  if (name.includes(needle) || productTarget.includes(needle)) return true;

  const baseTarget = phosphoBaseTarget(target);
  if (!baseTarget) return false;
  const baseNeedle = baseTarget.toLowerCase();
  if (!name.includes(baseNeedle) && !productTarget.includes(baseNeedle)) return false;

  return product.subcategory === '磷酸化抗体' || /phospho|phosphorylated|磷酸化/i.test(product.name);
}

export function primaryCandidateGroupKey(product: Product): string {
  if (product.brand === 'CST' && /^\d+[TLS]?$/i.test(product.catalogNumber)) {
    return `${product.brand}:${product.catalogNumber.replace(/[TLS]$/i, '')}`;
  }
  return product.catalogNumber;
}

export function preferPrimaryCandidate(candidate: Product, incumbent: Product): boolean {
  const sizeRank = (catalogNumber: string) => {
    if (catalogNumber.endsWith('S')) return 3;
    if (!/[TLS]$/i.test(catalogNumber)) return 2;
    if (catalogNumber.endsWith('T')) return 1;
    return 0;
  };

  const rankDiff = sizeRank(candidate.catalogNumber) - sizeRank(incumbent.catalogNumber);
  if (rankDiff !== 0) return rankDiff > 0;
  if (candidate.inStock !== incumbent.inStock) return candidate.inStock;
  return (candidate.price ?? 0) <= (incumbent.price ?? 0);
}

export function dedupePrimaryCandidates(products: Product[]): Product[] {
  const byKey = new Map<string, Product>();
  for (const product of products) {
    const key = primaryCandidateGroupKey(product);
    const existing = byKey.get(key);
    if (!existing || preferPrimaryCandidate(product, existing)) {
      byKey.set(key, product);
    }
  }
  return [...byKey.values()];
}

export function rankPrimaryCandidates(products: Product[], target: string, species = ''): Product[] {
  const needle = target.trim().toLowerCase();
  if (!needle) return products;

  return [...products].sort(
    (a, b) => scorePrimaryCandidate(b, needle, species) - scorePrimaryCandidate(a, needle, species),
  );
}

function scorePrimaryCandidate(product: Product, targetNeedle: string, species: string): number {
  let score = 0;
  const name = product.name.toLowerCase();
  const target = product.target?.toLowerCase() ?? '';
  const apps = product.applications?.join(' ').toLowerCase() ?? '';
  const speciesNeedle = species.trim().toLowerCase();

  if (target === targetNeedle) score += 6;
  if (name.includes(targetNeedle)) score += 4;
  if (new RegExp(`\\b${escapeRegExp(targetNeedle)}\\b`, 'i').test(product.name)) score += 2;

  if (product.subcategory === 'WB抗体') score += 3;
  else if (product.subcategory === '内参抗体' && LOADING_CONTROL_TARGETS.has(targetNeedle)) score += 3;
  else if (product.subcategory === '磷酸化抗体') {
    if (isPhosphoTargetQuery(targetNeedle) || /phospho|phosphorylated|磷酸化/i.test(name)) score += 3;
    const baseTarget = phosphoBaseTarget(targetNeedle);
    if (baseTarget && name.includes(baseTarget.toLowerCase())) score += 2;
  }

  if (apps.includes('wb') || name.includes('western') || name.includes('loading control')) score += 2;

  if (speciesNeedle) {
    if (product.reactivity?.some((entry) => entry.toLowerCase().includes(speciesNeedle))) score += 3;
    if (name.includes(speciesNeedle)) score += 1;
  }

  if (/biotin|biotinylated/i.test(product.name)) score -= 2;
  if (/hrp/i.test(product.name) && !product.subcategory?.includes('HRP')) score -= 1;
  if (product.inStock) score += 1;

  return score;
}

export function mergePrimaryCandidates(products: Product[], target: string, species = ''): Product[] {
  const filtered = products.filter((product) => isLikelyWbPrimaryAntibody(product, target));
  const deduped = dedupePrimaryCandidates(filtered);
  const ranked = rankPrimaryCandidates(deduped, target, species);
  return ranked.slice(0, 12);
}

export function pickBestSecondaryCandidate(products: Product[], host: string): Product | null {
  const normalizedHost = normalizeAntibodyHost(host);
  if (!normalizedHost || products.length === 0) return products[0] ?? null;

  const hostLower = normalizedHost.toLowerCase();
  const ranked = [...products].sort((a, b) => scoreSecondaryCandidate(b, hostLower) - scoreSecondaryCandidate(a, hostLower));
  return ranked[0] ?? null;
}

function scoreSecondaryCandidate(product: Product, hostLower: string): number {
  let score = 0;
  const name = product.name.toLowerCase();
  const productHost = product.host?.toLowerCase() ?? '';

  if (name.includes(hostLower) || productHost.includes(hostLower)) score += 4;
  if (name.includes('hrp')) score += 2;
  if (product.subcategory === 'HRP偶联二抗') score += 2;
  if (product.inStock) score += 1;
  return score;
}

export function formatPrimaryOptionLabel(product: Product): string {
  const host = product.host ? ` · ${product.host}` : '';
  const spec = product.spec ? ` · ${product.spec}` : '';
  return `${product.brand} · ${product.catalogNumber} · ${product.name}${host}${spec}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
