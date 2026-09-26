'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calculator, Copy, FlaskConical, PackageCheck, Plus, Trash2 } from 'lucide-react';
import type { Product } from '@/types/Product';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';
import { buildProductSearchQuery } from '@/lib/product-search-contract';

type PrepCategory = 'kit' | 'reagent' | 'consumable' | 'control';

type PrepItem = {
  name: string;
  category: PrepCategory;
  reason: string;
  href?: string;
};

type ProcurementItem = {
  name: string;
  category: PrepCategory;
  quantity: number;
  unit: string;
  catalogNumber: string;
  searchQuery: string;
  note: string;
};

type PrepOptionGroup = {
  id: string;
  label: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    items: PrepItem[];
  }>;
};

type PrepConfig = {
  title: string;
  summary: string;
  baseItems: PrepItem[];
  groups: PrepOptionGroup[];
};

type ScenePrepListBuilderProps = {
  sceneSlug: string;
  theme: SceneTheme;
  ui: SceneUiCopy['prep'];
};

const configs: Record<string, PrepConfig> = {
  'western-blot': {
    title: 'Western Blot 材料准备',
    summary: '告诉我们样本量与跑胶安排，我们为您估算通用耗材与常备器材；一抗、二抗等核心试剂请自行选购。',
    baseItems: [
      { name: '目标蛋白一抗', category: 'kit', reason: 'WB 信号来源，需确认应用、物种和样本类型。', href: '/products?sub=WB抗体' },
      { name: 'HRP 偶联二抗', category: 'kit', reason: '需匹配一抗宿主来源。', href: '/products?sub=HRP偶联二抗' },
      { name: 'ECL 发光液', category: 'reagent', reason: '用于化学发光检测。', href: '/products?sub=WB辅助试剂' },
      { name: 'PVDF/NC 膜', category: 'consumable', reason: '按蛋白大小和转膜条件选择膜材。', href: '/products?keyword=PVDF' },
      { name: '预染蛋白 Marker', category: 'consumable', reason: '判断分子量和转膜效率。', href: '/products?keyword=marker' },
      { name: '裂解液 + BCA 定量试剂', category: 'reagent', reason: '保证样本提取和上样量一致。', href: '/products?keyword=BCA' },
      { name: '封闭液 / TBST', category: 'reagent', reason: '控制背景和洗膜一致性。', href: '/products?sub=WB辅助试剂' },
    ],
    groups: [
      {
        id: 'sample',
        label: '样本类型',
        options: [
          {
            id: 'cell',
            label: '细胞样本',
            description: '常规细胞裂解和表达检测。',
            items: [
              { name: '蛋白酶抑制剂', category: 'reagent', reason: '减少裂解过程中的蛋白降解，细胞样本必备。', href: '/products?keyword=protease%20inhibitor' },
            ],
          },
          {
            id: 'tissue',
            label: '组织样本',
            description: '组织匀浆和复杂样本裂解。',
            items: [
              { name: '蛋白酶抑制剂', category: 'reagent', reason: '组织样本降解风险更高，建议高浓度或鸡尾酒抑制剂。', href: '/products?keyword=protease%20inhibitor' },
              { name: '匀浆耗材 / 低吸附管', category: 'consumable', reason: '减少样本损失并提升裂解一致性。' },
            ],
          },
          {
            id: 'phospho-sample',
            label: '磷酸化样本',
            description: '关注信号通路或修饰状态。',
            items: [
              { name: '磷酸酶抑制剂', category: 'reagent', reason: '保护磷酸化状态，避免裂解后快速丢失信号。', href: '/products?keyword=phosphatase%20inhibitor' },
              { name: 'BSA 封闭液', category: 'reagent', reason: '磷酸化抗体检测应避免含酪蛋白的奶粉封闭，改用 BSA。', href: '/products?sub=WB辅助试剂' },
            ],
          },
        ],
      },
      {
        id: 'target',
        label: '检测目标',
        options: [
          {
            id: 'routine',
            label: '常规丰度蛋白',
            description: '表达量稳定，基础清单已覆盖。',
            items: [],
          },
          {
            id: 'low-abundance',
            label: '低丰度蛋白',
            description: '条带弱或曝光时间长。',
            items: [
              { name: '高灵敏 ECL（升级常规 ECL）', category: 'reagent', reason: '低丰度目标建议高灵敏版本以提升信噪比。', href: '/products?sub=WB辅助试剂' },
              { name: '阳性对照样本', category: 'control', reason: '区分抗体问题和样本表达问题，弱信号场景尤其重要。', href: '/products?keyword=positive%20control' },
            ],
          },
          {
            id: 'phospho-target',
            label: '磷酸化蛋白',
            description: '同时检测 total 与 phospho。',
            items: [
              { name: '刺激 / 抑制处理阳性对照', category: 'control', reason: '验证通路响应是否成立，缺少对照难以解释结果。' },
            ],
          },
          {
            id: 'high-mw',
            label: '高分子量蛋白',
            description: '转膜效率和胶浓度更关键。',
            items: [
              { name: '高分子量专用转膜缓冲液', category: 'reagent', reason: '提高大蛋白转膜效率，降低信号损失。', href: '/products?sub=WB辅助试剂' },
            ],
          },
        ],
      },
      {
        id: 'stage',
        label: '实验阶段',
        options: [
          {
            id: 'first',
            label: '首次搭建',
            description: '需要完整跑通链路。',
            items: [
              { name: '内参抗体', category: 'control', reason: '判断上样量和转膜一致性，首次搭建必备。', href: '/products?sub=内参抗体' },
              { name: '上样缓冲液和还原剂', category: 'reagent', reason: '完整样本制备链路必备，Laemmli buffer 等。', href: '/products?sub=WB辅助试剂' },
            ],
          },
          {
            id: 'optimize',
            label: '条件优化',
            description: '已有结果，调整背景或信号。',
            items: [
              { name: '低背景封闭液（替代常规封闭液）', category: 'reagent', reason: '商业低背景封闭液可有效减少背景和杂带。', href: '/products?sub=WB辅助试剂' },
              { name: '交叉吸附 HRP 二抗', category: 'reagent', reason: '降低非特异结合风险，适合多抗或种属相近样本。', href: '/products?sub=HRP偶联二抗' },
            ],
          },
          {
            id: 'repeat',
            label: '复购补货',
            description: '已跑通体系，保证一致性。',
            items: [],
          },
        ],
      },
    ],
  },
  elisa: {
    title: 'ELISA 材料准备',
    summary: '告诉我们样本类型、目标分子与项目规模，我们为您整理试剂盒、标准品、耗材与常备器材建议。',
    baseItems: [
      { name: '目标指标 ELISA 试剂盒', category: 'kit', reason: '核心检测产品，需匹配物种、样本和检测范围。', href: '/products?cat=ELISA试剂盒' },
      { name: '标准品 / 标准曲线材料', category: 'control', reason: '定量检测的基础。', href: '/products?sub=抗体对和蛋白标准品' },
      { name: '洗液、TMB 底物、终止液', category: 'reagent', reason: '影响背景、显色和读数窗口。', href: '/products?sub=ELISA辅助试剂' },
      { name: '封板膜、吸头、酶标板相关耗材', category: 'consumable', reason: '保证加样和孵育一致性。', href: '/products?sub=ELISA辅助试剂' },
    ],
    groups: [
      {
        id: 'sample',
        label: '样本类型',
        options: [
          {
            id: 'serum-plasma',
            label: '血清 / 血浆',
            description: '常见体液样本，关注基质效应。',
            items: [
              { name: '验证血清/血浆样本的试剂盒', category: 'kit', reason: '优先选择说明书明确验证的样本类型。', href: '/products?cat=ELISA试剂盒' },
              { name: '样本稀释液', category: 'reagent', reason: '降低基质干扰并让 OD 落入检测范围。', href: '/products?sub=ELISA辅助试剂' },
            ],
          },
          {
            id: 'supernatant',
            label: '细胞上清',
            description: '关注分泌因子和低丰度指标。',
            items: [
              { name: '高灵敏或低检测下限试剂盒', category: 'kit', reason: '细胞上清目标浓度可能较低。', href: '/products?keyword=high%20sensitivity%20ELISA' },
              { name: '无菌收集管和低吸附耗材', category: 'consumable', reason: '降低样本损失和污染风险。' },
            ],
          },
          {
            id: 'tissue-lysate',
            label: '组织匀浆',
            description: '样本处理差异会显著影响结果。',
            items: [
              { name: '样本预处理/提取试剂', category: 'reagent', reason: '提高组织样本提取一致性。', href: '/products?sub=ELISA辅助试剂' },
              { name: '质控样本', category: 'control', reason: '用于判断板间差和处理批次差异。' },
            ],
          },
        ],
      },
      {
        id: 'goal',
        label: '检测目标',
        options: [
          {
            id: 'known-range',
            label: '浓度范围明确',
            description: '已有文献或预实验范围。',
            items: [
              { name: '检测范围匹配的完整试剂盒', category: 'kit', reason: '避免样本 OD 超出标准曲线。', href: '/products?cat=ELISA试剂盒' },
            ],
          },
          {
            id: 'unknown-range',
            label: '浓度未知',
            description: '第一次做该指标或样本。',
            items: [
              { name: '预实验小包装或宽范围试剂盒', category: 'kit', reason: '先确定样本稀释倍数和检测窗口。', href: '/products?cat=ELISA试剂盒' },
              { name: '额外样本稀释液', category: 'reagent', reason: '用于 2-3 个稀释梯度摸底。', href: '/products?sub=ELISA辅助试剂' },
            ],
          },
          {
            id: 'method-dev',
            label: '方法开发',
            description: '需要抗体对或自建检测体系。',
            items: [
              { name: '抗体对', category: 'kit', reason: '用于自建夹心法或方法优化。', href: '/products?sub=抗体对和蛋白标准品' },
              { name: '重组蛋白标准品', category: 'control', reason: '用于标准曲线和回收率评估。', href: '/products?sub=抗体对和蛋白标准品' },
            ],
          },
        ],
      },
      {
        id: 'scale',
        label: '项目规模',
        options: [
          {
            id: 'pilot',
            label: '预实验',
            description: '先验证指标和样本兼容性。',
            items: [
              { name: '1 盒试剂盒 + 预留重复孔耗材', category: 'kit', reason: '用于确认检测范围和样本稀释倍数。', href: '/products?cat=ELISA试剂盒' },
            ],
          },
          {
            id: 'batch',
            label: '批量检测',
            description: '多样本或多批次项目。',
            items: [
              { name: '同批次/近批次试剂盒', category: 'kit', reason: '降低批间差异。', href: '/products?cat=ELISA试剂盒' },
              { name: '桥接质控样本', category: 'control', reason: '用于连接不同检测批次。' },
              { name: '批量吸头、封板膜、洗液', category: 'consumable', reason: '高频消耗项需要提前估算。', href: '/products?sub=ELISA辅助试剂' },
            ],
          },
          {
            id: 'multi-target',
            label: '多指标检测',
            description: '同一批样本检测多个因子。',
            items: [
              { name: '多指标联检或抗体芯片', category: 'kit', reason: '提高样本利用率并统一检测窗口。', href: '/products?sub=抗体芯片' },
              { name: '统一质控材料', category: 'control', reason: '便于比较多个指标结果。' },
            ],
          },
        ],
      },
    ],
  },
  ihc: {
    title: 'IHC 免疫组化材料准备',
    summary: '告诉我们切片量、靶标数量和样本类型，我们为您整理一抗、修复、封闭、检测、显色与封片相关建议。',
    baseItems: [
      { name: 'IHC 验证一抗', category: 'kit', reason: '核心染色试剂，需确认 IHC/IHC-P/IHC-Fr 应用、物种和组织图片。', href: '/products?sub=IHC和成像抗体' },
      { name: 'HRP 聚合物检测系统 / 二抗', category: 'kit', reason: '需匹配一抗宿主来源和明场/荧光检测方式。', href: '/products?sub=二抗' },
      { name: '抗原修复液', category: 'reagent', reason: 'FFPE 样本通常需要热修复，pH 和时间会影响信号。', href: '/products?keyword=antigen%20retrieval' },
      { name: '封闭液与内源酶封闭液', category: 'reagent', reason: '降低非特异背景和内源性过氧化物酶干扰。', href: '/products?keyword=blocking%20buffer' },
      { name: 'DAB 显色液 / 复染 / 封片剂', category: 'reagent', reason: '控制最终显色、组织形态和图像保存。', href: '/products?sub=IHC和成像试剂' },
    ],
    groups: [
      {
        id: 'sample',
        label: '样本类型',
        options: [
          {
            id: 'ffpe',
            label: 'FFPE 石蜡切片',
            description: '常规 IHC-P，重点关注脱蜡和抗原修复。',
            items: [
              { name: '柠檬酸/EDTA 抗原修复液', category: 'reagent', reason: 'FFPE 样本多数需要热修复，建议准备不同 pH 条件对比。', href: '/products?keyword=antigen%20retrieval' },
              { name: '脱蜡透明和水化相关试剂', category: 'reagent', reason: '脱蜡不彻底会导致背景高和染色不均。' },
            ],
          },
          {
            id: 'frozen',
            label: '冰冻切片',
            description: '更关注固定方式、组织形态和荧光背景。',
            items: [
              { name: '组织固定液（PFA/丙酮等）', category: 'reagent', reason: '冰冻切片固定方式直接影响抗原保留和形态。' },
              { name: '抗荧光淬灭封片剂', category: 'reagent', reason: '若做免疫荧光或荧光二抗，需降低荧光衰减。', href: '/products?keyword=antifade%20mounting%20medium' },
            ],
          },
          {
            id: 'tma',
            label: '组织芯片 / 队列样本',
            description: '大批量样本，重点控制批间一致性。',
            items: [
              { name: '桥接质控切片', category: 'control', reason: '用于连接不同染色批次和评分窗口。' },
              { name: '批量防脱载玻片', category: 'consumable', reason: '减少高温修复和批量洗涤时脱片风险。', href: '/products?keyword=adhesion%20slides' },
            ],
          },
        ],
      },
      {
        id: 'detection',
        label: '检测方式',
        options: [
          {
            id: 'hrp-dab',
            label: 'HRP-DAB 明场',
            description: '最常用 IHC 显色方式。',
            items: [
              { name: 'DAB 显色液', category: 'reagent', reason: 'HRP 检测系统的常用底物，显色时间需固定。', href: '/products?keyword=DAB' },
              { name: '苏木素复染液', category: 'reagent', reason: '显示细胞核形态，便于组织定位判断。' },
            ],
          },
          {
            id: 'fluorescence',
            label: '荧光 / 共定位',
            description: '用于免疫荧光、共定位或多标记观察。',
            items: [
              { name: '荧光二抗', category: 'kit', reason: '需匹配一抗宿主和显微镜通道。', href: '/products?sub=二抗' },
              { name: 'DAPI / 抗淬灭封片剂', category: 'reagent', reason: '核染和图像保存常用配套。', href: '/products?keyword=DAPI' },
            ],
          },
          {
            id: 'multiplex',
            label: '多重 IHC',
            description: '同一切片检测多个靶点。',
            items: [
              { name: '多重 IHC 检测试剂', category: 'kit', reason: '多靶点顺序染色需避免通道串扰和抗体交叉反应。', href: '/products?sub=IHC和成像试剂' },
              { name: '交叉吸附二抗 / 同型对照', category: 'control', reason: '降低多抗体体系中的非特异信号。', href: '/products?keyword=isotype%20control' },
            ],
          },
        ],
      },
      {
        id: 'stage',
        label: '实验阶段',
        options: [
          {
            id: 'first',
            label: '首次搭建',
            description: '先跑通完整染色链路。',
            items: [
              { name: '阳性组织对照', category: 'control', reason: '判断抗体、修复和检测系统是否有效。', href: '/products?keyword=positive%20control' },
              { name: '无一抗阴性对照材料', category: 'control', reason: '用于判断检测系统和组织背景。' },
            ],
          },
          {
            id: 'optimize',
            label: '条件优化',
            description: '已有结果，调整信号或背景。',
            items: [
              { name: '不同 pH 抗原修复液对比', category: 'reagent', reason: '弱信号或背景高时常需要比较 pH6 与 pH9。', href: '/products?keyword=antigen%20retrieval' },
              { name: '抗体稀释液 / 低背景封闭液', category: 'reagent', reason: '帮助控制非特异染色和边缘背景。', href: '/products?keyword=antibody%20diluent' },
            ],
          },
          {
            id: 'repeat',
            label: '复购补货',
            description: '体系已稳定，保证批次和评分一致。',
            items: [
              { name: '同批次或近批次抗体备注', category: 'control', reason: '长期项目建议保留批号并做桥接对照。' },
            ],
          },
        ],
      },
    ],
  },
  immunofluorescence: {
    title: '免疫荧光材料准备',
    summary: '告诉我们样本量、荧光通道和实验阶段，我们为您整理一抗、荧光二抗、核染、封闭通透、抗淬灭封片与成像材料。',
    baseItems: [
      { name: 'IF 验证一抗', category: 'kit', reason: '核心染色试剂，需确认 IF/ICC 或 IF-Fr 应用、物种和定位图片。', href: '/products?sub=IHC和成像抗体' },
      { name: '荧光二抗', category: 'kit', reason: '需匹配一抗宿主、显微镜通道和多标实验的交叉吸附要求。', href: '/products?sub=荧光偶联二抗' },
      { name: 'DAPI / 核染料', category: 'reagent', reason: '用于细胞核定位和图像配准。', href: '/products?keyword=DAPI' },
      { name: '固定、通透和封闭试剂', category: 'reagent', reason: '决定抗原保留、抗体进入和背景水平。', href: '/products?sub=IHC和成像试剂' },
      { name: '抗淬灭封片剂', category: 'reagent', reason: '保护荧光信号，延长图像保存时间。', href: '/products?keyword=antifade%20mounting%20medium' },
    ],
    groups: [
      {
        id: 'sample',
        label: '样本类型',
        options: [
          {
            id: 'cells',
            label: '贴壁细胞 / 爬片',
            description: '常规 IF/ICC，重点关注固定、通透和爬片。',
            items: [
              { name: '细胞爬片 / 成像孔板', category: 'consumable', reason: '贴壁细胞成像常用载体，需匹配显微镜载物台。', href: '/products?keyword=coverslip' },
              { name: '4% PFA 固定液', category: 'reagent', reason: '大多数胞内蛋白 IF 的常用固定方式。', href: '/products?keyword=paraformaldehyde' },
            ],
          },
          {
            id: 'frozen-section',
            label: '冰冻切片',
            description: '关注组织形态、自发荧光和防脱片。',
            items: [
              { name: '防脱载玻片', category: 'consumable', reason: '减少洗涤和孵育过程中的组织脱落。', href: '/products?keyword=adhesion%20slides' },
              { name: '自发荧光淬灭剂', category: 'reagent', reason: '组织样本背景较强时用于降低非特异荧光。', href: '/products?keyword=autofluorescence%20quencher' },
            ],
          },
          {
            id: 'ffpe-if',
            label: 'FFPE 切片 IF',
            description: '需要兼顾抗原修复和荧光背景。',
            items: [
              { name: '抗原修复液', category: 'reagent', reason: 'FFPE 样本通常需要热修复以恢复抗原表位。', href: '/products?keyword=antigen%20retrieval' },
              { name: '低背景封闭液', category: 'reagent', reason: '降低组织自发荧光和非特异结合造成的背景。', href: '/products?keyword=blocking%20buffer' },
            ],
          },
        ],
      },
      {
        id: 'channels',
        label: '通道规划',
        options: [
          {
            id: 'single',
            label: '单标 + DAPI',
            description: '一个目标蛋白，基础通道组合。',
            items: [
              { name: '匹配单通道荧光二抗', category: 'kit', reason: '按一抗宿主和显微镜滤块选择 488/555/594/647 等通道。', href: '/products?sub=荧光偶联二抗' },
            ],
          },
          {
            id: 'double',
            label: '双标 / 共定位',
            description: '两个目标蛋白，需要避免宿主和光谱冲突。',
            items: [
              { name: '交叉吸附荧光二抗', category: 'kit', reason: '降低多标体系中的二抗交叉结合。', href: '/products?sub=荧光偶联二抗' },
              { name: '单染对照材料', category: 'control', reason: '用于设置采集参数并判断串色。' },
            ],
          },
          {
            id: 'multiplex',
            label: '多标 / 多重成像',
            description: '多个靶点或低丰度目标，通道和信号放大更关键。',
            items: [
              { name: '直接偶联抗体试剂盒', category: 'kit', reason: '同宿主一抗或多重染色时可降低二抗交叉反应。', href: '/products?sub=荧光偶联试剂盒' },
              { name: 'TSA 信号放大试剂', category: 'reagent', reason: '低丰度靶点或多重 IF 可考虑放大信号。', href: '/products?keyword=TSA' },
            ],
          },
        ],
      },
      {
        id: 'stage',
        label: '实验阶段',
        options: [
          {
            id: 'first',
            label: '首次搭建',
            description: '先跑通染色和成像链路。',
            items: [
              { name: '阳性对照样本', category: 'control', reason: '判断抗体和成像通道是否有效。', href: '/products?keyword=positive%20control' },
              { name: '无一抗阴性对照', category: 'control', reason: '用于判断二抗背景和样本自发荧光。' },
            ],
          },
          {
            id: 'optimize',
            label: '条件优化',
            description: '已有图像，调整信号、背景或串色。',
            items: [
              { name: '抗体稀释液 / 低背景封闭液', category: 'reagent', reason: '帮助降低背景并保持抗体孵育一致。', href: '/products?keyword=antibody%20diluent' },
              { name: '自发荧光淬灭剂', category: 'reagent', reason: '组织样本背景强时可用于优化信噪比。', href: '/products?keyword=autofluorescence%20quencher' },
            ],
          },
          {
            id: 'repeat',
            label: '复购补货',
            description: '体系已稳定，保持通道和批次一致。',
            items: [
              { name: '桥接对照样本', category: 'control', reason: '用于连接不同染色批次和成像参数。' },
            ],
          },
        ],
      },
    ],
  },
  'flow-cytometry': {
    title: '流式细胞术材料准备',
    summary: '告诉我们样本量、上机批次和 panel marker 数，我们为您整理抗体、死活染、补偿/FMO、流式管、滤网与样本制备建议。',
    baseItems: [
      { name: '流式验证抗体', category: 'kit', reason: '核心染色试剂，需确认 Flow/FCM 应用、克隆号、物种和荧光素。', href: '/products?sub=流式抗体' },
      { name: '死活染料', category: 'reagent', reason: '用于排除死细胞非特异吸附，提升门控可靠性。', href: '/products?sub=流式实验试剂' },
      { name: 'FACS Buffer / 染色缓冲液', category: 'reagent', reason: '保持细胞状态并降低非特异结合。', href: '/products?sub=流式实验试剂' },
      { name: '流式管、细胞滤网和低吸附耗材', category: 'consumable', reason: '减少聚团、堵针和样本损失。', href: '/products?sub=样本制备' },
      { name: '补偿、FMO 和同型对照', category: 'control', reason: '多色实验判断补偿矩阵、门控边界和非特异背景。', href: '/products?sub=同型对照抗体' },
    ],
    groups: [
      {
        id: 'sample',
        label: '样本类型',
        options: [
          {
            id: 'pbmc',
            label: 'PBMC / 血液样本',
            description: '关注红细胞裂解、Fc 受体和细胞活率。',
            items: [
              { name: '红细胞裂解液', category: 'reagent', reason: '全血或骨髓样本常需去除红细胞。', href: '/products?keyword=RBC%20lysis' },
              { name: 'Fc Block', category: 'reagent', reason: '免疫细胞 Fc 受体丰富，建议封闭降低背景。', href: '/products?keyword=Fc%20Block' },
            ],
          },
          {
            id: 'tissue',
            label: '组织消化样本',
            description: '重点控制消化、过滤和碎片干扰。',
            items: [
              { name: '组织消化酶 / DNase', category: 'reagent', reason: '提升单细胞悬液质量并减少黏连。', href: '/products?keyword=collagenase%20DNase' },
              { name: '细胞滤网', category: 'consumable', reason: '去除组织碎片和细胞团，降低堵针风险。', href: '/products?keyword=cell%20strainer' },
            ],
          },
          {
            id: 'cell-line',
            label: '细胞系',
            description: '常规表面染色或功能检测。',
            items: [
              { name: '无酶细胞解离液', category: 'reagent', reason: '表面 marker 易受胰酶影响时可降低抗原丢失。', href: '/products?keyword=cell%20dissociation' },
              { name: '细胞计数和活率试剂', category: 'reagent', reason: '上机前确认浓度和活率，便于统一染色体积。', href: '/products?sub=细胞健康检测试剂盒' },
            ],
          },
        ],
      },
      {
        id: 'panel',
        label: 'Panel 类型',
        options: [
          {
            id: 'surface',
            label: '表面 marker',
            description: '常规免疫分型或表面抗原检测。',
            items: [
              { name: 'Fc Block', category: 'reagent', reason: '表面染色常见非特异结合来源。', href: '/products?keyword=Fc%20Block' },
            ],
          },
          {
            id: 'intracellular',
            label: '胞内 / 核内染色',
            description: '胞内因子、转录因子或磷酸化信号。',
            items: [
              { name: '固定/通透试剂盒', category: 'reagent', reason: '胞内或核内靶点需要与抗体和死活染兼容的固定通透体系。', href: '/products?sub=流式实验试剂' },
              { name: '蛋白运输阻断剂', category: 'reagent', reason: '胞内因子检测常需刺激和阻断分泌。', href: '/products?keyword=protein%20transport%20inhibitor' },
            ],
          },
          {
            id: 'sorting',
            label: '细胞分选',
            description: '需要保活、无菌和分选后培养。',
            items: [
              { name: '分选级缓冲液', category: 'reagent', reason: '降低剪切应激并维持分选后细胞活性。', href: '/products?sub=流式实验试剂' },
              { name: '无菌低吸附收集管', category: 'consumable', reason: '用于分选后细胞回收和后续培养。' },
            ],
          },
        ],
      },
      {
        id: 'stage',
        label: '实验阶段',
        options: [
          {
            id: 'first',
            label: '首次搭建',
            description: '先跑通 panel、补偿和门控链路。',
            items: [
              { name: '补偿微球 / 单染对照', category: 'control', reason: '每个荧光通道都需要补偿参考。', href: '/products?keyword=compensation%20beads' },
              { name: 'FMO 对照材料', category: 'control', reason: '用于确定边界 marker 的门控位置。' },
            ],
          },
          {
            id: 'optimize',
            label: 'Panel 优化',
            description: '已有数据，调整信号、背景或串色。',
            items: [
              { name: '抗体滴定耗材', category: 'consumable', reason: '用于优化抗体用量和信噪比。' },
              { name: '替代荧光素抗体', category: 'kit', reason: '串色严重或低表达 marker 可替换通道。', href: '/products?sub=流式抗体' },
            ],
          },
          {
            id: 'repeat',
            label: '复购补货',
            description: '体系已稳定，保持克隆号和荧光素一致。',
            items: [
              { name: '桥接质控样本', category: 'control', reason: '用于连接不同批次抗体和仪器模板。' },
            ],
          },
        ],
      },
    ],
  },
  'molecular-biology': {
    title: '分子生物学材料准备',
    summary: '告诉我们样本量、反应批次和靶标/构建数量，我们为您整理核酸提取、PCR/qPCR、反转录、电泳、纯化、克隆和无核酸酶耗材建议。',
    baseItems: [
      { name: '核酸提取/纯化试剂盒', category: 'kit', reason: '模板质量直接决定 PCR/qPCR、克隆和测序结果。', href: '/products?sub=核酸纯化' },
      { name: 'PCR/qPCR Master Mix', category: 'reagent', reason: '扩增核心体系，需按终点 PCR、qPCR 或高保真扩增选择。', href: '/products?sub=PCR试剂' },
      { name: '引物 / 探针', category: 'reagent', reason: '决定扩增特异性、效率和定量可靠性。' },
      { name: 'Nuclease-free 水、滤芯吸头、低吸附管', category: 'consumable', reason: '降低 RNase/DNase 和扩增污染风险。', href: '/products?sub=分子生物学耗材' },
      { name: '琼脂糖、DNA Marker、凝胶染料', category: 'consumable', reason: '用于 PCR 产物大小与质量确认。', href: '/products?sub=DNA分子量标准' },
    ],
    groups: [
      {
        id: 'sample',
        label: '模板类型',
        options: [
          {
            id: 'dna',
            label: 'DNA 模板',
            description: '基因分型、克隆片段或常规 PCR。',
            items: [
              { name: '基因组 DNA / PCR 产物纯化试剂盒', category: 'kit', reason: '去除盐、蛋白和抑制物，提高扩增一致性。', href: '/products?sub=核酸纯化' },
            ],
          },
          {
            id: 'rna',
            label: 'RNA / cDNA',
            description: 'RT-PCR、qRT-PCR 或表达定量。',
            items: [
              { name: 'RNA 提取试剂盒', category: 'kit', reason: 'RNA 容易降解，建议使用专用提取和保护体系。', href: '/products?sub=核酸纯化' },
              { name: '反转录试剂', category: 'reagent', reason: 'qRT-PCR 或 RT-PCR 必备，需按模板量和引物类型选择。', href: '/products?sub=反转录试剂' },
            ],
          },
          {
            id: 'low-input',
            label: '低起始量 / 复杂模板',
            description: '低拷贝、GC-rich、长片段或抑制物较多样本。',
            items: [
              { name: '高灵敏或 GC-rich PCR 酶体系', category: 'reagent', reason: '复杂模板建议使用更耐受的扩增体系。', href: '/products?keyword=GC-rich%20PCR' },
              { name: '模板浓缩/清理试剂', category: 'kit', reason: '减少抑制物并提高有效模板输入。', href: '/products?sub=核酸纯化' },
            ],
          },
        ],
      },
      {
        id: 'assay',
        label: '实验类型',
        options: [
          {
            id: 'pcr',
            label: '终点 PCR / 电泳确认',
            description: '片段确认、基因分型或克隆前扩增。',
            items: [
              { name: '热启动 PCR Master Mix', category: 'reagent', reason: '提升特异性并降低非特异扩增。', href: '/products?sub=PCR试剂' },
            ],
          },
          {
            id: 'qpcr',
            label: 'qPCR / qRT-PCR',
            description: '表达定量、拷贝数或低丰度检测。',
            items: [
              { name: 'qPCR 专用板膜 / 管条', category: 'consumable', reason: '密封和光学质量影响 Ct 重复性。', href: '/products?keyword=qPCR%20plate' },
              { name: '内参和阴性对照材料', category: 'control', reason: '用于判断模板污染、扩增效率和表达归一化。' },
            ],
          },
          {
            id: 'cloning',
            label: '克隆 / 构建 / 转染',
            description: '载体构建、突变、质粒制备或表达验证。',
            items: [
              { name: '高保真 DNA 聚合酶', category: 'reagent', reason: '克隆和测序验证项目应减少扩增引入突变。', href: '/products?keyword=high%20fidelity%20polymerase' },
              { name: '限制性内切酶 / 连接或组装试剂', category: 'reagent', reason: '按载体构建路线选择酶切连接或无缝组装。', href: '/products?sub=限制性内切酶' },
              { name: '感受态细胞和质粒小提试剂盒', category: 'kit', reason: '用于转化、筛选和后续测序验证。', href: '/products?keyword=competent%20cells' },
            ],
          },
        ],
      },
      {
        id: 'stage',
        label: '实验阶段',
        options: [
          {
            id: 'first',
            label: '首次搭建',
            description: '需要完整跑通提取、扩增和验证链路。',
            items: [
              { name: '阳性模板和无模板阴性对照', category: 'control', reason: '用于区分模板问题、体系问题和污染问题。' },
              { name: 'PCR 工作区防污染耗材', category: 'consumable', reason: '首次搭建建议分区操作并使用滤芯吸头。', href: '/products?sub=分子生物学耗材' },
            ],
          },
          {
            id: 'optimize',
            label: '条件优化',
            description: '已有结果，调整特异性、效率或构建成功率。',
            items: [
              { name: '温度梯度 / Mg2+ / 添加剂优化材料', category: 'reagent', reason: '用于处理非特异扩增、弱扩增和 GC-rich 模板。', href: '/products?sub=PCR试剂' },
              { name: '替代引物或探针', category: 'reagent', reason: '非特异、二聚体或效率不佳时常需重新设计。' },
            ],
          },
          {
            id: 'repeat',
            label: '复购补货',
            description: '体系已稳定，保持酶、耗材和引物批次一致。',
            items: [
              { name: '同批次或近批次 Mix 备注', category: 'control', reason: '长期 qPCR 或项目验证建议记录批次，便于数据可比。' },
            ],
          },
        ],
      },
    ],
  },
};

configs['single-cell-omics'] = configs['flow-cytometry'];
configs['spatial-biology'] = configs.immunofluorescence;
configs['organoid-3d-culture'] = configs.immunofluorescence;
configs['crispr-gene-editing'] = configs['molecular-biology'];
configs['extracellular-vesicles'] = configs['flow-cytometry'];
configs['proteomics-mass-spec'] = configs['western-blot'];
configs['magnetic-cell-separation'] = configs['flow-cytometry'];
configs['elispot-fluorospot'] = configs.elisa;
configs['small-animal-imaging'] = {
  title: '小动物实验与成像材料准备',
  summary: '填写动物数量、成像批次和探针数量，整理麻醉保温、给药固定、探针底物和图像定量材料。',
  baseItems: [
    { name: '活体成像底物、探针或造影剂', category: 'reagent', reason: '按成像模态和模型选择，影响信号强度和采集窗口。', href: '/products?keyword=animal%20imaging%20probe' },
    { name: '小动物麻醉与保温材料', category: 'consumable', reason: '保持麻醉深度、体温和体位稳定。', href: '/products?keyword=小动物%20麻醉' },
    { name: '注射器、针头和灌胃针', category: 'consumable', reason: '用于腹腔、尾静脉、皮下或灌胃给药。', href: '/products?keyword=注射器%20灌胃针' },
    { name: '动物固定器和生理监测耗材', category: 'consumable', reason: '减少体位差异并保留呼吸、体温等状态记录。', href: '/products?keyword=animal%20monitor' },
    { name: '图像定量记录模板', category: 'control', reason: '统一 ROI、背景扣除、曝光或扫描参数。' },
  ],
  groups: [
    {
      id: 'modality',
      label: '成像方式',
      options: [
        {
          id: 'bioluminescence',
          label: '生物发光',
          description: '报告基因、肿瘤负荷或感染模型常用。',
          items: [
            { name: 'D-Luciferin 底物和避光分装耗材', category: 'reagent', reason: '生物发光核心底物，需控制剂量、溶解和采集间隔。', href: '/products?keyword=luciferin' },
          ],
        },
        {
          id: 'fluorescence',
          label: '荧光成像',
          description: '荧光探针、标记细胞或离体器官成像。',
          items: [
            { name: '荧光探针和单通道对照', category: 'reagent', reason: '用于评估组织自发荧光、通道串扰和背景扣除。', href: '/products?keyword=fluorescent%20probe' },
            { name: '脱毛与皮肤准备耗材', category: 'consumable', reason: '降低皮毛和皮肤背景，提高体表成像可比性。', href: '/products?keyword=depilatory%20animal' },
          ],
        },
        {
          id: 'tomography',
          label: 'CT、MRI 或 PET',
          description: '结构、代谢或示踪剂分布成像。',
          items: [
            { name: '造影剂或示踪剂给药记录材料', category: 'reagent', reason: '用于记录剂量、批次、半衰期、安全防护和采集窗口。', href: '/products?keyword=contrast%20agent' },
          ],
        },
      ],
    },
    {
      id: 'route',
      label: '给药路线',
      options: [
        {
          id: 'ip',
          label: '腹腔或皮下给药',
          description: '底物、部分探针或药物常用给药路线。',
          items: [
            { name: '胰岛素针和无菌注射耗材', category: 'consumable', reason: '保证给药体积和注射位置一致。', href: '/products?keyword=insulin%20syringe' },
          ],
        },
        {
          id: 'iv',
          label: '尾静脉给药',
          description: '血管内探针、纳米材料或示踪剂给药。',
          items: [
            { name: '尾静脉注射固定器和细针头', category: 'consumable', reason: '减少外漏，提高给药成功率和信号一致性。', href: '/products?keyword=tail%20vein%20injection' },
          ],
        },
        {
          id: 'gavage',
          label: '灌胃给药',
          description: '药效评价、代谢或口服给药模型。',
          items: [
            { name: '小动物灌胃针和给药记录表', category: 'consumable', reason: '匹配动物体重和给药体积，减少操作差异。', href: '/products?keyword=gavage%20needle' },
          ],
        },
      ],
    },
    {
      id: 'stage',
      label: '实验阶段',
      options: [
        {
          id: 'first',
          label: '首次搭建',
          description: '需要完整跑通动物准备、给药和采集。',
          items: [
            { name: '阳性、阴性和未给药对照', category: 'control', reason: '用于区分模型信号、探针背景和采集参数问题。' },
            { name: '动物状态评分和复苏观察表', category: 'control', reason: '用于记录麻醉、体温、体重和终点标准。' },
          ],
        },
        {
          id: 'optimize',
          label: '条件优化',
          description: '已有预实验结果，调整信号和背景。',
          items: [
            { name: '采集时间点梯度和曝光参数记录表', category: 'control', reason: '帮助确定最佳采集窗口和可比参数。' },
          ],
        },
        {
          id: 'repeat',
          label: '复购补货',
          description: '体系已稳定，保持批次和参数一致。',
          items: [
            { name: '同批次探针、底物或造影剂备注', category: 'control', reason: '长期项目建议记录批次，便于跨批次比较。' },
          ],
        },
      ],
    },
  ],
};

function estimateElisaItems(
  sampleCount: number,
  replicates: number,
  standardPoints: number,
  includeControls: boolean,
  reserveWells: number,
  species: string,
  targetMolecules: string[],
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const plateWells = 96;
  const standardWells = standardPoints * replicates;
  const blankWells = replicates;
  const controlWells = includeControls ? 4 : 0;
  const nonSampleWells = standardWells + blankWells + controlWells + reserveWells;
  const sampleCapacityPerPlate = Math.max(1, Math.floor((plateWells - nonSampleWells) / replicates));
  const plates = Math.max(1, Math.ceil(sampleCount / sampleCapacityPerPlate));
  const sampleWells = sampleCount * replicates;
  const totalUsedWells = sampleWells + plates * nonSampleWells;
  const normalizedSpecies = species.trim() || 'Human';
  const normalizedTargets = targetMolecules.map((target) => target.trim()).filter(Boolean);
  const effectiveTargets = normalizedTargets.length > 0 ? normalizedTargets : ['TNF alpha'];
  const coreKitItems: ProcurementItem[] = effectiveTargets.map((target, index) => ({
    name: `${target} ${normalizedSpecies} ELISA 试剂盒（96T）`,
    category: 'kit',
    quantity: plates,
    unit: '盒',
    catalogNumber: `SCENE-ELISA-96T-${index + 1}`,
    searchQuery: `${target} ${normalizedSpecies} ELISA Kit`,
    note: `按 ${sampleCount} 个样本、${replicates} 复孔、${normalizedSpecies} ${target}、每板约 ${sampleCapacityPerPlate} 个样本估算。`,
  }));

  const baseItems = ([
      ...coreKitItems,
      {
        name: '96 孔酶标板（U 型/V 型，按试剂盒要求）',
        category: 'consumable',
        quantity: plates,
        unit: '块',
        catalogNumber: 'SCENE-ELISA-PLATE',
        searchQuery: 'ELISA plate 96 well',
        note: '若试剂盒已预包被，通常无需另购；自建体系或预实验需确认板型。',
      },
      {
        name: '洗涤缓冲液（10× 浓缩液）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(plates / 2)),
        unit: '瓶',
        catalogNumber: 'SCENE-ELISA-WASH',
        searchQuery: 'ELISA wash buffer',
        note: '按洗板次数预留；手工洗板建议配洗瓶或洗板机。',
      },
      {
        name: 'TMB 底物液',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(plates / 2)),
        unit: '瓶',
        catalogNumber: 'SCENE-ELISA-TMB',
        searchQuery: 'TMB substrate',
        note: '单组分或 A/B 双液；若试剂盒已含足量可去除。',
      },
      {
        name: '终止液（如 2M H₂SO₄）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(plates / 3)),
        unit: '瓶',
        catalogNumber: 'SCENE-ELISA-STOP',
        searchQuery: 'ELISA stop solution',
        note: '显色后终止反应；部分试剂盒已包含。',
      },
      {
        name: '样本/标准品稀释液',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(plates / 2)),
        unit: '瓶',
        catalogNumber: 'SCENE-ELISA-DILUENT',
        searchQuery: 'sample diluent ELISA',
        note: '浓度未知或复杂样本建议额外准备 2–3 个稀释梯度。',
      },
      {
        name: '封板膜（铝膜或塑料密封膜）',
        category: 'consumable',
        quantity: plates * 2,
        unit: '张',
        catalogNumber: 'SCENE-ELISA-SEAL',
        searchQuery: 'plate seal',
        note: '包被、孵育过程防蒸发；每板建议至少 2 张。',
      },
      {
        name: '移液吸头（10 μL，排枪/单道）',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(totalUsedWells / 200)),
        unit: '盒',
        catalogNumber: 'SCENE-ELISA-TIPS-10',
        searchQuery: 'pipette tips 10ul',
        note: '标准曲线与样本加样；按总孔数估算。',
      },
      {
        name: '移液吸头（200 μL）',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(totalUsedWells / 150)),
        unit: '盒',
        catalogNumber: 'SCENE-ELISA-TIPS-200',
        searchQuery: 'pipette tips 200ul',
        note: '洗液、稀释液、试剂分装常用规格。',
      },
      {
        name: '移液吸头（1000 μL）',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(plates / 2)),
        unit: '盒',
        catalogNumber: 'SCENE-ELISA-TIPS-1000',
        searchQuery: 'pipette tips 1000ul',
        note: '洗涤液、大量稀释操作备用。',
      },
      {
        name: '加样槽 / 试剂槽',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(plates / 3)),
        unit: '个',
        catalogNumber: 'SCENE-ELISA-RESERVOIR',
        searchQuery: 'reagent reservoir',
        note: '多头移液器分装洗液、稀释液时使用。',
      },
      {
        name: '1.5 mL / 2 mL EP 管',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(sampleCount / 25)),
        unit: '包',
        catalogNumber: 'SCENE-ELISA-TUBES',
        searchQuery: 'microcentrifuge tubes',
        note: '样本分装、标准品复溶与梯度稀释。',
      },
      {
        name: '无粉乳胶手套',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(plates / 2)),
        unit: '盒',
        catalogNumber: 'SCENE-ELISA-GLOVES',
        searchQuery: 'nitrile gloves',
        note: '避免污染酶标板与样本。',
      },
      {
        name: '酶标仪（450 nm 滤光片）',
        category: 'consumable',
        quantity: 1,
        unit: '台',
        catalogNumber: 'SCENE-ELISA-READER',
        searchQuery: 'microplate reader',
        note: '常备器材，实验前确认读数波长与软件可用。',
      },
      {
        name: '洗板机或洗瓶',
        category: 'consumable',
        quantity: 1,
        unit: '套',
        catalogNumber: 'SCENE-ELISA-WASHER',
        searchQuery: 'plate washer',
        note: '手工洗板需准备洗瓶；批量项目建议洗板机。',
      },
      {
        name: '恒温摇床 / 孵育箱',
        category: 'consumable',
        quantity: 1,
        unit: '台',
        catalogNumber: 'SCENE-ELISA-SHAKER',
        searchQuery: 'plate shaker incubator',
        note: '37°C 或室温孵育时保持混匀；确认温度与转速。',
      },
      {
        name: '多通道移液器（8/12 道）',
        category: 'consumable',
        quantity: 1,
        unit: '支',
        catalogNumber: 'SCENE-ELISA-MULTIPIPET',
        searchQuery: 'multichannel pipette',
        note: '常备器材，确认量程覆盖 10–200 μL。',
      },
      {
        name: '桥接质控样本',
        category: 'control',
        quantity: plates > 1 ? 1 : 0,
        unit: '套',
        catalogNumber: 'SCENE-ELISA-QC',
        searchQuery: 'ELISA control',
        note: '多板或多批次检测建议保留桥接质控。',
      },
    ] satisfies ProcurementItem[]).filter((item) => item.quantity > 0);

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-ELISA-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '单板可测样本', value: `${sampleCapacityPerPlate} 个` },
      { label: '样本占用孔', value: `${sampleWells} 孔` },
      { label: '非样本孔/板', value: `${nonSampleWells} 孔` },
      { label: '需要 96 孔板', value: `${plates} 块` },
      { label: '总占用孔数', value: `${totalUsedWells} 孔` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateWbItems(
  sampleCount: number,
  lanesPerGel: number,
  reservedLanes: number,
  blotCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const effectiveBlotCount = Math.max(1, blotCount);
  const sampleCapacityPerGel = Math.max(1, lanesPerGel - reservedLanes);
  const gelsPerBlot = Math.max(1, Math.ceil(sampleCount / sampleCapacityPerGel));
  const totalGels = gelsPerBlot * effectiveBlotCount;

  const baseItems = ([
      {
        name: '预制 SDS-PAGE 胶（浓度按分子量选择）',
        category: 'consumable',
        quantity: totalGels,
        unit: '块',
        catalogNumber: 'SCENE-WB-GEL',
        searchQuery: 'precast gel',
        note: `每胶预留 ${reservedLanes} 个泳道用于 Marker/对照；大分子量建议低浓度胶。`,
      },
      {
        name: 'SDS-PAGE 电泳缓冲液（Running buffer）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(totalGels / 4)),
        unit: '套',
        catalogNumber: 'SCENE-WB-RUN-BUF',
        searchQuery: 'SDS PAGE running buffer',
        note: '10× 浓缩或预制液；每块胶约 1 L 1× 工作液。',
      },
      {
        name: '转膜缓冲液（Transfer buffer）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(totalGels / 4)),
        unit: '套',
        catalogNumber: 'SCENE-WB-TRANS-BUF',
        searchQuery: 'western transfer buffer',
        note: '湿转/半干转按方法选择；含甲醇配方需现配现用。',
      },
      {
        name: 'PVDF 膜（0.45 μm，需甲醇预活化）',
        category: 'consumable',
        quantity: totalGels,
        unit: '张',
        catalogNumber: 'SCENE-WB-PVDF',
        searchQuery: 'PVDF membrane',
        note: '低分子量或磷酸化蛋白也可选 NC 膜；按每胶一张估算。',
      },
      {
        name: '转膜滤纸（Whatman 3MM 或同等）',
        category: 'consumable',
        quantity: totalGels * 4,
        unit: '张',
        catalogNumber: 'SCENE-WB-FILTER',
        searchQuery: 'blotting filter paper',
        note: '湿转 sandwich 每层 2 张，按转膜次数预留。',
      },
      {
        name: '转膜海绵垫 / 纤维垫',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(totalGels / 5)),
        unit: '套',
        catalogNumber: 'SCENE-WB-SPONGE',
        searchQuery: 'western blot sponge',
        note: '老化或压痕明显时更换，保证转膜压力均匀。',
      },
      {
        name: '预染蛋白 Marker（Broad/Plus）',
        category: 'control',
        quantity: Math.max(1, Math.ceil(totalGels / 10)),
        unit: '支',
        catalogNumber: 'SCENE-WB-MARKER',
        searchQuery: 'protein marker',
        note: '每胶至少 1 个 Marker 泳道，用于分子量对照。',
      },
      {
        name: '2× SDS 上样缓冲液 + 还原剂（DTT/β-ME）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(sampleCount / 40)),
        unit: '套',
        catalogNumber: 'SCENE-WB-LOADING',
        searchQuery: 'SDS loading buffer',
        note: '煮样 95–100°C 5 min；还原剂现加现用。',
      },
      {
        name: 'RIPA / NP-40 裂解液',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(sampleCount / 50)),
        unit: '瓶',
        catalogNumber: 'SCENE-WB-LYSIS',
        searchQuery: 'RIPA lysis buffer',
        note: '细胞/组织总蛋白提取；组织样本建议配合匀浆。',
      },
      {
        name: 'BCA 蛋白定量试剂盒',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(sampleCount / 50)),
        unit: '套',
        catalogNumber: 'SCENE-WB-BCA',
        searchQuery: 'BCA protein assay',
        note: '上样前统一蛋白浓度，保证条带可比性。',
      },
      {
        name: '蛋白酶抑制剂 cocktail',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(sampleCount / 80)),
        unit: '套',
        catalogNumber: 'SCENE-WB-PI',
        searchQuery: 'protease inhibitor cocktail',
        note: '裂解时加入，减少蛋白降解。',
      },
      {
        name: '封闭液（5% BSA 或脱脂奶粉）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(totalGels / 6)),
        unit: '套',
        catalogNumber: 'SCENE-WB-BLOCK',
        searchQuery: 'blocking buffer western',
        note: '磷酸化抗体优先 BSA 封闭；常规靶点可用奶粉。',
      },
      {
        name: 'TBST 洗液（含 0.1% Tween-20）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(totalGels / 6)),
        unit: '套',
        catalogNumber: 'SCENE-WB-TBST',
        searchQuery: 'TBST',
        note: '一抗/二抗孵育后洗膜；建议 1× 工作液足量准备。',
      },
      {
        name: 'ECL 化学发光液（A+B 液）',
        category: 'reagent',
        quantity: Math.max(1, Math.ceil(totalGels / 4)),
        unit: '套',
        catalogNumber: 'SCENE-WB-ECL',
        searchQuery: 'ECL',
        note: '低丰度目标建议高灵敏 ECL；现配现用。',
      },
      {
        name: '抗体孵育袋 / 密封盒',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(totalGels / 3)),
        unit: '个',
        catalogNumber: 'SCENE-WB-BAG',
        searchQuery: 'western blot incubation bag',
        note: '减少一抗/二抗用量，避免膜干燥。',
      },
      {
        name: '无粉乳胶手套',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(totalGels / 4)),
        unit: '盒',
        catalogNumber: 'SCENE-WB-GLOVES',
        searchQuery: 'nitrile gloves',
        note: '接触膜与抗体时佩戴，避免 RNase/蛋白酶污染。',
      },
      {
        name: '低吸附 EP 管（1.5 / 2 mL）',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(sampleCount / 30)),
        unit: '包',
        catalogNumber: 'SCENE-WB-TUBES',
        searchQuery: 'low binding tubes',
        note: '样本分装、抗体稀释与上样准备。',
      },
      {
        name: '移液吸头（10 / 200 / 1000 μL）',
        category: 'consumable',
        quantity: Math.max(1, Math.ceil(sampleCount / 25)),
        unit: '盒',
        catalogNumber: 'SCENE-WB-TIPS',
        searchQuery: 'pipette tips',
        note: '裂解、定量、上样全流程消耗；按样本量估算。',
      },
      {
        name: '垂直电泳槽 + 电泳仪',
        category: 'consumable',
        quantity: 1,
        unit: '套',
        catalogNumber: 'SCENE-WB-ELECTRO',
        searchQuery: 'electrophoresis cell',
        note: '常备器材，确认可用及兼容胶规格。',
      },
      {
        name: '转膜装置（湿转/半干转槽）',
        category: 'consumable',
        quantity: 1,
        unit: '套',
        catalogNumber: 'SCENE-WB-TRANSFER',
        searchQuery: 'western blot transfer system',
        note: '常备器材，确认转膜夹与冷却模块可用。',
      },
      {
        name: '化学发光成像仪 / 暗室曝光设备',
        category: 'consumable',
        quantity: 1,
        unit: '台',
        catalogNumber: 'SCENE-WB-IMAGER',
        searchQuery: 'chemiluminescence imager',
        note: '常备器材，确认 CCD 或胶片曝光条件。',
      },
      {
        name: '水平摇床（抗体孵育）',
        category: 'consumable',
        quantity: 1,
        unit: '台',
        catalogNumber: 'SCENE-WB-SHAKER',
        searchQuery: 'lab rocker shaker',
        note: '封闭与一抗/二抗孵育时缓慢摇动。',
      },
  ] satisfies ProcurementItem[]);

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-WB-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '单胶可跑样本', value: `${sampleCapacityPerGel} 个` },
      { label: '检测目标数', value: `${effectiveBlotCount} 个` },
      { label: '预计胶数', value: `${totalGels} 块` },
      { label: '预计膜数', value: `${totalGels} 张` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateIhcItems(
  slideCount: number,
  slidesPerBatch: number,
  targetCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const effectiveSlideCount = Math.max(1, slideCount);
  const effectiveSlidesPerBatch = Math.max(1, slidesPerBatch);
  const effectiveTargetCount = Math.max(1, targetCount);
  const batches = Math.max(1, Math.ceil(effectiveSlideCount / effectiveSlidesPerBatch));
  const stainRuns = batches * effectiveTargetCount;
  const controlSlides = Math.max(effectiveTargetCount * 2, batches);
  const totalSlides = effectiveSlideCount + controlSlides;

  const baseItems = ([
    {
      name: 'IHC 验证一抗（按靶标分别选型）',
      category: 'kit',
      quantity: effectiveTargetCount,
      unit: '支',
      catalogNumber: 'SCENE-IHC-PRIMARY',
      searchQuery: 'IHC antibody',
      note: `按 ${effectiveTargetCount} 个靶标估算；优先确认 IHC/IHC-P/IHC-Fr、组织图片和阳性组织。`,
    },
    {
      name: 'HRP 聚合物检测系统 / 匹配二抗',
      category: 'kit',
      quantity: Math.max(1, Math.ceil(stainRuns / 6)),
      unit: '套',
      catalogNumber: 'SCENE-IHC-DETECTION',
      searchQuery: 'IHC detection system HRP',
      note: '需匹配一抗宿主；明场 IHC 常用 HRP-DAB，荧光体系请换荧光二抗。',
    },
    {
      name: '防脱载玻片',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(totalSlides / 72)),
      unit: '盒',
      catalogNumber: 'SCENE-IHC-SLIDES',
      searchQuery: 'adhesion microscope slides',
      note: `按样本切片和对照切片共约 ${totalSlides} 张估算，高温修复建议使用防脱片。`,
    },
    {
      name: '抗原修复液（pH6 / pH9 视抗体选择）',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IHC-RETRIEVAL',
      searchQuery: 'antigen retrieval buffer',
      note: 'FFPE 样本常用；弱信号或背景高时建议比较不同 pH 条件。',
    },
    {
      name: '内源性过氧化物酶封闭液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 10)),
      unit: '瓶',
      catalogNumber: 'SCENE-IHC-PEROXIDASE',
      searchQuery: 'peroxidase blocking solution',
      note: 'HRP-DAB 体系建议纳入，减少组织内源酶背景。',
    },
    {
      name: '封闭液 / 抗体稀释液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IHC-BLOCK',
      searchQuery: 'IHC blocking buffer antibody diluent',
      note: '用于降低非特异染色，建议与检测系统兼容。',
    },
    {
      name: 'PBS/TBS 洗液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 8)),
      unit: '套',
      catalogNumber: 'SCENE-IHC-WASH',
      searchQuery: 'PBS TBS buffer',
      note: '脱蜡后洗涤、抗体孵育后洗涤和显色前后均需使用。',
    },
    {
      name: 'DAB 显色液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 10)),
      unit: '套',
      catalogNumber: 'SCENE-IHC-DAB',
      searchQuery: 'DAB substrate',
      note: '显色时间需固定；低丰度靶点可考虑高灵敏检测系统。',
    },
    {
      name: '苏木素复染液 / 返蓝液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainRuns / 12)),
      unit: '套',
      catalogNumber: 'SCENE-IHC-HEMATOXYLIN',
      searchQuery: 'hematoxylin counterstain',
      note: '明场 IHC 常用核复染，便于组织结构判断。',
    },
    {
      name: '封片剂与盖玻片',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(totalSlides / 100)),
      unit: '套',
      catalogNumber: 'SCENE-IHC-MOUNT',
      searchQuery: 'mounting medium coverslips',
      note: '明场和荧光封片剂不同，需按检测方式选择。',
    },
    {
      name: '湿盒 / 染色缸 / 切片架',
      category: 'consumable',
      quantity: 1,
      unit: '套',
      catalogNumber: 'SCENE-IHC-HUMID',
      searchQuery: 'IHC humidified chamber slide rack',
      note: '孵育时避免切片干燥，批量染色保持加液和洗涤一致。',
    },
    {
      name: '阳性组织对照和无一抗阴性对照',
      category: 'control',
      quantity: controlSlides,
      unit: '张',
      catalogNumber: 'SCENE-IHC-CONTROL',
      searchQuery: 'IHC positive control tissue',
      note: '每个靶标建议至少保留阳性和阴性对照，便于解释弱信号和背景。',
    },
  ] satisfies ProcurementItem[]);

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-IHC-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '染色批次', value: `${batches} 批` },
      { label: '检测靶标', value: `${effectiveTargetCount} 个` },
      { label: '染色运行', value: `${stainRuns} 次` },
      { label: '对照切片', value: `${controlSlides} 张` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateImmunofluorescenceItems(
  sampleCount: number,
  samplesPerBatch: number,
  channelCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const effectiveSampleCount = Math.max(1, sampleCount);
  const effectiveSamplesPerBatch = Math.max(1, samplesPerBatch);
  const effectiveChannelCount = Math.max(1, channelCount);
  const batches = Math.max(1, Math.ceil(effectiveSampleCount / effectiveSamplesPerBatch));
  const stainingUnits = batches * effectiveChannelCount;
  const controlSamples = Math.max(effectiveChannelCount + 1, batches);
  const imagingSamples = effectiveSampleCount + controlSamples;

  const baseItems: ProcurementItem[] = [
    {
      name: 'IF 验证一抗（按靶标分别选型）',
      category: 'kit',
      quantity: effectiveChannelCount,
      unit: '支',
      catalogNumber: 'SCENE-IF-PRIMARY',
      searchQuery: 'immunofluorescence primary antibody',
      note: `按 ${effectiveChannelCount} 个目标通道估算；优先确认 IF/ICC 或 IF-Fr 应用和阳性图像。`,
    },
    {
      name: '荧光二抗（488/555/594/647 等）',
      category: 'kit',
      quantity: effectiveChannelCount,
      unit: '支',
      catalogNumber: 'SCENE-IF-SECONDARY',
      searchQuery: 'fluorescent secondary antibody',
      note: '需匹配一抗宿主和显微镜通道；多标实验建议交叉吸附二抗。',
    },
    {
      name: 'DAPI / 核染料',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IF-DAPI',
      searchQuery: 'DAPI nuclear stain',
      note: '用于核染和图像配准，注意避光保存和固定稀释比例。',
    },
    {
      name: '4% PFA 固定液或甲醇固定试剂',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IF-FIX',
      searchQuery: 'paraformaldehyde immunofluorescence',
      note: '按抗原特性选择 PFA、甲醇或丙酮固定方式。',
    },
    {
      name: '通透液（Triton X-100 / saponin）',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IF-PERM',
      searchQuery: 'Triton X-100 saponin permeabilization',
      note: '胞内或核内靶点需要通透；膜蛋白需谨慎选择强度。',
    },
    {
      name: '封闭液 / 抗体稀释液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainingUnits / 8)),
      unit: '瓶',
      catalogNumber: 'SCENE-IF-BLOCK',
      searchQuery: 'immunofluorescence blocking buffer antibody diluent',
      note: '用于降低二抗非特异结合，建议与二抗宿主和样本类型兼容。',
    },
    {
      name: 'PBS/TBS 洗液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainingUnits / 8)),
      unit: '套',
      catalogNumber: 'SCENE-IF-WASH',
      searchQuery: 'PBS TBS buffer',
      note: '固定、通透、抗体孵育和核染后均需洗涤；多标实验建议足量准备。',
    },
    {
      name: '抗淬灭封片剂',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(imagingSamples / 100)),
      unit: '瓶',
      catalogNumber: 'SCENE-IF-ANTIFADE',
      searchQuery: 'antifade mounting medium',
      note: '保护荧光信号；共聚焦或长期保存建议选择抗淬灭版本。',
    },
    {
      name: '细胞爬片 / 载玻片 / 盖玻片',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(imagingSamples / 72)),
      unit: '盒',
      catalogNumber: 'SCENE-IF-COVERSLIP',
      searchQuery: 'coverslip microscope slides',
      note: `按样本和对照共约 ${imagingSamples} 个成像样本估算。`,
    },
    {
      name: '无一抗、单染和阳性对照',
      category: 'control',
      quantity: controlSamples,
      unit: '份',
      catalogNumber: 'SCENE-IF-CONTROL',
      searchQuery: 'immunofluorescence control',
      note: '用于判断二抗背景、串色、自发荧光和成像参数。',
    },
    {
      name: '避光湿盒 / 铝箔 / 染色盒',
      category: 'consumable',
      quantity: 1,
      unit: '套',
      catalogNumber: 'SCENE-IF-LIGHT-PROTECT',
      searchQuery: 'immunofluorescence humidified chamber',
      note: '二抗孵育、核染和封片前后需避光，避免荧光淬灭。',
    },
  ];

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-IF-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '染色批次', value: `${batches} 批` },
      { label: '荧光通道', value: `${effectiveChannelCount} 个` },
      { label: '染色运行', value: `${stainingUnits} 次` },
      { label: '对照样本', value: `${controlSamples} 份` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateFlowCytometryItems(
  sampleCount: number,
  samplesPerBatch: number,
  markerCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const effectiveSampleCount = Math.max(1, sampleCount);
  const effectiveSamplesPerBatch = Math.max(1, samplesPerBatch);
  const effectiveMarkerCount = Math.max(1, markerCount);
  const batches = Math.max(1, Math.ceil(effectiveSampleCount / effectiveSamplesPerBatch));
  const stainingTubes = effectiveSampleCount + effectiveMarkerCount + 2;
  const controlTubes = effectiveMarkerCount + 2;

  const baseItems: ProcurementItem[] = [
    {
      name: '流式验证抗体（按 marker 分别选型）',
      category: 'kit',
      quantity: effectiveMarkerCount,
      unit: '支',
      catalogNumber: 'SCENE-FLOW-ANTIBODY',
      searchQuery: 'flow cytometry antibody',
      note: `按 ${effectiveMarkerCount} 个 marker 估算；需确认 Flow/FCM 应用、克隆号和荧光素。`,
    },
    {
      name: '死活染料（Fixable viability dye 或 PI/7-AAD）',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '支',
      catalogNumber: 'SCENE-FLOW-VIABILITY',
      searchQuery: 'flow viability dye',
      note: '用于排除死细胞；固定通透实验需选择 fixable 版本。',
    },
    {
      name: 'FACS Buffer / 染色缓冲液',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(stainingTubes / 40)),
      unit: '瓶',
      catalogNumber: 'SCENE-FLOW-BUFFER',
      searchQuery: 'FACS buffer',
      note: '常用 PBS + BSA/FBS + EDTA；用于染色、洗涤和重悬。',
    },
    {
      name: '流式管 / 5 mL 圆底管',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(stainingTubes / 100)),
      unit: '包',
      catalogNumber: 'SCENE-FLOW-TUBES',
      searchQuery: 'flow cytometry tubes',
      note: `按样本、单染补偿和对照共约 ${stainingTubes} 管估算。`,
    },
    {
      name: '细胞滤网（40/70 μm）',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(effectiveSampleCount / 30)),
      unit: '包',
      catalogNumber: 'SCENE-FLOW-STRAINER',
      searchQuery: 'cell strainer',
      note: '上机前过滤单细胞悬液，降低聚团和堵针风险。',
    },
    {
      name: '补偿微球 / 单染补偿材料',
      category: 'control',
      quantity: effectiveMarkerCount,
      unit: '份',
      catalogNumber: 'SCENE-FLOW-COMP',
      searchQuery: 'flow compensation beads',
      note: '每个荧光通道建议准备单染补偿，复杂 panel 尤其必要。',
    },
    {
      name: 'FMO / 同型对照材料',
      category: 'control',
      quantity: Math.max(1, Math.ceil(controlTubes / 4)),
      unit: '套',
      catalogNumber: 'SCENE-FLOW-FMO',
      searchQuery: 'FMO isotype control flow cytometry',
      note: '用于判断门控边界和非特异背景；关键 marker 优先设置 FMO。',
    },
    {
      name: 'Fc Block',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '支',
      catalogNumber: 'SCENE-FLOW-FC-BLOCK',
      searchQuery: 'Fc Block',
      note: '免疫细胞样本建议加入，降低 Fc 受体介导的非特异结合。',
    },
    {
      name: '低吸附 EP 管和移液吸头',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(stainingTubes / 80)),
      unit: '套',
      catalogNumber: 'SCENE-FLOW-CONSUMABLE',
      searchQuery: 'low binding tubes pipette tips',
      note: '抗体分装、染色混合和洗涤过程常用。',
    },
  ];

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-FLOW-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '上机批次', value: `${batches} 批` },
      { label: 'Panel marker', value: `${effectiveMarkerCount} 个` },
      { label: '预计染色管', value: `${stainingTubes} 管` },
      { label: '对照管', value: `${controlTubes} 管` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateMolecularBiologyItems(
  sampleCount: number,
  reactionsPerBatch: number,
  targetCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const effectiveSampleCount = Math.max(1, sampleCount);
  const effectiveReactionsPerBatch = Math.max(1, reactionsPerBatch);
  const effectiveTargetCount = Math.max(1, targetCount);
  const batches = Math.max(1, Math.ceil((effectiveSampleCount * effectiveTargetCount) / effectiveReactionsPerBatch));
  const baseReactions = effectiveSampleCount * effectiveTargetCount;
  const controlReactions = Math.max(effectiveTargetCount * 2, batches * 2);
  const reserveReactions = Math.ceil((baseReactions + controlReactions) * 0.15);
  const totalReactions = baseReactions + controlReactions + reserveReactions;

  const usesQpcr = conditionExtras.some((item) => item.name.includes('qPCR'));
  const usesCloning = conditionExtras.some((item) => item.name.includes('感受态') || item.name.includes('限制性内切酶') || item.name.includes('连接'));
  const usesRna = conditionExtras.some((item) => item.name.includes('RNA') || item.name.includes('反转录'));

  const baseItems = ([
    {
      name: usesRna ? 'RNA 提取/纯化试剂盒' : 'DNA / PCR 产物提取纯化试剂盒',
      category: 'kit',
      quantity: Math.max(1, Math.ceil(effectiveSampleCount / 50)),
      unit: '盒',
      catalogNumber: 'SCENE-MOL-EXTRACTION',
      searchQuery: usesRna ? 'RNA extraction kit' : 'DNA purification kit',
      note: `按 ${effectiveSampleCount} 个样本估算；RNA 项目需全程 RNase-free 操作。`,
    },
    {
      name: usesQpcr ? 'qPCR Master Mix（SYBR/Probe 按方案选择）' : 'PCR Master Mix / DNA Polymerase',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(totalReactions / 500)),
      unit: '套',
      catalogNumber: 'SCENE-MOL-PCR-MIX',
      searchQuery: usesQpcr ? 'qPCR master mix' : 'PCR master mix',
      note: `按约 ${totalReactions} 个反应估算，已包含对照和 15% 预留。`,
    },
    {
      name: '引物 / 探针（按靶标或构建分别设计）',
      category: 'reagent',
      quantity: effectiveTargetCount,
      unit: '对/套',
      catalogNumber: 'SCENE-MOL-PRIMER',
      searchQuery: 'PCR primers probes',
      note: `按 ${effectiveTargetCount} 个靶标/构建估算；qPCR 建议同时确认扩增效率和熔解曲线。`,
    },
    {
      name: 'Nuclease-free 水',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(totalReactions / 800)),
      unit: '瓶',
      catalogNumber: 'SCENE-MOL-WATER',
      searchQuery: 'nuclease free water',
      note: 'PCR/qPCR、反转录、引物稀释和阴性对照均需使用。',
    },
    {
      name: '滤芯吸头（10 / 200 / 1000 μL）',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(totalReactions / 150)),
      unit: '盒',
      catalogNumber: 'SCENE-MOL-FILTER-TIPS',
      searchQuery: 'filter pipette tips',
      note: '用于降低气溶胶污染；PCR/qPCR 建议固定专区使用。',
    },
    {
      name: usesQpcr ? 'qPCR 光学板膜 / 管条' : 'PCR 管 / 8 联管 / PCR 板',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(totalReactions / 96)),
      unit: usesQpcr ? '板/套' : '盒',
      catalogNumber: 'SCENE-MOL-PCR-PLATE',
      searchQuery: usesQpcr ? 'qPCR optical plate seal' : 'PCR tubes plate',
      note: usesQpcr ? '密封、离心和无气泡会影响 Ct 重复性。' : '需匹配 PCR 仪模块规格。',
    },
    {
      name: '琼脂糖、凝胶染料和电泳缓冲液',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(batches / 8)),
      unit: '套',
      catalogNumber: 'SCENE-MOL-GEL',
      searchQuery: 'agarose gel stain TAE TBE',
      note: '用于终点 PCR、克隆片段和纯化前后确认。',
    },
    {
      name: 'DNA 分子量标准 / Ladder',
      category: 'control',
      quantity: Math.max(1, Math.ceil(batches / 12)),
      unit: '支',
      catalogNumber: 'SCENE-MOL-LADDER',
      searchQuery: 'DNA ladder',
      note: '按片段大小选择 100 bp、1 kb 或宽范围 Marker。',
    },
    {
      name: '阳性模板、NTC 和阴性对照材料',
      category: 'control',
      quantity: Math.max(1, effectiveTargetCount),
      unit: '套',
      catalogNumber: 'SCENE-MOL-CONTROL',
      searchQuery: 'PCR control template',
      note: '用于区分模板问题、体系问题和污染问题。',
    },
    {
      name: '反转录试剂',
      category: 'reagent',
      quantity: usesRna ? Math.max(1, Math.ceil(effectiveSampleCount / 50)) : 0,
      unit: '套',
      catalogNumber: 'SCENE-MOL-RT',
      searchQuery: 'reverse transcription kit',
      note: 'RNA/qRT-PCR 项目必备，建议统一 RNA 输入量和反转录批次。',
    },
    {
      name: 'PCR 产物纯化 / 胶回收试剂盒',
      category: 'kit',
      quantity: usesCloning ? Math.max(1, Math.ceil(baseReactions / 50)) : Math.max(1, Math.ceil(batches / 12)),
      unit: '盒',
      catalogNumber: 'SCENE-MOL-CLEANUP',
      searchQuery: 'PCR cleanup gel extraction kit',
      note: usesCloning ? '克隆或测序前建议纯化片段，去除引物、酶和小片段。' : '用于必要的条带回收或测序前清理。',
    },
    {
      name: '限制性内切酶 / 连接或无缝组装试剂',
      category: 'reagent',
      quantity: usesCloning ? Math.max(1, effectiveTargetCount) : 0,
      unit: '套',
      catalogNumber: 'SCENE-MOL-CLONING',
      searchQuery: 'restriction enzyme ligase Gibson assembly',
      note: '按载体图谱、插入片段和构建路线选择酶切连接或无缝组装。',
    },
    {
      name: '感受态细胞和质粒小提试剂盒',
      category: 'kit',
      quantity: usesCloning ? Math.max(1, Math.ceil(effectiveTargetCount / 5)) : 0,
      unit: '套',
      catalogNumber: 'SCENE-MOL-COMPETENT',
      searchQuery: 'competent cells plasmid miniprep kit',
      note: '用于转化、筛选、挑克隆和后续测序验证。',
    },
  ] satisfies ProcurementItem[]).filter((item) => item.quantity > 0);

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-MOL-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '实验批次', value: `${batches} 批` },
      { label: '检测靶标', value: `${effectiveTargetCount} 个` },
      { label: '基础反应', value: `${baseReactions} 个` },
      { label: '总预估反应', value: `${totalReactions} 个` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function estimateSmallAnimalImagingItems(
  animalCount: number,
  animalsPerBatch: number,
  probeCount: number,
  conditionExtras: PrepItem[],
): {
  metrics: Array<{ label: string; value: string }>;
  items: ProcurementItem[];
} {
  const batches = Math.max(1, Math.ceil(animalCount / Math.max(1, animalsPerBatch)));
  const effectiveProbeCount = Math.max(1, probeCount);
  const imagingRuns = batches * effectiveProbeCount;

  const baseItems = ([
    {
      name: '活体成像底物、探针或造影剂',
      category: 'reagent',
      quantity: effectiveProbeCount,
      unit: '种',
      catalogNumber: 'SCENE-ANIMAL-PROBE',
      searchQuery: 'animal imaging probe luciferin contrast agent',
      note: `按 ${effectiveProbeCount} 个探针或成像模态准备，需记录剂量、批次和采集窗口。`,
    },
    {
      name: '小动物麻醉材料',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(imagingRuns / 6)),
      unit: '套',
      catalogNumber: 'SCENE-ANIMAL-ANESTHESIA',
      searchQuery: 'animal anesthesia',
      note: '包含诱导、维持、废气处理或替代麻醉材料；按设备和伦理要求确认。',
    },
    {
      name: '保温垫、体温探头或保温仓',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(animalsPerBatch / 5)),
      unit: '套',
      catalogNumber: 'SCENE-ANIMAL-WARMING',
      searchQuery: 'animal warming pad temperature probe',
      note: '维持采集期间体温稳定，降低信号和复苏波动。',
    },
    {
      name: '注射器、胰岛素针和给药耗材',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(animalCount * effectiveProbeCount / 50)),
      unit: '盒',
      catalogNumber: 'SCENE-ANIMAL-INJECTION',
      searchQuery: 'insulin syringe gavage needle animal',
      note: '按腹腔、皮下、尾静脉或灌胃路线选择规格，并预留操作损耗。',
    },
    {
      name: '动物固定器和体位辅助材料',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(animalsPerBatch / 4)),
      unit: '套',
      catalogNumber: 'SCENE-ANIMAL-HOLDER',
      searchQuery: 'animal holder restrainer imaging',
      note: '保证体位和 ROI 可比，适配动物体型和成像设备。',
    },
    {
      name: '脱毛、皮肤清洁和眼膏',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(animalCount / 20)),
      unit: '套',
      catalogNumber: 'SCENE-ANIMAL-PREP',
      searchQuery: 'animal depilatory eye ointment',
      note: '体表荧光或长时间麻醉建议准备，降低背景并保护角膜。',
    },
    {
      name: 'PBS 或无菌生理盐水',
      category: 'reagent',
      quantity: Math.max(1, Math.ceil(animalCount / 30)),
      unit: '瓶',
      catalogNumber: 'SCENE-ANIMAL-PBS',
      searchQuery: 'PBS sterile saline',
      note: '用于稀释、冲洗、给药前后处理或离体器官成像准备。',
    },
    {
      name: '离体器官取材与成像耗材',
      category: 'consumable',
      quantity: Math.max(1, Math.ceil(animalCount / 24)),
      unit: '套',
      catalogNumber: 'SCENE-ANIMAL-EXVIVO',
      searchQuery: 'dissection tools sterile petri dish',
      note: '用于终点组织取材、离体器官成像和后续组织学验证。',
    },
    {
      name: 'ROI、背景扣除和采集参数记录表',
      category: 'control',
      quantity: 1,
      unit: '份',
      catalogNumber: 'SCENE-ANIMAL-ROI',
      searchQuery: 'image analysis ROI template',
      note: '统一 ROI、曝光或扫描参数、背景扣除、软件版本和原始数据编号。',
    },
  ] satisfies ProcurementItem[]).filter((item) => item.quantity > 0);

  const extraItems: ProcurementItem[] = conditionExtras
    .filter((extra) => extra.name.trim().length > 0)
    .map((extra, i) => ({
      name: extra.name,
      category: extra.category,
      quantity: 1,
      unit: '套',
      catalogNumber: `SCENE-ANIMAL-COND-${i}`,
      searchQuery: extra.name,
      note: extra.reason,
    }));

  return {
    metrics: [
      { label: '动物数量', value: `${animalCount} 只` },
      { label: '成像批次', value: `${batches} 批` },
      { label: '探针或模态', value: `${effectiveProbeCount} 个` },
      { label: '预估采集轮次', value: `${imagingRuns} 轮` },
    ],
    items: [...baseItems, ...extraItems],
  };
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

export default function ScenePrepListBuilder({ sceneSlug, theme, ui }: ScenePrepListBuilderProps) {
  const t = theme;
  const config = configs[sceneSlug] ?? configs['western-blot'];
  const configGroups = useMemo(() => config?.groups ?? [], [config]);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [matchedProducts, setMatchedProducts] = useState<Record<string, Product | null>>({});
  const [sampleCount, setSampleCount] = useState(
    sceneSlug === 'elisa' || sceneSlug === 'elispot-fluorospot'
      ? 30
      : sceneSlug === 'small-animal-imaging'
        ? 12
      : sceneSlug === 'ihc' || sceneSlug === 'spatial-biology'
        ? 12
        : sceneSlug === 'immunofluorescence' ||
            sceneSlug === 'flow-cytometry' ||
            sceneSlug === 'magnetic-cell-separation' ||
            sceneSlug === 'single-cell-omics' ||
            sceneSlug === 'organoid-3d-culture' ||
            sceneSlug === 'crispr-gene-editing' ||
            sceneSlug === 'extracellular-vesicles' ||
            sceneSlug === 'proteomics-mass-spec' ||
            sceneSlug === 'molecular-biology'
          ? 24
          : 8,
  );
  const [species, setSpecies] = useState('Human');
  const [targetMolecules, setTargetMolecules] = useState<string[]>(['TNF alpha']);
  const [replicateMode, setReplicateMode] = useState<'3' | '4' | '5' | 'custom'>('3');
  const [customReplicates, setCustomReplicates] = useState(6);
  const [standardPoints, setStandardPoints] = useState(8);
  const [includeControls, setIncludeControls] = useState(false);
  const [reserveWells, setReserveWells] = useState(18);
  const [lanesPerGel, setLanesPerGel] = useState(10);
  const [reservedLanes, setReservedLanes] = useState(2);
  const [wbBlotCount, setWbBlotCount] = useState(2);
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(configGroups.map((group) => [group.id, group.options[0]?.id ?? ''])),
  );
  const isDesktop = useIsDesktop();

  const replicates = replicateMode === 'custom' ? customReplicates : Number(replicateMode);
  const isMultiTargetElisa = sceneSlug === 'elisa' && selected.scale === 'multi-target';
  const activeTargetMolecules = useMemo(
    () => (isMultiTargetElisa ? targetMolecules : targetMolecules.slice(0, 1)),
    [isMultiTargetElisa, targetMolecules],
  );

  const selectedConditionExtras = useMemo(
    () => configGroups.flatMap((group) =>
      group.options.find((opt) => opt.id === selected[group.id])?.items ?? [],
    ),
    [configGroups, selected],
  );

  const estimate = useMemo(() => {
    if (sceneSlug === 'elisa' || sceneSlug === 'elispot-fluorospot') {
      return estimateElisaItems(sampleCount, replicates, standardPoints, includeControls, reserveWells, species, activeTargetMolecules, selectedConditionExtras);
    }
    if (sceneSlug === 'ihc') {
      return estimateIhcItems(sampleCount, lanesPerGel, wbBlotCount, selectedConditionExtras);
    }
    if (sceneSlug === 'immunofluorescence' || sceneSlug === 'spatial-biology' || sceneSlug === 'organoid-3d-culture') {
      return estimateImmunofluorescenceItems(sampleCount, lanesPerGel, wbBlotCount, selectedConditionExtras);
    }
    if (sceneSlug === 'flow-cytometry' || sceneSlug === 'magnetic-cell-separation' || sceneSlug === 'single-cell-omics' || sceneSlug === 'extracellular-vesicles') {
      return estimateFlowCytometryItems(sampleCount, lanesPerGel, wbBlotCount, selectedConditionExtras);
    }
    if (sceneSlug === 'small-animal-imaging') {
      return estimateSmallAnimalImagingItems(sampleCount, lanesPerGel, wbBlotCount, selectedConditionExtras);
    }
    if (sceneSlug === 'molecular-biology' || sceneSlug === 'crispr-gene-editing') {
      return estimateMolecularBiologyItems(sampleCount, lanesPerGel, wbBlotCount, selectedConditionExtras);
    }
    return estimateWbItems(sampleCount, lanesPerGel, reservedLanes, wbBlotCount, selectedConditionExtras);
  }, [activeTargetMolecules, includeControls, lanesPerGel, replicates, reserveWells, reservedLanes, sampleCount, sceneSlug, selectedConditionExtras, species, standardPoints, wbBlotCount]);

  useEffect(() => {
    if (sceneSlug === 'western-blot') return undefined;

    let cancelled = false;

    async function fetchSingleMatch(item: ProcurementItem) {
      try {
        const params = buildProductSearchQuery({ keyword: item.searchQuery, limit: 1 });
        const response = await fetch(`/api/products?${params}`);
        if (!response.ok) return [item.catalogNumber, null] as const;
        const data = await response.json();
        return [item.catalogNumber, (data.products?.[0] ?? null) as Product | null] as const;
      } catch {
        return [item.catalogNumber, null] as const;
      }
    }

    async function fetchMatches() {
      const pairs = await Promise.all(estimate.items.map(fetchSingleMatch));
      if (!cancelled) setMatchedProducts(Object.fromEntries(pairs));
    }

    fetchMatches();
    return () => {
      cancelled = true;
    };
  }, [estimate, sceneSlug]);

  if (!config) return null;

  function updateTargetMolecule(index: number, value: string) {
    setTargetMolecules((current) => current.map((target, targetIndex) => (targetIndex === index ? value : target)));
  }

  function addTargetMolecule() {
    setTargetMolecules((current) => {
      const next = [...current, ''];
      if (sceneSlug === 'elisa' && next.length > 2) {
        setSelected((selectedCurrent) => (
          selectedCurrent.scale === 'multi-target' ? selectedCurrent : { ...selectedCurrent, scale: 'multi-target' }
        ));
      }
      return next;
    });
  }

  function removeTargetMolecule(index: number) {
    setTargetMolecules((current) => (current.length > 1 ? current.filter((_, targetIndex) => targetIndex !== index) : current));
  }

  function buildProcurementListText(): string {
    const header = [
      config.title,
      '',
      '【项目参数】',
      ...estimate.metrics.map((metric) => `${metric.label}：${metric.value}`),
      '',
      '【' + ui.listTitle + '】',
    ];

    const lines = estimate.items.map((item) => {
      const matched = sceneSlug !== 'western-blot' ? matchedProducts[item.catalogNumber] : null;
      const quantity = `${item.quantity} ${item.unit}`;
      const reference = matched ? `（参考：${matched.brand} · ${matched.catalogNumber}）` : '';
      return `- ${item.name} · ${quantity}${reference}\n  ${item.note}`;
    });

    const footer = [
      '',
      '说明：用量为估算参考；无货号项请至产品中心自行选型。',
    ];

    return [...header, ...lines, ...footer].join('\n');
  }

  async function copyProcurementList() {
    const text = buildProcurementListText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const isFluorescenceScene = sceneSlug === 'immunofluorescence';
  const isFlowScene = sceneSlug === 'flow-cytometry';
  const isMagneticCellSeparationScene = sceneSlug === 'magnetic-cell-separation';
  const isSingleCellScene = sceneSlug === 'single-cell-omics';
  const isSpatialBiologyScene = sceneSlug === 'spatial-biology';
  const isOrganoidScene = sceneSlug === 'organoid-3d-culture';
  const isMolecularBiologyScene = sceneSlug === 'molecular-biology';
  const isCrisprScene = sceneSlug === 'crispr-gene-editing';
  const isExtracellularVesiclesScene = sceneSlug === 'extracellular-vesicles';
  const isProteomicsScene = sceneSlug === 'proteomics-mass-spec';
  const isSmallAnimalImagingScene = sceneSlug === 'small-animal-imaging';
  const isElispotScene = sceneSlug === 'elispot-fluorospot';
  const isCompactStainingScene =
    sceneSlug === 'ihc' ||
    isElispotScene ||
    isFluorescenceScene ||
    isFlowScene ||
    isMagneticCellSeparationScene ||
    isSingleCellScene ||
    isSpatialBiologyScene ||
    isOrganoidScene ||
    isMolecularBiologyScene ||
    isCrisprScene ||
    isExtracellularVesiclesScene ||
    isProteomicsScene ||
    isSmallAnimalImagingScene;
  const sampleCountLabel = isElispotScene
    ? '样本/孔组数量'
    : isSmallAnimalImagingScene
      ? '动物数量'
    : isMolecularBiologyScene || isCrisprScene || isProteomicsScene
    ? '样本数量'
    : isExtracellularVesiclesScene
      ? '样本/批次数量'
    : isSpatialBiologyScene
      ? '组织切片数量'
      : isFlowScene || isMagneticCellSeparationScene || isSingleCellScene || isFluorescenceScene || isOrganoidScene
        ? '样本数量'
        : '样本切片数量';
  const batchSizeLabel = isElispotScene
    ? '每批检测孔数'
    : isSmallAnimalImagingScene
      ? '每批成像动物'
    : isMolecularBiologyScene || isCrisprScene
    ? '每批反应数'
    : isProteomicsScene
      ? '每批样本数'
      : isExtracellularVesiclesScene
        ? '每批处理样本'
    : isMagneticCellSeparationScene
      ? '每批分选样本'
      : isFlowScene
      ? '每批上机样本'
      : isSingleCellScene
        ? '每批建库样本'
        : isSpatialBiologyScene
          ? '每批检测切片'
          : isFluorescenceScene || isOrganoidScene
            ? '每批处理样本'
            : '每批染色切片';
  const targetCountLabel = isElispotScene
    ? '检测因子/刺激物数量'
    : isSmallAnimalImagingScene
      ? '探针/成像模态数量'
    : isMolecularBiologyScene || isCrisprScene
    ? '检测基因/构建数量'
    : isProteomicsScene
      ? '候选蛋白/验证靶标'
      : isExtracellularVesiclesScene
        ? '检测 marker/指标数量'
    : isMagneticCellSeparationScene
      ? '目标/去除 marker 数量'
      : isFlowScene
      ? 'Panel marker 数量'
      : isSingleCellScene
        ? '目标 marker/标签数量'
        : isSpatialBiologyScene
          ? '检测靶标/通道数量'
          : isFluorescenceScene || isOrganoidScene
            ? '荧光通道数量'
            : '检测靶标数量';

  const listLimit = isDesktop ? 16 : 8;
  const visibleItems = expanded ? estimate.items : estimate.items.slice(0, listLimit);

  const procurementListBlock = (
    <div className={`${sceneSurfaceClasses.card} overflow-hidden`}>
      <div className={`flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3 sm:px-5`}>
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.listTitle}</p>
          {estimate.items.length > listLimit ? (
            <span className={`text-xs ${sceneSurfaceClasses.mutedText}`}>共 {estimate.items.length} 项</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={copyProcurementList}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-brand px-3 py-1.5 text-xs font-medium text-white ${t.primaryBtn} ${t.primaryBtnHover} ${sceneSurfaceClasses.focusRing}`}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? ui.copyListDone : ui.copyListButton}
        </button>
      </div>

      <ol className="grid grid-cols-1 lg:grid-cols-2">
        {visibleItems.map((item, index) => {
          const matchedProduct = sceneSlug !== 'western-blot' ? matchedProducts[item.catalogNumber] : null;
          return (
            <li
              key={item.catalogNumber}
              className="flex items-baseline gap-3 border-b border-[var(--surface-border)] px-4 py-2.5 sm:px-5 lg:odd:border-r lg:odd:border-[var(--surface-border)]"
            >
              <span className={`w-5 shrink-0 text-right text-xs font-semibold ${t.softText}`}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className={`truncate text-sm font-medium ${sceneSurfaceClasses.text}`}>{item.name}</p>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${t.softBg} ${t.softText}`}>
                    {item.quantity} {item.unit}
                  </span>
                </div>
                <p className={`mt-0.5 text-xs leading-relaxed ${sceneSurfaceClasses.mutedText}`}>
                  {item.note}
                  {matchedProduct ? `　参考：${matchedProduct.brand} · ${matchedProduct.catalogNumber}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {estimate.items.length > listLimit || expanded ? (
        <div className="border-t border-[var(--surface-border)] px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={`flex min-h-10 w-full items-center justify-center gap-1.5 ${sceneSurfaceClasses.card} px-4 py-2 text-sm font-medium ${sceneSurfaceClasses.text} transition ${t.hoverBg} ${sceneSurfaceClasses.focusRing}`}
          >
            {expanded ? '收起' : `展开全部 ${estimate.items.length} 项`}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className={`mb-8 ${sceneSurfaceClasses.section} p-4 sm:p-5`}>
      <div className="mb-5">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${t.stepBadge}`}>
            <FlaskConical className="h-4 w-4" />
            {ui.sectionBadge}
          </div>
          <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>{config.title}</h2>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>
            {config.summary}
          </p>
        </div>
      </div>

      {sceneSlug === 'western-blot' ? (
        /* WB 单列紧凑布局 */
        <div className="space-y-4">
          {/* 条件组：横向三列 */}
          <div className={`${sceneSurfaceClasses.card} p-4`}>
            <div className="mb-3">
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.conditionsTitle}</p>
              <p className={`mt-0.5 text-xs ${sceneSurfaceClasses.mutedText}`}>{ui.conditionsHint}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {configGroups.map((group) => (
                <div key={group.id}>
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${sceneSurfaceClasses.mutedText}`}>{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                    {group.options.map((option) => {
                      const isActive = selected[group.id] === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelected((current) => ({ ...current, [group.id]: option.id }))}
                          className={`rounded-lg border px-3 py-2.5 text-left transition ${
                            isActive ? `${t.activeBorder} ${t.activeBg} ${t.strongText}` : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder}`
                          }`}
                        >
                          <span className="block text-sm font-semibold">{option.label}</span>
                          <span className={`mt-0.5 block text-xs leading-relaxed ${isActive ? t.softText : sceneSurfaceClasses.mutedText}`}>
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 参数 + 即时指标 */}
          <div className={`${sceneSurfaceClasses.subPanel} p-4`}>
            <div className="mb-3 flex items-center gap-2">
              <Calculator className={`h-4 w-4 ${t.sectionIcon}`} />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.paramsTitle}</p>
              <p className={`ml-auto text-xs ${sceneSurfaceClasses.mutedText}`}>{ui.planHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                样本数量
                <input
                  type="number"
                  min={1}
                  value={sampleCount}
                  onChange={(event) => setSampleCount(Math.max(1, Number(event.target.value) || 1))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                每块胶泳道数
                <input
                  type="number"
                  min={6}
                  max={20}
                  value={lanesPerGel}
                  onChange={(event) => setLanesPerGel(Math.max(6, Number(event.target.value) || 10))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                每胶预留泳道
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={reservedLanes}
                  onChange={(event) => setReservedLanes(Math.max(1, Number(event.target.value) || 2))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                检测目标数量
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={wbBlotCount}
                  onChange={(event) => setWbBlotCount(Math.max(1, Number(event.target.value) || 1))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
            </div>
            {/* 即时估算指标 */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {estimate.metrics.map((metric) => (
                <div key={metric.label} className={`rounded-brand px-3 py-2 ${t.softBg}`}>
                  <p className={`text-xs ${t.softText}`}>{metric.label}</p>
                  <p className={`mt-0.5 text-sm font-semibold ${t.strongText}`}>{metric.value}</p>
                </div>
              ))}
            </div>
          </div>

          {procurementListBlock}
        </div>
      ) : isCompactStainingScene ? (
        <div className="space-y-4">
          <div className={`${sceneSurfaceClasses.card} p-4`}>
            <div className="mb-3">
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.conditionsTitle}</p>
              <p className={`mt-0.5 text-xs ${sceneSurfaceClasses.mutedText}`}>{ui.conditionsHint}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {configGroups.map((group) => (
                <div key={group.id}>
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${sceneSurfaceClasses.mutedText}`}>{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                    {group.options.map((option) => {
                      const isActive = selected[group.id] === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSelected((current) => ({ ...current, [group.id]: option.id }))}
                          className={`rounded-lg border px-3 py-2.5 text-left transition ${
                            isActive ? `${t.activeBorder} ${t.activeBg} ${t.strongText}` : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder}`
                          }`}
                        >
                          <span className="block text-sm font-semibold">{option.label}</span>
                          <span className={`mt-0.5 block text-xs leading-relaxed ${isActive ? t.softText : sceneSurfaceClasses.mutedText}`}>
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${sceneSurfaceClasses.subPanel} p-4`}>
            <div className="mb-3 flex items-center gap-2">
              <Calculator className={`h-4 w-4 ${t.sectionIcon}`} />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.paramsTitle}</p>
              <p className={`ml-auto text-xs ${sceneSurfaceClasses.mutedText}`}>{ui.planHint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                {sampleCountLabel}
                <input
                  type="number"
                  min={1}
                  value={sampleCount}
                  onChange={(event) => setSampleCount(Math.max(1, Number(event.target.value) || 1))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                {batchSizeLabel}
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={lanesPerGel}
                  onChange={(event) => setLanesPerGel(Math.max(1, Number(event.target.value) || 12))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
              <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                {targetCountLabel}
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={wbBlotCount}
                  onChange={(event) => setWbBlotCount(Math.max(1, Number(event.target.value) || 1))}
                  className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {estimate.metrics.map((metric) => (
                <div key={metric.label} className={`rounded-brand px-3 py-2 ${t.softBg}`}>
                  <p className={`text-xs ${t.softText}`}>{metric.label}</p>
                  <p className={`mt-0.5 text-sm font-semibold ${t.strongText}`}>{metric.value}</p>
                </div>
              ))}
            </div>
          </div>

          {procurementListBlock}
        </div>
      ) : (
        /* ELISA 两栏布局（参数多，左右均衡） */
        <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div className={`${sceneSurfaceClasses.subPanel} p-4`}>
            <div className="mb-4">
              <p className={`text-base font-semibold ${sceneSurfaceClasses.text}`}>{ui.planTitle}</p>
              <p className={`mt-1 text-sm ${sceneSurfaceClasses.mutedText}`}>{ui.planHint}</p>
            </div>

            <div className={`${sceneSurfaceClasses.card} p-4`}>
              <p className={`mb-1 text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.conditionsTitle}</p>
              <p className={`mb-3 text-sm ${sceneSurfaceClasses.mutedText}`}>{ui.conditionsHint}</p>
              <div className="space-y-4">
                {configGroups.map((group) => (
                  <div key={group.id}>
                    <p className={`mb-2 text-xs font-semibold uppercase ${sceneSurfaceClasses.mutedText}`}>{group.label}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                      {group.options.map((option) => {
                        const isActive = selected[group.id] === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelected((current) => ({ ...current, [group.id]: option.id }))}
                            className={`rounded-lg border px-3 py-2.5 text-left transition ${
                              isActive ? `${t.activeBorder} ${t.activeBg} ${t.strongText}` : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder}`
                            }`}
                          >
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className={`mt-1 block text-xs leading-relaxed ${isActive ? t.softText : sceneSurfaceClasses.mutedText}`}>
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mt-4 ${sceneSurfaceClasses.card} p-4`}>
              <div className="mb-4 flex items-center gap-2">
                <Calculator className={`h-4 w-4 ${t.sectionIcon}`} />
                <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.paramsTitle}</p>
              </div>
              <div className="grid gap-3">
                <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                  样本数量
                  <input
                    type="number"
                    min={1}
                    value={sampleCount}
                    onChange={(event) => setSampleCount(Math.max(1, Number(event.target.value) || 1))}
                    className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                  />
                </label>
                <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                  种属
                  <select
                    value={species}
                    onChange={(event) => setSpecies(event.target.value)}
                    className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                  >
                    <option value="Human">Human</option>
                    <option value="Mouse">Mouse</option>
                    <option value="Rat">Rat</option>
                    <option value="Monkey">Monkey</option>
                    <option value="Rabbit">Rabbit</option>
                    <option value="">其他/不限定</option>
                  </select>
                </label>
                <div className={`text-sm ${sceneSurfaceClasses.text}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span>目标分子</span>
                    <button
                      type="button"
                      onClick={addTargetMolecule}
                      className={`inline-flex min-h-10 items-center gap-1 rounded-brand ${sceneSurfaceClasses.card} px-2 py-1 text-xs font-medium ${t.softText} ${t.hoverBg} ${sceneSurfaceClasses.focusRing}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      追加
                    </button>
                  </div>
                  {isMultiTargetElisa || targetMolecules.length > 1 ? (
                    <p className={`mb-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${t.softBg} ${t.softText}`}>
                      已按多指标处理；各目标会分别匹配试剂盒并计入配套建议。
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {targetMolecules.map((target, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          value={target}
                          onChange={(event) => updateTargetMolecule(index, event.target.value)}
                          placeholder="如 TNF alpha / IL-6 / VEGF"
                          className={`w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                        />
                        {isMultiTargetElisa && targetMolecules.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeTargetMolecule(index)}
                            className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center ${sceneSurfaceClasses.card} rounded-brand text-[var(--brand-color-error-text)] hover:bg-[var(--brand-color-error-bg)] ${sceneSurfaceClasses.focusRing}`}
                            aria-label="删除目标分子"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                  每个样本复孔数
                  <select
                    value={replicateMode}
                    onChange={(event) => setReplicateMode(event.target.value as '3' | '4' | '5' | 'custom')}
                    className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                  >
                    <option value="3">3 复孔</option>
                    <option value="4">4 复孔</option>
                    <option value="5">5 复孔</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                {replicateMode === 'custom' ? (
                  <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                    自定义复孔数
                    <input
                      type="number"
                      min={3}
                      max={24}
                      value={customReplicates}
                      onChange={(event) => setCustomReplicates(Math.max(3, Number(event.target.value) || 3))}
                      className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                    />
                  </label>
                ) : null}
                <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                  标准曲线点数
                  <input
                    type="number"
                    min={4}
                    max={12}
                    value={standardPoints}
                    onChange={(event) => setStandardPoints(Math.max(4, Number(event.target.value) || 8))}
                    className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                  />
                </label>
                <label className={`text-sm ${sceneSurfaceClasses.text}`}>
                  预留/边缘/备用孔
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={reserveWells}
                    onChange={(event) => setReserveWells(Math.max(0, Number(event.target.value) || 0))}
                    className={`mt-1 w-full px-3 py-2 text-sm ${sceneSurfaceClasses.input} ${t.inputFocus}`}
                  />
                </label>
                <label className={`flex items-center gap-2 ${sceneSurfaceClasses.card} rounded-brand px-3 py-2 text-sm ${sceneSurfaceClasses.text}`}>
                  <input
                    type="checkbox"
                    checked={includeControls}
                    onChange={(event) => setIncludeControls(event.target.checked)}
                    className={`h-4 w-4 rounded-brand border-[var(--surface-border)] ${t.checkbox} ${sceneSurfaceClasses.focusRing}`}
                  />
                  加入阳性/阴性对照复孔
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${sceneSurfaceClasses.card} p-4`}>
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <PackageCheck className={`h-5 w-5 ${t.sectionIcon}`} />
                  <p className={`font-semibold ${sceneSurfaceClasses.text}`}>{ui.estimateTitle}</p>
                </div>
                <p className={`mt-1 text-sm ${sceneSurfaceClasses.mutedText}`}>{ui.estimateHint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {estimate.metrics.map((metric) => (
                  <div key={metric.label} className={`rounded-brand px-3 py-2 ${t.softBg}`}>
                    <p className={`text-xs ${t.softText}`}>{metric.label}</p>
                    <p className={`mt-1 text-sm font-semibold ${t.strongText}`}>{metric.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {procurementListBlock}
          </div>
        </div>
      )}
    </section>
  );
}
