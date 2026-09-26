import snapshot from './tumor-spatial-immunity.generated.json';

export type TumorSpatialImmunityReference = {
  number: number;
  id: string;
  sourceType: 'primary_research' | 'review';
  title: string;
  citation: string;
  year: number;
  doi: string;
  url: string;
};

export type TumorSpatialImmunityTheme = {
  id: string;
  displayOrder: number;
  title: string;
  location: string;
  immuneDifference: string;
  commonality: string;
  variation: string;
  researchValue: string;
  sourceIds: string[];
};

export type TumorSpatialImmunityMethod = {
  id: string;
  displayOrder: number;
  category: string;
  title: string;
  summary: string;
  principle: string;
  answers: string;
  sampleDesign: string;
  workflow: string;
  qualityControl: string;
  resultInterpretation: string;
  limitations: string;
  sourceIds: string[];
};

export type TumorSpatialImmunitySnapshot = {
  releaseId: string;
  asOfDate: string;
  researchWindow: string;
  categoryId: 'C08';
  hotspotId: 'H022';
  title: string;
  subtitle: string;
  summary: string;
  scopeNote: string;
  spatialThemes: TumorSpatialImmunityTheme[];
  spatialMethods: TumorSpatialImmunityMethod[];
  references: TumorSpatialImmunityReference[];
};

export const tumorSpatialImmunitySnapshot = snapshot as TumorSpatialImmunitySnapshot;

export const tumorSpatialImmunityReferenceById = new Map(
  tumorSpatialImmunitySnapshot.references.map((reference) => [reference.id, reference]),
);

export const spatialOrganizationTerms = [
  {
    label: '01',
    title: '肿瘤实质区',
    text: '肿瘤细胞集中分布的区域。进入这里的细胞毒性 T 细胞更有机会直接接触肿瘤细胞。',
  },
  {
    label: '02',
    title: '侵袭边缘',
    text: '肿瘤向周围组织扩展的前沿。这里既可能聚集免疫细胞，也可能形成阻止免疫细胞继续进入的边界。',
  },
  {
    label: '03',
    title: '邻近基质',
    text: '由成纤维细胞、细胞外基质、血管和髓系细胞等组成。其结构和信号可支持免疫反应，也可造成免疫排斥。',
  },
  {
    label: '04',
    title: '血管周围区域',
    text: '免疫细胞从血液进入组织的关键位置。血管内皮、趋化因子和周围细胞共同影响淋巴细胞能否进入。',
  },
  {
    label: '05',
    title: '三级淋巴结构（TLS）',
    text: '肿瘤局部形成的淋巴样结构，可包含 B 细胞区、T 细胞区、抗原呈递细胞和高内皮微静脉。',
  },
  {
    label: '06',
    title: '纤维化或低氧区',
    text: '致密基质、异常血管和代谢压力常在这些区域同时出现，可减少 T 细胞进入并削弱其效应功能。',
  },
] as const;
