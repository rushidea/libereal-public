export type InstrumentCryoCandidate = {
  catalogNumber: string;
  name: string;
  category: string;
  subcategory: string | null;
  type: string | null;
};

export type InstrumentCryoTarget = '液氮储存' | '低温冰箱';

const LN2_NAME_MARKERS = ['液氮罐', '液氮生物容器', '液氮储存罐', '液氮杜瓦'] as const;
const LN2_EXCLUDE_MARKERS = ['液氮标签', '冻存管', 'Cryo.s', 'cryogenic vial', 'cryogenic tube'] as const;

const FREEZER_NAME_MARKERS = [
  '低温冰箱',
  '超低温冰箱',
  '超低温保存箱',
  '医用冰箱',
  '血液冷藏箱',
  '药品冷藏箱',
  '立式超低温',
  '卧式超低温',
  '-80℃冰箱',
  '-80度冰箱',
  '-86℃冰箱',
  '-86度冰箱',
  'ULT Freezer',
  'Ultra-Low Temperature Freezer',
] as const;

function includesAny(text: string, markers: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((marker) => lower.includes(marker.toLowerCase()));
}

/** 判断产品是否应归入仪器设备「液氮储存」。 */
export function matchesLiquidNitrogenStorage(product: InstrumentCryoCandidate): boolean {
  if (includesAny(product.name, LN2_EXCLUDE_MARKERS)) return false;

  if (product.subcategory === '低温储存设备' || product.subcategory === '液氮储存') {
    return product.category === '仪器设备' || includesAny(product.name, LN2_NAME_MARKERS);
  }

  if (product.type === '液氮罐') return true;
  if (/^YDS-/i.test(product.catalogNumber)) return true;
  return includesAny(product.name, LN2_NAME_MARKERS);
}

/** 判断产品是否应归入仪器设备「低温冰箱」。 */
export function matchesLowTempFreezer(product: InstrumentCryoCandidate): boolean {
  if (product.subcategory === '低温冰箱') {
    return product.category === '仪器设备' || includesAny(product.name, FREEZER_NAME_MARKERS);
  }
  return includesAny(product.name, FREEZER_NAME_MARKERS);
}

export function resolveInstrumentCryoTarget(
  product: InstrumentCryoCandidate,
): InstrumentCryoTarget | null {
  if (matchesLiquidNitrogenStorage(product)) return '液氮储存';
  if (matchesLowTempFreezer(product)) return '低温冰箱';
  return null;
}

export function needsInstrumentCryoReclassify(product: InstrumentCryoCandidate): boolean {
  const target = resolveInstrumentCryoTarget(product);
  if (!target) return false;
  return product.category !== '仪器设备' || product.subcategory !== target;
}
