// 「应用与场景」顶部导航下拉菜单数据
// 结构：全部应用（总入口）+ 各应用类型（按大类分组）

export type ScenesNavLink = {
  slug: string;
  label: string;
};

export type ScenesNavGroup = {
  title: string;
  links: ScenesNavLink[];
};

// 全部应用（总入口）
export const scenesNavOverview = {
  label: '全部应用',
  description: '按实验目标浏览全部应用场景',
  href: '/scenes',
};

// 应用类型（按大类分组，顺序与 scenes 页 sceneGroups 一致）
export const scenesNavGroups: ScenesNavGroup[] = [
  {
    title: '蛋白与免疫检测',
    links: [
      { slug: 'western-blot', label: 'Western Blot' },
      { slug: 'elisa', label: 'ELISA' },
      { slug: 'elispot-fluorospot', label: 'ELISpot / FluoroSpot' },
      { slug: 'ihc', label: 'IHC / 免疫组化' },
      { slug: 'immunofluorescence', label: '免疫荧光' },
    ],
  },
  {
    title: '细胞分析',
    links: [
      { slug: 'magnetic-cell-separation', label: '免疫磁珠分选 / 细胞分离' },
      { slug: 'flow-cytometry', label: '流式细胞术' },
      { slug: 'single-cell-omics', label: '单细胞组学' },
      { slug: 'extracellular-vesicles', label: '细胞外囊泡研究' },
    ],
  },
  {
    title: '空间与成像',
    links: [
      { slug: 'spatial-biology', label: '空间生物学' },
      { slug: 'small-animal-imaging', label: '小动物实验与成像' },
    ],
  },
  {
    title: '模型与培养',
    links: [
      { slug: 'organoid-3d-culture', label: '类器官与 3D 细胞培养' },
    ],
  },
  {
    title: '基因功能与组学',
    links: [
      { slug: 'crispr-gene-editing', label: 'CRISPR 基因编辑' },
      { slug: 'proteomics-mass-spec', label: '蛋白组学与质谱分析' },
    ],
  },
  {
    title: '分子生物学',
    links: [
      { slug: 'molecular-biology', label: '分子生物学' },
    ],
  },
];
