export type UnifiedSourcePriceBand = { unitCents: number; quantity: number; source: 'ordinary' | 'promotion'; sourceLineId?: string };

/** Map SKU-level integer-cent bands back to original checkout rows without crossing semantic identities. */
export function allocateUnifiedBandsToSources(
  bands: UnifiedSourcePriceBand[],
  sources: Array<{ sourceIndex: number; quantity: number; semantics: string }>,
): Array<{ sourceIndex: number; band: UnifiedSourcePriceBand; quantity: number }> {
  const tagged = bands.some((band) => band.sourceLineId !== undefined);
  const allocations: Array<{ sourceIndex: number; band: UnifiedSourcePriceBand; quantity: number }> = [];
  if (tagged) {
    if (bands.some((band) => typeof band.sourceLineId !== 'string' || !band.sourceLineId)) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
    const sourceById = new Map(sources.map((source) => [String(source.sourceIndex), source]));
    const remaining = new Map(sources.map((source) => [source.sourceIndex, source.quantity]));
    for (const band of bands) {
      const source = sourceById.get(band.sourceLineId!);
      if (!source) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      const left = remaining.get(source.sourceIndex) ?? 0;
      if (band.quantity > left) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      allocations.push({ sourceIndex: source.sourceIndex, band, quantity: band.quantity });
      remaining.set(source.sourceIndex, left - band.quantity);
    }
    if ([...remaining.values()].some((quantity) => quantity !== 0)) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
    return allocations;
  }
  if (sources.some((source) => source.semantics !== sources[0]?.semantics)) throw new Error('UNIFIED_STATIC_SOURCE_MAPPING_UNSUPPORTED');
  let sourceIndex = 0;
  let sourceRemaining = sources[0]?.quantity ?? 0;
  for (const band of bands) {
    let left = band.quantity;
    while (left > 0) {
      const source = sources[sourceIndex];
      if (!source) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      const quantity = Math.min(left, sourceRemaining);
      allocations.push({ sourceIndex: source.sourceIndex, band, quantity });
      left -= quantity;
      sourceRemaining -= quantity;
      if (sourceRemaining === 0) {
        sourceIndex++;
        sourceRemaining = sources[sourceIndex]?.quantity ?? 0;
      }
    }
  }
  if (sourceIndex !== sources.length || sourceRemaining !== 0) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
  return allocations;
}
