export interface FilterBand {
  name: string;
  center: number;    // 中心波长 (nm)
  bandwidth: number; // 带宽 (nm)
  min: number;       // 最小波长
  max: number;       // 最大波长
  color: string;
}

interface LaserConfig {
  wavelength: number;
  name: string;
  color: string;
}

export interface Instrument {
  id: string;
  name: string;
  brand: string;
  lasers: LaserConfig[];
  filters: FilterBand[];
  category: 'classic' | 'compact' | 'research' | 'highend';
}

const laserConfigs: Record<number, LaserConfig> = {
  405: { wavelength: 405, name: 'Violet', color: '#8B00FF' },
  488: { wavelength: 488, name: 'Blue', color: '#00BFFF' },
  561: { wavelength: 561, name: 'Yellow-Green', color: '#ADFF2F' },
  640: { wavelength: 640, name: 'Red', color: '#FF0000' },
  785: { wavelength: 785, name: 'Near-IR', color: '#800080' },
};

const bdChannels: FilterBand[] = [
  { name: 'FL1', center: 530, bandwidth: 30, min: 515, max: 545, color: '#00FF00' },
  { name: 'FL2', center: 585, bandwidth: 42, min: 564, max: 606, color: '#FFA500' },
  { name: 'FL3', center: 670, bandwidth: 30, min: 655, max: 685, color: '#FF6347' },
  { name: 'FL4', center: 660, bandwidth: 20, min: 650, max: 670, color: '#FF0000' },
  { name: 'FL5', center: 710, bandwidth: 50, min: 685, max: 735, color: '#DC143C' },
  { name: 'FL6', center: 780, bandwidth: 60, min: 750, max: 810, color: '#8B008B' },
  { name: 'FL7', center: 450, bandwidth: 50, min: 425, max: 475, color: '#4169E1' },
  { name: 'FL8', center: 525, bandwidth: 50, min: 500, max: 550, color: '#00CED1' },
];

const beckmanChannels: FilterBand[] = [
  { name: 'FL1', center: 525, bandwidth: 30, min: 510, max: 540, color: '#00FF00' },
  { name: 'FL2', center: 575, bandwidth: 25, min: 562.5, max: 587.5, color: '#FFA500' },
  { name: 'FL3', center: 620, bandwidth: 30, min: 605, max: 635, color: '#FF6347' },
  { name: 'FL4', center: 675, bandwidth: 30, min: 660, max: 690, color: '#FF0000' },
  { name: 'FL5', center: 720, bandwidth: 40, min: 700, max: 740, color: '#DC143C' },
  { name: 'FL6', center: 780, bandwidth: 60, min: 750, max: 810, color: '#8B008B' },
  { name: 'FL7', center: 450, bandwidth: 45, min: 427.5, max: 472.5, color: '#4169E1' },
  { name: 'FL8', center: 550, bandwidth: 40, min: 530, max: 570, color: '#00CED1' },
];

export const instruments: Instrument[] = [
  {
    id: 'bd_lsr2',
    name: 'BD LSR II',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[640]],
    filters: [
      { ...bdChannels[0], name: 'FL1' },
      { ...bdChannels[1], name: 'FL2' },
      { ...bdChannels[2], name: 'FL3' },
      { ...bdChannels[3], name: 'FL4' },
      { ...bdChannels[4], name: 'FL5' },
      { ...bdChannels[5], name: 'FL6' },
    ],
    category: 'classic',
  },
  {
    id: 'bd_facsaria3',
    name: 'BD FACSAria III',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640]],
    filters: [...bdChannels],
    category: 'classic',
  },
  {
    id: 'bd_facscalibur',
    name: 'BD FACSCalibur',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[488], laserConfigs[640]],
    filters: [
      { ...bdChannels[0], name: 'FL1' },
      { ...bdChannels[1], name: 'FL2' },
      { ...bdChannels[2], name: 'FL3' },
      { ...bdChannels[3], name: 'FL4' },
    ],
    category: 'classic',
  },
  {
    id: 'bd_accuri_c6',
    name: 'BD Accuri C6 Plus',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[488], laserConfigs[640]],
    filters: [
      { name: 'FL1', center: 533, bandwidth: 30, min: 518, max: 548, color: '#00FF00' },
      { name: 'FL2', center: 585, bandwidth: 42, min: 564, max: 606, color: '#FFA500' },
      { name: 'FL3', center: 670, bandwidth: 30, min: 655, max: 685, color: '#FF6347' },
      { name: 'FL4', center: 660, bandwidth: 20, min: 650, max: 670, color: '#FF0000' },
    ],
    category: 'compact',
  },
  {
    id: 'bd_lsrfortessa',
    name: 'BD LSRFortessa',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640]],
    filters: [...bdChannels],
    category: 'research',
  },
  {
    id: 'bd_facsymphony',
    name: 'BD FACSymphony',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640], laserConfigs[785]],
    filters: [...bdChannels, { name: 'FL9', center: 820, bandwidth: 60, min: 790, max: 850, color: '#4B0082' }],
    category: 'highend',
  },
  {
    id: 'bd_facsmelody',
    name: 'BD FACSMelody',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640]],
    filters: [...bdChannels],
    category: 'compact',
  },
  {
    id: 'bd_facsdiscover_s8',
    name: 'BD FACSDiscover S8',
    brand: 'BD Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640], laserConfigs[785]],
    filters: [...bdChannels, { name: 'FL9', center: 820, bandwidth: 60, min: 790, max: 850, color: '#4B0082' }],
    category: 'highend',
  },
  {
    id: 'beckman_cytflex',
    name: 'Beckman CytoFLEX',
    brand: 'Beckman Coulter',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[561], laserConfigs[640]],
    filters: [...beckmanChannels],
    category: 'research',
  },
  {
    id: 'millipore_guava',
    name: 'Millipore Guava easyCyte',
    brand: 'Millipore',
    lasers: [laserConfigs[488], laserConfigs[405] || laserConfigs[488]], // 488 标准，405 可选
    filters: [
      { name: 'FL1', center: 525, bandwidth: 30, min: 510, max: 540, color: '#00FF00' },
      { name: 'FL2', center: 583, bandwidth: 26, min: 570, max: 596, color: '#FFA500' },
      { name: 'FL3', center: 620, bandwidth: 30, min: 605, max: 635, color: '#FF6347' },
      { name: 'FL4', center: 680, bandwidth: 30, min: 665, max: 695, color: '#FF0000' },
      { name: 'FL5', center: 750, bandwidth: 40, min: 730, max: 770, color: '#DC143C' },
      { name: 'FL6', center: 785, bandwidth: 35, min: 767.5, max: 802.5, color: '#8B008B' },
    ],
    category: 'compact',
  },
  {
    id: 'acea_novoexpress',
    name: 'ACEA NovoExpress',
    brand: 'ACEA Biosciences',
    lasers: [laserConfigs[405], laserConfigs[488], laserConfigs[640]],
    filters: [
      { name: 'BL1', center: 530, bandwidth: 30, min: 515, max: 545, color: '#00FF00' },
      { name: 'BL2', center: 585, bandwidth: 42, min: 564, max: 606, color: '#FFA500' },
      { name: 'BL3', center: 670, bandwidth: 30, min: 655, max: 685, color: '#FF6347' },
      { name: 'BL4', center: 660, bandwidth: 20, min: 650, max: 670, color: '#FF0000' },
      { name: 'BL5', center: 710, bandwidth: 50, min: 685, max: 735, color: '#DC143C' },
      { name: 'BL6', center: 780, bandwidth: 60, min: 750, max: 810, color: '#8B008B' },
    ],
    category: 'research',
  },
];

export const categoryLabels: Record<Instrument['category'], string> = {
  classic: '经典款',
  compact: '紧凑款',
  research: '科研款',
  highend: '高端款',
};

export function checkDyeCompatibility(
  dye: { laserLine: number[]; emissionPeak: number },
  instrument: Instrument
): { laserCompatible: boolean; filterCompatible: boolean; matchingFilters: FilterBand[] } {
  const laserCompatible = dye.laserLine.some(wl =>
    instrument.lasers.some(l => l.wavelength === wl)
  );

  const matchingFilters = instrument.filters.filter(f =>
    dye.emissionPeak >= f.min && dye.emissionPeak <= f.max
  );
  const filterCompatible = matchingFilters.length > 0;

  return { laserCompatible, filterCompatible, matchingFilters };
}

export interface ManualConfig {
  lasers: number[];
  filters: FilterBand[];
}
