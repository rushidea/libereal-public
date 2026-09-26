import { Activity, BarChart3, CircleDot, Dna, Droplets, Magnet, Microscope, TestTube } from 'lucide-react';
import type { ComponentType } from 'react';

export type SceneLevel = 'beginner' | 'intermediate' | 'expert';
export type SceneIntent = 'first' | 'repeat';

export type SceneBundle = {
  title: string;
  summary: string;
  required: string[];
  recommended: string[];
  upgrades: string[];
  productLinks: { label: string; href: string }[];
  inquiryNote: string;
};

export type SceneDifficulty = {
  id: string;
  label: string;
  symptom: string;
  causes: string[];
  checks: string[];
  fixes: string[];
  productLinks: { label: string; href: string }[];
  bundleHint: string;
  inquiryNote: string;
};

export type SceneResource = {
  label: string;
  href: string;
  description: string;
  category?: string;
  iconUrl?: string;
  contextLabel?: string;
};

export type ScenePoint = {
  title: string;
  description: string;
};

export type SceneWorkflowStep = ScenePoint & {
  checks: string[];
  outputs: string[];
  productLinks: { label: string; href: string }[];
};

export type SceneDecisionPoint = ScenePoint & {
  productLinks?: { label: string; href: string }[];
};

export type SceneDefinition = {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  icon: ComponentType<{ className?: string }>;
  accentClass: string;
  overview: ScenePoint[];
  workflow: SceneWorkflowStep[];
  decisionPoints: SceneDecisionPoint[];
  difficulties: SceneDifficulty[];
  productLinks: { label: string; href: string }[];
  protocols: SceneResource[];
  analysisSoftware?: SceneResource[];
  supportLinks: SceneResource[];
  brands: string[];
  faqs: { question: string; answer: string }[];
  bundles: Record<SceneLevel, Record<SceneIntent, SceneBundle>>;
};

export const sceneLevelLabels: Record<SceneLevel, string> = {
  beginner: '入门',
  intermediate: '进阶中级',
  expert: '资深专家',
};

export const sceneIntentLabels: Record<SceneIntent, string> = {
  first: '初购配置',
  repeat: '复购补货',
};

const antibodyPublicResources: SceneResource[] = [
  {
    label: 'Antibodypedia',
    href: 'https://www.antibodypedia.com/',
    description: '按靶标和实验应用查询抗体，并查看公开验证评分与实验资料。',
    category: '抗体验证与选型',
  },
  {
    label: 'CiteAb',
    href: 'https://www.citeab.com/',
    description: '按靶标、应用和物种筛选抗体，并查看文献引用与实际使用记录。',
    category: '抗体验证与选型',
  },
  {
    label: 'Human Protein Atlas',
    href: 'https://www.proteinatlas.org/',
    description: '按基因和蛋白条目查看组织、细胞定位及抗体验证参考资料。',
    category: '蛋白表达与抗体验证',
  },
];

/**
 * B06 研究专题中反复涉及的公共计算资源。它们用于提出和整理研究假设，
 * 不代表实验验证、产品性能或临床结论。
 */
const computationalMolecularResearchTools: SceneResource[] = [
  {
    label: 'RCSB Protein Data Bank',
    href: 'https://www.rcsb.org/',
    description: '公共实验结构数据库；条目可用于查找结构与实验条件，但不能脱离原始论文解释功能。',
    category: '蛋白结构与相互作用',
    contextLabel: '结构预测与结构测量',
  },
  {
    label: 'AlphaFold Protein Structure Database',
    href: 'https://alphafold.ebi.ac.uk/',
    description: '公共预测结构数据库；适合提出结构假设，高置信度也不等于实验结构、结合或功能证据。',
    category: '蛋白结构与相互作用',
    contextLabel: '结构预测与结构测量',
  },
  {
    label: 'ColabFold',
    href: 'https://github.com/sokrypton/ColabFold',
    description: 'MIT 开源的蛋白及复合体结构预测工作流；模型与置信度不能替代界面和功能实验。',
    category: '蛋白结构与相互作用',
    contextLabel: '结构预测与结构测量',
  },
  {
    label: 'Electron Microscopy Data Bank',
    href: 'https://www.ebi.ac.uk/emdb/',
    description: '公共冷冻电镜三维图和代表性断层图数据库；沉积图需结合局部分辨率、模型和原始论文解释。',
    category: '冷冻电镜数据与分析',
    contextLabel: '冷冻电镜与原位结构',
  },
  {
    label: 'EMPIAR',
    href: 'https://www.ebi.ac.uk/empiar/',
    description: '公共电子显微镜原始图像档案；复用数据时仍需核对样本、采集参数和完整处理流程。',
    category: '冷冻电镜数据与分析',
    contextLabel: '冷冻电镜与原位结构',
  },
  {
    label: 'RELION',
    href: 'https://github.com/3dem/relion',
    description: 'GPL-2.0 开源的冷冻电镜图像处理软件；重建结果受制样、颗粒选择和处理参数影响。',
    category: '冷冻电镜数据与分析',
    contextLabel: '冷冻电镜与原位结构',
  },
  {
    label: 'ChEMBL',
    href: 'https://www.ebi.ac.uk/chembl/',
    description: '公共化学与生物活性数据库；不同实验条件下的活性值不能直接比较，也不能代替本项目复验。',
    category: '化合物与生物活性数据',
    contextLabel: 'AI 分子设计与虚拟筛选',
  },
  {
    label: 'PubChem',
    href: 'https://pubchem.ncbi.nlm.nih.gov/',
    description: '公共化合物与生物测定数据库；适合候选检索，数据库记录本身不证明样品纯度或实验可重复性。',
    category: '化合物与生物活性数据',
    contextLabel: 'AI 分子设计与虚拟筛选',
  },
  {
    label: 'DeepChem',
    href: 'https://github.com/deepchem/deepchem',
    description: 'MIT 开源的分子机器学习工具链；回顾性模型指标不能替代前瞻性合成和实验命中率。',
    category: 'AI 分子建模与化学信息学',
    contextLabel: 'AI 分子设计与虚拟筛选',
  },
  {
    label: 'AutoDock Vina',
    href: 'https://github.com/ccsb-scripps/AutoDock-Vina',
    description: 'Apache-2.0 开源分子对接引擎；用于生成和排序候选构象，对接分数不是结合或活性证据。',
    category: '分子对接与虚拟筛选',
    contextLabel: 'AI 分子设计与虚拟筛选',
  },
  {
    label: 'RDKit',
    href: 'https://github.com/rdkit/rdkit',
    description: 'BSD-3-Clause 开源化学信息学工具包；用于分子表示、计算和过滤，计算属性仍需实验确认。',
    category: 'AI 分子建模与化学信息学',
    contextLabel: 'AI 分子设计与虚拟筛选',
  },
  {
    label: 'ProteinMPNN',
    href: 'https://github.com/dauparas/ProteinMPNN',
    description: 'MIT 开源的蛋白序列设计工具；生成序列后仍需构建、表达、折叠和功能验证。',
    category: '蛋白设计与工程',
    contextLabel: '从头蛋白设计与工程',
  },
  {
    label: 'RFdiffusion',
    href: 'https://github.com/RosettaCommons/RFdiffusion',
    description: 'BSD 开源的生成式蛋白设计工具；候选骨架不等于可表达、正确折叠或具有预期功能。',
    category: '蛋白设计与工程',
    contextLabel: '从头蛋白设计与工程',
  },
];

const wbBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手 WB 初购组合',
      summary: '适合第一次搭建 Western Blot 体系的实验室，重点补齐基础试剂和常用耗材。',
      required: ['WB 一抗', 'HRP 偶联二抗', 'ECL 发光液', 'PVDF 膜', '预染蛋白 Marker'],
      recommended: ['RIPA 裂解液', 'BCA 蛋白定量试剂盒', '封闭液', 'TBST 洗液', '转膜缓冲液'],
      upgrades: ['高灵敏 ECL', '预制胶', '转膜套装'],
      productLinks: [
        { label: 'WB抗体', href: '/products?sub=WB抗体' },
        { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
        { label: 'HRP偶联二抗', href: '/products?sub=HRP偶联二抗' },
      ],
      inquiryNote: 'Western Blot 新手初购组合：一抗、HRP 二抗、ECL、PVDF 膜、Marker、裂解液、BCA、封闭液、TBST。',
    },
    repeat: {
      title: '新手 WB 复购补货',
      summary: '适合已经跑通 WB 流程后补充高频消耗品，避免重复采购低频工具项。',
      required: ['常用一抗补货', 'HRP 二抗补货', 'ECL 发光液', 'PVDF 膜'],
      recommended: ['TBST 洗液', '封闭液', '蛋白 Marker'],
      upgrades: ['高灵敏 ECL', '大包装洗液/缓冲液'],
      productLinks: [
        { label: 'WB抗体', href: '/products?sub=WB抗体' },
        { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
      ],
      inquiryNote: 'Western Blot 新手复购补货：常用一抗/二抗、ECL、PVDF 膜、TBST、封闭液。',
    },
  },
  intermediate: {
    first: {
      title: '进阶 WB 初购组合',
      summary: '适合需要兼顾多靶点、多样本和对照体系的团队，强调抗体验证和背景控制。',
      required: ['目标蛋白一抗', '内参抗体', 'HRP 二抗', '阳性/阴性对照样本', '高灵敏 ECL'],
      recommended: ['蛋白酶/磷酸酶抑制剂', 'BCA 试剂盒', '低背景封闭液', 'PVDF/NC 膜对比'],
      upgrades: ['磷酸化抗体组合', 'IP/Co-IP 前处理试剂', '多规格 ECL 梯度选择'],
      productLinks: [
        { label: '内参抗体', href: '/products?sub=内参抗体' },
        { label: '磷酸化抗体', href: '/products?sub=磷酸化抗体' },
        { label: 'ChIP和IP试剂', href: '/products?sub=ChIP和IP试剂' },
      ],
      inquiryNote: 'Western Blot 进阶初购组合：目标蛋白、内参、磷酸化抗体、高灵敏 ECL、低背景封闭体系。',
    },
    repeat: {
      title: '进阶 WB 复购补货',
      summary: '适合稳定课题组复现实验并控制单次成本，优先补充已验证品牌和批量规格。',
      required: ['已验证一抗/二抗', '高频 ECL', 'PVDF 膜', '蛋白 Marker'],
      recommended: ['批量 TBST/封闭液', 'BCA 补货', '裂解液补货'],
      upgrades: ['替代品牌比价', '同靶点多克隆验证', '授信月结与批量报价'],
      productLinks: [
        { label: '抗体组合套装', href: '/products?sub=抗体组合套装' },
        { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
      ],
      inquiryNote: 'Western Blot 进阶复购补货：已验证抗体、高频 ECL、PVDF、Marker、批量缓冲液。',
    },
  },
  expert: {
    first: {
      title: '专家 WB 初购组合',
      summary: '适合高难样本、低丰度蛋白或需要建立高灵敏检测平台的团队。',
      required: ['高特异性一抗', '高灵敏 ECL', '低背景封闭体系', '高质量膜材', '完整对照抗体'],
      recommended: ['亚细胞组分提取试剂', '磷酸化保护体系', 'IP/Co-IP 试剂', '多品牌抗体验证'],
      upgrades: ['定制抗体', '自动化 Western 相关试剂', '长期批量供货方案'],
      productLinks: [
        { label: 'ChIP和IP抗体', href: '/products?sub=ChIP和IP抗体' },
        { label: '磷酸化抗体', href: '/products?sub=磷酸化抗体' },
        { label: '重组多抗和传统多抗', href: '/products?sub=重组多抗和传统多抗' },
      ],
      inquiryNote: 'Western Blot 专家初购组合：高灵敏、低背景、多品牌验证、IP/Co-IP 和磷酸化体系。',
    },
    repeat: {
      title: '专家 WB 复购补货',
      summary: '适合长期项目和平台型实验室，强调批量、稳定批次、授信账期和折扣政策。',
      required: ['大包装 ECL', '批量 PVDF 膜', '稳定批次一抗/二抗', '常用 Marker'],
      recommended: ['批量缓冲液', '项目专属备货', '多课题组共享清单'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: 'WB抗体', href: '/products?sub=WB抗体' },
        { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
      ],
      inquiryNote: 'Western Blot 专家复购补货：大包装、稳定批次、批量报价、授信账期和专属折扣。',
    },
  },
};

const elisaBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手 ELISA 初购组合',
      summary: '适合第一次做 ELISA 定量检测的用户，优先选择完整试剂盒和基础耗材。',
      required: ['目标指标 ELISA 试剂盒', '标准品', '酶标板', '洗液', 'TMB 底物'],
      recommended: ['封板膜', '移液枪吸头', '样本稀释液', '终止液', '酶标仪适配耗材'],
      upgrades: ['预包被板', '高灵敏试剂盒', '多指标组合检测'],
      productLinks: [
        { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
        { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
        { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
      ],
      inquiryNote: 'ELISA 新手初购组合：目标指标试剂盒、标准品、酶标板、洗液、底物、封板膜和样本稀释液。',
    },
    repeat: {
      title: '新手 ELISA 复购补货',
      summary: '适合已确认检测指标后补充试剂盒和高消耗辅助试剂。',
      required: ['同指标 ELISA 试剂盒', '洗液', 'TMB 底物', '封板膜'],
      recommended: ['标准品补货', '样本稀释液', '吸头/板材'],
      upgrades: ['同指标不同品牌比价', '批量规格', '现货优先方案'],
      productLinks: [
        { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
        { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
      ],
      inquiryNote: 'ELISA 新手复购补货：同指标试剂盒、洗液、TMB、封板膜、标准品和耗材。',
    },
  },
  intermediate: {
    first: {
      title: '进阶 ELISA 初购组合',
      summary: '适合多样本类型、多物种或多指标检测，重点关注检测范围、灵敏度和样本兼容性。',
      required: ['目标指标试剂盒', '匹配物种试剂盒', '标准曲线材料', '样本预处理试剂'],
      recommended: ['抗体对和蛋白标准品', '重复孔耗材', '质控样本', '洗板相关耗材'],
      upgrades: ['夹心法ELISA', '多指标联检', '夹心法ELISA'],
      productLinks: [
        { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
        { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
        { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
      ],
      inquiryNote: 'ELISA 进阶初购组合：多物种/多样本试剂盒、标准曲线、样本预处理、质控和抗体对。',
    },
    repeat: {
      title: '进阶 ELISA 复购补货',
      summary: '适合稳定检测项目持续补货，优先保障批次一致性和检测窗口稳定。',
      required: ['已验证试剂盒批量补货', '标准品', '洗液', '底物'],
      recommended: ['同批次/近批次需求备注', '样本稀释液', '质控样本'],
      upgrades: ['批量折扣', '替代品牌备选', '授信账期'],
      productLinks: [
        { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
        { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
      ],
      inquiryNote: 'ELISA 进阶复购补货：已验证试剂盒、同批次需求、标准品、底物、洗液和批量报价。',
    },
  },
  expert: {
    first: {
      title: '专家 ELISA 初购组合',
      summary: '适合低丰度因子、复杂样本或方法开发，支持高灵敏和定制化检测方案。',
      required: ['高灵敏 ELISA 试剂盒', '抗体对', '重组蛋白标准品', '样本预处理体系'],
      recommended: ['夹心法ELISA', '多指标验证组合', '基质效应评估材料'],
      upgrades: ['定制抗体对', '方法学开发支持', '大样本项目报价'],
      productLinks: [
        { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
        { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
        { label: '重组蛋白', href: '/products?sub=重组蛋白' },
      ],
      inquiryNote: 'ELISA 专家初购组合：高灵敏检测、抗体对、重组蛋白标准品、复杂样本方法开发。',
    },
    repeat: {
      title: '专家 ELISA 复购补货',
      summary: '适合平台项目和大样本队列，强调批量供应、价格稳定和长期合作。',
      required: ['批量 ELISA 试剂盒', '标准品', '辅助试剂', '项目备货'],
      recommended: ['长期批次管理', '多指标项目清单', '质控材料'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
        { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
      ],
      inquiryNote: 'ELISA 专家复购补货：批量试剂盒、长期批次管理、项目备货、授信账期和专属折扣。',
    },
  },
};

const ihcBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手 IHC 初购组合',
      summary: '适合第一次做免疫组化染色的用户，重点补齐切片、修复、封闭、检测和显色材料。',
      required: ['IHC 验证一抗', 'HRP 聚合物检测系统', '抗原修复液', 'DAB 显色液', '苏木素复染液'],
      recommended: ['封闭液', 'PBS/TBS 洗液', '防脱载玻片', '封片剂', '阳性组织对照'],
      upgrades: ['预稀释 IHC 一抗', '自动染色机兼容试剂', '多重 IHC 检测体系'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        { label: '二抗', href: '/products?sub=二抗' },
      ],
      inquiryNote: 'IHC 新手初购组合：IHC 验证一抗、HRP 检测系统、抗原修复液、DAB、苏木素、封闭液、防脱片和封片剂。',
    },
    repeat: {
      title: '新手 IHC 复购补货',
      summary: '适合已跑通染色流程后补充高频消耗品，优先保持抗体、修复液和显色体系一致。',
      required: ['已验证一抗补货', 'DAB 显色液', '抗原修复液', '封片剂'],
      recommended: ['PBS/TBS 洗液', '封闭液', '防脱载玻片', '苏木素复染液'],
      upgrades: ['同靶点替代抗体', '更低背景检测系统', '批量切片项目备货'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: 'IHC 新手复购补货：已验证一抗、DAB、抗原修复液、封闭液、PBS/TBS、防脱片和封片剂。',
    },
  },
  intermediate: {
    first: {
      title: '进阶 IHC 初购组合',
      summary: '适合多组织、多靶点或需要评分一致性的项目，强调对照体系和背景控制。',
      required: ['多靶点 IHC 一抗', '阳性/阴性组织对照', 'HRP 或 AP 检测系统', '柠檬酸/EDTA 修复液'],
      recommended: ['内源性过氧化物酶封闭液', '正常血清封闭液', '抗体稀释液', '质控切片'],
      upgrades: ['双染/多重 IHC 试剂', '数字病理扫描兼容封片剂', '项目批次锁定'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        { label: '重组单抗', href: '/products?sub=重组单抗' },
      ],
      inquiryNote: 'IHC 进阶初购组合：多靶点一抗、组织对照、HRP/AP 检测系统、抗原修复、内源酶封闭和质控切片。',
    },
    repeat: {
      title: '进阶 IHC 复购补货',
      summary: '适合稳定项目持续补货，重点是保持抗体批次、修复条件、显色时间和封片体系一致。',
      required: ['已验证一抗/二抗', '检测系统补货', 'DAB/底物', '修复液'],
      recommended: ['批量防脱片', '封闭液', '洗液', '批次桥接对照切片'],
      upgrades: ['替代品牌比价', '同批次或近批次备注', '自动化染色试剂匹配'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: 'IHC 进阶复购补货：已验证抗体、检测系统、DAB、修复液、防脱片、对照切片和批次备注。',
    },
  },
  expert: {
    first: {
      title: '专家 IHC 初购组合',
      summary: '适合低丰度靶点、临床样本队列或多重染色项目，强调验证、灵敏度和批间一致性。',
      required: ['高特异性 IHC 一抗', '高灵敏聚合物检测系统', '多组织阳性/阴性对照', '优化型修复液'],
      recommended: ['信号放大试剂', '多重 IHC 检测试剂', '数字病理质控材料', '批量封片耗材'],
      upgrades: ['定制抗体或抗体筛选', '大样本项目备货', '长期批次管理'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        { label: '定制抗体服务', href: '/products?keyword=custom%20antibody' },
      ],
      inquiryNote: 'IHC 专家初购组合：低丰度靶点、高灵敏检测、多组织对照、多重染色、信号放大和批量项目备货。',
    },
    repeat: {
      title: '专家 IHC 复购补货',
      summary: '适合长期队列和平台型实验室，关注同批次、稳定供货、评分一致性和批量价格。',
      required: ['稳定批次一抗', '批量检测系统', 'DAB/修复液项目备货', '对照切片'],
      recommended: ['批量防脱片和封片剂', '项目专属补货清单', '桥接质控切片'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: 'IHC 专家复购补货：稳定批次一抗、批量检测系统、DAB/修复液备货、对照切片、授信账期和长期供货。',
    },
  },
};

const immunofluorescenceBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手免疫荧光初购组合',
      summary: '适合第一次做细胞或切片免疫荧光，重点是买齐一抗、荧光二抗、核染、封闭通透和抗淬灭封片材料。',
      required: ['IF 验证一抗', '荧光二抗', 'DAPI/核染料', '封闭液', '抗淬灭封片剂'],
      recommended: ['固定液', '通透液', 'PBS/TBS 洗液', '爬片/防脱载玻片', '无一抗阴性对照'],
      upgrades: ['交叉吸附荧光二抗', '预吸附二抗', '共聚焦适配封片剂'],
      productLinks: [
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: '免疫荧光新手初购组合：IF 验证一抗、荧光二抗、DAPI、封闭液、通透液、PBS/TBS、抗淬灭封片剂和对照材料。',
    },
    repeat: {
      title: '新手免疫荧光复购补货',
      summary: '适合已跑通染色流程后补充高频消耗品，优先保持抗体、二抗通道和封片体系一致。',
      required: ['已验证一抗补货', '荧光二抗补货', 'DAPI/核染料', '抗淬灭封片剂'],
      recommended: ['PBS/TBS 洗液', '封闭/通透液', '爬片/载玻片', '低吸附耗材'],
      upgrades: ['更亮荧光染料二抗', '低背景封闭液', '批量项目备货'],
      productLinks: [
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: '免疫荧光新手复购补货：已验证一抗、荧光二抗、DAPI、抗淬灭封片剂、PBS/TBS、封闭和通透试剂。',
    },
  },
  intermediate: {
    first: {
      title: '进阶免疫荧光初购组合',
      summary: '适合双标、三标或共定位项目，重点是通道规划、宿主搭配、交叉反应控制和对照体系。',
      required: ['多靶点 IF 一抗', '多通道荧光二抗', '交叉吸附二抗', 'DAPI/膜或细胞器染料'],
      recommended: ['同型对照', '无一抗对照', '抗体稀释液', '抗淬灭封片剂', '低背景封闭液'],
      upgrades: ['直接偶联抗体试剂盒', 'TSA 信号放大', '共聚焦成像适配耗材'],
      productLinks: [
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
      ],
      inquiryNote: '免疫荧光进阶初购组合：多靶点一抗、多通道荧光二抗、交叉吸附二抗、DAPI、同型/无一抗对照和抗淬灭封片剂。',
    },
    repeat: {
      title: '进阶免疫荧光复购补货',
      summary: '适合稳定共定位项目持续补货，重点维持荧光通道、曝光参数和抗体批次一致。',
      required: ['已验证一抗/荧光二抗', 'DAPI/核染料', '抗淬灭封片剂', '封闭/通透液'],
      recommended: ['桥接对照样本', '低自发荧光耗材', '同批次或近批次备注'],
      upgrades: ['替代荧光通道方案', '更高亮度二抗', '项目专属补货清单'],
      productLinks: [
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: '免疫荧光进阶复购补货：已验证抗体、荧光二抗、DAPI、抗淬灭封片剂、桥接对照和批次备注。',
    },
  },
  expert: {
    first: {
      title: '专家免疫荧光初购组合',
      summary: '适合低丰度靶点、多重染色、复杂组织或高分辨成像，强调信噪比、光谱分离和定量一致性。',
      required: ['高特异性 IF 一抗', '高亮荧光二抗', '交叉吸附二抗', '抗淬灭封片剂', '完整对照体系'],
      recommended: ['TSA 信号放大', '直接偶联抗体', '自发荧光淬灭剂', '共聚焦/超分辨适配封片剂'],
      upgrades: ['定制荧光偶联', '多重成像方案设计', '长期批次管理'],
      productLinks: [
        { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      inquiryNote: '免疫荧光专家初购组合：高特异性 IF 一抗、高亮荧光二抗、TSA、自发荧光淬灭、抗淬灭封片和多重成像方案。',
    },
    repeat: {
      title: '专家免疫荧光复购补货',
      summary: '适合长期成像平台和大样本项目，关注稳定批次、通道一致、定量可比和批量供应。',
      required: ['稳定批次一抗/二抗', '批量抗淬灭封片剂', 'DAPI/成像染料', '质控样本'],
      recommended: ['长期批次管理', '项目备货', '多课题组共享清单'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
        { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
      ],
      inquiryNote: '免疫荧光专家复购补货：稳定批次抗体、高亮二抗、封片剂、质控样本、项目备货、授信账期和长期供货。',
    },
  },
};

const flowCytometryBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手流式初购组合',
      summary: '适合第一次做流式检测，重点是把表面标志物抗体、死活染、缓冲液、滤网和对照管补齐。',
      required: ['流式验证抗体', '死活染料', 'FACS Buffer', '细胞滤网', '流式管'],
      recommended: ['Fc Block', '单染补偿对照', '同型对照', '红细胞裂解液', '计数板或细胞计数试剂'],
      upgrades: ['预混 panel', '补偿微球', 'Fixable viability dye'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
        { label: '样本制备', href: '/products?sub=样本制备' },
      ],
      inquiryNote: '流式新手初购组合：流式抗体、死活染、FACS Buffer、Fc Block、流式管、细胞滤网、补偿和同型对照。',
    },
    repeat: {
      title: '新手流式复购补货',
      summary: '适合已跑通过程后补充高频消耗品，优先保持抗体克隆号、荧光素和染色缓冲体系一致。',
      required: ['已验证流式抗体', '死活染料', 'FACS Buffer', '流式管'],
      recommended: ['细胞滤网', '红细胞裂解液', '补偿对照材料'],
      upgrades: ['同克隆不同荧光素替代', '大包装缓冲液', '批量项目备货'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
      ],
      inquiryNote: '流式新手复购补货：已验证抗体、死活染、FACS Buffer、流式管、细胞滤网和补偿材料。',
    },
  },
  intermediate: {
    first: {
      title: '进阶流式初购组合',
      summary: '适合多色 panel、免疫分型或胞内染色项目，重点是 panel 设计、补偿控制和样本制备一致性。',
      required: ['多色流式抗体 panel', '死活染料', '补偿微球', 'FMO 对照', '固定/通透试剂'],
      recommended: ['Fc Block', '细胞刺激/阻断试剂', '红细胞裂解液', '低吸附耗材'],
      upgrades: ['预混 cocktail', '胞内因子染色套装', '分选级缓冲液'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '抗体组合套装', href: '/products?sub=抗体组合套装' },
        { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
      ],
      inquiryNote: '流式进阶初购组合：多色 panel、补偿微球、FMO、死活染、固定通透、Fc Block 和样本制备试剂。',
    },
    repeat: {
      title: '进阶流式复购补货',
      summary: '适合稳定 panel 持续补货，重点保持克隆号、荧光素、补偿设置和仪器模板一致。',
      required: ['已验证 panel 抗体', '死活染', '补偿材料', 'FACS Buffer'],
      recommended: ['桥接样本', '同批次/近批次备注', '过滤和低吸附耗材'],
      upgrades: ['替代荧光素方案', '预混抗体 cocktail', '项目专属补货清单'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
      ],
      inquiryNote: '流式进阶复购补货：已验证 panel、补偿材料、死活染、桥接样本、批次备注和仪器模板一致性。',
    },
  },
  expert: {
    first: {
      title: '专家流式初购组合',
      summary: '适合高参数 panel、稀有细胞群或分选项目，强调抗原密度、荧光亮度、补偿和分选缓冲体系。',
      required: ['高参数流式 panel', '高亮荧光抗体', '死活染', '补偿/FMO 对照', '分选级缓冲液'],
      recommended: ['细胞富集试剂', '胞内/核内染色套装', '低丰度 marker 高亮染料', '仪器质控微球'],
      upgrades: ['定制 panel 设计', '抗体滴定支持', '长期批次管理'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '直标抗体', href: '/products?sub=直标抗体' },
        { label: '样本制备', href: '/products?sub=样本制备' },
      ],
      inquiryNote: '流式专家初购组合：高参数 panel、高亮抗体、分选缓冲、补偿/FMO、细胞富集、胞内染色和仪器质控。',
    },
    repeat: {
      title: '专家流式复购补货',
      summary: '适合平台型实验室和长期队列项目，关注 panel 稳定、批次锁定、分选质量和项目备货。',
      required: ['稳定批次 panel 抗体', '死活染/补偿材料', '分选级缓冲液', '质控微球'],
      recommended: ['项目备货', '桥接质控样本', '多课题组共享清单'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
      ],
      inquiryNote: '流式专家复购补货：稳定批次 panel、死活染、补偿材料、分选级缓冲、质控微球、项目备货和授信账期。',
    },
  },
};

const molecularBiologyBundles: SceneDefinition['bundles'] = {
  beginner: {
    first: {
      title: '新手分子生物学初购组合',
      summary: '适合第一次搭建 PCR/qPCR 或基础核酸检测流程的实验室，重点是补齐提取、扩增、电泳和污染控制材料。',
      required: ['核酸提取试剂盒', 'PCR/qPCR Master Mix', '引物', 'Nuclease-free 水', '琼脂糖和 DNA Marker'],
      recommended: ['反转录试剂', 'PCR 管/板', '滤芯吸头', '凝胶染料', 'PCR 产物纯化试剂盒'],
      upgrades: ['热启动酶', '高保真酶', 'qPCR 专用耗材'],
      productLinks: [
        { label: '分子生物学试剂', href: '/products?sub=分子生物学试剂' },
        { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
        { label: '核酸纯化', href: '/products?sub=核酸纯化' },
      ],
      inquiryNote: '分子生物学新手初购组合：核酸提取、PCR/qPCR Master Mix、引物、无核酸酶水、PCR 管板、琼脂糖、Marker 和凝胶染料。',
    },
    repeat: {
      title: '新手分子生物学复购补货',
      summary: '适合已跑通基础扩增流程后补充高频消耗品，优先保持酶、Mix、引物和耗材规格一致。',
      required: ['PCR/qPCR Master Mix', '引物补货', 'PCR 管/板', '滤芯吸头'],
      recommended: ['核酸提取试剂盒', 'Nuclease-free 水', '琼脂糖和凝胶染料'],
      upgrades: ['大包装 Master Mix', '低吸附耗材', '同批次项目备货'],
      productLinks: [
        { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
        { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
      ],
      inquiryNote: '分子生物学新手复购补货：PCR/qPCR Mix、引物、管板、滤芯吸头、核酸提取和电泳耗材。',
    },
  },
  intermediate: {
    first: {
      title: '进阶分子生物学初购组合',
      summary: '适合多靶标 qPCR、克隆构建或表达验证项目，强调高保真扩增、纯化、连接/组装和对照体系。',
      required: ['高保真 DNA 聚合酶', 'qPCR Master Mix', '反转录试剂', 'PCR 产物/胶回收纯化', '感受态细胞'],
      recommended: ['限制性内切酶或组装试剂', '连接酶', '质粒小提试剂盒', '阳性/阴性对照模板'],
      upgrades: ['Gibson/Golden Gate 组装', '低内毒素质粒提取', '探针法 qPCR'],
      productLinks: [
        { label: '限制性内切酶', href: '/products?sub=限制性内切酶' },
        { label: '反转录试剂', href: '/products?sub=反转录试剂' },
        { label: '核酸纯化', href: '/products?sub=核酸纯化' },
      ],
      inquiryNote: '分子生物学进阶初购组合：高保真酶、qPCR/RT 试剂、纯化回收、限制性内切酶、连接/组装、感受态和质粒提取。',
    },
    repeat: {
      title: '进阶分子生物学复购补货',
      summary: '适合稳定项目持续补货，重点是保持酶体系、引物批次、qPCR 耗材和纯化体系一致。',
      required: ['已验证 Master Mix', '高保真酶', '核酸纯化试剂盒', 'qPCR 板膜'],
      recommended: ['引物/探针补货', '反转录试剂', '感受态细胞', '质粒提取试剂'],
      upgrades: ['项目专属备货', '替代品牌比价', '批量规格'],
      productLinks: [
        { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
        { label: 'qPCR 相关试剂', href: '/products?keyword=qPCR' },
      ],
      inquiryNote: '分子生物学进阶复购补货：已验证酶体系、引物/探针、纯化、qPCR 板膜、感受态和质粒小提。',
    },
  },
  expert: {
    first: {
      title: '专家分子生物学初购组合',
      summary: '适合复杂模板、低拷贝靶标、定点突变、载体构建或高质量表达验证项目。',
      required: ['高保真/长片段扩增酶', '探针法 qPCR 或高灵敏 Mix', '无 RNase/DNase 操作耗材', '克隆组装体系', '测序验证材料'],
      recommended: ['低内毒素质粒提取', '模板去除酶', '多片段组装试剂', '严格阴性对照体系'],
      upgrades: ['定制引物/探针', '克隆构建服务', '长期项目备货'],
      productLinks: [
        { label: '分子生物学试剂', href: '/products?sub=分子生物学试剂' },
        { label: '核酸纯化', href: '/products?sub=核酸纯化' },
        { label: '限制性内切酶', href: '/products?sub=限制性内切酶' },
      ],
      inquiryNote: '分子生物学专家初购组合：高保真长片段扩增、探针 qPCR、低内毒素质粒、组装克隆、测序验证和污染控制。',
    },
    repeat: {
      title: '专家分子生物学复购补货',
      summary: '适合平台型实验室和长期项目，强调稳定批次、项目备货、污染控制和成本管理。',
      required: ['批量 Master Mix', '稳定批次酶和纯化试剂', 'qPCR 板膜耗材', '滤芯吸头'],
      recommended: ['项目引物/探针库', '低吸附管', '质控模板', '长期备货清单'],
      upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
      productLinks: [
        { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
        { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
      ],
      inquiryNote: '分子生物学专家复购补货：批量 Mix、稳定批次酶、qPCR 耗材、滤芯吸头、项目备货和授信账期。',
    },
  },
};

type SceneBundleSeed = {
  sceneName: string;
  required: string[];
  recommended: string[];
  upgrades: string[];
  productLinks: { label: string; href: string }[];
  inquiryNote: string;
};

function createSceneBundles(seed: SceneBundleSeed): SceneDefinition['bundles'] {
  return {
    beginner: {
      first: {
        title: `新手${seed.sceneName}初购组合`,
        summary: '适合首次建立实验流程的团队，重点是补齐关键试剂、基础耗材和质量控制材料。',
        required: seed.required,
        recommended: seed.recommended,
        upgrades: seed.upgrades,
        productLinks: seed.productLinks,
        inquiryNote: `${seed.sceneName}新手初购组合：${seed.inquiryNote}`,
      },
      repeat: {
        title: `新手${seed.sceneName}复购补货`,
        summary: '适合已完成初步验证后补充高频消耗品，优先保持已验证体系和批次记录一致。',
        required: seed.required.slice(0, 4),
        recommended: seed.recommended.slice(0, 4),
        upgrades: ['批量规格', '同批次备货', '替代品牌比价'],
        productLinks: seed.productLinks.slice(0, 2),
        inquiryNote: `${seed.sceneName}新手复购补货：${seed.inquiryNote}`,
      },
    },
    intermediate: {
      first: {
        title: `进阶${seed.sceneName}初购组合`,
        summary: '适合多样本、多指标或多批次项目，强调样本一致性、对照设置和后续分析可追溯。',
        required: seed.required,
        recommended: seed.recommended,
        upgrades: seed.upgrades,
        productLinks: seed.productLinks,
        inquiryNote: `${seed.sceneName}进阶初购组合：${seed.inquiryNote}`,
      },
      repeat: {
        title: `进阶${seed.sceneName}复购补货`,
        summary: '适合稳定项目持续补货，重点是保持关键材料规格、品牌和批次可比性。',
        required: seed.required.slice(0, 4),
        recommended: seed.recommended,
        upgrades: ['项目备货', '批次锁定', '长期供货协议'],
        productLinks: seed.productLinks.slice(0, 3),
        inquiryNote: `${seed.sceneName}进阶复购补货：${seed.inquiryNote}`,
      },
    },
    expert: {
      first: {
        title: `专家${seed.sceneName}初购组合`,
        summary: '适合平台型实验室、复杂样本或高通量项目，优先规划质控、对照、批次和分析流程。',
        required: seed.required,
        recommended: seed.recommended,
        upgrades: [...seed.upgrades, '质控样本', '长期项目清单'],
        productLinks: seed.productLinks,
        inquiryNote: `${seed.sceneName}专家初购组合：${seed.inquiryNote}`,
      },
      repeat: {
        title: `专家${seed.sceneName}复购补货`,
        summary: '适合长期队列、平台共享或批量实验，关注稳定供货、成本管理和批次连续性。',
        required: seed.required.slice(0, 5),
        recommended: seed.recommended,
        upgrades: ['专属折扣模板', '授信额度', '长期供货协议'],
        productLinks: seed.productLinks,
        inquiryNote: `${seed.sceneName}专家复购补货：${seed.inquiryNote}`,
      },
    },
  };
}

const singleCellOmicsBundles = createSceneBundles({
  sceneName: '单细胞组学',
  required: ['组织解离酶', '细胞过滤器', '死细胞去除试剂', '活率染料', '低吸附耗材'],
  recommended: ['FACS Buffer', '红细胞裂解液', '流式抗体', 'RNA 保护试剂', '单细胞样本质控耗材'],
  upgrades: ['CITE-seq 抗体', '细胞富集试剂', '多样本标签策略'],
  productLinks: [
    { label: '样本制备', href: '/products?sub=样本制备' },
    { label: '流式抗体', href: '/products?sub=流式抗体' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
  ],
  inquiryNote: '组织解离、细胞过滤、死细胞去除、活率染色、FACS Buffer、流式抗体和 RNA 保护材料。',
});

const spatialBiologyBundles = createSceneBundles({
  sceneName: '空间生物学',
  required: ['组织固定与包埋试剂', '切片耗材', '抗原修复液', '多重 IF 抗体', '封片与核染试剂'],
  recommended: ['RNase-free 耗材', '荧光二抗', '抗淬灭封片剂', '组织自发荧光处理试剂', '图像质控材料'],
  upgrades: ['空间转录组前处理', '多重成像 panel', '组织透明化方案'],
  productLinks: [
    { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
    { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
    { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
  ],
  inquiryNote: '组织固定包埋、切片、抗原修复、多重 IF、RNase-free 耗材、核染和抗淬灭封片材料。',
});

const organoid3dCultureBundles = createSceneBundles({
  sceneName: '类器官与 3D 培养',
  required: ['ECM/基质胶', '低吸附培养板', '3D 培养基', '生长因子', '细胞活力检测试剂'],
  recommended: ['Live/Dead 染色', '小分子抑制剂', '冻存复苏试剂', '免疫荧光抗体', '透明化和封片试剂'],
  upgrades: ['药筛读数体系', '高内涵成像耗材', '批次质控材料'],
  productLinks: [
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: '细胞健康检测试剂盒', href: '/products?sub=细胞健康检测试剂盒' },
    { label: '重组蛋白', href: '/products?sub=重组蛋白' },
  ],
  inquiryNote: 'ECM/基质胶、低吸附板、3D 培养基、生长因子、细胞活力检测、Live/Dead 染色和成像材料。',
});

const magneticCellSeparationBundles = createSceneBundles({
  sceneName: '免疫磁珠分选',
  required: ['目标细胞分选磁珠', '分选缓冲液', 'Fc Block', '细胞过滤器', '低吸附离心管'],
  recommended: ['红细胞裂解液', '死细胞去除试剂', '活率染料', '流式验证抗体', '计数耗材'],
  upgrades: ['untouched 负选试剂盒', 'rare cell enrichment 方案', '磁珠预富集后 FACS 精分选'],
  productLinks: [
    { label: '样本制备', href: '/products?sub=样本制备' },
    { label: '流式抗体', href: '/products?sub=流式抗体' },
    { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
  ],
  inquiryNote: '目标细胞磁珠、负选或去除试剂、分选缓冲液、Fc Block、过滤器、活率染料和流式验证抗体。',
});

const elispotBundles = createSceneBundles({
  sceneName: 'ELISpot / FluoroSpot',
  required: ['ELISpot 预包被或抗体对试剂盒', 'PVDF ELISpot 板', '细胞培养基', '刺激物或肽库', '检测抗体和显色底物'],
  recommended: ['PBMC 分离材料', '阳性对照刺激物', '阴性对照孔耗材', '洗液和封闭液', '无菌低吸附耗材'],
  upgrades: ['FluoroSpot 多指标检测', '自动 spot 计数服务', '抗原肽库和细胞亚群预富集'],
  productLinks: [
    { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
    { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
  ],
  inquiryNote: 'ELISpot 板、捕获/检测抗体、底物、刺激物或肽库、PBMC 培养材料、阳性/阴性对照和 spot 计数需求。',
});

const crisprGeneEditingBundles = createSceneBundles({
  sceneName: 'CRISPR 基因编辑',
  required: ['Cas9 或 Cas 相关表达载体', 'sgRNA 合成或克隆试剂', '转染试剂', '抗性筛选试剂', 'PCR 验证试剂'],
  recommended: ['测序引物', '单克隆筛选耗材', '基因型鉴定试剂', '细胞培养试剂', '阳性和阴性对照载体'],
  upgrades: ['RNP 电转体系', 'HDR 供体模板', '脱靶验证方案'],
  productLinks: [
    { label: '分子克隆试剂', href: '/products?sub=分子克隆试剂' },
    { label: '转染试剂', href: '/products?keyword=transfection' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
  ],
  inquiryNote: 'Cas 载体或 RNP、sgRNA、转染、电转、筛选抗生素、PCR 鉴定、测序引物和单克隆筛选材料。',
});

const extracellularVesiclesBundles = createSceneBundles({
  sceneName: '细胞外囊泡研究',
  required: ['无外泌体血清或替代培养体系', '超速离心或沉淀富集试剂', '过滤耗材', 'EV marker 抗体', '蛋白定量试剂'],
  recommended: ['NTA/qNano 样本耗材', 'WB 验证试剂', 'ELISA 检测试剂盒', 'RNA 提取试剂', '低吸附管'],
  upgrades: ['免疫捕获磁珠', '尺寸排阻柱', 'TEM/纳米流式验证方案'],
  productLinks: [
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: 'WB抗体', href: '/products?sub=WB抗体' },
    { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
  ],
  inquiryNote: '无外泌体血清、EV 富集、过滤耗材、EV marker 抗体、WB/ELISA 验证、RNA 提取和低吸附耗材。',
});

const proteomicsMassSpecBundles = createSceneBundles({
  sceneName: '蛋白组学与质谱',
  required: ['蛋白提取和裂解试剂', '蛋白定量试剂', '还原烷基化试剂', '胰蛋白酶', '肽段脱盐耗材'],
  recommended: ['磷酸化富集材料', '样本低吸附耗材', '质控标准品', 'Western Blot 验证抗体', 'LC-MS 级溶剂'],
  upgrades: ['TMT/iTRAQ 标记', '靶向 PRM/SRM 验证', '翻译后修饰富集方案'],
  productLinks: [
    { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
    { label: '磷酸化抗体', href: '/products?sub=磷酸化抗体' },
    { label: '蛋白定量相关产品', href: '/products?keyword=BCA' },
  ],
  inquiryNote: '蛋白提取、定量、还原烷基化、酶解、肽段脱盐、修饰富集、质控标准品和 WB 验证材料。',
});

const smallAnimalImagingBundles = createSceneBundles({
  sceneName: '小动物实验与成像',
  required: ['活体成像底物、探针或造影剂', '小动物麻醉与保温材料', '给药注射耗材', '动物固定与生理监测耗材', '图像定量记录模板'],
  recommended: ['脱毛与皮肤准备耗材', '眼膏与术后观察记录', 'PBS 或生理盐水', '离体器官成像耗材', '阳性和阴性对照动物或对照探针'],
  upgrades: ['多模态成像方案', 'PET/SPECT 标记与防护耗材', 'MRI 或 CT 造影剂', '行为学或代谢监测联用'],
  productLinks: [
    { label: '小动物麻醉与保温', href: '/products?keyword=小动物%20麻醉' },
    { label: '活体成像底物和探针', href: '/products?keyword=luciferin%20imaging' },
    { label: '注射给药耗材', href: '/products?keyword=注射器%20灌胃针' },
  ],
  inquiryNote: '活体成像底物、荧光或放射性探针、MRI 或 CT 造影剂、麻醉保温、给药注射、动物固定、生理监测和图像定量材料。',
});

const singleCellOmicsScene: SceneDefinition = {
  slug: 'single-cell-omics',
  title: '单细胞组学',
  eyebrow: '单细胞测序与细胞图谱',
  summary: '检查单细胞悬液质量、细胞富集和建库前质控。',
  icon: Activity,
  accentClass: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  overview: [
    { title: '实验用途', description: '解析组织、免疫微环境、肿瘤样本或模型体系中的细胞组成和状态。' },
    { title: '样本核心', description: '保持细胞活率、单细胞分散度、低碎片和低红细胞污染。' },
    { title: '实验重点', description: '组织解离、过滤、死细胞去除、计数和分选策略直接影响数据质量。' },
    { title: '数据分析', description: '结合公共细胞图谱和单细胞分析工具完成质控、聚类、注释和差异分析。' },
  ],
  workflow: [
    {
      title: '样本采集与组织解离',
      description: '根据组织类型选择机械剪切、酶消化和温控条件，减少应激和细胞损失。',
      checks: ['样本离体时间已记录', '解离酶适配组织类型', '消化时间和温度可追溯', 'RNase 污染和细胞应激已控制'],
      outputs: ['样本处理记录', '初步单细胞悬液', '解离条件和复购材料清单'],
      productLinks: [
        { label: '组织解离相关产品', href: '/products?keyword=dissociation' },
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
        { label: 'RNA 保护相关产品', href: '/products?keyword=RNA%20protect' },
      ],
    },
    {
      title: '悬液制备与质控',
      description: '过滤碎片、去除死细胞或红细胞，确认浓度、活率和双细胞风险。',
      checks: ['细胞团块已去除', '活率达到建库要求', '细胞浓度在平台建议范围内', '红细胞和碎片比例可接受'],
      outputs: ['合格单细胞悬液', '细胞浓度和活率记录', '死细胞/红细胞处理记录'],
      productLinks: [
        { label: '细胞过滤器', href: '/products?keyword=cell%20strainer' },
        { label: '死细胞去除', href: '/products?keyword=dead%20cell%20removal' },
        { label: '活率染料', href: '/products?keyword=viability%20dye' },
      ],
    },
    {
      title: '富集、分选与对照',
      description: '按细胞类型、marker 或样本来源决定是否做 FACS、磁珠富集或样本标签。',
      checks: ['分选 marker 和抗体克隆号已确认', '阴性/阳性和死活染对照已设置', '低丰度群体富集策略明确', '分选后活率和回收量可接受'],
      outputs: ['目标细胞群或混合样本', '分选门控记录', '可复用抗体和缓冲液清单'],
      productLinks: [
        { label: '流式抗体', href: '/products?sub=流式抗体' },
        { label: 'FACS Buffer', href: '/products?keyword=FACS%20buffer' },
        { label: '磁珠分选', href: '/products?keyword=magnetic%20beads' },
      ],
    },
    {
      title: '建库前准备与数据质控',
      description: '整理样本元数据，记录批次、处理条件和后续分析所需公共参考资源。',
      checks: ['样本元数据完整', '批次和处理条件清晰', '测序深度和目标细胞数已规划', '公共细胞图谱或参考数据已确定'],
      outputs: ['建库前样本清单', '数据分析元数据表', '公共参考资源列表'],
      productLinks: [
        { label: 'Human Cell Atlas', href: 'https://www.humancellatlas.org/' },
        { label: 'CELLxGENE Discover', href: 'https://cellxgene.cziscience.com/' },
        { label: 'Scanpy', href: 'https://scanpy.readthedocs.io/' },
      ],
    },
  ],
  decisionPoints: [
    { title: '样本是否适合做单细胞', description: '优先评估离体时间、组织纤维化程度、细胞活率和目标细胞比例。', productLinks: [{ label: '样本制备', href: '/products?sub=样本制备' }] },
    { title: '是否需要分选或富集', description: '低丰度细胞群、免疫细胞亚群或特定 marker 项目建议提前规划 FACS 或磁珠富集。', productLinks: [{ label: '流式抗体', href: '/products?sub=流式抗体' }, { label: '磁珠分选', href: '/products?keyword=magnetic%20beads' }] },
    { title: '是否加入蛋白或标签信息', description: 'CITE-seq 或样本标签方案需提前确认 oligo-tag 抗体、滴定和对照。', productLinks: [{ label: '直标抗体', href: '/products?sub=直标抗体' }] },
    { title: '参考图谱如何选择', description: '公共细胞图谱、已发表数据和项目内对照可提高细胞注释可靠性。', productLinks: [{ label: 'CELLxGENE Discover', href: 'https://cellxgene.cziscience.com/' }] },
  ],
  difficulties: [
    {
      id: 'low-viability',
      label: '细胞活率低',
      symptom: '建库前活细胞比例不足，死细胞和碎片明显增加。',
      causes: ['离体时间过长或温控不当', '酶消化过强', '离心和吹打过度', '样本坏死或炎症程度高'],
      checks: ['记录离体到上机间隔', '比较消化时间和酶浓度', '检查离心力和重悬方式', '使用死活染复核活率'],
      fixes: ['缩短处理时间并优化低温流程', '降低酶消化强度', '加入死细胞去除步骤', '必要时评估单核测序方案'],
      productLinks: [
        { label: '死细胞去除', href: '/products?keyword=dead%20cell%20removal' },
        { label: '活率染料', href: '/products?keyword=viability%20dye' },
      ],
      bundleHint: '建议优先补齐活率染料、过滤器、死细胞去除和温控处理材料。',
      inquiryNote: '单细胞组学难点：细胞活率低。需要组织解离、死细胞去除、活率染色和样本处理建议。',
    },
    {
      id: 'doublets-debris',
      label: '双细胞或碎片比例高',
      symptom: '上机前可见细胞团块，或数据中 doublet、ambient RNA 和低质量细胞比例偏高。',
      causes: ['组织未充分分散', '过滤孔径不合适', '细胞浓度过高', '红细胞或碎片未清除'],
      checks: ['显微镜检查团块和碎片', '复核细胞浓度', '确认过滤和洗涤步骤', '检查红细胞裂解是否充分'],
      fixes: ['增加温和过滤和重悬', '调整细胞上样浓度', '增加红细胞裂解或碎片清除', '数据分析中进行 doublet 识别'],
      productLinks: [
        { label: '细胞过滤器', href: '/products?keyword=cell%20strainer' },
        { label: '红细胞裂解液', href: '/products?keyword=RBC%20lysis' },
      ],
      bundleHint: '建议补充过滤器、红细胞裂解液和低吸附耗材。',
      inquiryNote: '单细胞组学难点：双细胞或碎片比例高。需要过滤、红细胞裂解、上样浓度和质控建议。',
    },
    {
      id: 'batch-effect',
      label: '批次效应明显',
      symptom: '聚类主要按批次分开，处理组或样本来源差异难以解释。',
      causes: ['样本处理时间不一致', '消化和分选条件变化', '建库批次差异', '元数据记录不完整'],
      checks: ['核对样本处理批次', '确认消化和分选条件', '检查测序深度和建库指标', '整理 donor、处理组和批次信息'],
      fixes: ['统一处理 SOP', '使用样本标签或混样策略', '保留桥接质控样本', '分析中采用合适的批次校正方法'],
      productLinks: [
        { label: '样本标签相关产品', href: '/products?keyword=cell%20hashing' },
        { label: '流式抗体', href: '/products?sub=流式抗体' },
      ],
      bundleHint: '建议在进阶组合中加入样本标签、桥接样本和统一耗材清单。',
      inquiryNote: '单细胞组学难点：批次效应明显。需要样本标签、批次记录、分选对照和数据分析资源建议。',
    },
  ],
  productLinks: [
    { label: '样本制备', href: '/products?sub=样本制备' },
    { label: '流式抗体', href: '/products?sub=流式抗体' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: '分子生物学试剂', href: '/products?sub=分子生物学试剂' },
  ],
  protocols: [
    { label: '流式细胞术实验指南', href: '/protocols/flow-cytometry', description: '单细胞分选、死活染和 marker 筛选可作为前处理参考。' },
    { label: '免疫细胞分离与纯化', href: '/protocols/immune-cell-isolation', description: 'PBMC、组织样本和后续单细胞建库前处理参考。' },
    { label: 'RNA 提取与保护', href: '/protocols/rna-extraction', description: '用于理解 RNA 质量控制和污染防护要求。' },
  ],
  analysisSoftware: [
    { label: 'Human Cell Atlas', href: 'https://www.humancellatlas.org/', description: '国际公共细胞图谱项目，可用于理解组织细胞组成和参考数据来源。', category: '公共细胞图谱' },
    { label: 'CELLxGENE Discover', href: 'https://cellxgene.cziscience.com/', description: '公共单细胞数据门户，可浏览、检索和下载已发布细胞图谱数据。', category: '公共细胞图谱' },
    { label: 'UCSC Cell Browser', href: 'https://cells.ucsc.edu/', description: '用于浏览单细胞数据集、细胞注释和表达模式的公共资源。', category: '公共细胞图谱' },
    { label: 'Single Cell Portal', href: 'https://singlecell.broadinstitute.org/single_cell', description: 'Broad Institute 提供的单细胞数据浏览和共享平台。', category: '公共细胞图谱' },
    { label: 'Scanpy', href: 'https://scanpy.readthedocs.io/', description: '免费开源 Python 单细胞分析工具，适合质控、聚类、注释和可视化。', category: '单细胞分析' },
    { label: 'Seurat', href: 'https://satijalab.org/seurat/', description: '免费开源 R 单细胞分析工具，适合 scRNA-seq、多模态数据和可视化分析。', category: '单细胞分析' },
    { label: 'scvi-tools', href: 'https://scvi-tools.org/', description: '免费开源单细胞深度生成模型工具集，适合批次校正和多样本比较。', category: '单细胞分析' },
    { label: 'Azimuth', href: 'https://azimuth.hubmapconsortium.org/', description: '基于参考图谱的细胞注释工具，可辅助快速映射和初步解释。', category: '细胞注释' },
  ],
  supportLinks: [
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: '单细胞分选、panel 设计和死活染对照。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: '核酸质量、PCR/qPCR 和下游验证资源。' },
    { label: '联系我们', href: '/contact', description: '需要样本制备或材料清单协助时可留言。' },
  ],
  brands: ['BD Biosciences', 'BioLegend', 'Miltenyi Biotec', 'Thermo Fisher', 'STEMCELL Technologies'],
  faqs: [
    { question: '单细胞项目最先确认什么？', answer: '先确认样本类型、离体时间、目标细胞比例、活率要求和是否需要分选或富集。' },
    { question: '活率不足是否还能继续？', answer: '需结合平台要求判断；活率明显不足时建议优化解离流程、去除死细胞，或评估单核测序方案。' },
    { question: '公共图谱有什么作用？', answer: '公共图谱可辅助细胞类型注释、marker 验证和结果解释，但仍需结合本项目样本和实验设计。' },
  ],
  bundles: singleCellOmicsBundles,
};

const spatialBiologyScene: SceneDefinition = {
  slug: 'spatial-biology',
  title: '空间生物学',
  eyebrow: '空间转录组与空间蛋白组',
  summary: '制备组织切片、完成空间定位与多重染色，进行图像配准。',
  icon: Microscope,
  accentClass: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  overview: [
    { title: '实验用途', description: '在组织结构中解析细胞类型、表达模式、细胞邻域和病理区域差异。' },
    { title: '样本核心', description: '切片质量、RNA 完整性、抗原保留和图像质量决定空间数据可信度。' },
    { title: '实验重点', description: 'FFPE、冰冻或新鲜组织需分别规划固定、切片、染色和 RNase 控制。' },
    { title: '数据分析', description: '将组织图像、ROI 标注、表达矩阵和空间坐标统一解释。' },
  ],
  workflow: [
    {
      title: '样本选择与切片质控',
      description: '确认 FFPE、冰冻或新鲜组织类型，评估形态、脱片风险和核酸质量。',
      checks: ['样本保存方式明确', '切片厚度符合要求', '组织完整且无明显脱片', 'RNA 或抗原保留情况可评估'],
      outputs: ['合格组织切片', '样本保存和切片记录', '前处理材料清单'],
      productLinks: [
        { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        { label: 'RNase-free 耗材', href: '/products?keyword=RNase-free' },
      ],
    },
    {
      title: '预染与组织区域确认',
      description: '通过 H&E、IHC 或 IF 预评估组织结构、阳性区域和背景信号。',
      checks: ['组织区域和病理结构清晰', '阳性/阴性区域已标注', '自发荧光或背景已评估', 'ROI 标注标准一致'],
      outputs: ['组织质控图像', 'ROI 或区域标注', '后续空间检测策略'],
      productLinks: [
        { label: 'IHC 场景', href: '/scenes/ihc' },
        { label: '免疫荧光场景', href: '/scenes/immunofluorescence' },
        { label: 'QuPath', href: 'https://qupath.github.io/' },
      ],
    },
    {
      title: '空间检测与多重标记',
      description: '根据研究问题选择空间转录组、原位杂交、多重 IF 或空间蛋白检测。',
      checks: ['靶标数量和空间分辨率需求明确', '抗体或探针验证信息充分', '通道串色和对照策略已规划', '批次和对照样本已设置'],
      outputs: ['空间表达或多重染色数据', '通道和靶标记录', '质控图像与原始数据'],
      productLinks: [
        { label: '荧光偶联二抗', href: '/products?sub=荧光偶联二抗' },
        { label: '原位杂交相关产品', href: '/products?keyword=in%20situ%20hybridization' },
        { label: '荧光光谱工具', href: '/support?tab=spectra' },
      ],
    },
    {
      title: '图像配准与空间分析',
      description: '利用图像、表达矩阵和坐标信息分析细胞邻域、区域差异和空间模式。',
      checks: ['图像和表达数据已正确配准', 'ROI 标注可追溯', '批次和样本元数据完整', '空间统计方法与问题匹配'],
      outputs: ['空间表达图谱', '细胞邻域或区域分析结果', '可复核的分析流程'],
      productLinks: [
        { label: 'Squidpy', href: 'https://squidpy.readthedocs.io/' },
        { label: 'Giotto', href: 'https://giottosuite.readthedocs.io/' },
        { label: 'napari', href: 'https://napari.org/' },
      ],
    },
  ],
  decisionPoints: [
    { title: '样本类型如何选择', description: 'FFPE 便于存档样本研究，冰冻样本更适合部分 RNA 质量要求高的检测。', productLinks: [{ label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' }] },
    { title: '空间分辨率需要多高', description: '按组织问题选择区域级、spot 级或单细胞/亚细胞级方案，避免过度设计。', productLinks: [{ label: '免疫荧光场景', href: '/scenes/immunofluorescence' }] },
    { title: '是否需要多重蛋白验证', description: '空间转录结果常需 IHC、IF 或流式验证关键细胞群和 marker。', productLinks: [{ label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' }] },
    { title: '图像分析如何组织', description: '建议在实验前确定 ROI 标注规则、图像格式和空间分析工具。', productLinks: [{ label: 'QuPath', href: 'https://qupath.github.io/' }] },
  ],
  difficulties: [
    {
      id: 'rna-quality',
      label: 'RNA 或组织质量不足',
      symptom: '切片形态不佳、RNA 完整性偏低，或空间检测信号整体偏弱。',
      causes: ['固定或保存条件不合适', '切片时间和温控不稳定', 'RNase 污染', '样本坏死或降解'],
      checks: ['核对固定和保存记录', '评估切片完整性', '检查 RNase-free 操作', '保留相邻切片做质控'],
      fixes: ['优化取材和保存流程', '使用新鲜切片或更合适样本类型', '加强 RNase 控制', '用预染确认可用区域'],
      productLinks: [
        { label: 'RNase-free 耗材', href: '/products?keyword=RNase-free' },
        { label: '组织处理试剂', href: '/products?sub=IHC和成像试剂' },
      ],
      bundleHint: '建议优先补齐 RNase-free 耗材、切片质控和组织处理材料。',
      inquiryNote: '空间生物学难点：RNA 或组织质量不足。需要样本保存、切片质控、RNase 控制和预染建议。',
    },
    {
      id: 'autofluorescence',
      label: '自发荧光或串色明显',
      symptom: '背景信号高，多个通道互相干扰，目标信号难以解释。',
      causes: ['组织自发荧光强', '荧光通道搭配不合理', '抗体浓度过高', '封片或成像条件不适合'],
      checks: ['设置未染和单染对照', '查看染料激发/发射光谱', '比较抗体滴定浓度', '检查曝光和滤光片设置'],
      fixes: ['调整荧光素组合', '降低抗体浓度并优化洗涤', '使用抗淬灭封片剂', '必要时做自发荧光处理'],
      productLinks: [
        { label: '荧光光谱工具', href: '/support?tab=spectra' },
        { label: '荧光偶联二抗', href: '/products?sub=荧光偶联二抗' },
      ],
      bundleHint: '建议补充单染对照、抗淬灭封片剂和合适荧光二抗。',
      inquiryNote: '空间生物学难点：自发荧光或串色明显。需要通道设计、抗体滴定、封片和成像建议。',
    },
    {
      id: 'registration',
      label: '图像配准或 ROI 不一致',
      symptom: '组织图像与表达数据错位，或不同人员标注区域差异较大。',
      causes: ['切片变形或脱片', '图像分辨率和格式不统一', 'ROI 标准不明确', '元数据记录缺失'],
      checks: ['核对原始图像和坐标文件', '统一 ROI 标注规则', '检查图像比例尺和方向', '记录每个样本的处理批次'],
      fixes: ['重新配准图像和表达矩阵', '使用统一标注模板', '保留相邻切片参考', '在分析流程中记录版本和参数'],
      productLinks: [
        { label: 'QuPath', href: 'https://qupath.github.io/' },
        { label: 'napari', href: 'https://napari.org/' },
      ],
      bundleHint: '建议在项目开始前建立 ROI 标注规范和图像命名规则。',
      inquiryNote: '空间生物学难点：图像配准或 ROI 不一致。需要图像格式、ROI 标注、相邻切片和分析工具建议。',
    },
  ],
  productLinks: [
    { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
    { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
    { label: '荧光偶联二抗', href: '/products?sub=荧光偶联二抗' },
    { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
  ],
  protocols: [
    { label: 'IHC 实验指南', href: '/protocols/ihc', description: '组织固定、切片、抗原修复和显色条件参考。' },
    { label: '免疫荧光实验指南', href: '/protocols/immunofluorescence', description: '多重染色、通道规划和封片成像参考。' },
    { label: '荧光光谱查看器', href: '/support?tab=spectra', description: '用于多重染色和通道搭配前的染料光谱核对。' },
  ],
  analysisSoftware: [
    { label: 'Squidpy', href: 'https://squidpy.readthedocs.io/', description: '免费开源空间组学分析工具，可用于空间邻域、表达模式和图像特征分析。', category: '空间组学分析' },
    { label: 'Giotto', href: 'https://giottosuite.readthedocs.io/', description: '免费开源空间转录组分析框架，支持空间网络、细胞邻域和可视化。', category: '空间组学分析' },
    { label: 'Seurat spatial', href: 'https://satijalab.org/seurat/articles/spatial_vignette.html', description: 'Seurat 的空间数据分析流程，适合配合单细胞注释使用。', category: '空间组学分析' },
    { label: 'stLearn', href: 'https://stlearn.readthedocs.io/', description: '免费开源空间转录组分析工具，结合形态图像和空间表达信息。', category: '空间组学分析' },
    { label: 'QuPath', href: 'https://qupath.github.io/', description: '免费开源数字病理图像分析工具，适合 ROI 标注、细胞检测和组织区域分析。', category: '图像与 ROI' },
    { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/', description: '免费开源图像处理工具，可用于基础测量、通道拆分和图像预处理。', category: '图像与 ROI' },
    { label: 'napari', href: 'https://napari.org/', description: '免费开源多维图像查看器，适合大图、切片和多通道图像检查。', category: '图像与 ROI' },
    { label: 'OME-Zarr', href: 'https://ngff.openmicroscopy.org/latest/', description: '开放显微图像数据格式规范，适合大规模空间图像数据管理。', category: '图像数据管理' },
  ],
  supportLinks: [
    { label: 'IHC 场景', href: '/scenes/ihc', description: '组织染色、抗原修复和显色条件参考。' },
    { label: '免疫荧光场景', href: '/scenes/immunofluorescence', description: '多重荧光、通道搭配和成像分析参考。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: '核酸质量控制和靶标验证资源。' },
  ],
  brands: ['Cell Signaling Technology', 'Abcam', 'BioLegend', 'Thermo Fisher', 'Sigma-Aldrich'],
  faqs: [
    { question: '空间项目先确认什么？', answer: '先确认样本类型、保存方式、切片质量、目标分辨率和是否需要 IHC/IF 预评估。' },
    { question: '空间转录组是否仍需抗体验证？', answer: '通常需要。关键细胞群、marker 或区域差异建议通过 IHC、IF 或流式进行正交验证。' },
    { question: '多重成像如何减少串色？', answer: '应设置单染和未染对照，提前核对光谱、滤光片、抗体滴定和曝光参数。' },
  ],
  bundles: spatialBiologyBundles,
};

const organoid3dCultureScene: SceneDefinition = {
  slug: 'organoid-3d-culture',
  title: '类器官与 3D 细胞培养',
  eyebrow: '三维模型与疾病模拟',
  summary: '配置 ECM、培养体系和生长因子，管理传代、冻存和药筛读数。',
  icon: TestTube,
  accentClass: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  overview: [
    { title: '实验用途', description: '构建更接近组织结构和功能状态的体外模型，支持机制研究、药筛和成像分析。' },
    { title: '模型核心', description: '细胞来源、ECM、培养基、生长因子和传代节奏共同决定模型稳定性。' },
    { title: '实验重点', description: '控制基质批次、接种密度、营养供应和中心坏死风险。' },
    { title: '数据分析', description: '结合活力检测、免疫荧光、高内涵成像和图像分析评估模型状态。' },
  ],
  workflow: [
    {
      title: '细胞来源与模型设计',
      description: '确认原代样本、干细胞或细胞系来源，定义培养目标、分化方向和验证指标。',
      checks: ['细胞来源和授权信息明确', '模型目标和终点指标清晰', '阳性/阴性对照已规划', '传代和冻存策略已确定'],
      outputs: ['模型设计记录', '细胞来源和对照清单', '初始材料需求'],
      productLinks: [
        { label: '细胞系', href: '/products?sub=细胞系' },
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
      ],
    },
    {
      title: 'ECM 与培养体系建立',
      description: '选择 ECM/基质胶、低吸附耗材、培养基、生长因子和小分子组合。',
      checks: ['ECM 批次和储存条件已记录', '培养基成分和生长因子浓度明确', '低吸附板或 3D 培养耗材匹配', '接种密度和胶滴体积可复现'],
      outputs: ['稳定培养体系', '培养基和 ECM 记录', '可复购试剂清单'],
      productLinks: [
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
        { label: '重组蛋白', href: '/products?sub=重组蛋白' },
        { label: '低吸附板', href: '/products?keyword=low%20attachment' },
      ],
    },
    {
      title: '传代、冻存与质量控制',
      description: '建立传代比例、消化方式、冻存复苏和污染检测流程。',
      checks: ['传代周期和比例稳定', '类器官大小分布可接受', '支原体和污染检测已安排', '冻存复苏回收率已记录'],
      outputs: ['可持续扩增模型', '传代和冻存记录', '质量控制结果'],
      productLinks: [
        { label: '细胞消化试剂', href: '/products?keyword=cell%20dissociation' },
        { label: '冻存液', href: '/products?keyword=cryopreservation' },
        { label: '支原体检测', href: '/products?keyword=mycoplasma' },
      ],
    },
    {
      title: '处理、染色与成像分析',
      description: '进行药物处理、活力检测、Live/Dead 染色、免疫荧光或高内涵成像。',
      checks: ['处理浓度和时间梯度明确', '读数方式与模型大小匹配', '成像穿透深度可接受', '图像分析流程可复用'],
      outputs: ['药效或表型读数', '染色和成像数据', '图像分析结果'],
      productLinks: [
        { label: '细胞健康检测试剂盒', href: '/products?sub=细胞健康检测试剂盒' },
        { label: '免疫荧光场景', href: '/scenes/immunofluorescence' },
        { label: 'CellProfiler', href: 'https://cellprofiler.org/releases/' },
      ],
    },
  ],
  decisionPoints: [
    { title: '模型来源如何确定', description: '原代、干细胞和细胞系模型在稳定性、复杂度和可解释性上差异较大。', productLinks: [{ label: '细胞系', href: '/products?sub=细胞系' }] },
    { title: 'ECM 与培养基如何选择', description: '需结合组织来源、分化方向和批次可获得性，优先建立可追溯记录。', productLinks: [{ label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' }, { label: '重组蛋白', href: '/products?sub=重组蛋白' }] },
    { title: '读数方式是否匹配模型', description: '厚样本成像、活力检测和药筛读数需考虑穿透深度、背景和中心坏死。', productLinks: [{ label: '细胞健康检测试剂盒', href: '/products?sub=细胞健康检测试剂盒' }] },
    { title: '是否需要二维验证', description: '关键结果建议结合 2D 细胞、WB、qPCR、IF 或流式做交叉验证。', productLinks: [{ label: 'Western Blot 场景', href: '/scenes/western-blot' }, { label: '分子生物学场景', href: '/scenes/molecular-biology' }] },
  ],
  difficulties: [
    {
      id: 'establishment-failure',
      label: '模型建立失败',
      symptom: '接种后类器官形成率低，结构松散，或短期内大量死亡。',
      causes: ['细胞状态不佳', 'ECM 批次或浓度不合适', '生长因子缺失或失活', '接种密度和操作温度不稳定'],
      checks: ['检查细胞活率和传代状态', '核对 ECM 批号和冻融次数', '确认生长因子储存和终浓度', '记录接种密度和胶滴操作时间'],
      fixes: ['优化细胞来源和接种密度', '比较 ECM 批次或浓度', '更换新鲜生长因子', '标准化冰上操作和凝胶时间'],
      productLinks: [
        { label: 'ECM/基质相关产品', href: '/products?keyword=ECM' },
        { label: '重组蛋白', href: '/products?sub=重组蛋白' },
      ],
      bundleHint: '建议优先补齐 ECM、低吸附耗材、生长因子和活力检测材料。',
      inquiryNote: '类器官与 3D 培养难点：模型建立失败。需要 ECM、培养基、生长因子、接种密度和细胞状态建议。',
    },
    {
      id: 'heterogeneity',
      label: '批间差异或分化不均一',
      symptom: '不同批次类器官大小、形态、marker 表达或药物响应差异明显。',
      causes: ['细胞来源异质性', 'ECM 或培养基批次变化', '传代比例不一致', '分化诱导时间窗不稳定'],
      checks: ['记录细胞来源和 passage', '核对 ECM 与生长因子批号', '比较接种密度和传代比例', '检测关键 marker 表达'],
      fixes: ['建立批次质控指标', '使用统一 passage 和接种密度', '保留桥接批次', '用 IF/qPCR 验证分化状态'],
      productLinks: [
        { label: '免疫荧光抗体', href: '/products?sub=IHC和成像抗体' },
        { label: 'qPCR 试剂', href: '/products?keyword=qPCR' },
      ],
      bundleHint: '建议在进阶组合中加入批次质控、marker 验证和桥接样本。',
      inquiryNote: '类器官与 3D 培养难点：批间差异或分化不均一。需要批次记录、marker 验证、IF/qPCR 和培养体系建议。',
    },
    {
      id: 'imaging-readout',
      label: '成像或药筛读数不稳定',
      symptom: '厚样本染色不均、中心区域信号弱，或药物处理读数波动大。',
      causes: ['染色穿透不足', '类器官大小分布不均', '药物扩散不充分', '读数方法不适合 3D 样本'],
      checks: ['比较类器官大小分布', '检查固定、通透和染色时间', '设置剂量和时间梯度', '确认图像分析阈值一致'],
      fixes: ['优化透明化或切片方案', '统一模型大小后处理', '延长药物处理或染色时间', '使用可复用图像分析 pipeline'],
      productLinks: [
        { label: 'Live/Dead 染色', href: '/products?keyword=live%20dead' },
        { label: 'CellProfiler', href: 'https://cellprofiler.org/releases/' },
      ],
      bundleHint: '建议补充活力检测、Live/Dead 染色、透明化和图像分析工具。',
      inquiryNote: '类器官与 3D 培养难点：成像或药筛读数不稳定。需要染色穿透、模型大小、药筛读数和图像分析建议。',
    },
  ],
  productLinks: [
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: '细胞健康检测试剂盒', href: '/products?sub=细胞健康检测试剂盒' },
    { label: '重组蛋白', href: '/products?sub=重组蛋白' },
    { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
  ],
  protocols: [
    { label: '细胞培养基础指南', href: '/protocols/cell-culture', description: '细胞状态、污染控制、传代和冻存基础参考。' },
    { label: '免疫荧光实验指南', href: '/protocols/immunofluorescence', description: '用于类器官 marker 染色和成像验证。' },
    { label: '细胞活力检测指南', href: '/protocols/cell-viability', description: '用于药物处理和模型状态评估。' },
  ],
  analysisSoftware: [
    { label: 'CellProfiler', href: 'https://cellprofiler.org/releases/', description: '免费开源细胞图像分析软件，适合 3D 模型批量图像定量和可复用 pipeline。', category: '图像定量' },
    { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/', description: '免费开源图像处理工具，可用于荧光强度、尺寸、ROI 和批量处理。', category: '图像定量' },
    { label: 'napari', href: 'https://napari.org/', description: '免费开源多维图像查看器，适合 z-stack、多通道和大图数据检查。', category: '图像查看' },
    { label: 'BioImage Archive', href: 'https://www.ebi.ac.uk/bioimage-archive/', description: '公共生物图像数据归档资源，可查阅参考图像数据集和共享规范。', category: '图像数据' },
    { label: 'OrganoidTracker', href: 'https://github.com/jvzonlab/OrganoidTracker', description: '开源类器官谱系和细胞追踪工具，适合特定 3D 成像分析场景。', category: '类器官分析' },
    { label: 'OMERO', href: 'https://www.openmicroscopy.org/omero/', description: '开源显微图像数据管理平台，适合团队管理、标注和共享图像数据。', category: '图像数据管理' },
  ],
  supportLinks: [
    { label: '免疫荧光场景', href: '/scenes/immunofluorescence', description: '类器官 marker 染色、通道搭配和成像分析参考。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: 'qPCR、克隆和表达验证资源。' },
    { label: '联系我们', href: '/contact', description: '需要 3D 培养材料清单或药筛读数建议时可留言。' },
  ],
  brands: ['Corning', 'STEMCELL Technologies', 'Thermo Fisher', 'R&D Systems', 'Sigma-Aldrich'],
  faqs: [
    { question: '类器官项目最先确认什么？', answer: '先确认细胞来源、模型目标、ECM 类型、培养基组成、生长因子和读数方式。' },
    { question: 'ECM 批次差异如何控制？', answer: '建议记录批号、蛋白浓度、凝胶条件和桥接质控结果，关键项目尽量使用稳定批次。' },
    { question: '药筛读数为什么波动大？', answer: '常见原因包括类器官大小不均、药物扩散不足、中心坏死、染色穿透不足和图像阈值不一致。' },
  ],
  bundles: organoid3dCultureBundles,
};

const magneticCellSeparationScene: SceneDefinition = {
  slug: 'magnetic-cell-separation',
  title: '免疫磁珠分选 / 细胞分离',
  eyebrow: '细胞富集、去除与 untouched 分离',
  summary: '在流式、FACS、单细胞建库和 ELISpot 前富集或去除目标细胞。',
  icon: Magnet,
  accentClass: 'bg-amber-50 text-amber-700 border-amber-100',
  overview: [
    { title: '实验用途', description: '在上机或功能实验前提高目标细胞比例、降低背景细胞和碎片干扰。' },
    { title: '策略核心', description: '正选、负选、depletion 和磁珠预富集后 FACS，对应不同纯度、活率和功能保留需求。' },
    { title: '实验重点', description: '样本解离、过滤、Fc Block、磁珠比例、孵育时间、洗涤和流式质控共同决定结果。' },
    { title: '实验顺序', description: '常见顺序为磁珠分选后进入流式、FACS 或单细胞建库；方法开发时可先用流式了解细胞组成。' },
  ],
  workflow: [
    {
      title: '样本制备与流式摸底',
      description: '制备单细胞悬液，必要时先用小样本流式确认目标细胞比例和 marker 表达。',
      checks: ['细胞活率和浓度已记录', '红细胞、碎片和聚团已评估', '目标细胞 marker 和抗体克隆号明确', '是否需要先做流式摸底已判断'],
      outputs: ['单细胞悬液质控记录', '目标细胞比例初判', '分选策略初稿'],
      productLinks: [
        { label: '流式细胞术场景', href: '/scenes/flow-cytometry' },
        { label: '细胞过滤器', href: '/products?keyword=cell%20strainer' },
        { label: '活率染料', href: '/products?keyword=viability%20dye' },
      ],
    },
    {
      title: '选择正选、负选或去除法',
      description: '按目标细胞丰度、后续用途和是否需要保留功能状态选择分离路线。',
      checks: ['后续是否做功能实验或培养', '目标细胞是否低丰度', '是否允许抗体直接结合目标细胞', '是否只需去除污染细胞'],
      outputs: ['正选/负选/depletion 判断', '磁珠和抗体需求清单', '对照样本安排'],
      productLinks: [
        { label: '磁珠分选相关产品', href: '/products?keyword=magnetic%20beads' },
        { label: 'Fc Block', href: '/products?keyword=Fc%20Block' },
        { label: '流式抗体', href: '/products?sub=流式抗体' },
      ],
    },
    {
      title: '磁珠孵育、分离与回收',
      description: '控制细胞密度、磁珠比例、孵育温度、洗涤强度和低吸附耗材，减少损失和非特异结合。',
      checks: ['细胞数和磁珠用量匹配', '缓冲液含 BSA/EDTA 等条件明确', '分离柱或磁架容量足够', '洗涤和回收步骤温和且可追溯'],
      outputs: ['富集或去除后的细胞群', '回收率和细胞数记录', '可复用操作参数'],
      productLinks: [
        { label: '分选缓冲液', href: '/products?keyword=cell%20separation%20buffer' },
        { label: '低吸附耗材', href: '/products?keyword=low%20binding' },
        { label: '死细胞去除', href: '/products?keyword=dead%20cell%20removal' },
      ],
    },
    {
      title: '纯度、活率与下游衔接',
      description: '用流式验证纯度和活率，再进入 FACS、单细胞建库、ELISpot、培养或功能实验。',
      checks: ['分选前后目标细胞比例已比较', '活率和回收率达到下游要求', 'FACS 或单细胞建库条件已确认', '功能实验避免激活偏差'],
      outputs: ['纯度/活率质控结果', '下游实验入口', '复购和优化建议'],
      productLinks: [
        { label: '单细胞组学场景', href: '/scenes/single-cell-omics' },
        { label: 'ELISpot 场景', href: '/scenes/elispot-fluorospot' },
        { label: '流式细胞术场景', href: '/scenes/flow-cytometry' },
      ],
    },
  ],
  decisionPoints: [
    { title: '要保持细胞功能状态吗', description: '后续做 ELISpot、培养或刺激实验时，优先考虑 untouched 负选，避免正选抗体影响目标细胞。', productLinks: [{ label: '负选磁珠相关产品', href: '/products?keyword=negative%20selection' }] },
    { title: '目标细胞是否低丰度', description: '低丰度细胞建议先磁珠富集，再流式验证或 FACS 精分选，降低上机时间和样本损失。', productLinks: [{ label: '磁珠富集', href: '/products?keyword=enrichment%20beads' }, { label: '流式细胞术场景', href: '/scenes/flow-cytometry' }] },
    { title: '只是去除污染细胞吗', description: '红细胞、死细胞、粒细胞或 CD45 阳性/阴性细胞干扰明显时，可选择 depletion 路线。', productLinks: [{ label: '死细胞去除', href: '/products?keyword=dead%20cell%20removal' }] },
    { title: '是否还需要 FACS', description: '磁珠适合粗富集和温和分离；需要极高纯度、多 marker 组合或亚群边界时，仍建议接 FACS。', productLinks: [{ label: '流式细胞术场景', href: '/scenes/flow-cytometry' }] },
  ],
  difficulties: [
    {
      id: 'low-purity',
      label: '纯度不足',
      symptom: '分选后目标细胞比例提升有限，流式质控仍显示大量杂细胞。',
      causes: ['marker 选择不准确', '磁珠或抗体用量不足', '样本团块和碎片多', '洗涤或磁分离时间不充分'],
      checks: ['比较分选前后流式比例', '复核 marker 和抗体克隆号', '检查细胞过滤和团块情况', '确认磁珠比例和孵育时间'],
      fixes: ['调整 marker 或组合去除策略', '优化磁珠用量和孵育条件', '增加过滤和 Fc Block', '低丰度目标先富集再 FACS'],
      productLinks: [{ label: '流式抗体', href: '/products?sub=流式抗体' }, { label: '磁珠分选相关产品', href: '/products?keyword=magnetic%20beads' }],
      bundleHint: '建议优先补齐流式验证抗体、Fc Block、过滤器和合适的富集或去除磁珠。',
      inquiryNote: '磁珠分选难点：纯度不足。需要 marker 选择、磁珠比例、Fc Block、过滤和流式质控建议。',
    },
    {
      id: 'low-recovery',
      label: '回收率低或活率下降',
      symptom: '分选后细胞数明显不足，活率降低，无法满足单细胞、FACS 或功能实验需求。',
      causes: ['样本处理时间长', '离心和洗涤过强', '细胞团块堵塞', '缓冲液或温度不适合目标细胞'],
      checks: ['记录每一步细胞数和活率', '检查离心力和重悬方式', '显微镜查看团块和碎片', '核对缓冲液和温控条件'],
      fixes: ['缩短处理时间并温和操作', '优化离心和洗涤条件', '使用低吸附耗材和过滤器', '必要时改用负选或降低分选强度'],
      productLinks: [{ label: '低吸附耗材', href: '/products?keyword=low%20binding' }, { label: '活率染料', href: '/products?keyword=viability%20dye' }],
      bundleHint: '建议加入低吸附管、活率染料、过滤器和死细胞去除材料。',
      inquiryNote: '磁珠分选难点：回收率低或活率下降。需要温和分离、低吸附耗材、过滤和活率质控建议。',
    },
    {
      id: 'downstream-interference',
      label: '影响下游功能或检测',
      symptom: '分选后细胞刺激反应异常，或流式/FACS marker 被占位、背景升高。',
      causes: ['正选抗体结合目标细胞并影响功能', '磁珠残留或抗体占位', 'Fc 介导非特异结合', '分选过程激活细胞'],
      checks: ['确认后续是否做功能实验', '比较正选和负选方案', '检查流式检测抗体是否与分选抗体冲突', '设置未分选对照'],
      fixes: ['功能实验优先使用 untouched 负选', '更换非竞争 clone 或间接方案', '增加 Fc Block 和洗涤', '分选后用流式重新验证状态'],
      productLinks: [{ label: 'Fc Block', href: '/products?keyword=Fc%20Block' }, { label: 'ELISpot 场景', href: '/scenes/elispot-fluorospot' }],
      bundleHint: '功能实验建议优先配置负选试剂、Fc Block、未分选对照和流式状态验证抗体。',
      inquiryNote: '磁珠分选难点：影响下游功能或检测。需要负选策略、clone 冲突、Fc Block 和功能对照建议。',
    },
  ],
  productLinks: [
    { label: '样本制备', href: '/products?sub=样本制备' },
    { label: '流式抗体', href: '/products?sub=流式抗体' },
    { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
  ],
  protocols: [
    { label: '流式细胞术实验指南', href: '/protocols/flow-cytometry', description: '用于分选前摸底和分选后纯度、活率验证。' },
    { label: '免疫细胞分离与纯化', href: '/protocols/immune-cell-isolation', description: 'PBMC、组织样本和目标细胞富集前处理参考。' },
    { label: '单细胞组学场景', href: '/scenes/single-cell-omics', description: '磁珠富集后进入建库前质控和公共图谱分析。' },
  ],
  analysisSoftware: [
    { label: 'CellMarker', href: 'http://bio-bigdata.hrbmu.edu.cn/CellMarker/', description: '公共细胞 marker 数据库，可辅助选择目标细胞和去除细胞 marker。', category: '细胞 marker 参考' },
    { label: 'PanglaoDB', href: 'https://panglaodb.se/', description: '单细胞 marker 和细胞类型参考数据库，可辅助确认富集目标。', category: '细胞 marker 参考' },
    { label: 'Human Cell Atlas', href: 'https://www.humancellatlas.org/', description: '公共细胞图谱项目，可辅助理解组织细胞组成和目标群体。', category: '公共细胞图谱' },
    { label: 'FlowRepository', href: 'https://flowrepository.org/', description: '公共流式数据仓库，可查阅部分公开 FCS 数据和门控思路。', category: '流式数据参考' },
  ],
  supportLinks: [
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: '分选前摸底、分选后纯度验证和 FACS 精分选。' },
    { label: '单细胞组学场景', href: '/scenes/single-cell-omics', description: '磁珠富集后进入单细胞建库前质控。' },
    { label: 'ELISpot 场景', href: '/scenes/elispot-fluorospot', description: 'untouched 细胞分离后进行免疫功能检测。' },
  ],
  brands: ['Miltenyi Biotec', 'STEMCELL Technologies', 'BioLegend', 'BD Biosciences', 'Thermo Fisher'],
  faqs: [
    { question: '正选和负选怎么选？', answer: '需要最高富集效率时可考虑正选；后续做功能实验、培养或刺激检测时优先考虑 untouched 负选。' },
    { question: '磁珠分选能替代 FACS 吗？', answer: '磁珠适合温和富集或去除，FACS 适合多 marker、高纯度和亚群边界明确的精分选；两者常组合使用。' },
    { question: '是否一定要先流式摸底？', answer: '不是必须，但样本复杂、目标细胞低丰度或 marker 不确定时，先做小样本流式摸底能显著降低路线选择风险。' },
  ],
  bundles: magneticCellSeparationBundles,
};

const elispotScene: SceneDefinition = {
  slug: 'elispot-fluorospot',
  title: 'ELISpot / FluoroSpot',
  eyebrow: '单细胞分泌功能检测',
  summary: '检测抗原特异性 T 细胞、B 细胞和细胞因子分泌细胞频率。',
  icon: CircleDot,
  accentClass: 'bg-green-50 text-green-700 border-green-100',
  overview: [
    { title: '实验用途', description: '在单细胞水平统计分泌反应细胞数量，结果通常以 SFU/well 或 SFU/百万细胞表示。' },
    { title: '区别 ELISA', description: 'ELISA 量化上清中总蛋白浓度，ELISpot 统计有分泌功能的细胞频率。' },
    { title: '实验重点', description: '细胞状态、刺激物、重复孔、阳性/阴性对照和 spot 计数规则决定结果可信度。' },
    { title: '结果重点', description: '需要背景扣除、复孔 CV、刺激指数、阳性对照和不可计数孔标记。' },
  ],
  workflow: [
    {
      title: '细胞来源与分离准备',
      description: '明确 PBMC、脾细胞、肿瘤浸润细胞或富集亚群来源，并保证活率和功能状态。',
      checks: ['样本采集和冻融记录完整', '细胞活率和计数已确认', '是否需要 untouched 磁珠分离已判断', '培养基和血清体系适合功能实验'],
      outputs: ['合格细胞悬液', '细胞数和活率记录', '分选或富集需求'],
      productLinks: [
        { label: '免疫磁珠分选场景', href: '/scenes/magnetic-cell-separation' },
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
      ],
    },
    {
      title: '板材包被、封闭与铺板',
      description: '按试剂盒或抗体对说明完成 PVDF 板预处理、捕获抗体包被、封闭和细胞铺板。',
      checks: ['板型和膜预处理方式明确', '捕获抗体浓度和包被时间记录完整', '每孔细胞数和重复孔已规划', '空白、阴性和阳性对照齐全'],
      outputs: ['包被和封闭记录', '孔位布局表', '细胞铺板方案'],
      productLinks: [
        { label: 'ELISpot 相关产品', href: '/products?keyword=ELISpot' },
        { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
      ],
    },
    {
      title: '刺激培养与检测显色',
      description: '加入抗原、肽库、刺激物或对照，孵育后完成检测抗体、酶标体系和底物显色。',
      checks: ['刺激物浓度和孵育时间明确', '阳性对照反应可预期', '洗板力度避免膜损伤', '显色终止时机一致'],
      outputs: ['可读 spot 板', '刺激条件记录', '异常孔标记'],
      productLinks: [
        { label: '刺激物 / 肽库', href: '/products?keyword=peptide%20pool' },
        { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
      ],
    },
    {
      title: 'spot 计数与结果归一化',
      description: '完成 spot 计数、背景扣除、SFU/百万细胞、刺激指数和复孔一致性判断。',
      checks: ['阴性背景可接受', '阳性对照有效', 'spot 未连片或过密不可计数', '复孔 CV 和异常孔已标记'],
      outputs: ['SFU 结果表', '质控结论', '可打印报告或导出数据'],
      productLinks: [
        { label: 'ELISpot 结果计算器', href: '/support?tab=calculators' },
        { label: 'ELISA 场景', href: '/scenes/elisa' },
      ],
    },
  ],
  decisionPoints: [
    { title: '检测细胞频率还是总浓度', description: '要知道“多少细胞有反应”选 ELISpot；要知道上清总量选 ELISA。', productLinks: [{ label: 'ELISA 场景', href: '/scenes/elisa' }] },
    { title: '是否需要 FluoroSpot', description: '同一样本需要同时检测 IFN-gamma、IL-2、TNF-alpha 等多指标时，可考虑 FluoroSpot。', productLinks: [{ label: '多指标检测', href: '/products?keyword=FluoroSpot' }] },
    { title: '细胞是否需要预富集', description: '抗原特异性细胞低丰度或样本背景复杂时，建议先做 untouched 分离或磁珠富集。', productLinks: [{ label: '免疫磁珠分选场景', href: '/scenes/magnetic-cell-separation' }] },
    { title: '孔位设计是否足够稳健', description: '应设置空白、阴性、阳性、刺激物和复孔，避免只凭单孔结果判断阳性。', productLinks: [{ label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' }] },
  ],
  difficulties: [
    {
      id: 'high-background',
      label: '阴性背景高',
      symptom: '未刺激孔 spot 多，背景扣除后阳性结果难以解释。',
      causes: ['细胞状态差或自发激活', '洗涤不足', '捕获/检测抗体浓度过高', '培养基或血清背景影响'],
      checks: ['检查细胞活率和冻融记录', '比较未刺激和空白孔', '复核抗体浓度和洗板条件', '确认培养体系和血清批次'],
      fixes: ['优化细胞处理和休整时间', '降低抗体浓度并加强洗涤', '更换低背景培养体系', '加入更多阴性对照'],
      productLinks: [{ label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' }, { label: 'ELISpot 相关产品', href: '/products?keyword=ELISpot' }],
      bundleHint: '建议补齐阴性对照、低背景培养材料、洗液和细胞状态质控材料。',
      inquiryNote: 'ELISpot 难点：阴性背景高。需要细胞状态、抗体浓度、洗板、培养体系和阴性对照建议。',
    },
    {
      id: 'weak-response',
      label: '阳性对照或刺激反应弱',
      symptom: '阳性对照 spot 少，抗原刺激孔无明显反应。',
      causes: ['细胞活率或功能状态差', '刺激物失效或浓度不合适', '每孔细胞数不足', '孵育时间或检测体系不匹配'],
      checks: ['复核细胞活率和计数', '确认阳性对照刺激物有效', '检查每孔细胞数和孵育时间', '核对捕获和检测抗体匹配'],
      fixes: ['提高细胞质量并优化铺板密度', '更换新鲜刺激物或肽库', '调整孵育时间', '使用已验证 ELISpot 试剂盒'],
      productLinks: [{ label: '刺激物 / 肽库', href: '/products?keyword=peptide%20pool' }, { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' }],
      bundleHint: '建议优先准备阳性对照刺激物、合适细胞密度梯度和已验证抗体对。',
      inquiryNote: 'ELISpot 难点：阳性对照或刺激反应弱。需要细胞状态、刺激物、铺板密度和试剂盒选择建议。',
    },
    {
      id: 'spot-counting',
      label: 'spot 连片或复孔差异大',
      symptom: 'spot 过密连片、大小不均，或复孔之间结果差异明显。',
      causes: ['细胞数过高', '显色时间过长', '洗板不均', '加样或铺板混匀不充分'],
      checks: ['比较不同细胞密度', '检查显色终止时间', '查看孔边缘效应', '复核加样和混匀流程'],
      fixes: ['降低每孔细胞数或刺激强度', '统一显色时间并及时终止', '优化洗板和加样一致性', '不可计数孔单独标记并重做'],
      productLinks: [{ label: 'ELISpot 板和耗材', href: '/products?keyword=ELISpot%20plate' }, { label: '低吸附耗材', href: '/products?keyword=low%20binding' }],
      bundleHint: '建议在预实验中设置细胞密度梯度、重复孔和统一显色条件。',
      inquiryNote: 'ELISpot 难点：spot 连片或复孔差异大。需要细胞密度、显色时间、洗板和孔位设计建议。',
    },
  ],
  productLinks: [
    { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
    { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: '样本制备', href: '/products?sub=样本制备' },
  ],
  protocols: [
    { label: 'ELISA 场景', href: '/scenes/elisa', description: '同类免疫检测中用于上清总量和标准曲线定量的路线。' },
    { label: '免疫磁珠分选场景', href: '/scenes/magnetic-cell-separation', description: 'ELISpot 前获得 untouched 目标细胞或降低背景细胞。' },
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: '用于检测细胞组成、活率和刺激后表型变化。' },
  ],
  analysisSoftware: [
    { label: 'ImmPort', href: 'https://www.immport.org/', description: '免疫学公共数据资源，可查阅免疫功能实验相关数据和研究条目。', category: '免疫数据资源' },
    { label: 'IEDB', href: 'https://www.iedb.org/', description: '免疫表位数据库，可用于查询抗原肽、表位和免疫应答资料。', category: '抗原和表位资源' },
    { label: 'IEDB Analysis Resource', href: 'https://tools.iedb.org/', description: '表位预测和免疫原性分析工具，可辅助筛选候选抗原肽和设计刺激条件。', category: '抗原和表位资源' },
    { label: 'FlowRepository', href: 'https://flowrepository.org/', description: '公共流式细胞术数据仓库，可查阅免疫表型、分选验证和细胞功能实验关联数据。', category: '流式数据资源' },
  ],
  supportLinks: [
    { label: 'ELISA 场景', href: '/scenes/elisa', description: '区分上清总量定量和单细胞分泌频率检测。' },
    { label: '免疫磁珠分选场景', href: '/scenes/magnetic-cell-separation', description: 'ELISpot 前的细胞富集、去除和 untouched 分离。' },
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: 'ELISpot 前后细胞组成和表型验证。' },
  ],
  brands: ['Mabtech', 'Cellular Technology Limited', 'BD Biosciences', 'BioLegend', 'Thermo Fisher'],
  faqs: [
    { question: 'ELISpot 和 ELISA 怎么选？', answer: 'ELISpot 统计分泌细胞频率，ELISA 定量上清总浓度；免疫功能细胞频率优先选 ELISpot。' },
    { question: 'ELISpot 前需要磁珠分选吗？', answer: '不是所有样本都需要。低丰度目标细胞、背景复杂或功能亚群研究时，可先用 untouched 负选或富集策略。' },
    { question: '结果为什么要背景扣除？', answer: '未刺激孔代表自发分泌和背景信号，通常需要扣除后再计算 SFU、刺激指数和阳性判定。' },
  ],
  bundles: elispotBundles,
};

const crisprGeneEditingScene: SceneDefinition = {
  slug: 'crispr-gene-editing',
  title: 'CRISPR 基因编辑',
  eyebrow: '基因功能与编辑验证',
  summary: '设计 sgRNA，安排编辑递送、筛选富集、基因型鉴定和功能验证。',
  icon: Dna,
  accentClass: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  overview: [
    { title: '实验用途', description: '用于基因敲除、敲入、碱基编辑、转录调控和功能筛选。' },
    { title: '设计核心', description: 'sgRNA 特异性、编辑方式、递送体系和验证路径共同决定项目成功率。' },
    { title: '实验重点', description: '载体或 RNP、转染/电转、药筛、单克隆和基因型鉴定需提前规划。' },
    { title: '数据分析', description: '结合测序、CRISPResso2、脱靶预测和功能读数判断编辑结果。' },
  ],
  workflow: [
    {
      title: '靶点与 sgRNA 设计',
      description: '明确编辑目标、转录本、外显子区域和 PAM 条件，优先设计多个候选 sgRNA。',
      checks: ['基因编号和转录本已确认', '编辑区域避开关键重复序列', '候选 sgRNA 脱靶风险已评估', '阳性/阴性对照已规划'],
      outputs: ['候选 sgRNA 列表', '脱靶预测记录', '引物和验证策略'],
      productLinks: [
        { label: 'CHOPCHOP', href: 'https://chopchop.cbu.uib.no/' },
        { label: 'CRISPOR', href: 'http://crispor.tefor.net/' },
        { label: '引物设计资源', href: '/scenes/molecular-biology' },
      ],
    },
    {
      title: '构建、递送与筛选',
      description: '按细胞类型选择质粒、病毒、mRNA 或 RNP 递送方式，并设置筛选和富集条件。',
      checks: ['细胞状态和转染条件已验证', '筛选抗生素 kill curve 已完成', '递送对照和荧光/抗性标记明确', '低毒性操作窗口已记录'],
      outputs: ['编辑细胞群体', '筛选条件记录', '可复购递送材料清单'],
      productLinks: [
        { label: '转染试剂', href: '/products?keyword=transfection' },
        { label: '分子克隆试剂', href: '/products?sub=分子克隆试剂' },
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
      ],
    },
    {
      title: '基因型鉴定与克隆筛选',
      description: '通过 PCR、Sanger/amplicon 测序、限制性酶切或测序分析确认编辑效率和克隆基因型。',
      checks: ['验证引物覆盖编辑区域', '混池编辑效率已评估', '单克隆来源和传代记录完整', '可能的大片段缺失已纳入检查'],
      outputs: ['编辑效率结果', '单克隆基因型表', '后续扩增和冻存清单'],
      productLinks: [
        { label: 'PCR/qPCR 试剂', href: '/products?keyword=PCR' },
        { label: 'CRISPResso2', href: 'https://crispresso.pinellolab.org/submission' },
        { label: '分子生物学场景', href: '/scenes/molecular-biology' },
      ],
    },
    {
      title: '功能验证与风险控制',
      description: '结合 WB、qPCR、流式、表型或救援实验确认编辑造成的真实功能变化。',
      checks: ['蛋白或 RNA 层面验证已安排', '脱靶和克隆差异风险已评估', '救援或多 sgRNA 验证策略明确', '原始序列和分析参数可追溯'],
      outputs: ['功能验证数据', '风险排查记录', '论文或项目可复用方法表'],
      productLinks: [
        { label: 'Western Blot 场景', href: '/scenes/western-blot' },
        { label: '流式细胞术场景', href: '/scenes/flow-cytometry' },
        { label: 'Cas-OFFinder', href: 'http://www.rgenome.net/cas-offinder/' },
      ],
    },
  ],
  decisionPoints: [
    { title: '选择 KO、KI 还是调控', description: '敲除、敲入、CRISPRi/a 和碱基编辑对载体、筛选和验证要求不同。', productLinks: [{ label: '分子克隆试剂', href: '/products?sub=分子克隆试剂' }] },
    { title: '递送方式如何确定', description: '难转染细胞优先评估电转、病毒或 RNP；普通细胞可先做质粒条件摸索。', productLinks: [{ label: '转染试剂', href: '/products?keyword=transfection' }] },
    { title: '是否需要单克隆', description: '机制研究通常需要单克隆；筛选或短期表型可先使用混池细胞评估。', productLinks: [{ label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' }] },
    { title: '如何降低脱靶风险', description: '使用多 sgRNA、脱靶预测、测序验证和救援实验提高结论可靠性。', productLinks: [{ label: 'Cas-OFFinder', href: 'http://www.rgenome.net/cas-offinder/' }] },
  ],
  difficulties: [
    {
      id: 'low-editing-efficiency',
      label: '编辑效率低',
      symptom: 'PCR 或测序显示 indel 比例低，药筛后阳性细胞不足。',
      causes: ['sgRNA 活性不足', '递送效率低', '细胞状态不佳', 'Cas 表达或 RNP 条件不合适'],
      checks: ['比较多个 sgRNA', '检查转染或电转效率', '复核细胞活率和 passage', '确认筛选强度和时间'],
      fixes: ['更换 sgRNA 或递送方式', '优化细胞密度和转染比例', '使用富集标记或药筛', '改用 RNP 或病毒递送'],
      productLinks: [{ label: '转染试剂', href: '/products?keyword=transfection' }, { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' }],
      bundleHint: '建议补齐多个 sgRNA、递送试剂、筛选材料和编辑效率检测工具。',
      inquiryNote: 'CRISPR 难点：编辑效率低。需要 sgRNA、转染/电转、筛选和测序验证建议。',
    },
    {
      id: 'clone-screening',
      label: '单克隆筛选困难',
      symptom: '单克隆生长慢、基因型复杂，或扩增后表型不稳定。',
      causes: ['单细胞压力大', '基因必需性影响增殖', '混合克隆未分离完全', '验证引物无法区分等位基因'],
      checks: ['复核克隆来源和孔记录', '检查细胞状态和培养条件', '设计多组鉴定引物', '保留混池对照'],
      fixes: ['优化单细胞铺板或流式分选', '增加克隆数量', '使用多位点 PCR 和测序', '必要时采用条件性编辑策略'],
      productLinks: [{ label: '流式细胞术场景', href: '/scenes/flow-cytometry' }, { label: 'PCR/qPCR 试剂', href: '/products?keyword=PCR' }],
      bundleHint: '建议准备单克隆培养耗材、PCR 鉴定试剂和冻存备份材料。',
      inquiryNote: 'CRISPR 难点：单克隆筛选困难。需要单克隆培养、PCR 鉴定和冻存策略建议。',
    },
    {
      id: 'off-target-risk',
      label: '脱靶或表型解释风险',
      symptom: '不同克隆表型不一致，或目标基因验证与功能读数不匹配。',
      causes: ['脱靶编辑', '克隆特异性适应', '补偿通路影响', '验证层级不足'],
      checks: ['比较多个 sgRNA 和多个克隆', '核对脱靶预测位点', '检查蛋白和 RNA 表达', '设置 rescue 或正交验证'],
      fixes: ['使用独立 sgRNA 重复验证', '增加救援实验', '测序关键脱靶位点', '结合 WB/qPCR/流式验证'],
      productLinks: [{ label: 'Western Blot 场景', href: '/scenes/western-blot' }, { label: '分子生物学场景', href: '/scenes/molecular-biology' }],
      bundleHint: '建议把功能验证抗体、qPCR 引物和脱靶位点测序纳入项目清单。',
      inquiryNote: 'CRISPR 难点：脱靶或表型解释风险。需要多 sgRNA、多克隆、rescue 和正交验证建议。',
    },
  ],
  productLinks: [
    { label: '分子克隆试剂', href: '/products?sub=分子克隆试剂' },
    { label: '转染试剂', href: '/products?keyword=transfection' },
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: 'PCR/qPCR 试剂', href: '/products?keyword=PCR' },
  ],
  protocols: [
    { label: '分子克隆与表达指南', href: '/protocols/molecular-cloning', description: '载体构建、转化、筛选和测序验证参考。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: '引物设计、PCR/qPCR、克隆和表达验证资源。' },
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: '用于荧光富集、单克隆分选和功能读数。' },
  ],
  analysisSoftware: [
    { label: 'CHOPCHOP', href: 'https://chopchop.cbu.uib.no/', description: '公共 CRISPR sgRNA 设计工具，可用于多物种基因编辑靶点设计。', category: 'sgRNA 设计' },
    { label: 'CRISPOR', href: 'http://crispor.tefor.net/', description: 'CRISPR sgRNA 设计和脱靶评分资源，适合候选靶点比较。', category: 'sgRNA 设计' },
    { label: 'Cas-OFFinder', href: 'http://www.rgenome.net/cas-offinder/', description: '用于搜索 CRISPR/Cas 潜在脱靶位点的公共工具。', category: '脱靶评估' },
    { label: 'CRISPResso2', href: 'https://crispresso.pinellolab.org/submission', description: '免费开源 CRISPR 测序结果分析工具，可评估 indel 和编辑效率。', category: '编辑结果分析' },
    { label: 'Addgene CRISPR Guide', href: 'https://www.addgene.org/guides/crispr/', description: '非营利质粒资源平台提供的 CRISPR 实验设计与载体参考。', category: '实验参考' },
  ],
  supportLinks: [
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: 'PCR、克隆、引物和测序验证资源。' },
    { label: 'Western Blot 场景', href: '/scenes/western-blot', description: '蛋白层面验证目标基因编辑效果。' },
    { label: '联系我们', href: '/contact', description: '需要基因编辑材料清单或验证路径协助时可留言。' },
  ],
  brands: ['Addgene', 'Thermo Fisher', 'NEB', 'Promega', 'Takara'],
  faqs: [
    { question: 'CRISPR 项目最先确认什么？', answer: '先确认编辑目标、细胞类型、递送方式、筛选策略和验证层级。' },
    { question: '是否一定要做单克隆？', answer: '机制研究通常建议筛单克隆；初筛或短期表型可先用混池细胞评估。' },
    { question: '编辑结果如何判断可靠？', answer: '建议结合测序、蛋白/RNA 验证、多 sgRNA、多克隆和必要的 rescue 实验。' },
  ],
  bundles: crisprGeneEditingBundles,
};

const extracellularVesiclesScene: SceneDefinition = {
  slug: 'extracellular-vesicles',
  title: '细胞外囊泡研究',
  eyebrow: 'EV / 外泌体分离与表征',
  summary: '明确囊泡来源、完成分离富集，测定粒径浓度并验证 marker。',
  icon: Droplets,
  accentClass: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  overview: [
    { title: '实验用途', description: '研究细胞通讯、疾病标志物、药物递送或条件培养基中的 EV 信号。' },
    { title: '样本核心', description: '样本来源、前处理、富集方法和污染控制直接决定结果解释。' },
    { title: '验证重点', description: '建议同时记录粒径浓度、形态、蛋白 marker 和阴性污染指标。' },
    { title: '规范重点', description: '按照 EV-TRACK 和 MISEV 思路保留方法参数，提升可重复性。' },
  ],
  workflow: [
    {
      title: '样本来源与前处理',
      description: '明确细胞培养上清、血清、血浆、尿液或组织液来源，并控制采集和保存条件。',
      checks: ['样本来源和处理时间已记录', '培养体系已避免外源 EV 干扰', '离心、过滤和冻融次数可追溯', '低吸附耗材已准备'],
      outputs: ['可追溯样本记录', '前处理 SOP', '污染控制清单'],
      productLinks: [
        { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
        { label: '低吸附耗材', href: '/products?keyword=low%20binding' },
      ],
    },
    {
      title: '分离富集与浓缩',
      description: '按样本量和用途选择差速离心、超速离心、沉淀、尺寸排阻或免疫捕获。',
      checks: ['分离方法与下游用途匹配', '蛋白/脂蛋白污染风险已评估', '回收率和纯度记录完整', '对照样本同步处理'],
      outputs: ['EV 富集样本', '分离参数记录', '可复购富集耗材清单'],
      productLinks: [
        { label: 'EV 富集相关产品', href: '/products?keyword=exosome' },
        { label: '过滤耗材', href: '/products?keyword=filter' },
      ],
    },
    {
      title: '表征与 marker 验证',
      description: '结合 NTA/纳米流式/TEM、WB、ELISA 或流式检测确认 EV 特征和污染水平。',
      checks: ['粒径和浓度数据已记录', '阳性 marker 和阴性 marker 已设置', '蛋白总量和颗粒数关系可解释', '图像或流式门控可追溯'],
      outputs: ['EV 表征报告', 'marker 验证结果', '质控结论'],
      productLinks: [
        { label: 'Western Blot 场景', href: '/scenes/western-blot' },
        { label: 'ELISA 场景', href: '/scenes/elisa' },
        { label: '流式细胞术场景', href: '/scenes/flow-cytometry' },
      ],
    },
    {
      title: '内容物与功能实验',
      description: '根据研究问题检测 miRNA、蛋白、细胞摄取、迁移、炎症或免疫调节等功能读数。',
      checks: ['输入量按颗粒数或蛋白量归一', '受体细胞状态一致', '摄取和功能对照明确', 'RNA/蛋白检测流程匹配 EV 样本'],
      outputs: ['功能实验结果', '归一化策略', '下游验证材料清单'],
      productLinks: [
        { label: '分子生物学场景', href: '/scenes/molecular-biology' },
        { label: '免疫荧光场景', href: '/scenes/immunofluorescence' },
      ],
    },
  ],
  decisionPoints: [
    { title: '样本类型决定分离方案', description: '培养上清和体液样本污染组成不同，应分别规划前处理和富集方法。', productLinks: [{ label: 'EV 富集相关产品', href: '/products?keyword=exosome' }] },
    { title: '纯度还是回收率优先', description: '功能实验常关注回收量，组学或机制验证更强调纯度和污染控制。', productLinks: [{ label: '过滤耗材', href: '/products?keyword=filter' }] },
    { title: '如何做 marker 组合', description: '建议设置阳性 EV marker、阴性污染 marker 和样本来源相关标志物。', productLinks: [{ label: 'WB抗体', href: '/products?sub=WB抗体' }] },
    { title: '结果如何规范记录', description: '记录样本来源、分离参数、粒径浓度、marker、归一化方式和数据版本。', productLinks: [{ label: 'EV-TRACK', href: 'https://evtrack.org/' }] },
  ],
  difficulties: [
    {
      id: 'low-yield',
      label: 'EV 回收量低',
      symptom: '粒子浓度低，蛋白量不足，无法完成后续验证或功能实验。',
      causes: ['起始样本量不足', '细胞状态或培养时间不合适', '富集方法回收率低', '冻融或转移损失'],
      checks: ['核对起始体积和细胞数量', '检查培养基和收集时间', '比较分离方法参数', '记录冻融和转移次数'],
      fixes: ['增加起始样本量', '优化收集时间窗', '减少转移和冻融', '改用更适合样本的富集方法'],
      productLinks: [{ label: '低吸附耗材', href: '/products?keyword=low%20binding' }, { label: 'EV 富集相关产品', href: '/products?keyword=exosome' }],
      bundleHint: '建议补齐低吸附耗材、富集试剂和样本处理记录模板。',
      inquiryNote: 'EV 难点：回收量低。需要样本量、培养条件、富集方法和低吸附耗材建议。',
    },
    {
      id: 'contamination',
      label: '污染或纯度不足',
      symptom: '蛋白污染高，脂蛋白或培养基成分干扰，下游组学结果难解释。',
      causes: ['前处理不足', '分离方法选择不当', '血清或体液污染复杂', '阴性 marker 未检测'],
      checks: ['检查过滤和预清步骤', '评估蛋白/颗粒比', '设置阴性污染 marker', '比较 SEC、超速或免疫捕获方案'],
      fixes: ['增加预清和过滤', '改进分离组合策略', '加入阴性 marker 验证', '按用途选择纯度更高方法'],
      productLinks: [{ label: 'WB抗体', href: '/products?sub=WB抗体' }, { label: '过滤耗材', href: '/products?keyword=filter' }],
      bundleHint: '建议将 marker 抗体、过滤耗材和纯度验证纳入进阶组合。',
      inquiryNote: 'EV 难点：污染或纯度不足。需要预处理、分离组合、阴性 marker 和纯度验证建议。',
    },
    {
      id: 'functional-variation',
      label: '功能实验波动大',
      symptom: '受体细胞反应不稳定，不同批次 EV 功能读数差异明显。',
      causes: ['EV 输入量归一不一致', '受体细胞状态差异', 'EV 批次和保存条件不同', '污染物参与功能读数'],
      checks: ['统一颗粒数或蛋白量归一', '记录受体细胞 passage', '核对 EV 保存和冻融', '设置去 EV 上清和载体对照'],
      fixes: ['统一归一化策略', '使用同批受体细胞', '设置桥接批次', '增加 marker 和污染验证'],
      productLinks: [{ label: '细胞健康检测试剂盒', href: '/products?sub=细胞健康检测试剂盒' }, { label: '分子生物学场景', href: '/scenes/molecular-biology' }],
      bundleHint: '建议补充归一化质控、受体细胞读数和桥接样本材料。',
      inquiryNote: 'EV 难点：功能实验波动大。需要归一化、受体细胞状态、桥接批次和对照建议。',
    },
  ],
  productLinks: [
    { label: '细胞培养试剂', href: '/products?sub=细胞培养试剂' },
    { label: 'WB抗体', href: '/products?sub=WB抗体' },
    { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
    { label: '分子生物学试剂', href: '/products?sub=分子生物学试剂' },
  ],
  protocols: [
    { label: 'Western Blot 场景', href: '/scenes/western-blot', description: 'EV marker 和污染 marker 的蛋白验证参考。' },
    { label: 'ELISA 场景', href: '/scenes/elisa', description: '特定蛋白或细胞因子定量检测参考。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: 'EV RNA、miRNA 和 qPCR 验证资源。' },
  ],
  analysisSoftware: [
    { label: 'EV-TRACK', href: 'https://evtrack.org/', description: 'EV 实验方法透明度和记录规范资源，用于整理分离和表征信息。', category: 'EV 规范与记录' },
    { label: 'MISEV Guidelines', href: 'https://www.isev.org/misev', description: '国际细胞外囊泡研究学会发布的 EV 研究建议和报告规范入口。', category: 'EV 规范与记录' },
    { label: 'ExoCarta', href: 'http://www.exocarta.org/', description: '细胞外囊泡蛋白、RNA 和脂质条目的公共数据库。', category: 'EV 数据库' },
    { label: 'Vesiclepedia', href: 'http://microvesicles.org/', description: '收录 EV 分子组成和研究条目的公共数据库。', category: 'EV 数据库' },
    { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/', description: '免费开源图像处理工具，可用于 TEM 或荧光摄取图像基础分析。', category: '图像分析' },
  ],
  supportLinks: [
    { label: 'Western Blot 场景', href: '/scenes/western-blot', description: 'EV marker、阴性 marker 和蛋白定量验证。' },
    { label: '流式细胞术场景', href: '/scenes/flow-cytometry', description: '纳米流式或 bead-based EV 检测的门控思路参考。' },
    { label: '联系我们', href: '/contact', description: '需要 EV 分离或表征材料清单协助时可留言。' },
  ],
  brands: ['System Biosciences', 'Thermo Fisher', 'Abcam', 'BioLegend', 'Cell Signaling Technology'],
  faqs: [
    { question: 'EV 项目最先确认什么？', answer: '先确认样本来源、起始体积、分离方式、下游用途和表征指标。' },
    { question: '外泌体和 EV 能否混用？', answer: '建议优先使用细胞外囊泡/EV 表述，并根据分离和表征结果谨慎描述亚型。' },
    { question: '是否只做一个 marker 就够？', answer: '不建议。通常需要阳性 marker、阴性污染 marker、粒径浓度和形态或功能读数共同支持。' },
  ],
  bundles: extracellularVesiclesBundles,
};

const proteomicsMassSpecScene: SceneDefinition = {
  slug: 'proteomics-mass-spec',
  title: '蛋白组学与质谱分析',
  eyebrow: '蛋白组、修饰组与靶向验证',
  summary: '准备样本，完成酶解、标记、LC-MS 数据分析和候选蛋白验证。',
  icon: BarChart3,
  accentClass: 'bg-blue-50 text-blue-700 border-blue-100',
  overview: [
    { title: '实验用途', description: '用于差异蛋白筛选、通路分析、翻译后修饰研究和靶向质谱验证。' },
    { title: '样本核心', description: '蛋白提取、定量、去污、酶解效率和批次设计决定数据质量。' },
    { title: '实验重点', description: '控制样本随机化、质控标准、缺失值、标记策略和修饰富集条件。' },
    { title: '数据分析', description: '结合 PRIDE、UniProt、MaxQuant、FragPipe 和 Skyline 完成鉴定与验证。' },
  ],
  workflow: [
    {
      title: '样本设计与蛋白提取',
      description: '明确分组、重复、样本量和裂解体系，避免去垢剂、盐和核酸干扰质谱。',
      checks: ['分组和生物学重复明确', '裂解液兼容质谱', '蛋白量和浓度满足要求', '样本随机化和批次记录完整'],
      outputs: ['蛋白样本', '分组设计表', '裂解和定量记录'],
      productLinks: [
        { label: '裂解液', href: '/products?sub=裂解液' },
        { label: 'BCA 定量试剂', href: '/products?keyword=BCA' },
      ],
    },
    {
      title: '还原烷基化、酶解与脱盐',
      description: '按样本类型完成还原、烷基化、酶解、肽段清理和 LC-MS 上机前质控。',
      checks: ['还原烷基化条件稳定', '酶解比例和时间记录完整', '肽段脱盐和回收率可接受', '质控样本已加入'],
      outputs: ['合格肽段样本', '酶解和脱盐记录', '上机前质控信息'],
      productLinks: [
        { label: '胰蛋白酶相关产品', href: '/products?keyword=trypsin' },
        { label: '肽段脱盐耗材', href: '/products?keyword=desalting' },
      ],
    },
    {
      title: '数据检索与定量分析',
      description: '使用开放工具或平台流程完成谱图检索、FDR 控制、定量矩阵和差异分析。',
      checks: ['数据库版本和物种明确', 'FDR 阈值和缺失值策略记录完整', '批次效应和质控样本已检查', '候选蛋白筛选标准透明'],
      outputs: ['蛋白鉴定表', '差异蛋白清单', '通路和候选验证列表'],
      productLinks: [
        { label: 'PRIDE Archive', href: 'https://www.ebi.ac.uk/pride/' },
        { label: 'UniProt', href: 'https://www.uniprot.org/' },
      ],
    },
    {
      title: '候选蛋白与修饰验证',
      description: '通过 WB、ELISA、PRM/SRM、免疫荧光或功能实验验证关键候选蛋白。',
      checks: ['候选蛋白抗体验证信息明确', '验证样本与发现队列区分', '修饰位点和总蛋白同时考虑', '靶向质谱转itions可追溯'],
      outputs: ['验证结果', '候选蛋白证据链', '后续机制实验清单'],
      productLinks: [
        { label: 'Western Blot 场景', href: '/scenes/western-blot' },
        { label: 'ELISA 场景', href: '/scenes/elisa' },
        { label: 'Skyline', href: 'https://skyline.ms/project/home/software/Skyline/begin.view' },
      ],
    },
  ],
  decisionPoints: [
    { title: '非标记还是标记定量', description: 'Label-free 更灵活，TMT/iTRAQ 更适合多样本批量比较，但对设计和批次要求更高。', productLinks: [{ label: '蛋白定量相关产品', href: '/products?keyword=BCA' }] },
    { title: '是否做修饰组', description: '磷酸化、泛素化等修饰组需要富集材料、更多起始量和对应验证路径。', productLinks: [{ label: '磷酸化抗体', href: '/products?sub=磷酸化抗体' }] },
    { title: '候选蛋白如何验证', description: '建议结合 WB、ELISA、PRM/SRM 或功能实验，避免只停留在发现阶段。', productLinks: [{ label: 'Western Blot 场景', href: '/scenes/western-blot' }] },
    { title: '数据如何归档复用', description: '保留原始谱图、数据库版本、搜索参数、定量矩阵和公共归档编号。', productLinks: [{ label: 'PRIDE Archive', href: 'https://www.ebi.ac.uk/pride/' }] },
  ],
  difficulties: [
    {
      id: 'poor-digestion',
      label: '酶解或上机质量差',
      symptom: '鉴定数量低，漏切比例高，肽段分布异常或质控样本波动大。',
      causes: ['样本污染或盐分高', '蛋白沉淀/去污不充分', '酶解条件不稳定', '肽段回收损失'],
      checks: ['检查裂解体系兼容性', '复核蛋白定量和去污步骤', '查看酶解比例和时间', '评估脱盐回收率'],
      fixes: ['优化样本清理', '统一还原烷基化和酶解条件', '加入质控标准品', '减少低吸附损失'],
      productLinks: [{ label: 'BCA 定量试剂', href: '/products?keyword=BCA' }, { label: '肽段脱盐耗材', href: '/products?keyword=desalting' }],
      bundleHint: '建议补齐质谱兼容裂解、定量、酶解、脱盐和质控标准品。',
      inquiryNote: '蛋白组学难点：酶解或上机质量差。需要裂解、去污、酶解、脱盐和质控建议。',
    },
    {
      id: 'batch-effect',
      label: '批次效应明显',
      symptom: '样本主要按上机批次或制备批次聚类，生物学差异被掩盖。',
      causes: ['样本随机化不足', '制备时间不一致', '标记批次差异', '质控样本缺失'],
      checks: ['核对样本随机化表', '查看 QC 样本稳定性', '检查缺失值和归一化策略', '比较批次内外变异'],
      fixes: ['重新规划随机化和桥接 QC', '统一制备流程', '采用合适归一化和批次校正', '保留完整元数据'],
      productLinks: [{ label: '低吸附耗材', href: '/products?keyword=low%20binding' }, { label: 'PRIDE Archive', href: 'https://www.ebi.ac.uk/pride/' }],
      bundleHint: '建议在项目开始前建立随机化、QC 和元数据记录表。',
      inquiryNote: '蛋白组学难点：批次效应明显。需要随机化、QC、归一化和元数据记录建议。',
    },
    {
      id: 'validation-gap',
      label: '候选蛋白验证困难',
      symptom: '质谱候选蛋白在 WB、ELISA 或功能实验中难以复现。',
      causes: ['抗体特异性不足', '样本队列差异', '肽段与蛋白水平不一致', '修饰位点和总蛋白混淆'],
      checks: ['核对候选肽段唯一性', '检查抗体验证信息', '区分总蛋白和修饰蛋白', '设置独立验证样本'],
      fixes: ['更换验证抗体或检测方法', '使用 PRM/SRM 靶向验证', '增加独立样本队列', '结合功能实验解释'],
      productLinks: [{ label: 'WB抗体', href: '/products?sub=WB抗体' }, { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' }],
      bundleHint: '建议将候选蛋白抗体、ELISA 或靶向质谱验证纳入后续清单。',
      inquiryNote: '蛋白组学难点：候选蛋白验证困难。需要抗体验证、独立样本和 PRM/SRM 验证建议。',
    },
  ],
  productLinks: [
    { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
    { label: 'WB抗体', href: '/products?sub=WB抗体' },
    { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
    { label: '蛋白定量相关产品', href: '/products?keyword=BCA' },
  ],
  protocols: [
    { label: 'Western Blot 场景', href: '/scenes/western-blot', description: '候选蛋白和修饰位点验证参考。' },
    { label: 'ELISA 场景', href: '/scenes/elisa', description: '候选分泌蛋白或细胞因子定量验证参考。' },
    { label: '分子生物学场景', href: '/scenes/molecular-biology', description: '候选基因 qPCR 和下游机制验证资源。' },
  ],
  analysisSoftware: [
    { label: 'PRIDE Archive', href: 'https://www.ebi.ac.uk/pride/', description: '公共蛋白组学数据归档资源，可用于检索和提交质谱数据。', category: '公共数据归档' },
    { label: 'ProteomeXchange', href: 'https://www.proteomexchange.org/', description: '蛋白组学公共数据交换联盟入口，适合查找归档数据集。', category: '公共数据归档' },
    { label: 'UniProt', href: 'https://www.uniprot.org/', description: '蛋白序列、功能注释和交叉引用数据库，是质谱解释常用参考。', category: '蛋白数据库' },
    { label: 'MaxQuant', href: 'https://www.maxquant.org/', description: '常用蛋白组学数据分析软件，可用于谱图检索和定量分析。', category: '质谱数据分析' },
    { label: 'FragPipe', href: 'https://fragpipe.nesvilab.org/', description: '免费开放的质谱数据分析软件，包含 MSFragger 等工具。', category: '质谱数据分析' },
    { label: 'Skyline', href: 'https://skyline.ms/project/home/software/Skyline/begin.view', description: '免费开源靶向质谱方法开发和数据分析软件，适合 PRM/SRM 验证。', category: '靶向质谱验证' },
  ],
  supportLinks: [
    { label: 'Western Blot 场景', href: '/scenes/western-blot', description: '候选蛋白和修饰位点验证。' },
    { label: 'ELISA 场景', href: '/scenes/elisa', description: '候选分泌蛋白或细胞因子定量验证。' },
    { label: '联系我们', href: '/contact', description: '需要蛋白组验证材料清单协助时可留言。' },
  ],
  brands: ['Thermo Fisher', 'Cytiva', 'Promega', 'Cell Signaling Technology', 'Sigma-Aldrich'],
  faqs: [
    { question: '蛋白组学项目最先确认什么？', answer: '先确认样本类型、分组重复、起始蛋白量、定量策略和后续验证方式。' },
    { question: '发现结果是否必须验证？', answer: '建议验证关键候选蛋白，尤其是用于机制解释或论文核心结论的差异蛋白。' },
    { question: '修饰组和普通蛋白组有什么不同？', answer: '修饰组通常需要更多起始量、富集步骤、位点级解释和总蛋白对照验证。' },
  ],
  bundles: proteomicsMassSpecBundles,
};

const smallAnimalImagingScene: SceneDefinition = {
  slug: 'small-animal-imaging',
  title: '小动物实验与成像',
  eyebrow: '动物模型、活体成像与数据定量',
  summary: '围绕动物模型、探针给药、麻醉监测、图像采集和定量分析组织材料与流程。',
  icon: Microscope,
  accentClass: 'bg-sky-50 text-sky-700 border-sky-100',
  overview: [
    { title: '实验用途', description: '用于肿瘤负荷、感染进展、炎症反应、药效评价、器官分布和组织结构观察。' },
    { title: '动物准备', description: '品系、体重、建模方式、给药路线、麻醉保温和伦理记录需要在实验前统一。' },
    { title: '成像方式', description: '常见路线包括生物发光、荧光、PET/SPECT、Micro-CT、MRI、超声和光声。' },
    { title: '数据分析', description: '按固定时间点、采集参数、ROI 规则和背景扣除方式整理可比较数据。' },
  ],
  workflow: [
    {
      title: '实验设计与动物模型确认',
      description: '明确研究问题、动物模型、分组随机化、成像时间点和伦理审批要求。',
      checks: ['动物品系、性别、周龄和体重范围明确', '模型建立与分组标准一致', '成像时间点和终点标准已记录', '伦理审批和动物状态评分表已准备'],
      outputs: ['动物实验设计表', '分组和随机化记录', '成像时间表'],
      productLinks: [
        { label: '动物固定和记录耗材', href: '/products?keyword=animal%20holder' },
        { label: '实验支持', href: '/support' },
      ],
    },
    {
      title: '探针、底物或造影剂给药',
      description: '按成像模态准备 D-Luciferin、荧光探针、放射性示踪剂或 MRI/CT 造影剂。',
      checks: ['探针与模型和检测窗口匹配', '给药剂量、路线和采集间隔明确', '阳性和阴性对照已设置', '避光、半衰期和安全防护要求已确认'],
      outputs: ['给药记录', '探针或造影剂清单', '对照设置'],
      productLinks: [
        { label: '活体成像底物和探针', href: '/products?keyword=luciferin%20imaging' },
        { label: '注射给药耗材', href: '/products?keyword=注射器%20灌胃针' },
      ],
    },
    {
      title: '麻醉、保温与图像采集',
      description: '控制麻醉深度、体温、体位、曝光或扫描参数，保证批次之间数据可比。',
      checks: ['麻醉浓度和诱导时间已记录', '保温垫和体温监测可用', '动物体位和固定方式一致', '曝光、滤光片或扫描参数固定'],
      outputs: ['原始图像或扫描数据', '采集参数记录', '动物状态记录'],
      productLinks: [
        { label: '小动物麻醉与保温', href: '/products?keyword=小动物%20麻醉' },
        { label: '生理监测耗材', href: '/products?keyword=animal%20monitor' },
      ],
    },
    {
      title: 'ROI 定量、离体器官和数据归档',
      description: '统一 ROI、背景扣除和归一化方式，必要时结合离体器官成像或组织学验证。',
      checks: ['ROI 标注规则固定', '背景和曝光范围可追溯', '离体器官取材顺序一致', '原始数据、定量表和软件版本已归档'],
      outputs: ['定量结果表', 'ROI 标注文件', '验证实验清单'],
      productLinks: [
        { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/' },
        { label: '免疫荧光场景', href: '/scenes/immunofluorescence' },
        { label: 'IHC 场景', href: '/scenes/ihc' },
      ],
    },
  ],
  decisionPoints: [
    { title: '研究问题决定成像模态', description: '肿瘤负荷和转染报告常用生物发光；结构观察常用 Micro-CT 或 MRI；代谢和受体分布常用 PET/SPECT。', productLinks: [{ label: '活体成像底物和探针', href: '/products?keyword=animal%20imaging%20probe' }] },
    { title: '探针是否匹配模型', description: '确认探针靶点、给药路线、检测窗口、组织穿透深度和背景来源，再安排采集时间。', productLinks: [{ label: '荧光与发光试剂', href: '/products?keyword=fluorescent%20probe' }] },
    { title: '动物状态与伦理要求', description: '麻醉、保温、镇痛、终点标准和复苏观察会影响动物福利，也会影响图像稳定性。', productLinks: [{ label: '小动物麻醉与保温', href: '/products?keyword=小动物%20麻醉' }] },
    { title: '数据是否可定量比较', description: '采集参数、ROI 规则、背景扣除和归一化方式应在实验开始前固定。', productLinks: [{ label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/' }] },
  ],
  difficulties: [
    {
      id: 'weak-signal',
      label: '成像信号偏弱',
      symptom: '目标区域信号低，组间差异难以区分，或同一模型批次信号波动大。',
      causes: ['模型负荷不足或表达不稳定', '探针剂量或采集时间点不合适', '组织穿透深度超过模态能力', '麻醉和体温造成生理状态波动'],
      checks: ['核对模型建立时间和负荷', '检查探针批次、剂量和给药路线', '复核采集窗口和曝光参数', '保留体温和麻醉记录'],
      fixes: ['重新优化采集时间点', '增加阳性对照或离体器官验证', '调整探针剂量或给药路线', '统一麻醉、保温和体位'],
      productLinks: [
        { label: '活体成像探针', href: '/products?keyword=animal%20imaging%20probe' },
        { label: '小动物保温材料', href: '/products?keyword=animal%20warming' },
      ],
      bundleHint: '建议优先补齐探针阳性对照、保温材料和采集参数记录表。',
      inquiryNote: '小动物成像难点：信号偏弱。需要模型负荷、探针剂量、给药路线、采集窗口和麻醉保温记录。',
    },
    {
      id: 'high-background',
      label: '背景信号偏高',
      symptom: '非目标组织、皮毛或给药部位信号明显，影响 ROI 定量。',
      causes: ['皮毛或组织自发荧光强', '探针清除不足', '给药外漏或污染', '曝光或滤光片设置不合适'],
      checks: ['设置未给药和空白动物对照', '检查脱毛和皮肤准备', '核对给药外漏和污染记录', '比较不同滤光片和曝光参数'],
      fixes: ['优化脱毛和清洁流程', '延长或调整采集时间窗', '改进给药操作', '更换通道或探针组合'],
      productLinks: [
        { label: '脱毛和皮肤准备耗材', href: '/products?keyword=depilatory%20animal' },
        { label: '荧光光谱工具', href: '/support?tab=spectra' },
      ],
      bundleHint: '建议补充脱毛耗材、空白对照和单通道参数测试。',
      inquiryNote: '小动物成像难点：背景偏高。需要未给药对照、脱毛记录、给药状态、滤光片和曝光参数。',
    },
    {
      id: 'animal-instability',
      label: '麻醉或动物状态不稳定',
      symptom: '采集中动物呼吸、体位或体温波动，导致图像模糊、参数不可比或复苏异常。',
      causes: ['麻醉浓度或诱导时间变化', '保温不足', '固定方式不一致', '动物体重和健康状态差异大'],
      checks: ['记录诱导和维持麻醉参数', '监测体温和呼吸', '核对体位固定方式', '检查动物体重、评分和复苏状态'],
      fixes: ['统一麻醉流程', '加入保温和生理监测', '使用适配体型的固定器', '按动物状态调整采集顺序'],
      productLinks: [
        { label: '小动物麻醉系统', href: '/products?keyword=animal%20anesthesia' },
        { label: '动物固定器', href: '/products?keyword=animal%20restrainer' },
      ],
      bundleHint: '建议将麻醉系统、保温垫、体温探头、固定器和状态评分表纳入基础清单。',
      inquiryNote: '小动物成像难点：麻醉或动物状态不稳定。需要麻醉浓度、体温、固定方式、体重和复苏记录。',
    },
  ],
  productLinks: [
    { label: '小动物麻醉与保温', href: '/products?keyword=小动物%20麻醉' },
    { label: '活体成像底物和探针', href: '/products?keyword=luciferin%20imaging' },
    { label: '注射给药耗材', href: '/products?keyword=注射器%20灌胃针' },
    { label: '成像与显微耗材', href: '/products?sub=显微镜与成像耗材' },
  ],
  protocols: [
    { label: '小动物成像实验设计', href: '/support', description: '用于整理伦理、模型、分组、采集时间点和材料准备。' },
    { label: '免疫荧光场景', href: '/scenes/immunofluorescence', description: '离体组织验证、荧光通道和图像分析参考。' },
    { label: '空间生物学场景', href: '/scenes/spatial-biology', description: '组织切片、空间标记和图像配准参考。' },
  ],
  analysisSoftware: [
    { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/', description: '免费开源图像处理工具，可用于 ROI、背景扣除、荧光强度和批量图像处理。', category: '图像定量' },
    { label: '3D Slicer', href: 'https://www.slicer.org/', description: '免费开源医学图像平台，可处理 CT、MRI、PET 等三维数据和分割任务。', category: '三维影像' },
    { label: 'ITK-SNAP', href: 'http://www.itksnap.org/', description: '常用医学图像分割工具，适合结构影像 ROI 标注和体积分析。', category: '三维影像' },
    { label: 'napari', href: 'https://napari.org/', description: '免费开源多维图像浏览和分析工具，适合荧光、组织切片和多通道图像查看。', category: '图像分析' },
    { label: 'QuPath', href: 'https://qupath.github.io/', description: '开源数字病理图像分析软件，可用于离体组织验证图像的 ROI 和细胞级分析。', category: '组织图像' },
  ],
  supportLinks: [
    { label: '免疫荧光场景', href: '/scenes/immunofluorescence', description: '离体组织荧光验证、通道规划和封片成像。' },
    { label: '空间生物学场景', href: '/scenes/spatial-biology', description: '组织切片、多重标记和空间图像分析。' },
    { label: '联系我们', href: '/contact', description: '需要小动物成像材料清单或厂家选型协助时可留言。' },
  ],
  brands: ['Pancentry', 'RWD', 'Kent Scientific', 'Revvity IVIS', 'Bruker', 'FUJIFILM VisualSonics', 'MILabs'],
  faqs: [
    { question: '第一次做小动物成像先确认什么？', answer: '先确认研究问题、动物模型、成像模态、探针或造影剂、给药路线、采集时间点和伦理要求。' },
    { question: '生物发光和荧光怎么选？', answer: '生物发光背景低，适合报告基因和肿瘤负荷；荧光可选探针多，但需要更重视组织自发荧光和穿透深度。' },
    { question: '成像前为什么要控制麻醉和体温？', answer: '麻醉深度和体温会影响循环、代谢、呼吸和体位稳定性，进而影响信号强度和组间可比性。' },
  ],
  bundles: smallAnimalImagingBundles,
};

export const scenes: SceneDefinition[] = [
  {
    slug: 'western-blot',
    title: 'Western Blot',
    eyebrow: '蛋白表达检测与验证',
    summary: '验证蛋白表达、分子量、修饰状态和处理组差异。',
    icon: BarChart3,
    accentClass: 'bg-blue-50 text-blue-700 border-blue-100',
    overview: [
      { title: '实验用途', description: '验证目标蛋白表达、分子量、修饰状态和处理组差异。' },
      { title: '材料准备', description: '一抗/二抗、显影体系、膜材、Marker、裂解和定量试剂。' },
      { title: '首次实验', description: '优先补齐一抗、二抗、ECL、膜、Marker、裂解液和洗膜试剂。' },
      { title: '补货记录', description: '按已验证抗体、ECL、PVDF 膜和缓冲液记录补货。' },
    ],
    workflow: [
      {
        title: '样本裂解与定量',
        description: '选择裂解液、抑制剂和 BCA 试剂，确认上样量一致。',
        checks: ['样本来源和处理组已记录', '裂解液匹配细胞/组织类型', '蛋白酶或磷酸酶抑制剂现用现加', 'BCA 标准曲线和上样量已确认'],
        outputs: ['统一浓度的蛋白样本', '可追溯的样本处理记录', '可用于后续复购的裂解和定量清单'],
        productLinks: [
          { label: '裂解液', href: '/products?sub=裂解液' },
          { label: 'BCA 定量试剂', href: '/products?keyword=BCA' },
          { label: '抑制剂', href: '/products?keyword=inhibitor' },
        ],
      },
      {
        title: '电泳与转膜',
        description: '按蛋白分子量选择胶浓度、膜材和转膜条件。',
        checks: ['目标蛋白分子量已确认', '胶浓度或预制胶规格匹配', 'PVDF/NC 膜材选择明确', '转膜后有总蛋白或 Ponceau S 复核'],
        outputs: ['分离清晰的蛋白条带', '转膜效率判断结果', '膜材和转膜条件记录'],
        productLinks: [
          { label: 'PVDF 膜', href: '/products?keyword=PVDF' },
          { label: '蛋白 Marker', href: '/products?keyword=marker' },
          { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
        ],
      },
      {
        title: '封闭与抗体孵育',
        description: '匹配一抗来源、二抗宿主和封闭体系，降低非特异背景。',
        checks: ['一抗应用包含 WB 和目标物种', '二抗宿主和标记类型匹配', '封闭液适合目标类型', '一抗/二抗稀释比例已做记录'],
        outputs: ['抗体孵育条件表', '可复用的一抗/二抗组合', '背景控制策略'],
        productLinks: [
          { label: 'WB抗体', href: '/products?sub=WB抗体' },
          { label: 'HRP偶联二抗', href: '/products?sub=HRP偶联二抗' },
          { label: '封闭液', href: '/products?sub=WB辅助试剂' },
        ],
      },
      {
        title: '显影与复核',
        description: '根据丰度选择 ECL 灵敏度，并配置内参和阳性对照。',
        checks: ['内参条带稳定', '阳性/阴性对照可解释', '曝光时间未过曝', 'ECL 灵敏度匹配目标丰度'],
        outputs: ['可解释的目标条带', '内参归一化基础', '下一次复购的显影和对照需求'],
        productLinks: [
          { label: 'ECL 发光液', href: '/products?sub=WB辅助试剂' },
          { label: '内参抗体', href: '/products?sub=内参抗体' },
          { label: '阳性对照', href: '/products?keyword=positive%20control' },
          { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '一抗是否已验证 WB',
        description: '优先选择明确标注 WB 应用、样本物种和文献引用的抗体。',
        productLinks: [
          { label: 'WB抗体', href: '/products?sub=WB抗体' },
          { label: '内参抗体', href: '/products?sub=内参抗体' },
        ],
      },
      {
        title: '目标蛋白丰度',
        description: '低丰度目标建议搭配高灵敏 ECL、低背景封闭液和阳性对照。',
        productLinks: [
          { label: '高灵敏 ECL', href: '/products?sub=WB辅助试剂' },
          { label: '阳性对照', href: '/products?keyword=positive%20control' },
        ],
      },
      {
        title: '膜材与转膜条件',
        description: '按分子量选择 PVDF 或 NC 膜，并记录转膜条件便于复购对照。',
        productLinks: [
          { label: 'PVDF 膜', href: '/products?keyword=PVDF' },
          { label: '蛋白 Marker', href: '/products?keyword=marker' },
        ],
      },
      {
        title: '二抗与封闭体系',
        description: '二抗宿主需与一抗来源匹配；背景高时可换低背景封闭液或交叉吸附二抗。',
        productLinks: [
          { label: 'HRP偶联二抗', href: '/products?sub=HRP偶联二抗' },
          { label: '封闭液', href: '/products?sub=WB辅助试剂' },
        ],
      },
      {
        title: '复购是否需要批次备注',
        description: '关键项目建议保留品牌、货号、批号或近批次需求，便于数据可比。',
        productLinks: [
          { label: 'WB抗体', href: '/products?sub=WB抗体' },
          { label: '选购组合', href: '#bundle-selector' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'weak-signal',
        label: '条带弱 / 没有条带',
        symptom: '曝光后目标条带很弱，或内参正常但目标蛋白不可见。',
        causes: ['目标蛋白丰度低或样本裂解不充分', '一抗不适用于 WB 或稀释比例过高', '转膜效率不足，特别是高分子量蛋白', 'ECL 灵敏度不够或底物失效'],
        checks: ['确认一抗说明书是否标注 WB、物种和样本类型', '检查内参、阳性对照和上样量是否正常', '用 Ponceau S 或总蛋白染色确认转膜', '缩短一抗稀释倍数或延长孵育时间做小范围对比'],
        fixes: ['优先补充高验证等级一抗和阳性对照', '低丰度目标改用高灵敏 ECL', '高分子量蛋白延长转膜或调整膜材', '加入蛋白酶/磷酸酶抑制剂保护样本'],
        productLinks: [
          { label: 'WB抗体', href: '/products?sub=WB抗体' },
          { label: '高灵敏 ECL', href: '/products?sub=WB辅助试剂' },
          { label: '阳性对照相关产品', href: '/products?keyword=positive%20control' },
        ],
        bundleHint: '推荐从“进阶 WB 初购组合”开始，重点补一抗验证、阳性对照和高灵敏显影。',
        inquiryNote: 'Western Blot 难点：条带弱/无条带。需要协助筛选 WB 验证一抗、高灵敏 ECL、阳性对照和转膜相关试剂。',
      },
      {
        id: 'high-background',
        label: '背景高 / 杂带多',
        symptom: '整张膜发灰、杂带很多，目标条带不清晰或重复性差。',
        causes: ['封闭体系不匹配或封闭时间不足', '一抗/二抗浓度过高', '洗膜强度不足', '抗体特异性不够或样本降解'],
        checks: ['分别降低一抗和二抗浓度，不要一次改太多变量', '比较 BSA、脱脂奶粉和商业封闭液', '延长 TBST 洗膜时间并确认 Tween 浓度', '查看同靶点抗体的 WB 图片和引用记录'],
        fixes: ['换低背景封闭液或优化封闭条件', '选择交叉吸附二抗减少非特异信号', '补充新鲜 TBST、封闭液和抑制剂', '同靶点准备替代品牌做验证'],
        productLinks: [
          { label: 'HRP偶联二抗', href: '/products?sub=HRP偶联二抗' },
          { label: '封闭/洗膜试剂', href: '/products?sub=WB辅助试剂' },
          { label: '同靶点抗体筛选', href: '/products?sub=WB抗体' },
        ],
        bundleHint: '推荐“进阶 WB 复购补货”，优先补低背景封闭体系、二抗和已验证抗体。',
        inquiryNote: 'Western Blot 难点：背景高/杂带多。需要低背景封闭液、交叉吸附二抗、TBST 和同靶点替代抗体建议。',
      },
      {
        id: 'phospho-unstable',
        label: '磷酸化信号不稳定',
        symptom: '同一处理组磷酸化条带波动大，复现实验时强弱不一致。',
        causes: ['样本处理没有及时抑制磷酸酶', '磷酸化抗体特异性或保存状态不稳定', '处理时间窗和样本收集节奏不一致', '总蛋白和磷酸化蛋白没有成对验证'],
        checks: ['裂解时是否加入磷酸酶抑制剂', '同时检测 total protein 和 phospho protein', '确认刺激/抑制处理时间点是否固定', '避免反复冻融抗体和样本'],
        fixes: ['补充磷酸酶抑制剂和低温裂解流程', '选择成对验证的 phospho/total 抗体', '建立阳性处理对照', '关键抗体按小包装或分装管理'],
        productLinks: [
          { label: '磷酸化抗体', href: '/products?sub=磷酸化抗体' },
          { label: '蛋白酶/磷酸酶抑制剂', href: '/products?keyword=phosphatase%20inhibitor' },
          { label: '内参抗体', href: '/products?sub=内参抗体' },
        ],
        bundleHint: '推荐“专家 WB 初购组合”，把磷酸化保护体系和成对抗体一起配置。',
        inquiryNote: 'Western Blot 难点：磷酸化信号不稳定。需要 phospho/total 抗体、磷酸酶抑制剂、阳性对照和样本保护方案。',
      },
    ],
    productLinks: [
      { label: 'WB抗体', href: '/products?sub=WB抗体' },
      { label: 'WB辅助试剂', href: '/products?sub=WB辅助试剂' },
      { label: 'HRP偶联二抗', href: '/products?sub=HRP偶联二抗' },
      { label: '裂解液', href: '/products?sub=裂解液' },
    ],
    protocols: [
      { label: 'Western Blot 实验指南', href: '/protocols/western-blot', description: '从蛋白提取到显影的完整流程。' },
      { label: '免疫沉淀 IP/Co-IP', href: '/protocols/immunoprecipitation', description: '用于蛋白互作和富集验证。' },
      { label: '磷酸化蛋白检测', href: '/products?sub=磷酸化抗体', description: '保护磷酸化状态并降低背景。' },
    ],
    analysisSoftware: [
      ...antibodyPublicResources,
      {
        label: 'ImageJ/Fiji',
        href: 'https://imagej.net/software/fiji/',
        description: '免费开源 ImageJ 发行版，适合 WB 条带灰度、背景扣除、ROI 和批量图像处理。',
        category: '条带定量',
      },
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: '采购、账户与实验相关问答汇总。' },
      { label: '开放平台', href: '/open-platform', description: '面向机构采购、目录对接和长期供货协作。' },
    ],
    brands: ['Abcam', 'CST', 'Proteintech', 'Thermo Fisher', 'Bio-Rad'],
    faqs: [
      { question: '第一次做 WB 应该先买什么？', answer: '先对照上方「实验流程」与「选型决策」，补齐一抗、二抗、ECL、膜、Marker、裂解液、BCA、封闭液和 TBST。' },
      { question: '复购时如何控制成本？', answer: '优先补 ECL、膜、二抗、TBST 等消耗品；已验证一抗建议保持品牌和批次备注。' },
      { question: '低丰度蛋白怎么选？', answer: '选择高特异性一抗、高灵敏 ECL、低背景封闭体系，并增加阳性对照；可参考疑难协助中的条带弱场景。' },
    ],
    bundles: wbBundles,
  },
  {
    slug: 'elisa',
    title: 'ELISA',
    eyebrow: '酶联免疫吸附试验',
    summary: '定量检测血清、血浆、细胞上清和组织匀浆样本。',
    icon: TestTube,
    accentClass: 'bg-green-50 text-green-700 border-green-100',
    overview: [
      { title: '实验用途', description: '完成血清、血浆、细胞上清、组织匀浆等样本的定量检测。' },
      { title: '材料准备', description: '试剂盒、标准品、酶标板、洗液、底物和样本处理相关耗材。' },
      { title: '首次实验', description: '优先选择完整试剂盒，减少抗体对、标准曲线和包被条件摸索。' },
      { title: '补货记录', description: '记录已验证指标、同批次需求、检测范围和耗材消耗。' },
    ],
    workflow: [
      {
        title: '确认检测指标',
        description: '明确因子名称、物种、样本类型、预期浓度和检测范围。',
        checks: ['指标英文名和别名已确认', '物种和样本类型已确认', '预期浓度或文献范围已确认', '是否需要高灵敏检测已判断'],
        outputs: ['可筛选的指标关键词', '样本类型和物种约束', '检测范围需求'],
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: '高灵敏 ELISA', href: '/products?keyword=high%20sensitivity%20ELISA' },
        ],
      },
      {
        title: '选择试剂盒类型',
        description: '按夹心法、竞争法、预包被板或抗体对匹配实验目标。',
        checks: ['夹心法/竞争法是否适合目标分子', '是否需要预包被板', '说明书是否验证目标样本', '是否需要抗体对做方法开发'],
        outputs: ['试剂盒类型判断', '候选品牌和货号', '是否需要定制或方法开发'],
        productLinks: [
          { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
          { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
          { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
        ],
      },
      {
        title: '样本与标准曲线',
        description: '规划稀释倍数、重复孔、标准品梯度和质控样本。',
        checks: ['标准品复溶和梯度方案已确定', '样本预稀释倍数已规划', '重复孔数量满足统计需求', '质控样本或桥接样本已准备'],
        outputs: ['标准曲线设计', '样本加样计划', '辅助试剂和耗材清单'],
        productLinks: [
          { label: '标准品', href: '/products?sub=抗体对和蛋白标准品' },
          { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
          { label: '板材耗材', href: '/products?keyword=ELISA%20plate' },
          { label: 'ELISA 曲线拟合计算器', href: '#elisa-calculator' },
        ],
      },
      {
        title: '读数与复购管理',
        description: '记录品牌、货号、批次、检测范围和复购时的现货需求。',
        checks: ['读板波长和终止时间一致', 'CV 和 R2 达到项目标准', '品牌/货号/批号已记录', '后续样本量和复购周期已估算'],
        outputs: ['可复用的检测记录', '复购批次需求', '项目备货或授信采购建议'],
        productLinks: [
          { label: 'ELISA 曲线拟合计算器', href: '#elisa-calculator' },
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: '品牌目录', href: '/brands' },
          { label: '选购组合', href: '#bundle-selector' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '物种和样本是否匹配',
        description: '优先确认说明书中的验证样本类型，复杂样本关注基质效应。',
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
        ],
      },
      {
        title: '检测范围是否覆盖预期浓度',
        description: '样本浓度未知时，建议准备预实验或选择更宽检测窗口。',
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: '标准品', href: '/products?sub=抗体对和蛋白标准品' },
        ],
      },
      {
        title: '夹心法还是竞争法',
        description: '多数蛋白因子适合夹心法；小分子、激素等常选竞争法，不确定时可先浏览两类目录。',
        productLinks: [
          { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
          { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
        ],
      },
      {
        title: '是否需要高灵敏检测',
        description: '目标浓度接近检测下限时，优先选择高灵敏试剂盒或预留预实验小包装。',
        productLinks: [
          { label: '高灵敏 ELISA', href: '/products?keyword=high%20sensitivity%20ELISA' },
          { label: '抗体对和标准品', href: '/products?sub=抗体对和蛋白标准品' },
        ],
      },
      {
        title: '是否需要长期批次稳定',
        description: '大样本项目建议提前备注同批次、近批次或项目备货需求。',
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: '选购组合', href: '#bundle-selector' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'range-mismatch',
        label: '标准曲线不好 / 超出范围',
        symptom: '标准曲线 R2 不理想，样本 OD 落在检测范围外，结果无法定量。',
        causes: ['试剂盒检测范围和样本真实浓度不匹配', '标准品复溶、梯度稀释或加样误差', '样本没有做预稀释摸底', '读板波长或终止时间不一致'],
        checks: ['核对说明书检测范围、灵敏度和样本推荐稀释倍数', '用 2-3 个稀释倍数做预实验', '检查标准品复溶体积、梯度和重复孔 CV', '确认酶标仪波长、终止液和读数时间'],
        fixes: ['更换检测范围更匹配的试剂盒', '补充标准品、样本稀释液和重复孔耗材', '样本浓度未知时先做预实验小包装', '大样本前锁定同一品牌和批次'],
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: '抗体对和蛋白标准品', href: '/products?sub=抗体对和蛋白标准品' },
          { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
        ],
        bundleHint: '可参考「进阶 ELISA 初购组合」，或使用上方选型决策缩小试剂盒范围。',
        inquiryNote: 'ELISA 难点：标准曲线不好/样本超出范围。需要匹配检测范围的试剂盒、标准品、样本稀释液和预实验建议。',
      },
      {
        id: 'matrix-effect',
        label: '复杂样本干扰大',
        symptom: '血清、血浆、组织匀浆或细胞上清结果波动大，稀释后不平行。',
        causes: ['样本基质影响抗原抗体结合或酶反应', '样本处理、离心、冻融次数不一致', '目标指标接近检测下限', '试剂盒没有验证该样本类型'],
        checks: ['确认说明书是否验证对应样本类型', '做稀释线性和平行性测试', '记录采样、离心、冻存和冻融次数', '加入质控样本判断板间差'],
        fixes: ['选择明确支持该样本类型的试剂盒', '补充样本预处理试剂和质控材料', '低丰度指标选择高灵敏试剂盒', '大样本项目优先要求同批次或项目备货'],
        productLinks: [
          { label: '高灵敏 ELISA', href: '/products?cat=ELISA试剂盒' },
          { label: '样本预处理/辅助试剂', href: '/products?sub=ELISA辅助试剂' },
          { label: '质控与标准品', href: '/products?sub=抗体对和蛋白标准品' },
        ],
        bundleHint: '可参考「专家 ELISA 初购组合」，侧重基质效应、灵敏度与质控配套。',
        inquiryNote: 'ELISA 难点：复杂样本干扰大。需要支持对应样本类型的试剂盒、样本预处理、质控材料和高灵敏方案。',
      },
      {
        id: 'batch-consistency',
        label: '复购批次不一致',
        symptom: '同一指标复购后结果偏移，历史数据和新批次数据难以合并。',
        causes: ['试剂盒批次变化导致标准曲线或回收率偏移', '没有保留上次品牌、货号和批号', '大样本项目分批采购，没有提前锁定备货', '辅助试剂或操作窗口发生变化'],
        checks: ['整理上次品牌、货号、批号、检测范围和样本稀释倍数', '新旧批次做桥接样本对比', '确认辅助试剂、酶标仪和读数窗口是否一致', '评估剩余样本量和后续批量需求'],
        fixes: ['复购时备注同批次/近批次需求', '对大样本项目申请项目备货', '保留桥接质控样本', '批量采购时同步锁定辅助试剂'],
        productLinks: [
          { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
          { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
          { label: '品牌目录', href: '/brands' },
        ],
        bundleHint: '复购时可参考「专家 ELISA 复购补货」组合，或备注批次与备货需求由顾问跟进。',
        inquiryNote: 'ELISA 难点：复购批次不一致。需要同批次/近批次试剂盒、项目备货、质控样本和辅助试剂锁定。',
      },
    ],
    productLinks: [
      { label: 'ELISA试剂盒', href: '/products?cat=ELISA试剂盒' },
      { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
      { label: '夹心法ELISA', href: '/products?sub=夹心法ELISA' },
      { label: 'ELISA辅助试剂', href: '/products?sub=ELISA辅助试剂' },
    ],
    protocols: [
      { label: 'ELISA 操作指南', href: '/protocols/elisa-sandwich', description: '标准曲线、加样、孵育、洗板和读数。' },
      { label: 'ELISPOT 实验指南', href: '/protocols/elispot', description: '用于细胞分泌因子的单细胞检测。' },
      { label: '抗体对和标准品', href: '/products?sub=抗体对和蛋白标准品', description: '适合方法开发和定制检测。' },
    ],
    analysisSoftware: [
      {
        label: 'ELISA 曲线拟合计算器',
        href: '/scenes/elisa#elisa-calculator',
        description: '站内免费工具，支持标准品 OD 4PL 拟合、样本浓度回算、质控提示和结果导出。',
        category: '站内计算器',
      },
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: '采购、账户与实验相关问答汇总。' },
      { label: '联系我们', href: '/contact', description: '需要人工协助时可留言，我们会尽快回复。' },
    ],
    brands: ['R&D Systems', 'Abcam', 'Thermo Fisher', 'BioLegend', 'Elabscience'],
    faqs: [
      { question: '不确定选哪款试剂盒？', answer: '先对照页面上方「选型决策」与「检测流程」确认物种、样本类型和检测范围，再至产品中心按类目筛选。' },
      { question: '复购时需要备注什么？', answer: '备注上次品牌、货号、样本类型、同批次需求和项目备货需求，便于核对历史数据。' },
      { question: '复杂样本结果不稳怎么办？', answer: '可先对照本页疑难协助，或通过支持中心说明样本来源与读板数据，协助排查与换型。' },
    ],
    bundles: elisaBundles,
  },
  {
    slug: 'ihc',
    title: 'IHC / 免疫组化',
    eyebrow: '组织定位与表达评估',
    summary: '在 FFPE 与冰冻切片中定位并观察蛋白表达。',
    icon: Microscope,
    accentClass: 'bg-rose-50 text-rose-700 border-rose-100',
    overview: [
      { title: '实验用途', description: '在组织切片中观察目标蛋白定位、表达强度和细胞/组织分布。' },
      { title: '材料准备', description: 'IHC 验证一抗、检测系统、抗原修复液、封闭液、DAB、复染和封片耗材。' },
      { title: '首次实验', description: '先确认样本类型、抗体 IHC 验证、阳性组织对照和检测系统兼容性。' },
      { title: '补货记录', description: '保持固定、修复、抗体批次、显色时间和封片体系一致，降低评分波动。' },
    ],
    workflow: [
      {
        title: '样本与切片确认',
        description: '明确 FFPE 或冰冻切片、固定条件、组织来源和目标蛋白定位。',
        checks: ['组织固定方式和时间已记录', '切片厚度与防脱片需求已确认', '目标蛋白定位和阳性组织已查证', '阴性对照和同型对照需求已规划'],
        outputs: ['样本条件记录', '对照切片需求', '基础耗材清单'],
        productLinks: [
          { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
          { label: '防脱载玻片', href: '/products?keyword=adhesion%20slides' },
          { label: '阳性对照', href: '/products?keyword=positive%20control' },
        ],
      },
      {
        title: '抗体与检测系统',
        description: '选择 IHC 验证一抗，并匹配宿主、二抗、HRP/AP 或荧光检测系统。',
        checks: ['一抗说明书包含 IHC 或 IHC-P/IHC-Fr 应用', '物种反应性和组织来源匹配', '二抗或聚合物系统匹配一抗宿主', '是否需要 DAB、AP 或荧光检测已确定'],
        outputs: ['一抗候选清单', '检测系统搭配', '对照和替代抗体方案'],
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '二抗', href: '/products?sub=二抗' },
          { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        ],
      },
      {
        title: '修复与封闭条件',
        description: '按样本和靶点选择柠檬酸或 EDTA 修复、内源酶封闭和非特异封闭。',
        checks: ['抗原修复 pH 和热修复方式已记录', '内源性过氧化物酶封闭已纳入 HRP 流程', '封闭液和抗体稀释液兼容', '洗液体系 PBS/TBS 已统一'],
        outputs: ['可复用修复条件', '封闭和洗涤方案', '背景控制策略'],
        productLinks: [
          { label: '抗原修复液', href: '/products?keyword=antigen%20retrieval' },
          { label: '封闭液', href: '/products?keyword=blocking%20buffer' },
          { label: 'PBS/TBS', href: '/products?keyword=PBS%20TBS' },
        ],
      },
      {
        title: '显色、复染与成像',
        description: '控制 DAB 显色时间、苏木素复染、封片和扫描/显微成像条件。',
        checks: ['DAB 显色时间未过度延长', '苏木素复染和返蓝条件一致', '封片剂匹配明场或荧光成像', '图像采集参数和评分标准已固定'],
        outputs: ['可解释染色图像', '评分和成像记录', '后续复购与批次管理清单'],
        productLinks: [
          { label: 'DAB 显色液', href: '/products?keyword=DAB' },
          { label: '封片剂', href: '/products?keyword=mounting%20medium' },
          { label: '成像相关试剂', href: '/products?sub=IHC和成像试剂' },
          { label: 'QuPath', href: 'https://qupath.github.io/' },
          { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '抗体是否验证 IHC 应用',
        description: '优先选择明确标注 IHC、IHC-P 或 IHC-Fr，并有组织图片或文献支持的抗体。',
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '重组单抗', href: '/products?sub=重组单抗' },
        ],
      },
      {
        title: 'FFPE 还是冰冻切片',
        description: 'FFPE 通常需要抗原修复；冰冻切片更关注固定方式、组织形态和荧光背景。',
        productLinks: [
          { label: '抗原修复液', href: '/products?keyword=antigen%20retrieval' },
          { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        ],
      },
      {
        title: '检测系统和显色方式',
        description: '明场 IHC 常用 HRP-DAB；共定位或多重检测可考虑荧光二抗或多重染色体系。',
        productLinks: [
          { label: '二抗', href: '/products?sub=二抗' },
          { label: 'DAB 显色液', href: '/products?keyword=DAB' },
        ],
      },
      {
        title: '阳性和阴性对照是否齐全',
        description: '弱信号或新靶点项目需要阳性组织对照；背景判断需设置无一抗或同型对照。',
        productLinks: [
          { label: '阳性对照', href: '/products?keyword=positive%20control' },
          { label: '同型对照', href: '/products?keyword=isotype%20control' },
        ],
      },
      {
        title: '是否需要评分一致性',
        description: '大样本或临床队列建议锁定批次、桥接对照切片和统一成像参数。',
        productLinks: [
          { label: '选购组合', href: '#bundle-selector' },
          { label: '联系我们', href: '/contact' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'weak-staining',
        label: '染色弱 / 无信号',
        symptom: '阳性区域信号很淡，或对照组织也没有明确染色。',
        causes: ['一抗未验证 IHC 或稀释过高', '抗原修复条件不足', '组织固定过度或抗原丢失', '检测系统灵敏度不够或底物失效'],
        checks: ['确认一抗应用、组织物种和阳性组织图片', '比较柠檬酸 pH6 与 EDTA pH9 修复条件', '检查阳性组织对照和无一抗对照', '延长一抗孵育或降低稀释倍数做小范围对比'],
        fixes: ['更换 IHC 验证等级更高的一抗', '补充阳性组织对照和高灵敏检测系统', '优化热修复时间和 pH', '更换新鲜 DAB 或底物体系'],
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '抗原修复液', href: '/products?keyword=antigen%20retrieval' },
          { label: 'DAB 显色液', href: '/products?keyword=DAB' },
        ],
        bundleHint: '推荐从“进阶 IHC 初购组合”开始，重点补 IHC 验证一抗、对照切片和修复体系。',
        inquiryNote: 'IHC 难点：染色弱/无信号。需要 IHC 验证一抗、阳性组织对照、抗原修复液、高灵敏检测系统和 DAB 建议。',
      },
      {
        id: 'high-background',
        label: '背景高 / 非特异染色',
        symptom: '整片发棕、间质或阴性区域染色明显，目标定位难以判断。',
        causes: ['一抗浓度过高或孵育过长', '内源性过氧化物酶或生物素未充分封闭', '封闭液不匹配或洗涤不足', '组织坏死、脱蜡不彻底或切片干片'],
        checks: ['做无一抗对照和同型对照', '降低一抗浓度并缩短孵育时间', '确认 H2O2 封闭和血清封闭步骤', '延长 PBS/TBS 洗涤并检查脱蜡水化流程'],
        fixes: ['补充内源酶封闭液和合适封闭液', '选择聚合物检测系统降低非特异背景', '更换交叉吸附二抗或预吸附抗体', '统一切片脱蜡、水化和洗涤条件'],
        productLinks: [
          { label: '封闭液', href: '/products?keyword=blocking%20buffer' },
          { label: '二抗', href: '/products?sub=二抗' },
          { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
        ],
        bundleHint: '推荐“进阶 IHC 复购补货”，优先补封闭体系、检测系统和已验证抗体。',
        inquiryNote: 'IHC 难点：背景高/非特异染色。需要封闭液、内源酶封闭、聚合物检测系统、二抗和洗涤条件建议。',
      },
      {
        id: 'section-quality',
        label: '脱片 / 边缘染色 / 显色不均',
        symptom: '组织从玻片脱落，边缘颜色更深，或同一切片不同区域信号差异大。',
        causes: ['载玻片附着力不足或烤片不充分', '修复过强导致组织脱落', '孵育液覆盖不均或切片干燥', '手工加液和洗涤节奏不一致'],
        checks: ['使用防脱载玻片并检查烤片条件', '降低修复强度或缩短修复时间', '确保切片全程被液体覆盖', '同批次切片采用统一加液体积和洗涤时间'],
        fixes: ['更换防脱载玻片和新鲜封片耗材', '优化修复方式和缓冲液 pH', '使用湿盒孵育并避免干片', '批量项目可考虑自动染色或统一操作模板'],
        productLinks: [
          { label: '防脱载玻片', href: '/products?keyword=adhesion%20slides' },
          { label: '抗原修复液', href: '/products?keyword=antigen%20retrieval' },
          { label: '封片剂', href: '/products?keyword=mounting%20medium' },
        ],
        bundleHint: '推荐“新手 IHC 初购组合”，把防脱片、修复液、湿盒孵育和封片耗材一起补齐。',
        inquiryNote: 'IHC 难点：脱片/边缘染色/显色不均。需要防脱载玻片、抗原修复条件、湿盒孵育、封片剂和操作一致性建议。',
      },
    ],
    productLinks: [
      { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
      { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
      { label: '二抗', href: '/products?sub=二抗' },
      { label: '抗原修复液', href: '/products?keyword=antigen%20retrieval' },
    ],
    protocols: [
      { label: 'IHC 实验指南', href: '/protocols/ihc', description: '脱蜡、水化、抗原修复、封闭、孵育、显色和封片。' },
      { label: '免疫荧光实验指南', href: '/protocols/immunofluorescence', description: '用于荧光二抗、多重标记和共定位观察。' },
      { label: '抗体应用筛选', href: '/products?sub=IHC和成像抗体', description: '按靶点、物种、组织和 IHC 应用筛选抗体。' },
    ],
    analysisSoftware: [
      ...antibodyPublicResources,
      {
        label: 'QuPath',
        href: 'https://qupath.github.io/',
        description: '免费开源数字病理与组织图像分析工具，适合 IHC 切片标注、细胞检测和半定量分析。',
        category: '组织图像分析',
      },
      {
        label: 'ImageJ/Fiji',
        href: 'https://imagej.net/software/fiji/',
        description: '免费开源 ImageJ 发行版，可用于明场/荧光图像测量、ROI、灰度和批量处理。',
        category: '通用图像分析',
      },
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: '采购、账户与实验相关问答汇总。' },
      { label: '联系我们', href: '/contact', description: '需要人工协助时可留言，我们会尽快回复。' },
    ],
    brands: ['Abcam', 'CST', 'Proteintech', 'Thermo Fisher', 'BioLegend'],
    faqs: [
      { question: 'IHC 一抗怎么选？', answer: '优先选择明确标注 IHC/IHC-P/IHC-Fr 的抗体，并核对组织物种、阳性组织图片和文献记录。' },
      { question: 'FFPE 一定要抗原修复吗？', answer: '多数 FFPE 样本需要热修复；修复液 pH 和时间要按抗体说明书或预实验优化。' },
      { question: '背景高先改什么？', answer: '先设置无一抗对照，逐步调整一抗浓度、封闭、内源酶封闭和洗涤条件，避免一次改太多变量。' },
    ],
    bundles: ihcBundles,
  },
  {
    slug: 'immunofluorescence',
    title: '免疫荧光',
    eyebrow: '荧光定位与共定位成像',
    summary: '观察细胞、冰冻切片和部分 FFPE 样本中的荧光定位。',
    icon: Droplets,
    accentClass: 'bg-purple-50 text-purple-700 border-purple-100',
    overview: [
      { title: '实验用途', description: '观察目标蛋白在细胞或组织中的定位、表达差异和多靶点共定位关系。' },
      { title: '材料准备', description: 'IF 验证一抗、荧光二抗、DAPI、固定/通透/封闭、抗淬灭封片和成像耗材。' },
      { title: '首次实验', description: '先确认样本类型、一抗 IF 验证、二抗宿主和显微镜激发/发射通道。' },
      { title: '补货记录', description: '保持抗体批次、荧光通道、封片剂、曝光参数和对照样本一致。' },
    ],
    workflow: [
      {
        title: '样本与固定方式',
        description: '明确贴壁细胞、悬浮细胞、冰冻切片或 FFPE 样本，并选择固定和通透条件。',
        checks: ['样本类型和目标定位已确认', 'PFA、甲醇或丙酮固定方式已选择', '胞内/核内靶点通透条件已规划', '载玻片、爬片或孔板成像方式已确认'],
        outputs: ['样本处理条件记录', '固定/通透材料清单', '成像载体选择'],
        productLinks: [
          { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
          { label: '爬片/载玻片', href: '/products?keyword=coverslip' },
          { label: '固定液', href: '/products?keyword=paraformaldehyde' },
        ],
      },
      {
        title: '抗体与通道规划',
        description: '按一抗宿主、荧光二抗和显微镜通道设计单标、双标或多标组合。',
        checks: ['一抗说明书包含 IF/ICC 或 IF-Fr 应用', '多靶点一抗宿主不冲突', '二抗荧光通道与显微镜滤块匹配', 'DAPI、FITC/Alexa 488、TRITC/Cy3、Cy5 等通道已分配'],
        outputs: ['抗体与荧光通道表', '二抗搭配方案', '串色风险提示'],
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
          { label: '荧光光谱查看器', href: '/support?tab=spectra' },
        ],
      },
      {
        title: '封闭、孵育与洗涤',
        description: '通过封闭、抗体稀释、避光孵育和洗涤降低背景并保护荧光信号。',
        checks: ['封闭液与二抗宿主兼容', '一抗/二抗稀释比例已记录', '避光孵育和洗涤时间一致', '无一抗对照和单染对照已设置'],
        outputs: ['可复用孵育条件', '背景控制策略', '对照设置清单'],
        productLinks: [
          { label: '封闭液', href: '/products?keyword=blocking%20buffer' },
          { label: '抗体稀释液', href: '/products?keyword=antibody%20diluent' },
          { label: 'PBS/TBS', href: '/products?keyword=PBS%20TBS' },
        ],
      },
      {
        title: '封片与成像',
        description: '选择 DAPI、抗淬灭封片剂和合适曝光参数，记录原始图像用于比较。',
        checks: ['DAPI 或核染通道已设置', '抗淬灭封片剂匹配荧光染料', '曝光、增益和激光强度未过曝', '多通道采集顺序和单染对照已核对'],
        outputs: ['可解释荧光图像', '成像参数记录', '后续复购和批次管理清单'],
        productLinks: [
          { label: 'DAPI', href: '/products?keyword=DAPI' },
          { label: '抗淬灭封片剂', href: '/products?keyword=antifade%20mounting%20medium' },
          { label: '成像相关试剂', href: '/products?sub=IHC和成像试剂' },
          { label: 'ImageJ/Fiji', href: 'https://imagej.net/software/fiji/' },
          { label: 'CellProfiler', href: 'https://cellprofiler.org/releases/' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '一抗是否验证 IF/ICC',
        description: '优先选择明确标注 IF、ICC 或 IF-Fr，并有细胞/组织荧光图像支持的抗体。',
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '重组单抗', href: '/products?sub=重组单抗' },
        ],
      },
      {
        title: '一抗宿主是否冲突',
        description: '双标/多标时避免多个一抗来自同一宿主；无法避免时考虑直接偶联或顺序染色。',
        productLinks: [
          { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
        ],
      },
      {
        title: '通道是否匹配显微镜',
        description: '荧光染料要匹配滤块或激光线，并和 DAPI、FITC、TRITC、Cy5 等通道错开。',
        productLinks: [
          { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: 'DAPI', href: '/products?keyword=DAPI' },
        ],
      },
      {
        title: '样本自发荧光是否明显',
        description: '组织、固定时间长或含血红素/脂褐素样本要预留自发荧光淬灭或远红通道方案。',
        productLinks: [
          { label: '自发荧光淬灭剂', href: '/products?keyword=autofluorescence%20quencher' },
          { label: '抗淬灭封片剂', href: '/products?keyword=antifade%20mounting%20medium' },
        ],
      },
      {
        title: '是否需要定量可比',
        description: '定量项目建议固定曝光、增益、激光强度、批次和桥接对照样本。',
        productLinks: [
          { label: '选购组合', href: '#bundle-selector' },
          { label: '联系我们', href: '/contact' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'weak-fluorescence',
        label: '荧光弱 / 无信号',
        symptom: '目标通道信号很弱，阳性样本也难以看到明确定位。',
        causes: ['一抗未验证 IF 或稀释过高', '固定/通透条件破坏抗原或进入不足', '二抗通道不匹配或荧光淬灭', '曝光参数过低或滤块不匹配'],
        checks: ['确认一抗 IF/ICC 应用和阳性样本图片', '比较 PFA 与甲醇固定、Triton 与 saponin 通透', '确认荧光二抗宿主和显微镜通道', '用阳性对照和单染对照排除成像设置问题'],
        fixes: ['更换 IF 验证一抗或降低稀释倍数', '优化固定和通透条件', '补充高亮荧光二抗和抗淬灭封片剂', '固定曝光和增益后重新采集'],
        productLinks: [
          { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
          { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: '抗淬灭封片剂', href: '/products?keyword=antifade%20mounting%20medium' },
        ],
        bundleHint: '推荐从“进阶免疫荧光初购组合”开始，重点补 IF 验证一抗、高亮二抗和对照体系。',
        inquiryNote: '免疫荧光难点：荧光弱/无信号。需要 IF 验证一抗、高亮荧光二抗、固定/通透优化、抗淬灭封片和阳性对照建议。',
      },
      {
        id: 'high-background',
        label: '背景高 / 自发荧光强',
        symptom: '阴性区域或整张图都有亮背景，目标定位不清晰。',
        causes: ['二抗非特异结合或封闭不足', '组织自发荧光强', '抗体浓度过高或洗涤不足', '固定液残留或样本干片'],
        checks: ['设置无一抗对照和二抗单独对照', '降低一抗/二抗浓度并延长洗涤', '用未染样本判断自发荧光通道', '确认切片或细胞全程未干燥'],
        fixes: ['换交叉吸附荧光二抗或低背景封闭液', '使用自发荧光淬灭剂或避开强背景通道', '优化抗体稀释和洗涤时间', '减少固定残留并使用新鲜缓冲液'],
        productLinks: [
          { label: '交叉吸附荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: '封闭液', href: '/products?keyword=blocking%20buffer' },
          { label: '自发荧光淬灭剂', href: '/products?keyword=autofluorescence%20quencher' },
        ],
        bundleHint: '推荐“进阶免疫荧光复购补货”，优先补交叉吸附二抗、封闭体系和自发荧光处理材料。',
        inquiryNote: '免疫荧光难点：背景高/自发荧光强。需要交叉吸附二抗、封闭液、自发荧光淬灭剂和对照设置建议。',
      },
      {
        id: 'channel-bleedthrough',
        label: '串色 / 共定位假阳性',
        symptom: '不同通道信号互相污染，合并图看似共定位但单通道不可靠。',
        causes: ['荧光染料光谱重叠', '采集顺序或曝光设置不合适', '缺少单染对照', '多个一抗宿主相同导致二抗交叉结合'],
        checks: ['检查每个染料的激发/发射谱', '用单染样本设置采集参数', '确认多标一抗宿主和二抗交叉吸附情况', '降低过曝通道曝光或激光强度'],
        fixes: ['更换光谱分离更好的荧光二抗', '增加单染和无一抗对照', '同宿主一抗改用直接偶联或顺序染色', '采用顺序扫描并固定参数'],
        productLinks: [
          { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
          { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
          { label: '同型对照', href: '/products?keyword=isotype%20control' },
        ],
        bundleHint: '推荐“专家免疫荧光初购组合”，把多通道二抗、直接偶联和完整对照一起配置。',
        inquiryNote: '免疫荧光难点：串色/共定位假阳性。需要多通道荧光二抗、直接偶联试剂、单染对照和采集参数建议。',
      },
    ],
    productLinks: [
      { label: 'IHC和成像抗体', href: '/products?sub=IHC和成像抗体' },
      { label: '荧光二抗', href: '/products?sub=荧光偶联二抗' },
      { label: '荧光标记试剂盒', href: '/products?sub=荧光偶联试剂盒' },
      { label: 'IHC和成像试剂', href: '/products?sub=IHC和成像试剂' },
    ],
    protocols: [
      { label: '免疫荧光实验指南', href: '/protocols/immunofluorescence', description: '固定、通透、封闭、抗体孵育、核染、封片和成像。' },
      { label: 'IHC 实验指南', href: '/protocols/ihc', description: '组织样本染色与抗原修复条件可作为切片 IF 参考。' },
      { label: '抗体应用筛选', href: '/products?sub=IHC和成像抗体', description: '按靶点、物种、样本和 IF 应用筛选抗体。' },
    ],
    analysisSoftware: [
      ...antibodyPublicResources,
      {
        label: 'ImageJ/Fiji',
        href: 'https://imagej.net/software/fiji/',
        description: '免费开源 ImageJ 发行版，适合荧光强度、共定位、ROI 和批量图像处理。',
        category: '通用图像分析',
      },
      {
        label: 'CellProfiler',
        href: 'https://cellprofiler.org/releases/',
        description: '免费开源细胞图像分析软件，适合细胞分割、批量定量和可复用 pipeline。',
        category: '细胞图像分析',
      },
      {
        label: 'QuPath',
        href: 'https://qupath.github.io/',
        description: '免费开源数字病理图像分析工具，适合组织切片 IF、细胞检测和区域标注。',
        category: '组织图像分析',
      },
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: '采购、账户与实验相关问答汇总。' },
      { label: '联系我们', href: '/contact', description: '需要人工协助时可留言，我们会尽快回复。' },
    ],
    brands: ['Abcam', 'CST', 'Proteintech', 'Thermo Fisher', 'Jackson ImmunoResearch'],
    faqs: [
      { question: '免疫荧光二抗怎么选？', answer: '先看一抗宿主，再匹配显微镜通道；多标实验优先选择交叉吸附二抗并设置单染对照。' },
      { question: 'DAPI 和目标通道会冲突吗？', answer: 'DAPI 通常在蓝色通道，需和 488、555/594、647 等目标通道分开采集，避免过曝影响合并图判断。' },
      { question: '背景高先改什么？', answer: '先做无一抗对照和未染样本，区分二抗背景与自发荧光，再调整封闭、抗体浓度、洗涤和通道选择。' },
    ],
    bundles: immunofluorescenceBundles,
  },
  elispotScene,
  magneticCellSeparationScene,
  {
    slug: 'flow-cytometry',
    title: '流式细胞术',
    eyebrow: '单细胞多参数分析',
    summary: '分析免疫分型、细胞周期、凋亡、胞内因子和分选前样本。',
    icon: Activity,
    accentClass: 'bg-amber-50 text-amber-700 border-amber-100',
    overview: [
      { title: '实验用途', description: '在单细胞层面分析表面 marker、胞内蛋白、死活状态、细胞周期和细胞群比例。' },
      { title: '材料准备', description: '流式验证抗体、荧光素搭配、死活染、补偿/FMO 对照、样本制备和上机耗材。' },
      { title: '首次实验', description: '先确认样本类型、目标细胞群、抗体克隆号、仪器激光和滤光片配置。' },
      { title: '补货记录', description: '保持克隆号、荧光素、抗体滴度、补偿设置和仪器模板一致。' },
    ],
    workflow: [
      {
        title: '样本制备与计数',
        description: '制备单细胞悬液，控制细胞活率、聚团、红细胞和碎片干扰。',
        checks: ['样本来源和处理时间已记录', '细胞活率和浓度已确认', '红细胞裂解或组织消化条件已规划', '过滤、洗涤和低温避光流程已准备'],
        outputs: ['可上机单细胞悬液', '细胞浓度和活率记录', '样本制备耗材清单'],
        productLinks: [
          { label: '样本制备', href: '/products?sub=样本制备' },
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
          { label: '细胞滤网', href: '/products?keyword=cell%20strainer' },
        ],
      },
      {
        title: 'Panel 与荧光搭配',
        description: '按 marker 表达强弱、抗体克隆号、荧光亮度和仪器通道设计 panel。',
        checks: ['marker 列表和目标细胞群已确认', '抗体应用包含 Flow/FCM', '荧光素匹配仪器激光和滤光片', '低表达 marker 优先分配高亮染料'],
        outputs: ['抗体 panel 表', '荧光通道搭配', '替代荧光素方案'],
        productLinks: [
          { label: '荧光光谱查看器', href: '#spectrum-viewer' },
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '直标抗体', href: '/products?sub=直标抗体' },
          { label: '抗体组合套装', href: '/products?sub=抗体组合套装' },
        ],
      },
      {
        title: '染色与对照设置',
        description: '设置死活染、Fc Block、表面/胞内染色、补偿、FMO 和同型对照。',
        checks: ['死活染和固定兼容性已确认', '每个荧光通道有单染补偿', '关键边界 marker 设置 FMO', '胞内染色有固定/通透方案'],
        outputs: ['染色流程表', '补偿和门控对照', '质控样本安排'],
        productLinks: [
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
          { label: '同型对照抗体', href: '/products?sub=同型对照抗体' },
          { label: '细胞凋亡', href: '/products?sub=细胞凋亡' },
        ],
      },
      {
        title: '上机与数据质控',
        description: '控制流速、事件数、补偿矩阵、门控策略和批间桥接样本。',
        checks: ['仪器质控和电压模板已确认', '单细胞、活细胞和目标群门控顺序固定', '事件数满足统计需求', '批间桥接样本和原始 FCS 已保存'],
        outputs: ['可解释 FCS 数据', '门控和补偿记录', '复购和批次管理需求'],
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '仪器配件', href: '/products?sub=配件' },
          { label: 'Cytoflow 用户手册', href: 'https://cytoflow.readthedocs.io/en/stable/user_manual/user_manual.html' },
          { label: '选购组合', href: '#bundle-selector' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '抗体是否验证 Flow',
        description: '优先选择明确标注 Flow/FCM 应用、样本物种和目标细胞类型的抗体。',
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '直标抗体', href: '/products?sub=直标抗体' },
        ],
      },
      {
        title: '仪器通道是否匹配',
        description: '荧光素必须匹配仪器激光和滤光片；高参数 panel 需提前规划光谱重叠。',
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '荧光染料参考', href: '/support?tab=spectra' },
        ],
      },
      {
        title: 'marker 表达强弱如何分配',
        description: '低表达或关键分群 marker 优先分配 PE、APC、BV421 等高亮染料。',
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '抗体组合套装', href: '/products?sub=抗体组合套装' },
        ],
      },
      {
        title: '对照是否齐全',
        description: '多色实验至少准备单染补偿；边界不清的 marker 需要 FMO，对非特异结合可加同型对照。',
        productLinks: [
          { label: '同型对照抗体', href: '/products?sub=同型对照抗体' },
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
        ],
      },
      {
        title: '是否做胞内或分选',
        description: '胞内染色需要固定通透体系；分选项目需关注无菌、低内毒素和分选级缓冲液。',
        productLinks: [
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
          { label: '样本制备', href: '/products?sub=样本制备' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'weak-signal',
        label: '信号弱 / 阳性群不清',
        symptom: '阳性群和阴性群分不开，或目标 marker 信号接近背景。',
        causes: ['抗体克隆或荧光素不适合该 marker', '抗体滴度过低或染色时间不足', '低表达 marker 分配了较暗染料', '样本处理导致抗原丢失或细胞状态差'],
        checks: ['确认抗体说明书是否标注 Flow/FCM 和样本物种', '做抗体滴定而不是直接沿用默认浓度', '查看 marker 表达强弱并调整荧光素亮度', '加入阳性对照细胞或已知阳性样本'],
        fixes: ['更换 Flow 验证抗体或同克隆高亮荧光素', '补充阳性对照和死活染', '优化样本处理时间和温度', '低表达 marker 优先使用高亮通道'],
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '直标抗体', href: '/products?sub=直标抗体' },
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
        ],
        bundleHint: '推荐从“进阶流式初购组合”开始，重点补高亮抗体、阳性对照、死活染和补偿材料。',
        inquiryNote: '流式难点：信号弱/阳性群不清。需要 Flow 验证抗体、高亮荧光素、抗体滴定、阳性对照和样本制备建议。',
      },
      {
        id: 'high-background',
        label: '背景高 / 非特异结合',
        symptom: '阴性群整体偏高，多个通道背景抬升，门控边界不清。',
        causes: ['Fc 受体介导非特异结合', '死细胞多导致抗体吸附', '洗涤不足或抗体浓度过高', '补偿或自发荧光处理不当'],
        checks: ['加入 Fc Block 并比较封闭前后', '用死活染排除死细胞', '降低抗体用量并增加洗涤', '查看未染、单染和 FMO 对照'],
        fixes: ['补充 Fc Block、死活染和低背景缓冲液', '优化样本制备和过滤', '重新做补偿矩阵', '设置 FMO 辅助门控'],
        productLinks: [
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
          { label: '同型对照抗体', href: '/products?sub=同型对照抗体' },
          { label: '样本制备', href: '/products?sub=样本制备' },
        ],
        bundleHint: '推荐“进阶流式复购补货”，优先补 Fc Block、死活染、补偿/FMO 和样本制备耗材。',
        inquiryNote: '流式难点：背景高/非特异结合。需要 Fc Block、死活染、FMO/同型对照、低背景缓冲和样本制备建议。',
      },
      {
        id: 'compensation-panel',
        label: '补偿异常 / 串色严重',
        symptom: '补偿后数据倾斜、阴性群扩散，或多色 panel 中通道互相污染。',
        causes: ['单染补偿不完整或亮度不匹配', '荧光素光谱重叠过强', '电压设置或采集模板不一致', '抗体 panel 未按表达量和亮度分配'],
        checks: ['每个荧光通道准备单染补偿样本或补偿微球', '检查低表达 marker 是否使用高亮染料', '确认仪器模板、电压和补偿矩阵对应同一批实验', '增加 FMO 判断真实阳性边界'],
        fixes: ['补充补偿微球和单染对照', '调整 panel 中重叠严重的荧光素', '固定仪器模板和采集顺序', '复杂 panel 先做小规模预实验'],
        productLinks: [
          { label: '流式抗体', href: '/products?sub=流式抗体' },
          { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
          { label: '抗体组合套装', href: '/products?sub=抗体组合套装' },
        ],
        bundleHint: '推荐“专家流式初购组合”，把 panel 设计、补偿微球、FMO 和高亮抗体一起配置。',
        inquiryNote: '流式难点：补偿异常/串色严重。需要 panel 调整、补偿微球、单染/FMO 对照、高亮荧光素和仪器模板建议。',
      },
    ],
    productLinks: [
      { label: '流式抗体', href: '/products?sub=流式抗体' },
      { label: '流式实验试剂', href: '/products?sub=流式实验试剂' },
      { label: '样本制备', href: '/products?sub=样本制备' },
      { label: '同型对照抗体', href: '/products?sub=同型对照抗体' },
    ],
    protocols: [
      { label: '流式细胞术实验指南', href: '/protocols/flow-cytometry', description: '样本制备、染色、补偿、上机和门控分析。' },
      { label: '免疫细胞分离与纯化', href: '/protocols/immune-cell-isolation', description: 'PBMC、组织样本和后续流式前处理参考。' },
      { label: '磁珠分选 MACS', href: '/protocols/magnetic-bead-sorting', description: '流式前富集或去除特定细胞群。' },
    ],
    analysisSoftware: [
      ...antibodyPublicResources,
      {
        label: 'Cytoflow 分析软件（用户手册）',
        href: 'https://cytoflow.readthedocs.io/en/stable/user_manual/user_manual.html',
        description: '免费开源流式数据分析软件文档，了解 GUI、workflow 复用、元数据分组和数据分析流程。',
        category: 'FCS 数据分析',
      },
      {
        label: 'Cytoflow 官方下载',
        href: 'https://cytoflow.github.io/',
        description: '前往 Cytoflow 官网获取免费开源软件安装包与版本更新。',
        category: 'FCS 数据分析',
      },
      {
        label: '支持 Cytoflow 维护者 Leah',
        href: 'https://ko-fi.com/lrteague',
        description: 'Cytoflow 为免费开源软件；如该工具对您的数据分析有帮助，可通过 Ko-fi 支持维护者继续改进。',
        category: '项目支持',
      },
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: '流式补偿、对照和样本制备相关问答。' },
      { label: '联系我们', href: '/contact', description: '需要 panel 选型或人工协助时可留言。' },
    ],
    brands: ['BD Biosciences', 'BioLegend', 'Thermo Fisher', 'CST', 'Abcam'],
    faqs: [
      { question: '流式抗体怎么选？', answer: '先确认 Flow/FCM 应用、物种、克隆号和目标细胞类型，再按仪器通道选择荧光素。' },
      { question: '什么时候需要 FMO？', answer: '多色 panel 中边界不清、连续表达或低丰度 marker 建议设置 FMO，用于确定门控边界。' },
      { question: '背景高先查什么？', answer: '先看死活染、无染/单染/FMO、Fc Block 和样本碎片聚团，再调整抗体滴度与洗涤。' },
    ],
    bundles: flowCytometryBundles,
  },
  singleCellOmicsScene,
  spatialBiologyScene,
  smallAnimalImagingScene,
  organoid3dCultureScene,
  crisprGeneEditingScene,
  extracellularVesiclesScene,
  proteomicsMassSpecScene,
  {
    slug: 'molecular-biology',
    title: '分子生物学',
    eyebrow: '核酸扩增、克隆与表达验证',
    summary: '提取核酸、完成 PCR/qPCR 与反转录，开展克隆构建和表达验证。',
    icon: Dna,
    accentClass: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    overview: [
      { title: '实验用途', description: '核酸提取、终点 PCR、RT-PCR/qPCR、载体构建、转染和表达验证。' },
      { title: '材料准备', description: '提取纯化、PCR/qPCR 酶体系、引物/探针、反转录、电泳、克隆和无核酸酶耗材。' },
      { title: '首次实验', description: '先补齐提取、扩增、电泳确认和污染控制，避免因缺少基础材料中断实验。' },
      { title: '补货记录', description: '按已验证 Mix、引物、纯化试剂和耗材规格补货。' },
    ],
    workflow: [
      {
        title: '样本与核酸提取',
        description: '按样本类型选择 DNA/RNA/miRNA 提取方案，控制降解、污染和产量波动。',
        checks: ['样本来源、保存和冻融次数已记录', 'DNA、RNA 或 miRNA 类型已确认', 'RNase/DNase-free 操作材料已准备', '浓度、纯度和完整性检测方式已规划'],
        outputs: ['可用于扩增的核酸模板', '浓度与纯度记录', '提取和纯化材料清单'],
        productLinks: [
          { label: '核酸纯化', href: '/products?sub=核酸纯化' },
          { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
          { label: 'NCBI Gene', href: 'https://www.ncbi.nlm.nih.gov/gene/' },
          { label: 'NCBI BLAST', href: 'https://blast.ncbi.nlm.nih.gov/Blast.cgi' },
          { label: 'RNAcentral', href: 'https://rnacentral.org/' },
          { label: 'miRNA 提取指南', href: '/protocols/mirna-extraction' },
        ],
      },
      {
        title: 'PCR/qPCR 体系设计',
        description: '确认引物、模板、酶体系、退火温度、阴性对照和定量策略。',
        checks: ['引物特异性和产物长度已确认', '模板量和稀释倍数已确定', '阴性/无模板/阳性对照已设置', 'qPCR 内参和重复孔方案已规划'],
        outputs: ['扩增体系表', '引物与对照清单', 'qPCR 数据可比方案'],
        productLinks: [
          { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
          { label: '反转录试剂', href: '/products?sub=反转录试剂' },
          { label: 'qPCR 试剂', href: '/products?keyword=qPCR' },
          { label: 'PrimerBank', href: 'https://pga.mgh.harvard.edu/primerbank/' },
          { label: 'NCBI Primer-BLAST', href: 'https://www.ncbi.nlm.nih.gov/tools/primer-blast/' },
          { label: 'UCSC In-Silico PCR', href: 'https://genome.ucsc.edu/cgi-bin/hgPcr' },
          { label: 'qRT-PCR 指南', href: '/protocols/qpcr-qrtpcr' },
        ],
      },
      {
        title: '克隆、转染或构建',
        description: '根据目的选择限制性酶切连接、无缝组装、突变、质粒提取和细胞转染。',
        checks: ['载体图谱和插入片段已核对', '酶切位点或组装重叠序列已设计', '感受态、筛选抗性和测序引物已准备', '转染细胞状态和对照已规划'],
        outputs: ['构建路线图', '克隆与质粒制备清单', '后续表达验证安排'],
        productLinks: [
          { label: '限制性内切酶', href: '/products?sub=限制性内切酶' },
          { label: '核酸纯化', href: '/products?sub=核酸纯化' },
          { label: '转染相关产品', href: '/products?keyword=transfection' },
          { label: 'Addgene Vector Database', href: 'https://www.addgene.org/vector-database/' },
          { label: 'Sequence Manipulation Suite', href: 'https://www.bioinformatics.org/sms2/' },
          { label: '分子克隆指南', href: '/protocols/molecular-cloning' },
        ],
      },
      {
        title: '验证与结果复核',
        description: '通过电泳、熔解曲线、测序、qPCR、WB 或功能实验确认结果可靠。',
        checks: ['电泳条带大小和阴性对照已核对', 'qPCR Ct、熔解曲线和重复孔 CV 已检查', '克隆构建已测序确认', '表达层面验证路径已确定'],
        outputs: ['可解释的扩增或构建结果', '异常复核记录', '下一轮补货和优化需求'],
        productLinks: [
          { label: 'DNA分子量标准', href: '/products?sub=DNA分子量标准' },
          { label: 'PCR 产物纯化', href: '/products?sub=核酸纯化' },
          { label: 'ENCORI / starBase', href: 'https://rnasysu.com/encori/' },
          { label: 'miRTarBase', href: 'https://mirtarbase.cuhk.edu.cn/' },
          { label: 'TargetScan', href: 'https://www.targetscan.org/' },
          { label: 'Western Blot 场景', href: '/scenes/western-blot' },
          { label: 'ELISA 场景', href: '/scenes/elisa' },
        ],
      },
    ],
    decisionPoints: [
      {
        title: '模板是 DNA 还是 RNA',
        description: 'DNA 项目关注纯度和抑制物；RNA 项目必须控制 RNase、反转录效率和完整性。',
        productLinks: [
          { label: '核酸纯化', href: '/products?sub=核酸纯化' },
          { label: '反转录试剂', href: '/products?sub=反转录试剂' },
        ],
      },
      {
        title: '终点 PCR 还是 qPCR',
        description: '终点 PCR 更适合片段确认；表达定量、拷贝数或低丰度检测优先 qPCR。',
        productLinks: [
          { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
          { label: 'qPCR 试剂', href: '/products?keyword=qPCR' },
        ],
      },
      {
        title: '是否需要高保真扩增',
        description: '克隆、突变或测序验证项目建议使用高保真酶，减少扩增引入突变。',
        productLinks: [
          { label: '高保真 PCR 酶', href: '/products?keyword=high%20fidelity%20polymerase' },
          { label: '分子克隆指南', href: '/protocols/molecular-cloning' },
        ],
      },
      {
        title: '是否做克隆或转染',
        description: '克隆项目需提前准备纯化、连接/组装、感受态、筛选和测序；转染项目还需评估细胞状态。',
        productLinks: [
          { label: '限制性内切酶', href: '/products?sub=限制性内切酶' },
          { label: 'siRNA 转染指南', href: '/protocols/sirna-transfection' },
        ],
      },
      {
        title: '污染控制是否到位',
        description: 'PCR/qPCR 对污染非常敏感，建议分区操作、滤芯吸头、阴性对照和模板后加样。',
        productLinks: [
          { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
          { label: 'Nuclease-free 试剂', href: '/products?keyword=nuclease%20free' },
        ],
      },
    ],
    difficulties: [
      {
        id: 'no-band',
        label: 'PCR 无条带 / 条带弱',
        symptom: '电泳后目标片段不可见，或条带明显弱于预期。',
        causes: ['模板质量差或含抑制物', '引物设计或退火温度不合适', '酶体系不适合 GC-rich/长片段模板', '循环数、Mg2+ 或模板量不足'],
        checks: ['检测模板浓度、A260/280 和完整性', '用阳性模板或 housekeeping 片段排除体系问题', '做退火温度梯度和模板量梯度', '检查引物二聚体、产物长度和 GC 含量'],
        fixes: ['重新纯化模板或稀释抑制物', '更换热启动或高保真/GC-rich 专用酶', '优化退火温度和循环数', '准备阳性对照和新鲜 dNTP/Mix'],
        productLinks: [
          { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
          { label: '核酸纯化', href: '/products?sub=核酸纯化' },
          { label: 'DNA Marker', href: '/products?sub=DNA分子量标准' },
        ],
        bundleHint: '推荐从“进阶分子生物学初购组合”开始，重点补高保真酶、模板纯化和对照体系。',
        inquiryNote: '分子生物学难点：PCR 无条带/条带弱。需要模板纯化、引物优化、PCR 酶体系和阳性对照建议。',
      },
      {
        id: 'qpcr-cv',
        label: 'qPCR Ct 异常 / 重复差',
        symptom: '重复孔 Ct 差异大，熔解曲线异常，或内参波动明显。',
        causes: ['加样误差或板膜密封不好', '引物二聚体或非特异扩增', '反转录效率不稳定', '模板量过高、过低或含抑制物'],
        checks: ['检查重复孔、NTC、熔解曲线和扩增效率', '确认 qPCR 板膜、离心和气泡处理', '比较 RNA 质量和反转录批次', '做模板稀释曲线判断抑制物'],
        fixes: ['更换 qPCR 专用板膜和低吸附吸头', '重设计引物或改用探针法', '统一 RNA 输入量和反转录体系', '补充阴性、阳性和内参对照'],
        productLinks: [
          { label: 'qPCR 试剂', href: '/products?keyword=qPCR' },
          { label: '反转录试剂', href: '/products?sub=反转录试剂' },
          { label: '分子生物学耗材', href: '/products?sub=分子生物学耗材' },
        ],
        bundleHint: '推荐“进阶分子生物学复购补货”，优先补已验证 qPCR Mix、板膜、引物和反转录试剂。',
        inquiryNote: '分子生物学难点：qPCR Ct 异常/重复差。需要 qPCR Mix、板膜耗材、引物优化、反转录和对照设置建议。',
      },
      {
        id: 'cloning-low',
        label: '克隆 / 转染效率低',
        symptom: '转化后菌落少、阳性率低，或转染后表达/敲降效果不明显。',
        causes: ['插入片段或载体纯度不足', '酶切、连接或组装比例不合适', '感受态细胞效率低或抗性筛选错误', '细胞状态、转染试剂或 DNA/RNA 质量不适合'],
        checks: ['电泳确认载体和插入片段大小及纯度', '设置载体自连、阳性连接和空白对照', '核对抗性、培养温度和感受态保存', '评估细胞密度、活率和转染对照'],
        fixes: ['更换高效感受态和新鲜连接/组装试剂', '优化插入片段与载体摩尔比', '使用胶回收或 PCR 产物纯化提升质量', '转染前优化细胞密度和试剂比例'],
        productLinks: [
          { label: '限制性内切酶', href: '/products?sub=限制性内切酶' },
          { label: '核酸纯化', href: '/products?sub=核酸纯化' },
          { label: '转染试剂', href: '/products?keyword=transfection' },
        ],
        bundleHint: '推荐“专家分子生物学初购组合”，把高效克隆、质粒纯化、测序验证和转染优化一起规划。',
        inquiryNote: '分子生物学难点：克隆/转染效率低。需要高效感受态、连接/组装、纯化回收、质粒制备和转染优化建议。',
      },
    ],
    productLinks: [
      { label: '分子生物学试剂', href: '/products?sub=分子生物学试剂' },
      { label: 'PCR试剂', href: '/products?sub=PCR试剂' },
      { label: '核酸纯化', href: '/products?sub=核酸纯化' },
      { label: '反转录试剂', href: '/products?sub=反转录试剂' },
    ],
    protocols: [
      { label: 'PCR/RT-PCR 实验指南', href: '/protocols/pcr', description: '模板、引物、体系配置、扩增和电泳确认。' },
      { label: 'qRT-PCR 实验指南', href: '/protocols/qpcr-qrtpcr', description: '反转录、qPCR、内参、重复孔和结果判断。' },
      { label: '分子克隆与表达指南', href: '/protocols/molecular-cloning', description: '载体构建、转化、筛选和表达验证。' },
      { label: 'siRNA 转染实验指南', href: '/protocols/sirna-transfection', description: '细胞转染、敲降和后续验证参考。' },
    ],
    analysisSoftware: [
      {
        label: 'PrimerBank',
        href: 'https://pga.mgh.harvard.edu/primerbank/',
        description: '查询已整理的人/鼠 qPCR 引物，适合基因表达定量项目快速初筛。',
        category: '引物设计',
      },
      {
        label: 'NCBI Primer-BLAST',
        href: 'https://www.ncbi.nlm.nih.gov/tools/primer-blast/',
        description: '设计 PCR/qPCR 引物并用 BLAST 检查特异性，适合新靶标引物设计。',
        category: '引物设计',
      },
      {
        label: 'Primer3',
        href: 'https://primer3.ut.ee/',
        description: '经典公共引物设计工具，可自定义产物长度、Tm、GC 和引物参数。',
        category: '引物设计',
      },
      {
        label: 'UCSC In-Silico PCR',
        href: 'https://genome.ucsc.edu/cgi-bin/hgPcr',
        description: '输入引物后在基因组中模拟扩增，用于确认扩增位置和潜在非特异产物。',
        category: '引物检查',
      },
      {
        label: 'NCBI Gene',
        href: 'https://www.ncbi.nlm.nih.gov/gene/',
        description: '查询基因 ID、别名、RefSeq 转录本、物种注释和基础功能信息。',
        category: '序列查询',
      },
      {
        label: 'NCBI BLAST',
        href: 'https://blast.ncbi.nlm.nih.gov/Blast.cgi',
        description: '比对引物、PCR 产物、插入片段或测序结果，检查同源性和特异性。',
        category: '序列查询',
      },
      {
        label: 'Addgene Vector Database',
        href: 'https://www.addgene.org/vector-database/',
        description: '非营利质粒库提供的常用载体信息，可辅助查询骨架、抗性、启动子和表达系统。',
        category: '克隆构建',
      },
      {
        label: 'Sequence Manipulation Suite',
        href: 'https://www.bioinformatics.org/sms2/',
        description: '免费开源序列处理工具集合，可做反向互补、翻译、限制性位点和基础序列分析。',
        category: '克隆构建',
      },
      {
        label: 'ENCORI / starBase',
        href: 'https://rnasysu.com/encori/',
        description: '查询 miRNA、lncRNA、circRNA、mRNA 与 RBP 互作，支持 ceRNA 网络和泛癌分析。',
        category: 'RNA 调控与靶标',
        iconUrl: '/images/tool-favicons/rnasysu.com.png',
      },
      {
        label: 'TargetScan',
        href: 'https://www.targetscan.org/',
        description: 'miRNA 靶基因预测数据库，适合候选靶标初筛和保守性判断。',
        category: 'RNA 调控与靶标',
      },
      {
        label: 'miRDB',
        href: 'https://mirdb.org/',
        description: 'miRNA 靶基因预测资源，可与 TargetScan、ENCORI 等交叉验证候选靶点。',
        category: 'RNA 调控与靶标',
      },
      {
        label: 'miRTarBase',
        href: 'https://mirtarbase.cuhk.edu.cn/',
        description: '收录实验验证的 miRNA-target 互作，适合查找证据等级更强的靶标关系。',
        category: 'RNA 调控与靶标',
      },
      {
        label: 'RNAcentral',
        href: 'https://rnacentral.org/',
        description: '非编码 RNA 综合序列与注释资源，适合查询 miRNA、lncRNA 等 RNA 条目。',
        category: 'RNA 调控与靶标',
      },
      {
        label: 'CHOPCHOP',
        href: 'https://chopchop.cbu.uib.no/',
        description: 'CRISPR sgRNA 设计和靶点评估工具，适合基因编辑实验前期设计。',
        category: '基因编辑',
      },
      ...computationalMolecularResearchTools,
    ],
    supportLinks: [
      { label: '实验与支持', href: '/support', description: '常见问题、售后与实验协助入口。' },
      { label: '常见问题', href: '/support?tab=faqs', description: 'PCR、qPCR、克隆和采购相关问答。' },
      { label: '联系我们', href: '/contact', description: '需要引物、酶体系或构建方案协助时可留言。' },
    ],
    brands: ['NEB', 'Thermo Fisher', 'Takara', 'QIAGEN', 'Sigma-Aldrich'],
    faqs: [
      { question: '第一次做 PCR/qPCR 先买什么？', answer: '先准备核酸提取、PCR/qPCR Mix、引物、无核酸酶水、PCR 管板、滤芯吸头、电泳和对照材料。' },
      { question: 'qPCR 重复孔差异大先查什么？', answer: '先看加样、板膜密封、气泡、熔解曲线、NTC 和模板质量，再调整引物、反转录和 Mix。' },
      { question: '克隆项目如何降低失败率？', answer: '优先确认载体图谱、插入片段纯度、连接/组装比例、感受态效率、抗性筛选和测序验证。' },
    ],
    bundles: molecularBiologyBundles,
  },
];

export function getSceneBySlug(slug: string) {
  return scenes.find((scene) => scene.slug === slug);
}
