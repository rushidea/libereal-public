// 荧光染料数据 - 流式细胞术常用染料
// 核心染料使用真实峰形参数，其他使用模拟高斯峰

export interface FluorescenceDye {
  id: string;
  name: string;           // 全名
  abbr: string;           // 缩写
  excitationPeak: number;  // 激发波长 (nm)
  emissionPeak: number;    // 发射波长 (nm)
  fwhm: number;           // 半峰宽 (nm)，用于高斯峰模拟
  secondaryPeak?: number; // 次级峰波长 (nm)，用于双峰染料
  secondaryFwhm?: number;  // 次级峰半峰宽
  laserLine: number[];     // 适用激光线 (nm)
  channel: string;        // BD 通道
  color: string;          // 显示颜色 (hex)
  category: 'blue' | 'violet' | 'green' | 'yellow' | 'red' | 'far-red';
}

export const fluorescenceDyes: FluorescenceDye[] = [
  // 蓝光激光 (488nm) 染料
  {
    id: 'fitc',
    name: 'FITC (Fluorescein isothiocyanate)',
    abbr: 'FITC',
    excitationPeak: 498,
    emissionPeak: 519,
    fwhm: 50,
    secondaryPeak: 289,
    secondaryFwhm: 35,
    laserLine: [488],
    channel: 'FL1',
    color: '#00FF00',
    category: 'green',
  },
  {
    id: 'pe',
    name: 'PE (Phycoerythrin)',
    abbr: 'PE',
    excitationPeak: 498,
    emissionPeak: 576,
    fwhm: 40,
    laserLine: [488],
    channel: 'FL2',
    color: '#FFA500',
    category: 'yellow',
  },
  {
    id: 'percp',
    name: 'PerCP (Peridinin chlorophyll protein)',
    abbr: 'PerCP',
    excitationPeak: 482,
    emissionPeak: 677,
    fwhm: 35,
    laserLine: [488],
    channel: 'FL3',
    color: '#FF6B6B',
    category: 'red',
  },
  {
    id: 'percp-cy55',
    name: 'PerCP-Cy5.5',
    abbr: 'PerCP-Cy5.5',
    excitationPeak: 482,
    emissionPeak: 695,
    fwhm: 30,
    laserLine: [488],
    channel: 'FL3',
    color: '#DC143C',
    category: 'red',
  },
  {
    id: 'bfluor450',
    name: 'Brilliant Violet 450',
    abbr: 'BV421',
    excitationPeak: 405,
    emissionPeak: 450,
    fwhm: 25,
    laserLine: [405],
    channel: 'FL6',
    color: '#4169E1',
    category: 'violet',
  },
  {
    id: 'bfluor480',
    name: 'Brilliant Violet 480',
    abbr: 'BV480',
    excitationPeak: 405,
    emissionPeak: 480,
    fwhm: 28,
    laserLine: [405],
    channel: 'FL8',
    color: '#87CEEB',
    category: 'violet',
  },
  {
    id: 'bfluor500',
    name: 'Brilliant Violet 500',
    abbr: 'BV500',
    excitationPeak: 405,
    emissionPeak: 500,
    fwhm: 28,
    laserLine: [405],
    channel: 'FL8',
    color: '#00CED1',
    category: 'violet',
  },
  {
    id: 'bfluor605',
    name: 'Brilliant Violet 605',
    abbr: 'BV605',
    excitationPeak: 405,
    emissionPeak: 603,
    fwhm: 28,
    laserLine: [405],
    channel: 'FL4',
    color: '#FF6347',
    category: 'violet',
  },
  {
    id: 'bfluor650',
    name: 'Brilliant Violet 650',
    abbr: 'BV650',
    excitationPeak: 405,
    emissionPeak: 650,
    fwhm: 30,
    laserLine: [405],
    channel: 'FL5',
    color: '#FF4500',
    category: 'violet',
  },
  {
    id: 'bfluor711',
    name: 'Brilliant Violet 711',
    abbr: 'BV711',
    excitationPeak: 405,
    emissionPeak: 711,
    fwhm: 30,
    laserLine: [405],
    channel: 'FL6',
    color: '#8B0000',
    category: 'violet',
  },
  // 黄绿激光 (561nm) 染料
  {
    id: 'pe-dazzle',
    name: 'PE/Dazzle 594',
    abbr: 'PE-Dazzle',
    excitationPeak: 561,
    emissionPeak: 610,
    fwhm: 35,
    laserLine: [561],
    channel: 'FL4',
    color: '#FF6347',
    category: 'yellow',
  },
  {
    id: 'pe-cy55',
    name: 'PE-Cy5',
    abbr: 'PE-Cy5',
    excitationPeak: 561,
    emissionPeak: 670,
    fwhm: 30,
    laserLine: [561],
    channel: 'FL3',
    color: '#DC143C',
    category: 'red',
  },
  {
    id: 'pe-cy7',
    name: 'PE-Cy7',
    abbr: 'PE-Cy7',
    excitationPeak: 561,
    emissionPeak: 785,
    fwhm: 30,
    laserLine: [561],
    channel: 'FL4',
    color: '#8B008B',
    category: 'far-red',
  },
  {
    id: 'alexa568',
    name: 'Alexa Fluor 568',
    abbr: 'AF568',
    excitationPeak: 578,
    emissionPeak: 603,
    fwhm: 32,
    laserLine: [561],
    channel: 'FL4',
    color: '#FF6347',
    category: 'yellow',
  },
  {
    id: 'af555',
    name: 'Alexa Fluor 555',
    abbr: 'AF555',
    excitationPeak: 555,
    emissionPeak: 568,
    fwhm: 30,
    laserLine: [561],
    channel: 'FL2',
    color: '#FFA500',
    category: 'yellow',
  },
  {
    id: 'af594',
    name: 'Alexa Fluor 594',
    abbr: 'AF594',
    excitationPeak: 590,
    emissionPeak: 617,
    fwhm: 32,
    laserLine: [561],
    channel: 'FL3',
    color: '#FF6347',
    category: 'yellow',
  },
  {
    id: 'cy3',
    name: 'Cy3',
    abbr: 'Cy3',
    excitationPeak: 550,
    emissionPeak: 570,
    fwhm: 30,
    laserLine: [561],
    channel: 'FL2',
    color: '#FFA500',
    category: 'yellow',
  },
  // 红光激光 (640nm) 染料
  {
    id: 'apc',
    name: 'APC (Allophycocyanin)',
    abbr: 'APC',
    excitationPeak: 650,
    emissionPeak: 660,
    fwhm: 35,
    laserLine: [640],
    channel: 'FL4',
    color: '#FF0000',
    category: 'red',
  },
  {
    id: 'alexa647',
    name: 'Alexa Fluor 647',
    abbr: 'AF647',
    excitationPeak: 650,
    emissionPeak: 668,
    fwhm: 30,
    laserLine: [640],
    channel: 'FL4',
    color: '#FF0000',
    category: 'red',
  },
  {
    id: 'apc-cy7',
    name: 'APC-Cy7',
    abbr: 'APC-Cy7',
    excitationPeak: 650,
    emissionPeak: 785,
    fwhm: 35,
    laserLine: [640],
    channel: 'FL4',
    color: '#8B008B',
    category: 'far-red',
  },
  {
    id: 'alexa700',
    name: 'Alexa Fluor 700',
    abbr: 'AF700',
    excitationPeak: 350,
    emissionPeak: 720,
    fwhm: 30,
    secondaryPeak: 676,
    secondaryFwhm: 30,
    laserLine: [640],
    channel: 'FL5',
    color: '#B22222',
    category: 'far-red',
  },
  {
    id: 'alexa750',
    name: 'Alexa Fluor 750',
    abbr: 'AF750',
    excitationPeak: 749,
    emissionPeak: 775,
    fwhm: 30,
    laserLine: [640],
    channel: 'FL6',
    color: '#800000',
    category: 'far-red',
  },
  // 其他常用染料
  {
    id: 'efluor450',
    name: 'eFluor 450',
    abbr: 'eF450',
    excitationPeak: 403,
    emissionPeak: 421,
    fwhm: 25,
    laserLine: [405],
    channel: 'FL6',
    color: '#4169E1',
    category: 'violet',
  },
  {
    id: 'efluor660',
    name: 'eFluor 660',
    abbr: 'eF660',
    excitationPeak: 633,
    emissionPeak: 665,
    fwhm: 28,
    laserLine: [640],
    channel: 'FL5',
    color: '#FF4500',
    category: 'red',
  },
  {
    id: 'cfblue',
    name: 'CF Blue',
    abbr: 'CFBlue',
    excitationPeak: 405,
    emissionPeak: 425,
    fwhm: 25,
    laserLine: [405],
    channel: 'FL6',
    color: '#6495ED',
    category: 'violet',
  },
  {
    id: 'cf绿',
    name: 'CFSE',
    abbr: 'CFSE',
    excitationPeak: 496,
    emissionPeak: 521,
    fwhm: 30,
    laserLine: [488],
    channel: 'FL1',
    color: '#32CD32',
    category: 'green',
  },
  {
    id: 'hoechst',
    name: 'Hoechst 33342',
    abbr: 'Hoechst',
    excitationPeak: 352,
    emissionPeak: 455,
    fwhm: 30,
    laserLine: [405],
    channel: 'FL8',
    color: '#4169E1',
    category: 'violet',
  },
  {
    id: 'dapi',
    name: 'DAPI',
    abbr: 'DAPI',
    excitationPeak: 356,
    emissionPeak: 460,
    fwhm: 25,
    laserLine: [405],
    channel: 'FL8',
    color: '#4169E1',
    category: 'violet',
  },
  {
    id: 'propidium',
    name: 'Propidium Iodide',
    abbr: 'PI',
    excitationPeak: 535,
    emissionPeak: 617,
    fwhm: 35,
    laserLine: [488, 561],
    channel: 'FL3',
    color: '#FF6347',
    category: 'red',
  },
  {
    id: '7aad',
    name: '7-AAD',
    abbr: '7-AAD',
    excitationPeak: 546,
    emissionPeak: 647,
    fwhm: 35,
    laserLine: [488],
    channel: 'FL3',
    color: '#DC143C',
    category: 'red',
  },
  {
    id: 'gv',
    name: 'GeldanVel Reporter',
    abbr: 'GV',
    excitationPeak: 405,
    emissionPeak: 530,
    fwhm: 30,
    laserLine: [405],
    channel: 'FL8',
    color: '#00FF7F',
    category: 'violet',
  },
  {
    id: 'krome',
    name: 'Krome Orange',
    abbr: 'Krome',
    excitationPeak: 405,
    emissionPeak: 551,
    fwhm: 28,
    laserLine: [405],
    channel: 'FL2',
    color: '#FFA500',
    category: 'violet',
  },
  {
    id: 'cy7',
    name: 'Cy7',
    abbr: 'Cy7',
    excitationPeak: 747,
    emissionPeak: 785,
    fwhm: 35,
    laserLine: [640],
    channel: 'FL6',
    color: '#800080',
    category: 'far-red',
  },
  // 常用流式染料补充
  {
    id: 'af488',
    name: 'Alexa Fluor 488',
    abbr: 'AF488',
    excitationPeak: 495,
    emissionPeak: 519,
    fwhm: 30,
    laserLine: [488],
    channel: 'FL1',
    color: '#00FF00',
    category: 'green',
  },
  {
    id: 'af532',
    name: 'Alexa Fluor 532',
    abbr: 'AF532',
    excitationPeak: 532,
    emissionPeak: 554,
    fwhm: 30,
    laserLine: [561],
    channel: 'FL2',
    color: '#00FF7F',
    category: 'green',
  },
  {
    id: 'af680',
    name: 'Alexa Fluor 680',
    abbr: 'AF680',
    excitationPeak: 679,
    emissionPeak: 702,
    fwhm: 28,
    laserLine: [640],
    channel: 'FL5',
    color: '#B22222',
    category: 'far-red',
  },
  {
    id: 'bb515',
    name: 'Brilliant Blue 515',
    abbr: 'BB515',
    excitationPeak: 425,
    emissionPeak: 515,
    fwhm: 30,
    laserLine: [488],
    channel: 'FL1',
    color: '#00FF00',
    category: 'green',
  },
  {
    id: 'krome-green',
    name: 'Krome Green',
    abbr: 'KromeGrn',
    excitationPeak: 405,
    emissionPeak: 525,
    fwhm: 28,
    laserLine: [405],
    channel: 'FL8',
    color: '#00FF7F',
    category: 'violet',
  },
  {
    id: 'bv785',
    name: 'Brilliant Violet 785',
    abbr: 'BV785',
    excitationPeak: 405,
    emissionPeak: 785,
    fwhm: 35,
    laserLine: [405],
    channel: 'FL6',
    color: '#800080',
    category: 'far-red',
  },
  {
    id: 'pacblue',
    name: 'Pacific Blue',
    abbr: 'PacBlue',
    excitationPeak: 410,
    emissionPeak: 455,
    fwhm: 25,
    laserLine: [405],
    channel: 'FL6',
    color: '#4169E1',
    category: 'violet',
  },
];

// 根据波长范围获取对应通道

// 生成高斯峰光谱数据（支持双峰）
function generateGaussianSpectrum(
  peakWavelength: number,
  fwhm: number,
  type: 'excitation' | 'emission',
  secondaryPeak?: number,
  secondaryFwhm?: number
): { wavelength: number; intensity: number }[] {
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.log(2)));
  const secondarySigma = secondaryFwhm ? secondaryFwhm / (2 * Math.sqrt(2 * Math.log(2))) : sigma;
  const points: { wavelength: number; intensity: number }[] = [];

  // 激发光谱范围: 250nm 到 peak + 100nm（扩展以容纳次级峰）
  // 发射光谱范围: peak - 50nm 到 peak + 100nm
  const minWl = type === 'excitation' ? 250 : peakWavelength - 50;
  const maxWl = type === 'excitation' ? peakWavelength + 100 : peakWavelength + 100;

  for (let wl = Math.max(250, minWl); wl <= Math.min(850, maxWl); wl += 1) {
    const primary = Math.exp(-Math.pow(wl - peakWavelength, 2) / (2 * sigma * sigma));
    let secondary = 0;
    if (secondaryPeak) {
      const secWeight = 0.4;
      secondary = Math.exp(-Math.pow(wl - secondaryPeak, 2) / (2 * secondarySigma * secondarySigma)) * secWeight;
    }
    const intensity = Math.min(1, primary + secondary);
    points.push({ wavelength: wl, intensity: Math.round(intensity * 100) });
  }

  return points;
}

// 生成完整光谱数据
export function generateDyeSpectrum(dye: FluorescenceDye) {
  return {
    id: dye.id,
    name: dye.name,
    abbr: dye.abbr,
    excitation: generateGaussianSpectrum(dye.excitationPeak, dye.fwhm, 'excitation', dye.secondaryPeak, dye.secondaryFwhm),
    emission: generateGaussianSpectrum(dye.emissionPeak, dye.fwhm, 'emission'),
    laserLine: dye.laserLine,
    channel: dye.channel,
    color: dye.color,
  };
}

// 保存的染料组合类型
export interface SavedDyeSet {
  id: string;
  name: string;
  dyeIds: string[];
  createdAt: number;
}

const SAVED_DYE_SETS_KEY = 'libereal_fluorescence_saved';
export const MAX_DYES_DISPLAY = 8;

// 获取保存的染料组合
export function getSavedDyeSets(): SavedDyeSet[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SAVED_DYE_SETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// 保存染料组合
export function saveDyeSet(name: string, dyeIds: string[]): SavedDyeSet {
  const sets = getSavedDyeSets();
  const newSet: SavedDyeSet = {
    id: 'ds_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    dyeIds,
    createdAt: Date.now(),
  };
  sets.unshift(newSet);
  localStorage.setItem(SAVED_DYE_SETS_KEY, JSON.stringify(sets));
  return newSet;
}

// 删除染料组合
export function deleteDyeSet(id: string): void {
  const sets = getSavedDyeSets();
  const filtered = sets.filter(s => s.id !== id);
  localStorage.setItem(SAVED_DYE_SETS_KEY, JSON.stringify(filtered));
}
