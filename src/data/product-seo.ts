export interface ProductSeoCategory {
  slug: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  selectionTitle: string;
  selection: string[];
  catalogFilters: { category: string; subcategory?: string; productType?: string }[];
  relatedSlugs: string[];
  relatedBrands: string[];
  inquiryBrands?: string[];
  brandNote?: string;
}

export const productSeoCategories: ProductSeoCategory[] = [
  {
    slug: 'antibodies',
    title: '科研抗体选购｜一抗、二抗与验证应用',
    description: '浏览科研抗体选型入口，覆盖重组单抗、磷酸化抗体、内参抗体、标签抗体及二抗等类别；按靶标、宿主和 WB、流式、IHC 等验证应用继续筛选，并结合产品说明确认样本与反应种属。',
    heading: '科研抗体：按实验应用筛选一抗与二抗',
    intro: '抗体选型应结合目标蛋白、样本类型、宿主来源和实验用途。LIBEREAL 提供按抗体类别与应用进入产品目录的入口，便于继续核对产品说明和验证资料。',
    selectionTitle: '常见抗体选型方向',
    selection: ['可按重组单抗、磷酸化、内参或标签抗体等类别缩小范围，再核对靶标与宿主。', 'WB、流式、IHC/成像等应用的验证条件可能不同，请以具体产品资料为准。', '同时比较克隆类型、反应种属、包装规格及随附验证数据。'],
    catalogFilters: [
      { category: '一抗' }, { category: '二抗' },
      { category: '一抗', subcategory: 'WB抗体' },
      { category: '一抗', subcategory: '流式抗体' },
      { category: '一抗', subcategory: 'IHC和成像抗体' },
    ],
    relatedSlugs: ['western-blot-reagents', 'elisa-kits'],
    relatedBrands: ['Thermo Fisher', 'Abcam', 'CST'],
    inquiryBrands: ['Proteintech'],
    brandNote: 'Proteintech 相关产品需求可通过询价沟通；此入口不代表目录中已有对应现货。',
  },
  {
    slug: 'elisa-kits',
    title: 'ELISA 试剂盒选购｜夹心法与竞争法',
    description: '按夹心法、竞争法及检测目标浏览 ELISA 试剂盒目录；选型时核对人、小鼠或大鼠等物种、样本类型、检测范围、灵敏度和实验流程，并查看标准品、抗体对等配套信息。',
    heading: 'ELISA 试剂盒：按检测方法与目标选择',
    intro: 'ELISA 试剂盒的适用性取决于检测目标、样本基质和实验设计。可从夹心法、竞争法及相关辅助试剂进入目录，再对照各产品说明中的性能和操作信息。',
    selectionTitle: '选型时建议核对',
    selection: ['确认目标物与样本类型是否在产品说明的适用范围内。', '对照标准曲线范围、检测限、孵育步骤及所需读板条件。', '若需要抗体对、蛋白标准品或配套辅助试剂，请分别查看对应目录。'],
    catalogFilters: [
      { category: 'ELISA试剂盒' },
      { category: 'ELISA试剂盒', subcategory: '夹心法ELISA' },
      { category: 'ELISA试剂盒', subcategory: '竞争法ELISA' },
      { category: 'ELISA试剂盒', subcategory: '抗体对和蛋白标准品' },
    ],
    relatedSlugs: ['antibodies', 'western-blot-reagents'],
    relatedBrands: ['Thermo Fisher', 'Abcam'],
    inquiryBrands: ['Proteintech'],
  },
  {
    slug: 'western-blot-reagents',
    title: 'Western Blot 试剂与抗体｜WB 选型入口',
    description: '查看 Western Blot 相关抗体和辅助试剂目录入口，按 WB 抗体、裂解与转印需求筛选；核对 RIPA、BCA、ECL 和 PVDF 等试剂耗材的适用条件。',
    heading: 'Western Blot 试剂：从抗体到转印耗材',
    intro: 'Western Blot 实验通常需要结合目标蛋白、样本制备方式、抗体验证信息和转印条件来选择试剂。以下入口连接到现有产品分类，具体适用条件以产品资料为准。',
    selectionTitle: 'WB 实验采购核对项',
    selection: ['优先核对抗体是否提供 WB 应用验证及推荐稀释条件，并按样本制备需求考虑 RIPA 裂解液。', '根据蛋白分子量和检测方式比较 PVDF 或其他转印膜；BCA 用于蛋白定量，ECL 用于化学发光检测，具体兼容性以产品说明为准。', '结合实验流程确认封闭、孵育和显色所需辅助试剂。'],
    catalogFilters: [
      { category: '一抗', subcategory: 'WB抗体' },
      { category: '样本制备和检测试剂盒', subcategory: 'WB辅助试剂' },
      { category: '材料合成', subcategory: '过滤与分离耗材' },
    ],
    relatedSlugs: ['antibodies', 'elisa-kits'],
    relatedBrands: ['Thermo Fisher', 'CST', 'Biosharp'],
    inquiryBrands: ['Proteintech'],
    brandNote: 'Proteintech 相关产品需求可通过询价沟通；此入口不代表目录中已有对应现货。',
  },
  {
    slug: 'cell-culture-plates',
    title: '细胞培养板选购｜多孔板与培养耗材',
    description: '浏览细胞培养板及相关细胞培养器皿分类，比较 6、12、24、48、96 孔板等常见孔数，并确认表面处理、无菌状态、材质与包装规格，按培养规模和下游读数选择板型。',
    heading: '细胞培养板：按培养与实验用途筛选',
    intro: '细胞培养板的选择需要匹配细胞类型、培养规模和下游实验。可从细胞培养板与培养器皿目录进入，具体表面处理、孔数和无菌信息请以产品规格为准。',
    selectionTitle: '细胞培养板选型要点',
    selection: ['按培养规模与读数方式比较 6、12、24、48 或 96 孔板等板型；实际可选规格以目录产品为准。', '核对是否需要组织培养处理、低吸附表面或特定材质。', '确认无菌状态、单独包装方式及适配的培养设备。'],
    catalogFilters: [
      { category: '材料合成', subcategory: '细胞培养器皿', productType: '细胞培养板' },
    ],
    relatedSlugs: ['cell-culture-flasks', 'elisa-kits'],
    relatedBrands: ['Thermo Fisher', 'Biosharp', 'Labselect'],
  },
  {
    slug: 'cell-culture-flasks',
    title: '细胞培养瓶选购｜培养瓶与细胞培养器皿',
    description: '浏览细胞培养瓶及细胞培养器皿目录入口，比较 T25、T75、T175 等培养面积标识，并核对瓶型、表面处理、瓶盖配置和无菌要求，按培养规模匹配操作流程。',
    heading: '细胞培养瓶：按培养规模核对规格',
    intro: '细胞培养瓶用于不同规模的贴壁细胞培养和扩增。选择前应核对瓶型、培养面积、瓶盖形式及表面处理，并确认产品规格符合实验室流程。',
    selectionTitle: '细胞培养瓶选型要点',
    selection: ['按细胞数量和培养规模比较 T25、T75、T175 等培养面积标识；具体可选规格以产品目录为准。', '根据培养箱和操作流程确认透气盖或密封盖等瓶盖配置。', '核对表面处理、无菌状态、材质和包装信息。'],
    catalogFilters: [
      { category: '材料合成', subcategory: '细胞培养器皿', productType: '细胞培养瓶' },
    ],
    relatedSlugs: ['cell-culture-plates'],
    relatedBrands: ['Thermo Fisher', 'Biosharp', 'Labselect'],
  },
];

export function getProductSeoCategory(slug: string) {
  return productSeoCategories.find((category) => category.slug === slug);
}

export function productCategoryCatalogHref(filter: { category: string; subcategory?: string; productType?: string }) {
  const params = new URLSearchParams({ cat: filter.category });
  if (filter.subcategory) params.set('sub', filter.subcategory);
  if (filter.productType) params.set('type', filter.productType);
  return `/products/catalog?${params.toString()}`;
}
