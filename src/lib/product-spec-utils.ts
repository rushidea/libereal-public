/** Normalize spec for volume matching (µ/μ → u, strip spaces). */
export function normalizeSpecForVolume(spec: string): string {
  return spec.toLowerCase().replace(/\s/g, '').replace(/[μµ]/g, 'u');
}

/** True when spec is exactly `volume` µL (e.g. 20), not 200 µL / 120 µL. */
export function isVolumeMicroLiters(spec: string | null | undefined, volume: number): boolean {
  if (!spec) return false;
  const n = normalizeSpecForVolume(spec);
  const token = `${volume}ul`;
  if (!n.includes(token)) return false;
  const re = new RegExp(`(?:^|[^0-9])${volume}ul(?:$|[^0-9a-z/])`);
  return re.test(n) || n === token || n.startsWith(`${token}/`);
}

const NON_20UL_VOLUME_PATTERN =
  /(?:^|[^0-9])(?:50|100|200|400|500|600|1000)ul(?:$|[^0-9a-z/])|(?:^|[^0-9])\d+ml(?:$|[^0-9a-z/])/;

/** Spec string encodes a volume/size other than 20 µL (e.g. 50 µL, 200 µL, 1 ml). */
export function hasNon20UlVolumeSpec(spec: string | null | undefined): boolean {
  if (!spec) return false;
  const n = normalizeSpecForVolume(spec);
  if (isVolumeMicroLiters(spec, 20)) return false;
  return NON_20UL_VOLUME_PATTERN.test(n);
}

export type ProductVolumeRow = {
  brand: string;
  catalogNumber: string;
  category: string | null;
  spec: string | null;
  variants: { spec: string }[];
};

/**
 * Count 一抗 with 20 µL small-pack sizing.
 * - Explicit 20 µL in product or variant spec
 * - Abcam 一抗: catalog default is 20 µL (import often leaves spec empty)
 * - CST 一抗: catalog numbers ending in T are 20 µL trial size
 */
export function productQualifiesAs20UlAntibody(product: ProductVolumeRow): boolean {
  const specs = [product.spec, ...product.variants.map((v) => v.spec)].filter(
    (s): s is string => Boolean(s?.trim()),
  );

  if (specs.some((s) => isVolumeMicroLiters(s, 20))) {
    return true;
  }

  if (specs.some((s) => hasNon20UlVolumeSpec(s))) {
    return false;
  }

  if (product.category !== '一抗') {
    return false;
  }

  if (product.brand === 'Abcam') {
    return true;
  }

  if (product.brand === 'CST' && /T$/i.test(product.catalogNumber)) {
    return true;
  }

  return false;
}

/** Abcepta 一抗 with 50 µL in product or variant spec. */
export function productQualifiesAs50UlAbceptaAntibody(product: ProductVolumeRow): boolean {
  if (product.category !== '一抗' || product.brand !== 'Abcepta') {
    return false;
  }
  const specs = [product.spec, ...product.variants.map((v) => v.spec)].filter(
    (s): s is string => Boolean(s?.trim()),
  );
  return specs.some((s) => isVolumeMicroLiters(s, 50));
}

export type SmallPackAntibodyStats = {
  count20Ul: number;
  count50Ul: number;
  total: number;
};

/** Round down to nearest 1,000 for marketing copy, e.g. 8006 → "8,000+" */
export function formatProductCountPlus(count: number): string {
  if (count <= 0) return '0';
  if (count < 1000) return `${count}+`;
  const rounded = Math.floor(count / 1000) * 1000;
  return `${rounded.toLocaleString('en-US')}+`;
}
