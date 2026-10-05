interface BrandDescription {
  name: string;
  description: string;
  detail?: string;
  aliases?: string[];
  catalogStatus?: 'catalog' | 'inquiry';
  seoTitle?: string;
  promotion?: {
    title: string;
    href: string;
    label: string;
  };
  subBrands?: {
    name: string;
    description: string;
  }[];
}

const brandDbNames: Record<string, string> = {
  'Cell Signaling Technology': 'CST',
};

function resolveBrandAlias(name: string): string | undefined {
  const normalizedName = name.toLocaleLowerCase();
  return Object.entries(brandDescriptions).find(([, info]) =>
    info.aliases?.some(alias => alias.toLocaleLowerCase() === normalizedName)
  )?.[0];
}

export function resolveDbBrandName(name: string): string {
  return resolveBrandAlias(name) ?? brandDbNames[name] ?? name;
}

export function resolveBrandKey(name: string): string {
  const aliasMatch = resolveBrandAlias(name);
  if (aliasMatch) return aliasMatch;
  const dbName = resolveDbBrandName(name);
  if (brandDescriptions[dbName]) return dbName;
  if (brandDescriptions[name]) return name;
  return dbName;
}

export function getBrandInfo(name: string): BrandDescription | undefined {
  return brandDescriptions[resolveBrandKey(name)];
}

export function getBrandDisplayName(name: string): string {
  return getBrandInfo(name)?.name ?? name;
}

export function brandPageHref(dbBrand: string): string {
  return `/brands/${encodeURIComponent(dbBrand)}`;
}

export const featuredBrands: { dbName: string; color: string }[] = [
  { dbName: 'Abcepta', color: 'from-emerald-500 to-teal-500' },
  { dbName: 'Thermo Fisher', color: 'from-blue-500 to-cyan-500' },
  { dbName: 'Abcam', color: 'from-red-500 to-pink-500' },
  { dbName: 'Sigma-Aldrich', color: 'from-amber-500 to-orange-500' },
  { dbName: 'CST', color: 'from-violet-500 to-purple-500' },
];

export const brandDescriptions: Record<string, BrandDescription> = {
  'Abcepta': {
    name: 'Abcepta',
    description: '美国抗体生产公司,自主生产抗体并提供多肽合成、蛋白表达等定制服务。产品以荧光标记抗体和高难度多肽合成为主。',
    detail: `Abcepta 成立于美国,主营抗体定制生产和多肽合成。其荧光标记抗体和高难度多肽合成是主要优势品类,提供定制抗体开发、多肽合成和蛋白表达服务。在中国大陆通过授权代理销售,提供本地技术支持。`,
    subBrands: [],
  },
  'Thermo Fisher': {
    name: 'Thermo Fisher Scientific',
    seoTitle: '赛默飞 Thermo Fisher Scientific 抗体、ELISA 与细胞培养产品',
    description: '赛默飞（Thermo Fisher Scientific）生命科学产品涵盖科研抗体、免疫分析试剂、细胞培养基与实验室耗材。可按 Invitrogen、Gibco、Thermo Scientific Nunc 等产品线和具体货号查找。',
    detail: `可按具体产品线查找：Invitrogen 一抗、二抗及免疫分析产品；Gibco 细胞培养基与培养试剂；Thermo Scientific Nunc 细胞培养板、培养瓶及培养皿。产品品牌和系列以各产品页面标注为准。`,
    subBrands: [
      { name: 'Thermo Scientific', description: '分析仪器、实验室设备、质谱、色谱、耗材和软件' },
      { name: 'Fisher BioReagents', description: '分子生物学、细胞培养、蛋白研究常用试剂' },
      { name: 'FastDigest', description: '快速限制性内切酶' },
      { name: 'ABfinity', description: '重组单克隆抗体' },
      { name: 'Novex', description: '预制 SDS-PAGE 凝胶与电泳试剂' },
      { name: 'Pierce', description: '蛋白定量与蛋白分析相关试剂' },
      { name: 'DreamTaq', description: 'Taq DNA 聚合酶' },
      { name: 'Phusion', description: '高保真 DNA 聚合酶' },
      { name: 'Phire', description: 'PCR 试剂' },
      { name: 'Annexin', description: '细胞凋亡检测试剂' },
      { name: 'GeneJET', description: '核酸纯化试剂盒' },
      { name: 'Invariant', description: '免疫分析相关试剂' },
      { name: 'Image-iT', description: '荧光成像试剂' },
      { name: 'PAGEruler', description: '蛋白分子量标准' },
      { name: 'RNAlater', description: 'RNA 稳定保存试剂' },
    ],
  },
  'Fisher BioReagents': {
    name: 'Fisher BioReagents',
    description: 'Thermo Fisher 旗下的分子生物学与细胞培养试剂品牌,覆盖核酸电泳、PCR、缓冲液、培养基、蛋白提取定量与 Western Blot 等常用实验场景。',
    detail: `Fisher BioReagents 聚焦生命科学研究中的基础试剂。产品覆盖分子生物学、细胞培养、蛋白研究和免疫检测方向，适合常规实验室建立稳定库存,也支持按项目采购小规格试剂。`,
    subBrands: [],
  },
  'Abcam': {
    name: 'Abcam',
    seoTitle: 'Abcam 抗体、Western blot 验证抗体与 ELISA 试剂盒',
    description: 'Abcam 科研产品包括一抗、二抗、重组抗体、ELISA 试剂盒及免疫分析组件，提供 Western blot 验证抗体、SimpleStep ELISA 与配对抗体等产品类别。',
    detail: `可按靶标、宿主、应用及验证信息筛选抗体。相关品类包括一抗、二抗、Western blot 验证抗体、SimpleStep ELISA 试剂盒、配对抗体及 ELISA 开发组件。具体适用实验与验证结果请以对应产品资料为准。`,
    subBrands: [],
  },
  'Sigma-Aldrich': {
    name: 'Sigma-Aldrich',
    description: '德国默克集团旗下的生命科学与生物技术产品供应商,以品类齐全的化学与生化试剂著称。',
    detail: `Sigma-Aldrich 由 Sigma Chemical Company(1946)和 Aldrich Chemical Company(1951)于 1975 年合并而成。2015 年被德国默克(Merck KGaA)以 170 亿美元收购,与 Millipore 合并为 MilliporeSigma。

其特点是产品广度:超过 30 万种化学品、生化试剂、抗体、细胞培养产品和实验室耗材。旗下子品牌包括 Milli-Q(超纯水)、Supelco(色谱)、SAFC(生物制药原料)、BioReliance(生物测试服务)等。

在中国大陆通过西格玛奥德里奇(上海)贸易有限公司运营,在北京、上海、苏州、无锡设有分支机构和物流中心。`,
    subBrands: [
      { name: 'Sigma®', description: '细胞培养、抗体、酶、CRISPR 工具、生物活性小分子' },
      { name: 'Aldrich®', description: '有机/无机合成原料、材料科学化学品' },
      { name: 'Fluka®', description: '高纯度分析试剂、卡尔费休试剂、离子对试剂' },
      { name: 'Supelco®', description: 'GC/HPLC 色谱柱、固相萃取产品' },
      { name: 'SAFC®', description: 'GMP 级别生物制药原料、培养基' },
      { name: 'Vetec™', description: '高性价比常用基础试剂' },
      { name: 'Milli-Q®', description: '超纯水系统' },
      { name: 'BioReliance®', description: '生物安全性测试、工艺验证' },
    ],
  },
  'CST': {
    name: 'Cell Signaling Technology',
    seoTitle: 'CST Cell Signaling Technology 抗体与 Western blot 试剂',
    description: 'Cell Signaling Technology（CST）提供细胞信号研究抗体和实验试剂，覆盖常见靶标及磷酸化等修饰检测；另有 Western blotting 应用解决方案试剂盒。',
    detail: `可按靶标和实验应用查找 CST 抗体及配套试剂。Western Blotting Application Solutions Kit 覆盖从样品制备到检测所需的相关试剂；抗体的适用应用和验证信息请以具体产品资料为准。`,
    subBrands: [],
  },
  'Labselect': {
    name: 'Labselect（甄选）',
    description: '国产实验室耗材品牌,主做细胞培养、分子生物学与液体处理耗材,走性价比路线。',
    detail: `Labselect 是中国本土实验室耗材品牌,面向高校实验室、医院科研平台、第三方检测机构和生物医药企业研发中心。产品覆盖细胞培养、液体处理、样品储存、分子检测前处理等基础实验流程,提供合规、可负担的国产耗材。`,
    subBrands: [],
  },
  'Biosharp': {
    name: 'Biosharp（白鲨）',
    description: '中国本土实验室耗材与基础试剂品牌,提供离心管、吸头、手套等一次性耗材以及常用基础试剂。',
    detail: `Biosharp 是中国实验室耗材品牌,主营一次性实验耗材(离心管、吸头、手套、PCR 管等)和部分常用基础试剂科研场景。`,
    subBrands: [],
  },
  Proteintech: {
    name: 'Proteintech',
    seoTitle: 'Proteintech 抗体、ELISA 试剂盒与免疫分析产品',
    aliases: ['武汉三鹰', '武汉三鹰生物技术有限公司', 'Proteintech Group', 'PTG'],
    catalogStatus: 'inquiry',
    description: 'Proteintech（武汉三鹰）科研产品涵盖一抗、二抗、重组抗体、免疫印迹（WB）抗体、ELISA 试剂盒及抗体对。当前目录尚未展示具体货号，可联系咨询并询价采购。',
    detail: `相关产品类别包括一抗、二抗、重组抗体、免疫印迹（WB）抗体、ELISA 试剂盒及抗体对。当前品牌页尚未展示可浏览的产品条目；如需确认具体靶标、货号与供货信息，请通过咨询联系。`,
    subBrands: [],
  },
  '近岸蛋白': {
    name: '近岸蛋白（NovoProtein）',
    seoTitle: '近岸蛋白 NovoProtein 细胞因子、靶点蛋白与参照抗体',
    aliases: ['NovoProtein', '苏州近岸蛋白质科技股份有限公司'],
    catalogStatus: 'inquiry',
    description: '近岸蛋白（NovoProtein）产品包括细胞因子、靶点蛋白、参照抗体、病毒研究相关产品及基质胶和培养基。当前目录尚未展示具体货号，可联系咨询并询价采购。',
    detail: `近岸蛋白官方产品分类包括细胞因子、靶点蛋白、参照抗体、病毒研究相关产品及基质胶和培养基。当前品牌页尚未展示可浏览的产品条目；请联系咨询具体靶点、货号与供货信息。`,
    subBrands: [],
  },
};

export const inquiryBrands = Object.entries(brandDescriptions)
  .filter(([, info]) => info.catalogStatus === 'inquiry')
  .map(([dbName]) => dbName);
