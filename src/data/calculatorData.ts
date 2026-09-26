// 原子量表 (相对原子质量, 25°C)
export const atomicWeights: Record<string, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  S: 32.065,
  P: 30.974,
  Na: 22.990,
  K: 39.098,
  Cl: 35.453,
  Ca: 40.078,
  Mg: 24.305,
  Fe: 55.845,
  Zn: 65.38,
  Cu: 63.546,
  Mn: 54.938,
  Co: 58.933,
  I: 126.904,
  Br: 79.904,
  F: 18.998,
  Li: 6.941,
  Ba: 137.327,
  Sr: 87.62,
  Al: 26.982,
  Si: 28.086,
  Cr: 51.996,
  Ni: 58.693,
  Ag: 107.868,
  Au: 196.967,
  Hg: 200.59,
  Pb: 207.2,
  Cd: 112.411,
  Sn: 118.71,
  Sb: 121.76,
  Bi: 208.98,
  B: 10.811,
  Se: 78.96,
  As: 74.922,
  Mo: 95.94,
  W: 183.84,
  V: 50.942,
  Ti: 47.867,
  Zr: 91.224,
  U: 238.03,
};

// 化学基团分子量表
export const functionalGroups: Record<string, { name: string; mw: number }> = {
  '-OH': { name: '羟基', mw: 17.008 },
  '-COOH': { name: '羧基', mw: 45.018 },
  '-NH2': { name: '氨基', mw: 16.023 },
  '-CHO': { name: '醛基', mw: 29.018 },
  '-COOR': { name: '酯基', mw: 59.044 },
  '-SO3H': { name: '磺酸基', mw: 81.07 },
  '-PO3H2': { name: '磷酸基', mw: 80.98 },
  '-SH': { name: '巯基', mw: 33.07 },
  '-CONH2': { name: '酰胺基', mw: 44.032 },
  '-COCl': { name: '酰氯基', mw: 63.47 },
  '-COH': { name: '羟甲基', mw: 31.034 },
  '-CH3': { name: '甲基', mw: 15.035 },
  '-C2H5': { name: '乙基', mw: 29.062 },
  '-C6H5': { name: '苯基', mw: 77.106 },
  '-NO2': { name: '硝基', mw: 46.006 },
  '-CN': { name: '氰基', mw: 26.018 },
  '-OCH3': { name: '甲氧基', mw: 31.034 },
  '-OC2H5': { name: '乙氧基', mw: 45.062 },
  '-N(CH3)2': { name: '二甲氨基', mw: 45.066 },
  '-N(CH3)3': { name: '季铵基', mw: 58.102 },
  '-COCH3': { name: '乙酰基', mw: 43.045 },
  '-COOCH3': { name: '甲酯基', mw: 59.044 },
  '-SO2NH2': { name: '磺酰胺基', mw: 80.062 },
};

// 缓冲体系组分信息
interface BufferComponent {
  name: string;
  formula?: string;
  mw: number;
}

export interface BufferSystem {
  name: string;
  pKa: number[];
  适用pH: string;
  standardConc?: number; // 标准浓度 (mM)，如 50 表示 50mM
  acid: BufferComponent; // 酸形式
  base: BufferComponent; // 共轭碱形式
  type: 'acid-base' | 'salt'; // 类型：酸碱对 或 盐溶液
  saltRecipe?: { // 对于盐溶液类型的特殊配方
    components: { name: string; formula: string; mw: number; amount: string }[];
  };
}

export const bufferSystems: BufferSystem[] = [
  {
    name: 'Tris',
    pKa: [8.07],
    适用pH: '7.0-9.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'Tris-HCl', formula: 'C4H12ClNO3', mw: 157.6 },
    base: { name: 'Tris', formula: 'C4H11NO3', mw: 121.14 },
  },
  {
    name: 'HEPES',
    pKa: [7.48],
    适用pH: '6.8-8.2',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'HEPES (酸式)', formula: 'C8H17N2O4S', mw: 237.3 },
    base: { name: 'HEPES-Na', formula: 'C8H16N2NaO4S', mw: 259.3 },
  },
  {
    name: 'MES',
    pKa: [6.10],
    适用pH: '5.5-6.7',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'MES (酸式)', formula: 'C6H13NO4S', mw: 195.24 },
    base: { name: 'MES-Na', formula: 'C6H12NNaO4S', mw: 217.22 },
  },
  {
    name: 'MOPS',
    pKa: [7.09],
    适用pH: '6.5-7.9',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'MOPS (酸式)', formula: 'C7H15NO4S', mw: 209.26 },
    base: { name: 'MOPS-Na', formula: 'C7H14NNaO4S', mw: 231.25 },
  },
  {
    name: 'MOPSO',
    pKa: [6.90],
    适用pH: '6.5-7.9',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'MOPSO (酸式)', formula: 'C7H15NO5S', mw: 225.26 },
    base: { name: 'MOPSO-Na', formula: 'C7H14NNaO5S', mw: 247.25 },
  },
  {
    name: 'PIPES',
    pKa: [6.76],
    适用pH: '6.1-7.5',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'PIPES (酸式)', formula: 'C8H18N2O6S', mw: 302.37 },
    base: { name: 'PIPES-Na', formula: 'C8H16N2Na2O6S', mw: 346.3 },
  },
  {
    name: 'ACES',
    pKa: [6.78],
    适用pH: '6.1-7.5',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'ACES (酸式)', formula: 'C4H10ClN2O3S', mw: 182.62 },
    base: { name: 'ACES-Na', formula: 'C4H9N2NaO3S', mw: 190.2 },
  },
  {
    name: 'ADA',
    pKa: [6.59],
    适用pH: '5.6-7.3',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'ADA (酸式)', formula: 'C6H10N2O4', mw: 162.15 },
    base: { name: 'ADA-Na', formula: 'C6H9N2NaO4', mw: 184.14 },
  },
  {
    name: 'EPPS',
    pKa: [8.00],
    适用pH: '7.3-8.7',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'EPPS (酸式)', formula: 'C9H20N2O4S', mw: 236.3 },
    base: { name: 'EPPS-Na', formula: 'C9H19N2NaO4S', mw: 258.28 },
  },
  {
    name: 'TAPS',
    pKa: [8.40],
    适用pH: '7.7-9.1',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'TAPS (酸式)', formula: 'C9H19NO6S', mw: 243.29 },
    base: { name: 'TAPS-Na', formula: 'C9H18NNaO6S', mw: 265.27 },
  },
  {
    name: 'Tricine',
    pKa: [8.05],
    适用pH: '7.4-8.8',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'Tricine (酸式)', formula: 'C6H13NO5', mw: 179.17 },
    base: { name: 'Tricine-Na', formula: 'C6H12NNaO5', mw: 201.15 },
  },
  {
    name: 'Bicine',
    pKa: [8.35],
    适用pH: '7.6-9.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'Bicine (酸式)', formula: 'C6H15NO4', mw: 163.17 },
    base: { name: 'Bicine-Na', formula: 'C6H14NNaO4', mw: 185.15 },
  },
  {
    name: 'CHES',
    pKa: [9.30],
    适用pH: '8.6-10.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'CHES (酸式)', formula: 'C8H17NO3S', mw: 207.29 },
    base: { name: 'CHES-Na', formula: 'C8H16NNaO3S', mw: 229.27 },
  },
  {
    name: 'CAPS',
    pKa: [10.10],
    适用pH: '9.7-11.1',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: 'CAPS (酸式)', formula: 'C9H19NO3S', mw: 221.32 },
    base: { name: 'CAPS-Na', formula: 'C9H18NNaO3S', mw: 243.3 },
  },
  {
    name: '磷酸',
    pKa: [2.14, 7.20, 12.35],
    适用pH: '2.1-2.5, 6.5-7.5, 11.5-12.5',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '磷酸二氢钾', formula: 'KH2PO4', mw: 136.09 },
    base: { name: '磷酸氢二钠', formula: 'Na2HPO4', mw: 141.96 },
  },
  {
    name: '醋酸',
    pKa: [4.76],
    适用pH: '3.6-5.6',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '冰醋酸', formula: 'CH3COOH', mw: 60.052 },
    base: { name: '醋酸钠', formula: 'CH3COONa', mw: 82.03 },
  },
  {
    name: '柠檬酸',
    pKa: [3.13, 4.76, 6.40],
    适用pH: '2.1-6.4',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '柠檬酸', formula: 'C6H8O7', mw: 192.12 },
    base: { name: '柠檬酸三钠', formula: 'C6H5Na3O7', mw: 258.07 },
  },
  {
    name: '碳酸',
    pKa: [6.35, 10.33],
    适用pH: '5.4-7.0, 9.3-11.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '碳酸氢钠', formula: 'NaHCO3', mw: 84.01 },
    base: { name: '碳酸钠', formula: 'Na2CO3', mw: 105.99 },
  },
  {
    name: '硼酸',
    pKa: [9.24],
    适用pH: '8.0-10.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '硼酸', formula: 'H3BO3', mw: 61.83 },
    base: { name: '硼砂', formula: 'Na2B4O7·10H2O', mw: 381.37 },
  },
  {
    name: '甘氨酸',
    pKa: [2.34, 9.60],
    适用pH: '1.0-3.0, 8.0-12.0',
    standardConc: 50,
    type: 'acid-base',
    acid: { name: '甘氨酸 (酸式)', formula: 'C2H5NO2', mw: 75.07 },
    base: { name: '甘氨酸钠', formula: 'C2H4NO2Na', mw: 97.05 },
  },
  {
    name: 'PBS',
    pKa: [7.20],
    适用pH: '6.5-8.0',
    standardConc: 10, // 1X PBS = 10mM
    type: 'salt',
    acid: { name: 'PBS (预混盐)', formula: 'NaCl/KCl/Na2HPO4/KH2PO4', mw: 0 },
    base: { name: 'PBS (预混盐)', formula: 'NaCl/KCl/Na2HPO4/KH2PO4', mw: 0 },
    saltRecipe: {
      // 10X PBS 配方 (每升)
      components: [
        { name: '氯化钠', formula: 'NaCl', mw: 58.44, amount: '80g' },
        { name: '氯化钾', formula: 'KCl', mw: 74.55, amount: '2g' },
        { name: '磷酸氢二钠', formula: 'Na2HPO4', mw: 141.96, amount: '14.4g' },
        { name: '磷酸二氢钾', formula: 'KH2PO4', mw: 136.09, amount: '2.4g' },
      ],
    },
  },
];

// 根据 pH 选择合适的 pKa
function getAppropriatePKa(buffer: BufferSystem, targetPH: number): number {
  const pKas = buffer.pKa;
  if (pKas.length === 1) return pKas[0];

  // 选择最接近目标 pH 的 pKa
  let closest = pKas[0];
  let minDiff = Math.abs(targetPH - pKas[0]);

  for (let i = 1; i < pKas.length; i++) {
    const diff = Math.abs(targetPH - pKas[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = pKas[i];
    }
  }
  return closest;
}

// 计算缓冲液配制
export interface BufferCalculationResult {
  success: boolean;
  components: { name: string; mass: number; volume?: number }[];
  notes?: string;
}

export function calculateBuffer(
  bufferName: string,
  targetPH: number,
  volumeML: number,
  concentrationM: number
): BufferCalculationResult {
  const buffer = bufferSystems.find(b => b.name === bufferName);
  if (!buffer) {
    return { success: false, components: [], notes: '未找到该缓冲体系' };
  }

  // 体积转为升
  const volumeL = volumeML / 1000;
  const totalMoles = concentrationM * volumeL;

  // 如果是盐溶液类型（如 PBS），返回固定配方
  if (buffer.type === 'salt' && buffer.saltRecipe) {
    // PBS 的浓度倍数直接对应目标工作浓度
    // 标准 1X PBS = 10mM PB, 137mM NaCl, 2.7mM KCl
    // 用户选择的倍数直接作为浓度倍数计算
    const factor = concentrationM / 0.01; // 相对于标准 10mM 的倍数

    const components = buffer.saltRecipe.components.map(comp => {
      // 根据浓度倍数调整（直接配制成目标浓度，不需要稀释）
      const mass = parseFloat(comp.amount.replace(/[^0-9.]/g, '')) * factor * (volumeML / 1000);
      return {
        name: comp.name,
        mass: mass,
      };
    });

    const targetMm = concentrationM * 1000;
    return {
      success: true,
      components,
      notes: `目标浓度 ${targetMm}mM (${factor.toFixed(1)}×)，直接定容至 ${volumeML}mL 使用`,
    };
  }

  // 酸碱缓冲体系计算
  const pKa = getAppropriatePKa(buffer, targetPH);

  // Henderson-Hasselbalch: pH = pKa + log([A-]/[HA])
  // [A-]/[HA] = 10^(pH - pKa)
  const ratio = Math.pow(10, targetPH - pKa);

  // [HA] + [A-] = totalMoles
  // [A-] = ratio * [HA]
  // [HA] + ratio*[HA] = totalMoles
  // [HA] = totalMoles / (1 + ratio)
  const acidMoles = totalMoles / (1 + ratio);
  const baseMoles = totalMoles - acidMoles;

  const components: { name: string; mass: number }[] = [];

  if (acidMoles > 0.000001) {
    components.push({
      name: buffer.acid.name,
      mass: acidMoles * buffer.acid.mw,
    });
  }

  if (baseMoles > 0.000001) {
    components.push({
      name: buffer.base.name,
      mass: baseMoles * buffer.base.mw,
    });
  }

  return {
    success: true,
    components,
    notes: `pH ${targetPH} 使用 pKa ${pKa}`,
  };
}

// 单位换算表
export const concentrationUnits: Record<string, { name: string; factor: number }> = {
  M: { name: 'M', factor: 1 },
  mM: { name: 'mM', factor: 1e-3 },
  μM: { name: 'μM', factor: 1e-6 },
  nM: { name: 'nM', factor: 1e-9 },
  pM: { name: 'pM', factor: 1e-12 },
};

/** Volume unit in the denominator of a concentration (e.g. mM/mL → per mL). factorToL = liters per 1 unit. */
export const perVolumeUnits: Record<string, { name: string; factorToL: number }> = {
  L: { name: 'L', factorToL: 1 },
  dL: { name: 'dL', factorToL: 1e-1 },
  mL: { name: 'mL', factorToL: 1e-3 },
  μL: { name: 'μL', factorToL: 1e-6 },
};

export function formatMolarPerVolumeUnit(molar: string, volume: string): string {
  return `${molar}/${volume}`;
}

/** Convert molar concentration with explicit volume denominator, e.g. 5 mM/dL → M/mL. */
export function convertMolarPerVolume(
  value: number,
  fromMolar: string,
  fromVolume: string,
  toMolar: string,
  toVolume: string,
): number {
  const fromMolarFactor = concentrationUnits[fromMolar]?.factor ?? 1;
  const toMolarFactor = concentrationUnits[toMolar]?.factor ?? 1;
  const fromVolL = perVolumeUnits[fromVolume]?.factorToL ?? 1;
  const toVolL = perVolumeUnits[toVolume]?.factorToL ?? 1;
  const molPerL = (value * fromMolarFactor) / fromVolL;
  return (molPerL * toVolL) / toMolarFactor;
}

export function formatConcentrationValue(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e4 || abs < 1e-4) return value.toExponential(4);
  return value
    .toFixed(6)
    .replace(/\.?0+$/, '');
}

export const massUnits: Record<string, { name: string; factor: number }> = {
  'g': { name: 'g', factor: 1 },
  'mg': { name: 'mg', factor: 1e-3 },
  'μg': { name: 'μg', factor: 1e-6 },
  'ng': { name: 'ng', factor: 1e-9 },
  'pg': { name: 'pg', factor: 1e-12 },
};

export const volumeUnits: Record<string, { name: string; factor: number }> = {
  'L': { name: 'L', factor: 1 },
  'mL': { name: 'mL', factor: 1e-3 },
  'μL': { name: 'μL', factor: 1e-6 },
};

export interface ElisaReplicateStats {
  values: number[];
  mean: number;
  sd: number;
  cv: number | null;
}

export interface ElisaStandardInput {
  id: string;
  concentration: number | null;
  odValues: number[];
}

export interface ElisaSampleInput {
  id: string;
  name: string;
  odValues: number[];
  dilution: number;
}

export interface FourPLParameters {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface ElisaStandardResult extends ElisaStandardInput {
  stats: ElisaReplicateStats | null;
  fittedOd: number | null;
  residual: number | null;
}

export interface ElisaSampleResult extends ElisaSampleInput {
  stats: ElisaReplicateStats | null;
  calculatedConcentration: number | null;
  finalConcentration: number | null;
  flags: string[];
}

export interface ElisaFitResult {
  success: boolean;
  message?: string;
  params: FourPLParameters | null;
  rSquared: number | null;
  standards: ElisaStandardResult[];
  samples: ElisaSampleResult[];
  qc: string[];
  range: { min: number; max: number } | null;
}

const ELISA_CV_LIMIT = 10;

function finiteValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

export function calculateReplicateStats(values: number[]): ElisaReplicateStats | null {
  const cleanValues = finiteValues(values);
  if (cleanValues.length === 0) return null;
  const mean = cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
  const variance = cleanValues.length > 1
    ? cleanValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (cleanValues.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const cv = mean !== 0 ? Math.abs(sd / mean) * 100 : null;
  return { values: cleanValues, mean, sd, cv };
}

export function fourPL(x: number, params: FourPLParameters): number {
  if (x <= 0 || params.c <= 0) return Number.NaN;
  return params.d + (params.a - params.d) / (1 + Math.pow(x / params.c, params.b));
}

function sumSquaredError(points: Array<{ x: number; y: number }>, params: FourPLParameters): number {
  return points.reduce((sum, point) => {
    const predicted = fourPL(point.x, params);
    if (!Number.isFinite(predicted)) return sum + 1e12;
    return sum + Math.pow(point.y - predicted, 2);
  }, 0);
}

function fitFourPL(points: Array<{ x: number; y: number }>): { params: FourPLParameters; rSquared: number } | null {
  if (points.length < 4) return null;
  const sortedPoints = [...points].sort((left, right) => left.x - right.x);
  const firstY = sortedPoints[0].y;
  const lastY = sortedPoints[sortedPoints.length - 1].y;
  const minX = sortedPoints[0].x;
  const maxX = sortedPoints[sortedPoints.length - 1].x;
  const meanY = sortedPoints.reduce((sum, point) => sum + point.y, 0) / sortedPoints.length;
  const totalSS = sortedPoints.reduce((sum, point) => sum + Math.pow(point.y - meanY, 2), 0);

  let bestVector = [
    firstY,
    lastY,
    Math.log(Math.sqrt(minX * maxX)),
    lastY >= firstY ? -1 : 1,
  ];
  let bestParams: FourPLParameters = {
    a: bestVector[0],
    d: bestVector[1],
    c: Math.exp(bestVector[2]),
    b: bestVector[3],
  };
  let bestError = sumSquaredError(sortedPoints, bestParams);
  let steps = [
    Math.max(0.05, Math.abs(lastY - firstY) * 0.5),
    Math.max(0.05, Math.abs(lastY - firstY) * 0.5),
    Math.max(0.4, Math.log(maxX / minX) / 3),
    0.6,
  ];

  for (let iteration = 0; iteration < 180; iteration += 1) {
    let improved = false;
    for (let index = 0; index < bestVector.length; index += 1) {
      for (const direction of [-1, 1]) {
        const candidateVector = [...bestVector];
        candidateVector[index] += direction * steps[index];
        const candidateParams = {
          a: candidateVector[0],
          d: candidateVector[1],
          c: Math.exp(candidateVector[2]),
          b: Math.max(-8, Math.min(8, candidateVector[3])),
        };
        const error = sumSquaredError(sortedPoints, candidateParams);
        if (error < bestError) {
          bestVector = [candidateParams.a, candidateParams.d, Math.log(candidateParams.c), candidateParams.b];
          bestParams = candidateParams;
          bestError = error;
          improved = true;
        }
      }
    }
    if (!improved) {
      steps = steps.map((step) => step * 0.72);
      if (Math.max(...steps) < 1e-6) break;
    }
  }

  if (!Number.isFinite(bestError) || !Number.isFinite(bestParams.c) || Math.abs(bestParams.b) < 0.001) return null;
  const rSquared = totalSS > 0 ? 1 - bestError / totalSS : 1;
  return { params: bestParams, rSquared };
}

export function invertFourPL(od: number, params: FourPLParameters): number | null {
  const denominator = od - params.d;
  if (denominator === 0) return null;
  const ratio = (params.a - params.d) / denominator - 1;
  if (ratio <= 0 || !Number.isFinite(ratio)) return null;
  const concentration = params.c * Math.pow(ratio, 1 / params.b);
  return Number.isFinite(concentration) && concentration > 0 ? concentration : null;
}

export function calculateElisaFit(standards: ElisaStandardInput[], samples: ElisaSampleInput[]): ElisaFitResult {
  const standardResults: ElisaStandardResult[] = standards.map((standard) => ({
    ...standard,
    stats: calculateReplicateStats(standard.odValues),
    fittedOd: null,
    residual: null,
  }));
  const validStandards = standardResults
    .filter((standard) => standard.concentration !== null && standard.concentration > 0 && standard.stats)
    .map((standard) => ({ x: standard.concentration as number, y: standard.stats?.mean as number }));
  const qc: string[] = [];

  if (validStandards.length < 4) {
    return {
      success: false,
      message: '至少需要 4 个有效标准点才能进行 4PL 拟合。',
      params: null,
      rSquared: null,
      standards: standardResults,
      samples: samples.map((sample) => ({ ...sample, stats: calculateReplicateStats(sample.odValues), calculatedConcentration: null, finalConcentration: null, flags: ['标准曲线不可用'] })),
      qc: ['标准点不足'],
      range: null,
    };
  }

  const monotonicDirection = validStandards[validStandards.length - 1].y - validStandards[0].y;
  const sortedByConcentration = [...validStandards].sort((left, right) => left.x - right.x);
  const hasDirectionBreak = sortedByConcentration.some((point, index) => {
    if (index === 0) return false;
    const delta = point.y - sortedByConcentration[index - 1].y;
    return monotonicDirection >= 0 ? delta < -0.02 : delta > 0.02;
  });
  if (hasDirectionBreak) qc.push('标准曲线 OD 不完全单调，建议检查标准品稀释或复孔。');

  const fit = fitFourPL(validStandards);
  if (!fit) {
    return {
      success: false,
      message: '4PL 拟合未收敛，请检查标准品浓度和 OD 数据。',
      params: null,
      rSquared: null,
      standards: standardResults,
      samples: samples.map((sample) => ({ ...sample, stats: calculateReplicateStats(sample.odValues), calculatedConcentration: null, finalConcentration: null, flags: ['标准曲线不可用'] })),
      qc: [...qc, '4PL 拟合失败'],
      range: null,
    };
  }

  const range = {
    min: Math.min(...validStandards.map((point) => point.x)),
    max: Math.max(...validStandards.map((point) => point.x)),
  };
  const fittedStandards = standardResults.map((standard) => {
    if (standard.concentration === null || standard.concentration <= 0 || !standard.stats) return standard;
    const fittedOd = fourPL(standard.concentration, fit.params);
    return { ...standard, fittedOd, residual: standard.stats.mean - fittedOd };
  });
  const fittedOds = fittedStandards
    .map((standard) => standard.fittedOd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const odMin = Math.min(...fittedOds);
  const odMax = Math.max(...fittedOds);

  const sampleResults = samples.map((sample) => {
    const stats = calculateReplicateStats(sample.odValues);
    const flags: string[] = [];
    if (!stats) {
      flags.push('缺少 OD');
      return { ...sample, stats, calculatedConcentration: null, finalConcentration: null, flags };
    }
    if (stats.cv !== null && stats.cv > ELISA_CV_LIMIT) flags.push(`复孔 CV > ${ELISA_CV_LIMIT}%`);
    if (stats.mean < odMin || stats.mean > odMax) flags.push(stats.mean < odMin ? '低于最低标准点' : '高于最高标准点');
    const concentration = invertFourPL(stats.mean, fit.params);
    const inRangeConcentration = concentration !== null && concentration >= range.min && concentration <= range.max ? concentration : null;
    if (concentration !== null && (concentration < range.min || concentration > range.max) && !flags.some((flag) => flag.includes('标准点'))) {
      flags.push(concentration < range.min ? '低于最低标准点' : '高于最高标准点');
    }
    const finalConcentration = inRangeConcentration !== null ? inRangeConcentration * Math.max(1, sample.dilution || 1) : null;
    return { ...sample, stats, calculatedConcentration: inRangeConcentration, finalConcentration, flags };
  });

  fittedStandards.forEach((standard) => {
    if (standard.stats?.cv !== null && standard.stats && standard.stats.cv > ELISA_CV_LIMIT) {
      qc.push(`标准点 ${standard.concentration} 复孔 CV > ${ELISA_CV_LIMIT}%`);
    }
  });
  if (fit.rSquared < 0.99) qc.push('R² < 0.99，建议谨慎使用本曲线定量。');
  if (qc.length === 0) qc.push('标准曲线和复孔质量未见明显异常。');

  return {
    success: true,
    params: fit.params,
    rSquared: fit.rSquared,
    standards: fittedStandards,
    samples: sampleResults,
    qc,
    range,
  };
}

// 计算器历史记录类型
export interface CalculatorHistory {
  type: 'dilution' | 'buffer' | 'mw' | 'unit' | 'solution' | 'elisa';
  inputs: Record<string, number | string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>;
  timestamp: number;
}

// localStorage key
const CALCULATOR_HISTORY_KEY = 'libereal_calculator_history';
const MAX_HISTORY_ITEMS = 20;

// 保存计算器历史
export function saveCalculatorHistory(history: CalculatorHistory): void {
  try {
    const existing = localStorage.getItem(CALCULATOR_HISTORY_KEY);
    const items: CalculatorHistory[] = existing ? JSON.parse(existing) : [];
    items.unshift(history);
    // 限制最多 20 条
    const trimmed = items.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(CALCULATOR_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

// 获取计算器历史
export function getCalculatorHistory(): CalculatorHistory[] {
  try {
    const existing = localStorage.getItem(CALCULATOR_HISTORY_KEY);
    return existing ? JSON.parse(existing) : [];
  } catch {
    return [];
  }
}

// 清除计算器历史
export function clearCalculatorHistory(): void {
  localStorage.removeItem(CALCULATOR_HISTORY_KEY);
}

// 计算分子量
export function calculateMolecularWeight(formula: string): { mw: number; composition: Record<string, number> } {
  const composition: Record<string, number> = {};
  let mw = 0;

  // 匹配原子和数量的正则
  const regex = /([A-Z][a-z]?)(\d*)/g;
  let match;

  while ((match = regex.exec(formula)) !== null) {
    const element = match[1];
    const count = match[2] ? parseInt(match[2], 10) : 1;

    if (element && atomicWeights[element]) {
      composition[element] = (composition[element] || 0) + count;
      mw += atomicWeights[element] * count;
    }
  }

  return { mw, composition };
}

// 计算溶液稀释 C1V1 = C2V2
export function calculateDilution(c1?: number, v1?: number, c2?: number, v2?: number): Record<string, number | null> {
  // C1 * V1 = C2 * V2
  if (c1 && v1 && c2) {
    // 求 V2
    return { v2: (c1 * v1) / c2, c1, v1, c2 };
  }
  if (c1 && v1 && v2) {
    // 求 C2
    return { c2: (c1 * v1) / v2, c1, v1, v2 };
  }
  if (c1 && c2 && v2) {
    // 求 V1
    return { v1: (c2 * v2) / c1, c1, c2, v2 };
  }
  if (v1 && c2 && v2) {
    // 求 C1
    return { c1: (c2 * v2) / v1, v1, c2, v2 };
  }
  return { c1: null, v1: null, c2: null, v2: null };
}

// 计算溶液配制 (质量 -> 摩尔浓度)
export function calculateSolution(mass?: number, mw?: number, volume?: number, targetMolarity?: number): Record<string, number | null> {
  if (mass && mw && volume) {
    const moles = mass / mw;
    const calculatedMolarity = moles / volume;
    return { molarity: calculatedMolarity, mass, mw, volume };
  }
  if (targetMolarity && mw && volume) {
    const moles = targetMolarity * volume;
    const calculatedMass = moles * mw;
    return { mass: calculatedMass, molarity: targetMolarity, mw, volume };
  }
  return { molarity: null, mass: null, mw: null, volume: null };
}

// 单位换算
