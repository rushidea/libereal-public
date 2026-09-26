export type SceneHeroHighlight = {
  title: string;
  description: string;
  href?: string;
};

export type SceneUiCopy = {
  heroTitle?: string;
  heroHighlights: SceneHeroHighlight[];
  prep: {
    sectionBadge: string;
    planTitle: string;
    planHint: string;
    paramsTitle: string;
    conditionsTitle: string;
    conditionsHint: string;
    estimateTitle: string;
    estimateHint: string;
    estimateCountSuffix: string;
    copyListButton: string;
    copyListDone: string;
    listTitle: string;
  };
  difficulty: {
    sectionBadge: string;
    title: string;
    subtitle: string;
    progressPrefix: string;
    causesTitle: string;
    checksTitle: string;
    fixesTitle: string;
    adviceTitle: string;
    adviceLead: string;
    resourcesTitle: string;
  };
  resources: {
    sectionBadge: string;
    title: string;
    subtitle: string;
    tabProtocols?: string;
    tabSoftware?: string;
    tabSupport?: string;
    tabBrands?: string;
    brandLinkDescription?: string;
  };
  faqTitle: string;
  workflow?: {
    sectionBadge: string;
    title: string;
    subtitle: string;
    checksTitle: string;
    outputsTitle: string;
    productsTitle: string;
  };
  decisions?: {
    sectionBadge: string;
    title: string;
    subtitle: string;
    browseProducts: string;
    browseProductsHref: string;
    viewBundles: string;
  };
  calculatorGuide?: {
    sectionTitle: string;
    title: string;
    items: string[];
    toolTitle: string;
    toolSummary: string;
  };
};

const elisaUiCopy: SceneUiCopy = {
  heroTitle: 'ELISA 检测工作台',
  heroHighlights: [
    {
      title: '选试剂盒',
      description: '按指标、物种与样本类型筛选 ELISA 试剂盒，确定检测方案。',
      href: '#product-decisions',
    },
    {
      title: '算结果',
      description: '已有 OD 数据？用 4PL 标准曲线回算样本浓度。',
      href: '#elisa-calculator',
    },
    {
      title: '排查问题',
      description: '标准曲线、基质干扰或批次不一致，按场景自查。',
      href: '#difficulty',
    },
  ],
  prep: {
    sectionBadge: '实验材料准备助手',
    planTitle: '您的项目信息',
    planHint: '填写下列内容，我们会即时更新耗材与器材用量估算。',
    paramsTitle: '基础信息',
    conditionsTitle: '补充说明',
    conditionsHint: '用于更贴合您的情况；不确定时保持默认即可。',
    estimateTitle: '材料准备建议',
    estimateHint: '按当前参数生成的耗材与器材参考清单；有明确货号的项会标注参考产品，其余请至产品中心自行选型。',
    estimateCountSuffix: '项清单',
    copyListButton: '复制材料清单',
    copyListDone: '已复制到剪贴板',
    listTitle: '材料准备清单',
  },
  difficulty: {
    sectionBadge: '疑难协助',
    title: '检测遇到异常？',
    subtitle: '选择最接近的情况，查看常见原因与可参考的排查项；如需人工协助，欢迎随时联系我们。',
    progressPrefix: '已勾选',
    causesTitle: '常见原因',
    checksTitle: '可参考的核对项',
    fixesTitle: '调整建议',
    adviceTitle: '我们的建议',
    adviceLead:
      '您可对照左侧核对项自查；若仍无法定位，请保留样本类型、目标指标、关键操作条件或读板数据，我们便于进一步协助。',
    resourcesTitle: '相关产品与资料',
  },
  resources: {
    sectionBadge: '支持与下一步',
    title: '还需要查阅什么？',
    subtitle: '操作指南、免费开源工具与支持入口；选型、读数和材料清单请回到上方工作台模块。',
    tabProtocols: '操作指南',
    tabSoftware: '免费开源工具',
    tabSupport: '帮助',
    tabBrands: '品牌',
    brandLinkDescription: '查看 {brand} 的 ELISA 试剂盒与相关产品。',
  },
  faqTitle: '您可能关心',
  workflow: {
    sectionBadge: '检测流程',
    title: '从选型到复购怎么走？',
    subtitle: '按步骤核对关键项，查看每步产出、站内计算器与相关产品入口。',
    checksTitle: '核对项',
    outputsTitle: '本步产出',
    productsTitle: '相关产品/工具',
  },
  decisions: {
    sectionBadge: '选型决策',
    title: '买试剂盒前先确认什么？',
    subtitle: '对照下列决策点缩小范围，再至产品中心筛选或查看分级选购建议。',
    browseProducts: '浏览产品',
    browseProductsHref: '/products?cat=ELISA试剂盒',
    viewBundles: '查看选购组合',
  },
  calculatorGuide: {
    sectionTitle: '已有 OD 数据？4PL 标准曲线回算样本浓度',
    title: '工具说明',
    toolTitle: '标准曲线拟合与浓度回算',
    toolSummary: '录入标准品与样本 OD 后，自动完成 4PL 拟合并估算浓度，供您内部记录与核对。',
    items: [
      '标准品：填写各浓度点及 OD 复孔（建议 ≥4 点；多个复孔用逗号分隔）。',
      '样本：填写名称、OD 复孔与稀释倍数（未稀释可填 1）。',
      '拟合完成后可查看 R²、质控提示与回算浓度；超出曲线范围会有标注。',
      '支持上传 Excel/CSV，或在粘贴区按示例格式批量导入。',
    ],
  },
};

const westernBlotUiCopy: SceneUiCopy = {
  heroTitle: 'Western Blot 实验工作台',
  heroHighlights: [
    {
      title: '选抗体',
      description: '确认一抗验证信息、物种匹配与二抗搭配，缩小 WB 抗体范围。',
      href: '#product-decisions',
    },
    {
      title: '备材料',
      description: '按样本量与跑胶次数估算胶、膜、缓冲液等通用耗材用量。',
      href: '#prep-assistant',
    },
    {
      title: '排查问题',
      description: '条带弱、背景高或磷酸化信号不稳，按场景对照自查。',
      href: '#difficulty',
    },
  ],
  prep: {
    sectionBadge: '实验材料准备助手',
    planTitle: '您的项目信息',
    planHint: '填写样本量与跑胶参数，我们会即时更新耗材与器材用量估算。',
    paramsTitle: '基础信息',
    conditionsTitle: '实验条件',
    conditionsHint: '用于补充场景判断；不确定时保持默认即可。',
    estimateTitle: '通用材料估算',
    estimateHint: '以下为胶、膜、缓冲液等通用消耗与常备器材；一抗/二抗请至产品中心自行选购。',
    estimateCountSuffix: '项清单',
    copyListButton: '复制材料清单',
    copyListDone: '已复制到剪贴板',
    listTitle: '材料准备清单',
  },
  difficulty: {
    sectionBadge: '疑难协助',
    title: '结果不理想？',
    subtitle: '选择最接近的情况查看参考排查项；如需人工协助，欢迎随时联系我们。',
    progressPrefix: '已勾选',
    causesTitle: '常见原因',
    checksTitle: '可参考的核对项',
    fixesTitle: '调整建议',
    adviceTitle: '我们的建议',
    adviceLead:
      '对照核对项自查后若仍存疑，请保留目标蛋白、抗体信息、曝光图或关键操作条件，便于我们进一步协助。',
    resourcesTitle: '相关产品与资料',
  },
  resources: {
    sectionBadge: '支持与下一步',
    title: '还需要查阅什么？',
    subtitle: '操作指南、免费开源工具与支持入口；选型与材料清单请回到上方工作台模块。',
    tabProtocols: 'Protocol',
    tabSoftware: '免费开源工具',
    tabSupport: '帮助',
    tabBrands: '品牌',
    brandLinkDescription: '查看 {brand} 的 WB 抗体与相关产品。',
  },
  faqTitle: '常见问题',
  workflow: {
    sectionBadge: '实验流程',
    title: '从样本到显影怎么走？',
    subtitle: '按步骤核对关键项，查看每步产出、条带定量工具与相关产品入口。',
    checksTitle: '核对项',
    outputsTitle: '本步产出',
    productsTitle: '相关产品/工具',
  },
  decisions: {
    sectionBadge: '选型决策',
    title: '跑 WB 前先确认什么？',
    subtitle: '对照下列决策点缩小抗体与试剂范围，再至产品中心筛选或查看分级选购建议。',
    browseProducts: '浏览 WB 产品',
    browseProductsHref: '/products?sub=WB抗体',
    viewBundles: '查看选购组合',
  },
};

function createResearchSceneUiCopy({
  heroTitle,
  heroHighlights,
  prepPlanHint,
  estimateTitle,
  estimateHint,
  difficultyTitle,
  difficultyAdviceLead,
  resourcesSubtitle,
  workflowTitle,
  workflowSubtitle,
  decisionTitle,
  decisionSubtitle,
  browseProducts,
  browseProductsHref,
  brandLinkDescription,
}: {
  heroTitle: string;
  heroHighlights: SceneHeroHighlight[];
  prepPlanHint: string;
  estimateTitle: string;
  estimateHint: string;
  difficultyTitle: string;
  difficultyAdviceLead: string;
  resourcesSubtitle: string;
  workflowTitle: string;
  workflowSubtitle: string;
  decisionTitle: string;
  decisionSubtitle: string;
  browseProducts: string;
  browseProductsHref: string;
  brandLinkDescription: string;
}): SceneUiCopy {
  return {
    heroTitle,
    heroHighlights,
    prep: {
      sectionBadge: '实验材料准备助手',
      planTitle: '项目信息',
      planHint: prepPlanHint,
      paramsTitle: '基础信息',
      conditionsTitle: '实验条件',
      conditionsHint: '用于完善材料配置和质控判断；暂不确定时可保留默认设置。',
      estimateTitle,
      estimateHint,
      estimateCountSuffix: '项清单',
      copyListButton: '复制材料清单',
      copyListDone: '已复制到剪贴板',
      listTitle: '材料准备清单',
    },
    difficulty: {
      sectionBadge: '疑难协助',
      title: difficultyTitle,
      subtitle: '选择最接近的情况，查看常见原因、核对项和调整建议。',
      progressPrefix: '已勾选',
      causesTitle: '常见原因',
      checksTitle: '核对项',
      fixesTitle: '调整建议',
      adviceTitle: '处理建议',
      adviceLead: difficultyAdviceLead,
      resourcesTitle: '相关产品与资料',
    },
    resources: {
      sectionBadge: '支持与下一步',
      title: '相关指南与公共资源',
      subtitle: resourcesSubtitle,
      tabProtocols: '操作指南',
      tabSoftware: '免费开源工具',
      tabSupport: '帮助',
      tabBrands: '品牌',
      brandLinkDescription,
    },
    faqTitle: '常见问题',
    workflow: {
      sectionBadge: '实验流程',
      title: workflowTitle,
      subtitle: workflowSubtitle,
      checksTitle: '核对项',
      outputsTitle: '本步产出',
      productsTitle: '相关产品/工具',
    },
    decisions: {
      sectionBadge: '选型决策',
      title: decisionTitle,
      subtitle: decisionSubtitle,
      browseProducts,
      browseProductsHref,
      viewBundles: '查看选购组合',
    },
  };
}

const sceneUiCopies: Record<string, SceneUiCopy> = {
  elisa: elisaUiCopy,
  'elispot-fluorospot': createResearchSceneUiCopy({
    heroTitle: 'ELISpot / FluoroSpot 工作台',
    heroHighlights: [
      { title: '设计孔位', description: '规划样本、刺激物、阳性/阴性对照、复孔和细胞铺板密度。', href: '#workflow' },
      { title: '判断细胞功能', description: '计算 SFU、背景扣除、刺激指数和复孔一致性。', href: '#product-decisions' },
      { title: '衔接细胞分离', description: '用 untouched 分离或流式验证提高功能检测可信度。', href: '#support' },
    ],
    prepPlanHint: '填写样本数量、检测因子和刺激条件，用于整理 ELISpot 板、抗体对、刺激物和对照材料。',
    estimateTitle: 'ELISpot 材料准备',
    estimateHint: '以下为 ELISpot/FluoroSpot 板材、捕获/检测抗体、刺激物、细胞培养体系和对照相关清单。',
    difficultyTitle: 'ELISpot 背景或 spot 计数异常？',
    difficultyAdviceLead:
      '建议保留细胞来源、活率、每孔细胞数、刺激物、孔位布局、显色时间、原始图像和 spot 计数规则。',
    resourcesSubtitle: 'ELISpot 报告规范、免疫表位资源、细胞分离、流式验证和 ELISA 相关场景。',
    workflowTitle: '从细胞准备到 SFU 结果怎么走？',
    workflowSubtitle: '按步骤核对细胞状态、板材包被、刺激检测、spot 计数和质控结论。',
    decisionTitle: 'ELISpot 项目前先确认什么？',
    decisionSubtitle: '对照 ELISA、FluoroSpot、细胞分离、刺激物和孔位设计，确定检测路线。',
    browseProducts: '浏览 ELISpot 相关产品',
    browseProductsHref: '/products?keyword=ELISpot',
    brandLinkDescription: '查看 {brand} 的 ELISpot、抗体对、细胞培养和免疫检测相关产品。',
  }),
  'magnetic-cell-separation': createResearchSceneUiCopy({
    heroTitle: '免疫磁珠分选工作台',
    heroHighlights: [
      { title: '先定分离路线', description: '在正选、负选、depletion 和磁珠预富集后 FACS 之间做判断。', href: '#product-decisions' },
      { title: '保纯度与活率', description: '围绕样本解离、过滤、Fc Block、磁珠比例和温和洗涤控制结果。', href: '#workflow' },
      { title: '衔接下游实验', description: '分选后进入流式质控、FACS、单细胞、ELISpot 或功能实验。', href: '#support' },
    ],
    prepPlanHint: '填写样本数量、目标 marker 和下游用途，用于整理磁珠分选、缓冲液、过滤和流式验证材料。',
    estimateTitle: '磁珠分选材料准备',
    estimateHint: '以下为磁珠、分选缓冲液、Fc Block、过滤器、活率染料、死细胞去除和流式验证相关清单。',
    difficultyTitle: '磁珠分选纯度或回收率不理想？',
    difficultyAdviceLead:
      '建议保留分选前后流式比例、细胞数、活率、marker、磁珠用量、孵育时间和洗涤条件。',
    resourcesSubtitle: '细胞 marker 参考、公共细胞图谱、流式质控、单细胞建库和 ELISpot 功能检测入口。',
    workflowTitle: '从样本摸底到下游实验怎么走？',
    workflowSubtitle: '按步骤核对样本状态、分选策略、磁珠分离、纯度活率验证和下游衔接。',
    decisionTitle: '磁珠分选前先确认什么？',
    decisionSubtitle: '对照目标细胞丰度、功能保留、去除需求和是否需要后续 FACS，确定正选或负选路线。',
    browseProducts: '浏览样本制备产品',
    browseProductsHref: '/products?sub=样本制备',
    brandLinkDescription: '查看 {brand} 的磁珠分选、流式抗体、样本制备和细胞处理相关产品。',
  }),
  'single-cell-omics': createResearchSceneUiCopy({
    heroTitle: '单细胞组学工作台',
    heroHighlights: [
      { title: '控样本质量', description: '围绕活率、浓度、碎片和双细胞风险组织前处理。', href: '#workflow' },
      { title: '定富集策略', description: '按目标细胞群规划 FACS、磁珠富集、死活染和对照。', href: '#product-decisions' },
      { title: '查公共图谱', description: '结合公共数据门户和开源工具辅助细胞注释与质控。', href: '#support' },
    ],
    prepPlanHint: '填写样本数量、目标细胞群和检测类型，用于整理单细胞样本制备材料。',
    estimateTitle: '单细胞样本制备材料',
    estimateHint: '以下为组织解离、过滤、死细胞去除、活率检测、分选和样本质控相关清单。',
    difficultyTitle: '单细胞样本质量异常？',
    difficultyAdviceLead:
      '建议保留样本来源、离体时间、解离条件、活率、细胞浓度、分选门控和建库前质控记录，便于定位问题。',
    resourcesSubtitle: '单细胞样本制备指南、公共细胞图谱、免费开源分析工具和相关站内场景。',
    workflowTitle: '从样本到单细胞数据怎么走？',
    workflowSubtitle: '按步骤核对样本处理、悬液质控、分选富集和数据分析准备。',
    decisionTitle: '单细胞项目前先确认什么？',
    decisionSubtitle: '对照样本适配性、富集方式、标签策略和公共参考资源，形成可执行的前处理方案。',
    browseProducts: '浏览样本制备产品',
    browseProductsHref: '/products?sub=样本制备',
    brandLinkDescription: '查看 {brand} 的单细胞样本制备、流式抗体和细胞处理相关产品。',
  }),
  'spatial-biology': createResearchSceneUiCopy({
    heroTitle: '空间生物学工作台',
    heroHighlights: [
      { title: '评估切片质量', description: '按样本类型、切片状态和 RNA/抗原保留情况组织质控。', href: '#workflow' },
      { title: '规划空间检测', description: '结合空间转录组、多重 IF、原位检测和正交验证设计实验。', href: '#product-decisions' },
      { title: '组织图像分析', description: '使用 ROI、图像配准和空间组学工具管理结果解释。', href: '#support' },
    ],
    prepPlanHint: '填写样本类型、切片数量和检测目标，用于整理空间检测和成像相关材料。',
    estimateTitle: '空间检测材料准备',
    estimateHint: '以下为组织处理、切片、抗原修复、多重染色、RNase-free 耗材和成像分析相关清单。',
    difficultyTitle: '空间检测或图像分析异常？',
    difficultyAdviceLead:
      '建议保留样本保存方式、切片条件、预染图像、通道设置、ROI 标注和原始数据，便于后续排查。',
    resourcesSubtitle: '空间组学、组织成像、ROI 标注和免费开源图像分析工具。',
    workflowTitle: '从组织切片到空间数据怎么走？',
    workflowSubtitle: '按步骤核对样本质控、预染、空间检测和图像配准分析。',
    decisionTitle: '空间生物学项目前先确认什么？',
    decisionSubtitle: '对照样本类型、空间分辨率、检测方式和图像分析要求，确定实验路径。',
    browseProducts: '浏览成像相关产品',
    browseProductsHref: '/products?sub=IHC和成像试剂',
    brandLinkDescription: '查看 {brand} 的组织成像、IHC/IF 抗体和空间验证相关产品。',
  }),
  'organoid-3d-culture': createResearchSceneUiCopy({
    heroTitle: '类器官与 3D 细胞培养工作台',
    heroHighlights: [
      { title: '建立培养体系', description: '围绕细胞来源、ECM、培养基和生长因子配置模型。', href: '#workflow' },
      { title: '控制批次差异', description: '记录传代、基质批次、接种密度和质控指标。', href: '#difficulty' },
      { title: '设计读数方式', description: '结合活力检测、免疫荧光和图像分析评估模型状态。', href: '#support' },
    ],
    prepPlanHint: '填写模型类型、样本批次和检测目标，用于整理 3D 培养和读数材料。',
    estimateTitle: '3D 培养材料准备',
    estimateHint: '以下为 ECM、低吸附耗材、培养基、生长因子、活力检测和成像验证相关清单。',
    difficultyTitle: '类器官培养或读数不稳定？',
    difficultyAdviceLead:
      '建议保留细胞来源、passage、ECM 批号、培养基配方、接种密度、传代节奏和读数原始数据。',
    resourcesSubtitle: '3D 培养、图像定量、药筛读数和免费开源图像管理工具。',
    workflowTitle: '从模型建立到读数验证怎么走？',
    workflowSubtitle: '按步骤核对细胞来源、ECM、培养体系、质控和成像/药筛读数。',
    decisionTitle: '类器官项目前先确认什么？',
    decisionSubtitle: '对照模型来源、ECM 批次、培养体系、读数方式和验证路径，形成可复现方案。',
    browseProducts: '浏览细胞培养产品',
    browseProductsHref: '/products?sub=细胞培养试剂',
    brandLinkDescription: '查看 {brand} 的细胞培养、重组蛋白和细胞健康检测相关产品。',
  }),
  'crispr-gene-editing': createResearchSceneUiCopy({
    heroTitle: 'CRISPR 基因编辑工作台',
    heroHighlights: [
      { title: '设计 sgRNA', description: '结合靶点、PAM、脱靶风险和验证引物制定编辑方案。', href: '#workflow' },
      { title: '规划递送筛选', description: '按细胞类型选择质粒、病毒、RNP、转染或电转体系。', href: '#product-decisions' },
      { title: '验证编辑结果', description: '用测序、WB、qPCR、流式或 rescue 实验建立证据链。', href: '#support' },
    ],
    prepPlanHint: '填写细胞批次、靶标数量和编辑方式，用于整理 CRISPR 递送、筛选和验证材料。',
    estimateTitle: '基因编辑材料准备',
    estimateHint: '以下为 sgRNA、载体或 RNP、转染/电转、筛选、PCR 鉴定和功能验证相关清单。',
    difficultyTitle: '编辑效率或克隆筛选不顺利？',
    difficultyAdviceLead:
      '建议保留 sgRNA 序列、递送条件、筛选曲线、测序结果、克隆来源和功能验证原始记录。',
    resourcesSubtitle: 'sgRNA 设计、脱靶评估、编辑结果分析、分子克隆和站内验证资源。',
    workflowTitle: '从靶点设计到功能验证怎么走？',
    workflowSubtitle: '按步骤核对 sgRNA 设计、递送筛选、基因型鉴定和功能验证。',
    decisionTitle: 'CRISPR 项目前先确认什么？',
    decisionSubtitle: '对照编辑方式、递送体系、筛选策略、单克隆需求和验证层级，形成可执行方案。',
    browseProducts: '浏览分子克隆产品',
    browseProductsHref: '/products?sub=分子克隆试剂',
    brandLinkDescription: '查看 {brand} 的克隆、转染、PCR 和基因编辑验证相关产品。',
  }),
  'extracellular-vesicles': createResearchSceneUiCopy({
    heroTitle: '细胞外囊泡研究工作台',
    heroHighlights: [
      { title: '控制样本来源', description: '记录培养体系、体液来源、前处理、冻融和低吸附耗材。', href: '#workflow' },
      { title: '选择分离方式', description: '按纯度、回收率和下游用途选择超速、沉淀、SEC 或免疫捕获。', href: '#product-decisions' },
      { title: '完成规范表征', description: '结合粒径浓度、marker、形态和功能读数支撑结论。', href: '#support' },
    ],
    prepPlanHint: '填写样本来源、批次数量和下游用途，用于整理 EV 分离、表征和功能验证材料。',
    estimateTitle: 'EV 分离与表征材料',
    estimateHint: '以下为无外泌体培养体系、富集耗材、过滤、marker 验证、RNA/蛋白检测和功能实验相关清单。',
    difficultyTitle: 'EV 回收、纯度或功能读数异常？',
    difficultyAdviceLead:
      '建议保留样本来源、分离参数、粒径浓度、marker 结果、归一化方式和受体细胞状态记录。',
    resourcesSubtitle: 'EV 研究规范、公共数据库、WB/ELISA/流式验证和站内功能实验资源。',
    workflowTitle: '从样本前处理到 EV 表征怎么走？',
    workflowSubtitle: '按步骤核对样本来源、分离富集、marker 表征和功能验证。',
    decisionTitle: 'EV 项目前先确认什么？',
    decisionSubtitle: '对照样本类型、分离方法、纯度要求、归一化策略和下游检测方式。',
    browseProducts: '浏览细胞培养产品',
    browseProductsHref: '/products?sub=细胞培养试剂',
    brandLinkDescription: '查看 {brand} 的 EV、细胞培养、抗体和分子检测相关产品。',
  }),
  'proteomics-mass-spec': createResearchSceneUiCopy({
    heroTitle: '蛋白组学与质谱分析工作台',
    heroHighlights: [
      { title: '设计样本批次', description: '按分组、重复、随机化和 QC 样本控制批次效应。', href: '#workflow' },
      { title: '控制制备质量', description: '围绕裂解、定量、去污、酶解、脱盐和质控标准组织材料。', href: '#product-decisions' },
      { title: '连接公共数据', description: '使用 PRIDE、UniProt、MaxQuant、FragPipe 和 Skyline 支撑分析与验证。', href: '#support' },
    ],
    prepPlanHint: '填写样本批次、靶标数量和验证方式，用于整理蛋白提取、酶解、脱盐和验证材料。',
    estimateTitle: '蛋白组学材料准备',
    estimateHint: '以下为蛋白提取、定量、还原烷基化、酶解、肽段脱盐、质控和候选验证相关清单。',
    difficultyTitle: '质谱数据或候选验证不理想？',
    difficultyAdviceLead:
      '建议保留样本分组、裂解体系、酶解条件、数据库版本、搜索参数、定量矩阵和候选验证记录。',
    resourcesSubtitle: '蛋白组公共数据库、质谱分析软件、靶向验证工具和站内 WB/ELISA 验证资源。',
    workflowTitle: '从蛋白样本到候选验证怎么走？',
    workflowSubtitle: '按步骤核对样本设计、蛋白制备、数据分析和候选蛋白验证。',
    decisionTitle: '蛋白组学项目前先确认什么？',
    decisionSubtitle: '对照定量策略、修饰富集、批次设计、公共数据归档和后续验证路径。',
    browseProducts: '浏览蛋白检测产品',
    browseProductsHref: '/products?sub=WB辅助试剂',
    brandLinkDescription: '查看 {brand} 的蛋白提取、定量、抗体验证和 ELISA 相关产品。',
  }),
  'small-animal-imaging': createResearchSceneUiCopy({
    heroTitle: '小动物实验与成像工作台',
    heroHighlights: [
      { title: '确定成像路线', description: '在生物发光、荧光、PET/SPECT、Micro-CT、MRI、超声和光声之间做选择。', href: '#product-decisions' },
      { title: '整理动物准备', description: '围绕麻醉、保温、给药、固定、生理监测和伦理记录准备材料。', href: '#prep-assistant' },
      { title: '形成可比数据', description: '统一时间点、ROI、曝光或扫描参数，保留原始图像和定量表。', href: '#workflow' },
    ],
    prepPlanHint: '填写动物数量、每批成像数量和检测通道/探针数量，用于整理麻醉、给药、固定、成像探针和通用耗材。',
    estimateTitle: '小动物成像材料准备',
    estimateHint: '以下为活体成像底物、荧光/放射性/MRI/CT 造影材料、麻醉监测、给药固定和动物实验通用耗材清单。',
    difficultyTitle: '成像信号或动物状态异常？',
    difficultyAdviceLead:
      '建议保留动物品系、体重、模型类型、给药剂量、采集时间点、麻醉参数、体温记录、原始图像和 ROI 规则。',
    resourcesSubtitle: '小动物成像方法、开源图像分析工具、动物实验记录和站内相关场景。',
    workflowTitle: '从动物模型到成像定量怎么走？',
    workflowSubtitle: '按步骤核对实验设计、动物准备、探针给药、图像采集和定量分析。',
    decisionTitle: '小动物成像项目前先确认什么？',
    decisionSubtitle: '对照研究问题、成像深度、灵敏度、定量需求、动物负担和设备可用性，确定成像方式。',
    browseProducts: '浏览小动物实验相关产品',
    browseProductsHref: '/products?keyword=animal%20imaging',
    brandLinkDescription: '查看 {brand} 的小动物成像、麻醉、行为学、给药和手术相关产品。',
  }),
  'molecular-biology': {
    heroTitle: '分子生物学工作台',
    heroHighlights: [
      {
        title: '定方案',
        description: '按 DNA/RNA、PCR/qPCR、克隆或转染目标确认实验路线。',
        href: '#workflow',
      },
      {
        title: '备材料',
        description: '按样本量、反应批次和靶标数量估算试剂与耗材。',
        href: '#prep-assistant',
      },
      {
        title: '排查扩增',
        description: '无条带、Ct 异常、克隆或转染效率低，按症状逐项核对。',
        href: '#difficulty',
      },
    ],
    prep: {
      sectionBadge: '实验材料准备助手',
      planTitle: '您的项目信息',
      planHint: '填写样本量、反应批次与靶标数量，我们会即时更新核酸实验材料建议。',
      paramsTitle: '基础信息',
      conditionsTitle: '实验条件',
      conditionsHint: '用于判断提取、扩增、反转录、克隆和污染控制需求；不确定时保持默认即可。',
      estimateTitle: '分子实验材料估算',
      estimateHint: '以下为核酸提取、PCR/qPCR、反转录、电泳、纯化、克隆和常用耗材清单。',
      estimateCountSuffix: '项清单',
      copyListButton: '复制材料清单',
      copyListDone: '已复制到剪贴板',
      listTitle: '材料准备清单',
    },
    difficulty: {
      sectionBadge: '疑难协助',
      title: '扩增或构建不顺利？',
      subtitle: '选择最接近的情况查看参考排查项；如需人工协助，建议保留模板、引物、体系和电泳/qPCR 数据。',
      progressPrefix: '已勾选',
      causesTitle: '常见原因',
      checksTitle: '可参考的核对项',
      fixesTitle: '调整建议',
      adviceTitle: '我们的建议',
      adviceLead:
        '对照核对项自查后若仍存疑，请保留样本类型、模板质量、引物序列、酶体系、循环条件和代表性结果，便于进一步协助。',
      resourcesTitle: '相关产品与资料',
    },
    resources: {
      sectionBadge: '支持与下一步',
      title: '还需要查阅什么？',
      subtitle: 'PCR/qPCR、克隆、转染指南、免费开源工具与公共数据库；选型与材料清单请回到上方工作台模块。',
      tabProtocols: '操作指南',
      tabSoftware: '免费开源工具',
      tabSupport: '帮助',
      tabBrands: '品牌',
      brandLinkDescription: '查看 {brand} 的分子生物学试剂、酶和耗材。',
    },
    faqTitle: '常见问题',
    workflow: {
      sectionBadge: '实验流程',
      title: '从核酸到验证怎么走？',
      subtitle: '按步骤核对关键项，查看每步产出与相关产品入口。',
      checksTitle: '核对项',
      outputsTitle: '本步产出',
      productsTitle: '相关产品/工具',
    },
    decisions: {
      sectionBadge: '选型决策',
      title: '做分子实验前先确认什么？',
      subtitle: '对照下列决策点缩小提取、扩增、反转录、克隆和耗材范围，再至产品中心筛选或查看分级选购建议。',
      browseProducts: '浏览分子产品',
      browseProductsHref: '/products?cat=分子生物学',
      viewBundles: '查看选购组合',
    },
  },
  'flow-cytometry': {
    heroTitle: '流式细胞术工作台',
    heroHighlights: [
      {
        title: '设计 panel',
        description: '按 marker、克隆号、荧光素和仪器通道搭配流式抗体。',
        href: '#product-decisions',
      },
      {
        title: '查光谱',
        description: '对照仪器激光和滤光片，查看染料光谱与通道兼容性。',
        href: '#spectrum-viewer',
      },
      {
        title: '备样本',
        description: '按样本数、marker 数和上机批次整理染色与对照材料。',
        href: '#prep-assistant',
      },
      {
        title: '排查上机',
        description: '信号弱、背景高或补偿异常，按症状逐项核对。',
        href: '#difficulty',
      },
    ],
    prep: {
      sectionBadge: '实验材料准备助手',
      planTitle: '您的项目信息',
      planHint: '填写样本量与 panel 信息，我们会即时更新流式染色与对照材料建议。',
      paramsTitle: '基础信息',
      conditionsTitle: '实验条件',
      conditionsHint: '用于判断样本制备、死活染、补偿、胞内染色和分选需求；不确定时保持默认即可。',
      estimateTitle: '流式材料估算',
      estimateHint: '以下为流式抗体、死活染、FACS Buffer、流式管、滤网、补偿/FMO 和样本制备相关清单。',
      estimateCountSuffix: '项清单',
      copyListButton: '复制材料清单',
      copyListDone: '已复制到剪贴板',
      listTitle: '材料准备清单',
    },
    difficulty: {
      sectionBadge: '疑难协助',
      title: '流式结果不理想？',
      subtitle: '选择最接近的情况查看参考排查项；如需人工协助，建议保留 panel、补偿和 FCS 信息。',
      progressPrefix: '已勾选',
      causesTitle: '常见原因',
      checksTitle: '可参考的核对项',
      fixesTitle: '调整建议',
      adviceTitle: '我们的建议',
      adviceLead:
        '对照核对项自查后若仍存疑，请保留样本类型、抗体克隆号、荧光素、仪器通道、补偿设置和代表性 FCS/门控图，便于进一步协助。',
      resourcesTitle: '相关产品与资料',
    },
    resources: {
      sectionBadge: '支持与下一步',
      title: '还需要查阅什么？',
      subtitle: '流式指南、免费开源工具与支持入口；选型与材料清单请回到上方工作台模块。',
      tabProtocols: '操作指南',
      tabSoftware: '免费开源工具',
      tabSupport: '帮助',
      tabBrands: '品牌',
      brandLinkDescription: '查看 {brand} 的流式抗体、试剂与样本制备产品。',
    },
    faqTitle: '常见问题',
    workflow: {
      sectionBadge: '实验流程',
      title: '从样本到 FCS 数据怎么走？',
      subtitle: '按步骤核对关键项，查看每步产出、站内工具与免费开源分析软件。',
      checksTitle: '核对项',
      outputsTitle: '本步产出',
      productsTitle: '相关产品/工具',
    },
    decisions: {
      sectionBadge: '选型决策',
      title: '做流式前先确认什么？',
      subtitle: '对照下列决策点缩小抗体、荧光素、对照和样本制备试剂范围，再至产品中心筛选或查看分级选购建议。',
      browseProducts: '浏览流式产品',
      browseProductsHref: '/products?sub=流式抗体',
      viewBundles: '查看选购组合',
    },
  },
  immunofluorescence: {
    heroTitle: '免疫荧光染色工作台',
    heroHighlights: [
      {
        title: '选抗体',
        description: '确认 IF 应用、一抗宿主和荧光二抗通道，避免串色与宿主冲突。',
        href: '#product-decisions',
      },
      {
        title: '配通道',
        description: '按样本类型、靶标数量、DAPI 和封片方式整理染色材料。',
        href: '#prep-assistant',
      },
      {
        title: '排查成像',
        description: '弱信号、自发荧光、串色或淬灭，按症状逐项核对。',
        href: '#difficulty',
      },
    ],
    prep: {
      sectionBadge: '实验材料准备助手',
      planTitle: '您的项目信息',
      planHint: '填写样本量与荧光通道，我们会即时更新染色试剂与耗材建议。',
      paramsTitle: '基础信息',
      conditionsTitle: '实验条件',
      conditionsHint: '用于判断固定、通透、封闭、二抗通道和封片方式；不确定时保持默认即可。',
      estimateTitle: '荧光染色材料估算',
      estimateHint: '以下为一抗、荧光二抗、DAPI、封闭/通透、抗淬灭封片和成像相关清单。',
      estimateCountSuffix: '项清单',
      copyListButton: '复制材料清单',
      copyListDone: '已复制到剪贴板',
      listTitle: '材料准备清单',
    },
    difficulty: {
      sectionBadge: '疑难协助',
      title: '荧光图像不理想？',
      subtitle: '选择最接近的情况查看参考排查项；如需人工协助，建议保留通道设置、曝光参数和原始图。',
      progressPrefix: '已勾选',
      causesTitle: '常见原因',
      checksTitle: '可参考的核对项',
      fixesTitle: '调整建议',
      adviceTitle: '我们的建议',
      adviceLead:
        '对照核对项自查后若仍存疑，请保留样本类型、抗体货号、固定/通透条件、二抗荧光通道和原始图像，便于进一步协助。',
      resourcesTitle: '相关产品与资料',
    },
    resources: {
      sectionBadge: '支持与下一步',
      title: '还需要查阅什么？',
      subtitle: '免疫荧光指南、免费开源图像工具与支持入口；选型与材料清单请回到上方工作台模块。',
      tabProtocols: '操作指南',
      tabSoftware: '免费开源工具',
      tabSupport: '帮助',
      tabBrands: '品牌',
      brandLinkDescription: '查看 {brand} 的 IF 抗体、荧光二抗与成像相关产品。',
    },
    faqTitle: '常见问题',
    workflow: {
      sectionBadge: '染色流程',
      title: '从样本到荧光图像怎么走？',
      subtitle: '按步骤核对关键项，查看每步产出、站内光谱工具与免费开源图像分析工具。',
      checksTitle: '核对项',
      outputsTitle: '本步产出',
      productsTitle: '相关产品/工具',
    },
    decisions: {
      sectionBadge: '选型决策',
      title: '做免疫荧光前先确认什么？',
      subtitle: '对照下列决策点缩小一抗、荧光二抗、染料和封片体系范围，再至产品中心筛选或查看分级选购建议。',
      browseProducts: '浏览 IF 产品',
      browseProductsHref: '/products?sub=荧光偶联二抗',
      viewBundles: '查看选购组合',
    },
  },
  ihc: {
    heroTitle: 'IHC 免疫组化工作台',
    heroHighlights: [
      {
        title: '选抗体',
        description: '按 IHC 应用、样本类型、物种和阳性组织缩小抗体范围。',
        href: '#product-decisions',
      },
      {
        title: '定条件',
        description: '梳理切片、修复、封闭、显色和封片所需材料。',
        href: '#prep-assistant',
      },
      {
        title: '排查染色',
        description: '弱信号、背景高或脱片显色不均，按症状对照处理。',
        href: '#difficulty',
      },
    ],
    prep: {
      sectionBadge: '实验材料准备助手',
      planTitle: '您的项目信息',
      planHint: '填写切片量与靶标数量，我们会即时更新染色耗材与试剂建议。',
      paramsTitle: '基础信息',
      conditionsTitle: '实验条件',
      conditionsHint: '用于判断修复、检测系统和背景控制；不确定时保持默认即可。',
      estimateTitle: '染色材料估算',
      estimateHint: '以下为切片、修复、封闭、检测、显色和封片相关清单；一抗请按靶点自行选型。',
      estimateCountSuffix: '项清单',
      copyListButton: '复制材料清单',
      copyListDone: '已复制到剪贴板',
      listTitle: '材料准备清单',
    },
    difficulty: {
      sectionBadge: '疑难协助',
      title: '染色结果不理想？',
      subtitle: '选择最接近的情况查看参考排查项；如需人工协助，建议保留切片类型、抗体信息和染色图片。',
      progressPrefix: '已勾选',
      causesTitle: '常见原因',
      checksTitle: '可参考的核对项',
      fixesTitle: '调整建议',
      adviceTitle: '我们的建议',
      adviceLead:
        '对照核对项自查后若仍存疑，请保留样本固定方式、抗体货号、修复条件、显色时间和代表性图片，便于进一步协助。',
      resourcesTitle: '相关产品与资料',
    },
    resources: {
      sectionBadge: '支持与下一步',
      title: '还需要查阅什么？',
      subtitle: 'IHC 指南、免费开源图像工具与支持入口；选型与材料清单请回到上方工作台模块。',
      tabProtocols: '操作指南',
      tabSoftware: '免费开源工具',
      tabSupport: '帮助',
      tabBrands: '品牌',
      brandLinkDescription: '查看 {brand} 的 IHC 抗体与成像相关产品。',
    },
    faqTitle: '常见问题',
    workflow: {
      sectionBadge: '染色流程',
      title: '从切片到成像怎么走？',
      subtitle: '按步骤核对关键项，查看每步产出、定量记录与免费开源图像分析工具。',
      checksTitle: '核对项',
      outputsTitle: '本步产出',
      productsTitle: '相关产品/工具',
    },
    decisions: {
      sectionBadge: '选型决策',
      title: '做 IHC 前先确认什么？',
      subtitle: '对照下列决策点缩小抗体、修复液和检测系统范围，再至产品中心筛选或查看分级选购建议。',
      browseProducts: '浏览 IHC 产品',
      browseProductsHref: '/products?sub=IHC和成像抗体',
      viewBundles: '查看选购组合',
    },
  },
  'western-blot': westernBlotUiCopy,
};

export function getSceneUiCopy(slug: string): SceneUiCopy {
  return sceneUiCopies[slug] ?? westernBlotUiCopy;
}
