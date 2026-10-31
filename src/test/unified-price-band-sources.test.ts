import { describe, expect, it } from 'vitest';
import { allocateUnifiedBandsToSources } from '@/lib/unified-price-band-sources';

describe('allocateUnifiedBandsToSources', () => {
  const ordinary = { unitCents: 100, quantity: 1, source: 'ordinary' as const };
  const promo = { unitCents: 50, quantity: 1, source: 'promotion' as const };

  it('maps explicitly tagged bands only to their named original rows', () => {
    expect(allocateUnifiedBandsToSources([
      { ...promo, sourceLineId: '1' }, { ...ordinary, sourceLineId: '0' },
    ], [
      { sourceIndex: 0, quantity: 1, semantics: 'same' },
      { sourceIndex: 1, quantity: 1, semantics: 'same' },
    ])).toEqual([
      { sourceIndex: 1, band: { ...promo, sourceLineId: '1' }, quantity: 1 },
      { sourceIndex: 0, band: { ...ordinary, sourceLineId: '0' }, quantity: 1 },
    ]);
  });

  it('rejects missing, foreign, or over-allocated tagged sources', () => {
    expect(() => allocateUnifiedBandsToSources([
      { ...promo, sourceLineId: '1' }, ordinary,
    ], [{ sourceIndex: 0, quantity: 1, semantics: 'same' }, { sourceIndex: 1, quantity: 1, semantics: 'same' }]))
      .toThrow('UNIFIED_PRICE_BANDS_UNSUPPORTED');
    expect(() => allocateUnifiedBandsToSources([
      { ...promo, sourceLineId: '2' }, { ...ordinary, sourceLineId: '0' },
    ], [{ sourceIndex: 0, quantity: 1, semantics: 'same' }, { sourceIndex: 1, quantity: 1, semantics: 'same' }]))
      .toThrow('UNIFIED_PRICE_BANDS_UNSUPPORTED');
  });

  it('sequentially maps untagged bands only across equivalent source rows', () => {
    expect(allocateUnifiedBandsToSources([promo, ordinary], [
      { sourceIndex: 0, quantity: 1, semantics: 'same' },
      { sourceIndex: 1, quantity: 1, semantics: 'same' },
    ])).toEqual([
      { sourceIndex: 0, band: promo, quantity: 1 },
      { sourceIndex: 1, band: ordinary, quantity: 1 },
    ]);
    expect(() => allocateUnifiedBandsToSources([promo, ordinary], [
      { sourceIndex: 0, quantity: 1, semantics: 'marked' },
      { sourceIndex: 1, quantity: 1, semantics: 'unmarked' },
    ])).toThrow('UNIFIED_STATIC_SOURCE_MAPPING_UNSUPPORTED');
  });
});
