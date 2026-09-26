import { describe, expect, it } from 'vitest';
import {
  buildPrimaryFetchPlans,
  buildWbPrimarySearchQuery,
  buildWbSecondarySearchQuery,
  dedupePrimaryCandidates,
  inferAntibodyHostFromProduct,
  isLikelyWbPrimaryAntibody,
  mergePrimaryCandidates,
  normalizeAntibodyHost,
  pickBestSecondaryCandidate,
  rankPrimaryCandidates,
} from '@/lib/wb-antibody-match';
import type { Product } from '@/types/Product';

function mockProduct(overrides: Partial<Product>): Product {
  return {
    id: '1',
    name: 'Test Antibody',
    catalogNumber: 'TEST-1',
    brand: 'TestBrand',
    price: 100,
    inStock: true,
    ...overrides,
  };
}

describe('wb-antibody-match', () => {
  it('normalizes host aliases', () => {
    expect(normalizeAntibodyHost('rabbit')).toBe('Rabbit');
    expect(normalizeAntibodyHost('小鼠')).toBe('Mouse');
  });

  it('uses target-only display query instead of over-specific API text', () => {
    expect(buildWbPrimarySearchQuery('GAPDH', 'Human')).toBe('GAPDH（Human）');
    expect(buildWbSecondarySearchQuery('Rabbit')).toBe('Anti-Rabbit IgG HRP');
  });

  it('fetches across WB, loading-control, and phospho subcategories', () => {
    expect(buildPrimaryFetchPlans('GAPDH')).toEqual([
      { search: 'GAPDH', sub: 'WB抗体' },
      { search: 'GAPDH', sub: '内参抗体' },
      { search: 'GAPDH', sub: '磷酸化抗体' },
    ]);
  });

  it('matches phospho targets via base protein name', () => {
    expect(
      isLikelyWbPrimaryAntibody(
        mockProduct({ name: 'Phospho-STAT3 (Tyr705) Antibody', subcategory: '磷酸化抗体' }),
        'p-STAT3',
      ),
    ).toBe(true);
    expect(isLikelyWbPrimaryAntibody(mockProduct({ name: 'STAT3 Antibody', subcategory: 'WB抗体' }), 'p-STAT3')).toBe(
      false,
    );
  });

  it('filters out non-antibody products', () => {
    expect(isLikelyWbPrimaryAntibody(mockProduct({ name: 'Heptelidic acid, GAPDH inhibitor' }), 'GAPDH')).toBe(false);
    expect(isLikelyWbPrimaryAntibody(mockProduct({ name: 'Recombinant Human GAPDH Protein Standard' }), 'GAPDH')).toBe(false);
    expect(isLikelyWbPrimaryAntibody(mockProduct({ name: 'GAPDH Antibody', subcategory: '内参抗体' }), 'GAPDH')).toBe(true);
  });

  it('dedupes CST size variants to one representative', () => {
    const deduped = dedupePrimaryCandidates([
      mockProduct({ id: 't', brand: 'CST', catalogNumber: '2118T', name: 'GAPDH (14C10) Rabbit mAb' }),
      mockProduct({ id: 's', brand: 'CST', catalogNumber: '2118S', name: 'GAPDH (14C10) Rabbit mAb', inStock: true }),
      mockProduct({ id: 'l', brand: 'CST', catalogNumber: '2118L', name: 'GAPDH (14C10) Rabbit mAb' }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.catalogNumber).toBe('2118S');
  });

  it('ranks primary candidates by target relevance and subcategory', () => {
    const ranked = rankPrimaryCandidates(
      [
        mockProduct({ id: 'a', name: 'Random antibody', target: 'IL-6' }),
        mockProduct({ id: 'b', name: 'Anti-TNF alpha antibody', target: 'TNF alpha', subcategory: 'WB抗体' }),
        mockProduct({ id: 'c', name: 'GAPDH inhibitor' }),
      ],
      'TNF alpha',
    );
    expect(ranked[0]?.id).toBe('b');
  });

  it('prefers loading-control subcategory for GAPDH', () => {
    const merged = mergePrimaryCandidates(
      [
        mockProduct({ id: 'wb', catalogNumber: 'WB-1', name: 'GAPDH Loading Control Antibody', subcategory: 'WB抗体' }),
        mockProduct({ id: 'lc', catalogNumber: 'LC-1', name: 'GAPDH Antibody', subcategory: '内参抗体' }),
        mockProduct({ id: 'bad', catalogNumber: 'BAD-1', name: 'GAPDH inhibitor' }),
      ],
      'GAPDH',
      'Human',
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((product) => product.id).sort()).toEqual(['lc', 'wb']);
  });

  it('infers host from product name when host field is empty', () => {
    expect(
      inferAntibodyHostFromProduct(
        mockProduct({ name: 'GAPDH Mouse Monoclonal Antibody', host: undefined }),
      ),
    ).toBe('Mouse');
    expect(
      inferAntibodyHostFromProduct(
        mockProduct({ name: 'GAPDH (14C10) Rabbit Monoclonal Antibody', host: 'Rabbit' }),
      ),
    ).toBe('Rabbit');
  });

  it('picks secondary by host match', () => {
    const best = pickBestSecondaryCandidate(
      [
        mockProduct({ id: 'a', name: 'Anti-Mouse IgG HRP', subcategory: 'HRP偶联二抗' }),
        mockProduct({ id: 'b', name: 'Anti-Rabbit IgG HRP', subcategory: 'HRP偶联二抗' }),
      ],
      'Rabbit',
    );
    expect(best?.id).toBe('b');
  });
});
