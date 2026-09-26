import { describe, expect, it } from 'vitest';
import {
  FISHER_BIOREAGENTS_SUB_BRAND,
  buildFisherBioReagentsProductWhere,
  buildSubBrandWhere,
  mergeBrandSubBrands,
} from '@/lib/brand-sub-brands';

describe('mergeBrandSubBrands', () => {
  it('orders Thermo Fisher sub-brands canonically and merges invariant alias', () => {
    const merged = mergeBrandSubBrands('Thermo Fisher', [
      { name: 'FastDigest', count: 10 },
      { name: 'invariant', count: 3 },
      { name: FISHER_BIOREAGENTS_SUB_BRAND, count: 208 },
      { name: 'Thermo Scientific', count: 100 },
    ]);

    expect(merged.map((s) => s.name)).toEqual([
      'Thermo Scientific',
      FISHER_BIOREAGENTS_SUB_BRAND,
      'FastDigest',
      'Invariant',
    ]);
    expect(merged.find((s) => s.name === 'Invariant')?.count).toBe(3);
  });
});

describe('buildSubBrandWhere', () => {
  it('matches Fisher BioReagents by subBrand or FB catalog', () => {
    const where = buildSubBrandWhere(FISHER_BIOREAGENTS_SUB_BRAND);
    expect(where).toHaveProperty('OR');
  });
});

describe('buildFisherBioReagentsProductWhere', () => {
  it('covers independent brand, subBrand, and FB catalog under Thermo', () => {
    const where = buildFisherBioReagentsProductWhere() as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { brand: FISHER_BIOREAGENTS_SUB_BRAND },
        { subBrand: FISHER_BIOREAGENTS_SUB_BRAND },
        expect.objectContaining({
          catalogNumber: { startsWith: 'FB' },
        }),
      ]),
    );
  });
});
