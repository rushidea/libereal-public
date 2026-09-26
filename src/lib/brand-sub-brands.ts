import { getBrandInfo } from '@/data/brands';

export const FISHER_BIOREAGENTS_SUB_BRAND = 'Fisher BioReagents';

const SUB_BRAND_ALIASES: Record<string, string[]> = {
  Invariant: ['Invariant', 'invariant'],
};

function normalizeSubBrandName(name: string): string {
  return name === 'invariant' ? 'Invariant' : name;
}

/** Merge DB sub-brand counts with canonical order from brands.ts (in-stock only). */
export function mergeBrandSubBrands(
  brand: string,
  dbSubBrands: { name: string; count: number }[],
): { name: string; count: number }[] {
  const canonical = getBrandInfo(brand)?.subBrands?.map((sb) => sb.name) ?? [];
  const countByName = new Map<string, number>();

  for (const { name, count } of dbSubBrands) {
    const normalized = normalizeSubBrandName(name);
    countByName.set(normalized, (countByName.get(normalized) ?? 0) + count);
  }

  const merged: { name: string; count: number }[] = [];
  const seen = new Set<string>();

  for (const name of canonical) {
    const count = countByName.get(name) ?? 0;
    if (count > 0) {
      merged.push({ name, count });
      seen.add(name);
    }
  }

  for (const [name, count] of countByName) {
    if (!seen.has(name) && count > 0) {
      merged.push({ name, count });
    }
  }

  return merged;
}

/** Prisma where fragment for sub-brand facet (handles aliases & Fisher BioReagents). */
export function buildSubBrandWhere(subBrand: string): Record<string, unknown> {
  if (subBrand === FISHER_BIOREAGENTS_SUB_BRAND) {
    return {
      OR: [
        { subBrand: FISHER_BIOREAGENTS_SUB_BRAND },
        {
          catalogNumber: { startsWith: 'FB' },
          OR: [{ subBrand: null }, { subBrand: '' }],
        },
      ],
    };
  }

  const aliases = SUB_BRAND_ALIASES[subBrand];
  if (aliases) {
    return { subBrand: { in: aliases } };
  }

  return { subBrand };
}

/**
 * Match Fisher BioReagents products across both catalog shapes:
 * - independent brand (`brand = Fisher BioReagents`)
 * - legacy Thermo Fisher sub-brand (`subBrand = Fisher BioReagents` or FB* under Thermo)
 */
export function buildFisherBioReagentsProductWhere(): Record<string, unknown> {
  return {
    OR: [
      { brand: FISHER_BIOREAGENTS_SUB_BRAND },
      { subBrand: FISHER_BIOREAGENTS_SUB_BRAND },
      {
        catalogNumber: { startsWith: 'FB' },
        brand: { in: ['Thermo Fisher', 'Fisher BioReagents'] },
      },
    ],
  };
}
