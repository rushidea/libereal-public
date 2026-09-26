interface BrandDescription {
  name: string;
  description: string;
  detail?: string;
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

export function resolveDbBrandName(name: string): string {
  return brandDbNames[name] ?? name;
}

export function resolveBrandKey(name: string): string {
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
    description: '科学服务领域的大型供应商,提供仪器、试剂、耗材等实验室产品。旗下拥有多个子品牌,覆盖分子、细胞、蛋白、基因组学等多条实验线。',
    detail: `赛默飞世尔(TMO)成立于1956年,总部位于美国马萨诸塞州。年营收约400亿美元,全球约7万名员工,在50个国家有业务运营。1982年进入中国,中国总部设在上海,在北京、苏州、广州设有研发中心,员工超过7000人。

通过多次并购(Life Technologies、Patheon、PPD 等)形成了多条产品线的品牌矩阵:
• Thermo Scientific:分析仪器、实验室设备、质谱、色谱、耗材软件
• Invitrogen / Gibco:细胞培养基、血清、转染试剂、抗体、核酸纯化
• Applied Biosystems:qPCR、数字PCR、测序系统
• Fisher Scientific:渠道品牌,提供超200万种产品的采购与物流

在中国大陆通过授权代理商提供售前售后技术支持。`,
    subBrands: [
      { name: 'Thermo Scientific', description: '分析仪器、实验室设备、质谱、色谱、耗材和软件' },
      { name: 'Fisher BioReagents', description: '分子生物学、细胞培养、蛋白研究常用试剂,支持小规格采购' },
      { name: 'FastDigest', description: '快速限制性内切酶' },
      { name: 'ABfinity', description: '重组单克隆抗体' },
      { name: 'Novex', description: '预制 SDS-PAGE 凝胶与电泳试剂' },
      { name: 'Pierce', description: 'BCA 蛋白定量等经典试剂' },
      { name: 'DreamTaq', description: 'Taq DNA 聚合酶' },
      { name: 'Phusion', description: '高保真 DNA 聚合酶' },
      { name: 'Phire', description: '快速 PCR 试剂' },
      { name: 'Annexin', description: '细胞凋亡检测试剂' },
      { name: 'GeneJET', description: '核酸纯化试剂盒' },
      { name: 'Invariant', description: '链霉亲和素系统' },
      { name: 'Image-iT', description: '荧光成像试剂' },
      { name: 'PAGEruler', description: '预染蛋白分子量标准' },
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
    description: '英国抗体生产与供应商,以重组抗体和透明的验证数据为特色。2023 年被丹纳赫集团收购。全球超过 75 万名科研用户。',
    detail: `Abcam 1998 年成立于英国剑桥,2023 年被丹纳赫(Danaher)收购。总部位于英国,在美国、日本、中国香港设有分公司,覆盖 140 多个国家。

其特点是:
• 抗体品类全:超过 11 万种产品,含 3.7 万多种重组抗体
• 验证数据透明:官网提供实验图示、稀释比例、敲除(Knockout)验证数据
• 定制服务:提供从靶点到抗体的全周期支持

在中国大陆通过授权代理(如江苏康成百澳)提供现货和技术支持。`,
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
    description: '美国抗体公司,由科学家创立并管理,主做细胞信号转导和翻译后修饰(特别是磷酸化)抗体。',
    detail: `CST 1999 年成立于美国马萨诸塞州,由科学家创立并管理的私营家族企业。研发团队中超过 90% 为博士,兼做产品开发和技术支持。

主做磷酸化等翻译后修饰抗体,每支抗体经过多种实验平台(WB、IP、IHC、IF、Flow、ChIP)验证,含基因敲除验证数据。还提供 ELISA 试剂盒、染色质免疫沉淀试剂盒、siRNA 等科研工具。

免费开放 PhosphoSitePlus® 数据库(蛋白质翻译后修饰)和《Cell Signaling Handbook》信号通路手册。

2008 年在上海设立中国分公司,通过授权代理提供现货和技术支持。`,
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
};
