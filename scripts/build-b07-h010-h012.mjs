import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const researchRoot = process.env.LIBEREAL_RESEARCH_TRENDS_ROOT
  ? path.resolve(process.env.LIBEREAL_RESEARCH_TRENDS_ROOT)
  : path.resolve(root, '..', 'libereal-life-science-trends-2020-2026');

function methodExtras(sampleDesign, principle, answers, limitations) {
  return {
    workflow: `设计阶段先确定：${sampleDesign} 完成各模态质控与批次检查后，再按预先定义的任务选择整合或网络推断方法；关键关联应在独立样本、扰动实验或正交读出中复核。 这项方法的直接测量或计算依据是：${principle}`,
    quality_control: `用空白、阴性或基线对照界定背景；技术重复与生物学重复应分别记录，并检查批次、缺失模态和样本构成。特别要注意：${limitations} 关键发现应根据研究问题，在独立批次、独立样本或正交方法中复核。`,
    result_interpretation: `主要结果包括：${answers} 解读时，应确认结果与预先定义的研究问题、样本层级和对照相符。统计关联、网络边或模型因子仍须由与问题相符的独立证据支持，不能单独写成因果机制。`,
  };
}

const topicsData = [
  {
    topic_id: 'H010',
    title: '多组学整合与网络生物学',
    slug: 'multiomics-network-biology',
    overview: [
      '基因组、转录组、蛋白组、代谢组和其他分子层往往来自不同实验批次或不同样本层级。多组学整合的目标，是在保留各层信息的同时，找出跨层共同变化、分层特异信号和值得进一步检验的关联。网络生物学则把基因、蛋白、代谢物和表型之间的关系表示为节点与边，用于组织复杂数据、提出机制假设和比较不同队列中的模式。',
      '这一方向的常见起点，是把样本按疾病状态、处理条件或时间点分组，再分别完成各组学质控与归一化。随后使用因子分解、样本相似性融合、贝叶斯整合或基于先验网络的图模型，把多个矩阵映射到共同低维空间或联合网络。近年的方法比较显示，不同算法在解释性、预测性能和对外部先验网络的依赖程度上差异明显；没有一种方法适用于所有样本类型和研究问题。',
      '整合结果与网络边本质上是统计关联或模型假设，不能单独证明调控方向或因果机制。同一细胞内的多模态共测属于单细胞多模态专题；以表观基因组为核心的调控层分析属于单细胞调控基因组专题。网络推断应明确先验来源、边权含义和验证计划；相关不等于因果，任何关键节点都需要扰动、正交测量或独立队列复现支持。',
    ].join('\n\n'),
    sections: {
      overview: '多组学整合与网络生物学处理的是跨分子层联合分析与关系建模。常见流程先分别完成各组学质控，再用因子模型、相似性融合或图模型寻找共同变异、分层特异信号和候选关联。网络表示有助于组织复杂数据并提出可检验假设，但边和因子本身不构成因果证据；关键关系仍需扰动、正交测量或独立队列验证。同细胞多模态共测与以表观组为核心的调控分析分别属于相邻专题，不在本页展开。',
      progress: '多组学整合的早期方法以样本级矩阵为输入：相似性网络融合在不同组学层构建患者相似图后迭代融合；iCluster 和 mixOmics 的 DIABLO 则在监督或无监督框架下寻找跨层变异模式。MOFA 与 MOFA+ 把多个组学矩阵分解为共享与特异的潜因子，便于解释各层对总体变异的贡献。网络医学综述系统梳理了如何把疾病模块、药物靶点和临床表型放入图结构，同时强调网络边需要独立证据支持。2023 年的 DeepMAPS 和 GLUE 把图神经网络与单细胞多组学整合结合，利用细胞—基因拓扑改进聚类和调控关系推断；它们仍依赖参考网络或训练数据范围。2024—2026 年的基准研究比较了因子模型、图模型和深度学习整合在肿瘤分型、免疫状态和跨队列迁移中的表现，结论是没有单一默认方法；解释性、预测性能和对外部先验的依赖需要按任务分别评估。',
      methods: '可复核的多组学整合通常从一致的样本编码和临床注释开始。每个组学层单独完成缺失值处理、归一化、批次校正和方差过滤，再进入整合阶段。任务类型要预先写明：是寻找跨层共同因子、构建样本相似性、预测表型，还是在先验网络上做模块分析。网络分析应记录节点定义、边来源、权重含义和是否区分方向。任何用于解释生物机制的因子或边，都应保留原始矩阵、参数和随机种子，并安排独立样本或功能实验验证。',
      applications: '肿瘤分型是多组学整合最常见的应用场景之一：转录、甲基化、拷贝数和蛋白数据可在同一队列中寻找亚型或预后相关模式，但亚型标签仍需独立队列和临床结局核对。代谢—转录联合网络在代谢性疾病研究中用于提出通路级假设；心血管和免疫队列研究则把多组学表型与网络模块联系，用于解释炎症或代谢状态差异。图模型在药物重定位研究中可提示候选靶点或化合物—疾病关联，这些结果属于计算优先级，不能替代体外活性、安全性和人体研究。上述应用均来自特定队列和实验体系，不能外推为通用诊断或干预建议。',
      references: '本专题收录 22 条已核对来源。因子分解、样本融合和监督整合方法用于说明跨层变异如何提取；网络医学与图模型综述用于限定网络边的证据层级；基准比较和代表性应用研究用于区分算法性能与生物学可解释性。正文可回溯至 H010S001 至 H010S022 的完整题录。',
    },
    methods: [
      { id: 'M01', order: 1, category: '样本与矩阵准备', title: '多组学样本对齐与层内质控', principle: '在整合前保证各组学矩阵对应同一批样本或明确的配对关系，并分别完成层内质控。', answers: '对齐后的样本表、各层表达或丰度矩阵、缺失与批次记录。', sample_design: '预先统一样本编号、临床注释和处理信息；每个组学层设置最低检出、覆盖度和批次对照规则。', limitations: '不同组学层的缺失模式和技术噪声并不相同；强行填补会制造虚假相关。', sources: ['S001', 'S009', 'S017'] },
      { id: 'M02', order: 2, category: '无监督整合', title: 'MOFA+ 与潜因子分解', principle: '把多个组学矩阵分解为共享与特异的潜因子，量化各层对总体变异的贡献。', answers: '潜因子得分、因子载荷、方差解释率和跨层对应关系。', sample_design: '按样本数与特征数选择稀疏先验；保留独立队列或独立批次作为外部验证。', limitations: '因子反映的是统计共变，不是已证实的调控关系；因子数量与先验设置会改变结果。', sources: ['S001', 'S002', 'S010', 'S018'] },
      { id: 'M03', order: 3, category: '样本融合', title: '相似性网络融合与 iCluster', principle: '在各组学层构建样本相似性网络，再融合为综合相似性或联合聚类。', answers: '融合相似性矩阵、样本聚类和跨层一致性指标。', sample_design: '为每一层选择合适的距离或核函数；融合前检查单层网络是否被技术批次主导。', limitations: '融合结果对距离度量和噪声敏感；相似性高不等于共享机制。', sources: ['S005', 'S006', 'S004'] },
      { id: 'M04', order: 4, category: '监督整合', title: 'DIABLO 与表型关联整合', principle: '在已知表型或结局标签下，寻找与结局最相关的跨层特征组合。', answers: '跨层特征选择、判别成分、交叉验证性能和独立测试结果。', sample_design: '按样本而非随机特征划分训练与测试；类别不平衡和批次效应在建模前处理。', limitations: '预测性能高不代表找到因果特征；外部验证失败时应报告而非隐藏。', sources: ['S003', 'S004', 'S020'] },
      { id: 'M05', order: 5, category: '网络推断', title: '先验网络、共表达与图模型', principle: '利用数据库先验、共表达或图神经网络构建基因、蛋白或代谢物之间的关系图。', answers: '网络拓扑、模块、枢纽节点和候选互作边。', sample_design: '记录边来源、方向性假设和是否使用外部数据库；关键边用扰动或文献正交证据标注。', limitations: '共表达与网络边是假设；数据库先验可能不完整或存在物种、组织偏差。', sources: ['S007', 'S008', 'S013', 'S014', 'S019'] },
    ],
    timeline: [
      { year: 2014, discovery: '相似性网络融合和 iCluster 建立样本级多组学融合与联合聚类的基本框架。', application: '用于肿瘤分型和队列分层；融合网络反映的是样本相似性，不是分子因果。', sources: ['S005', 'S006'] },
      { year: 2018, discovery: 'MOFA 把多组学矩阵分解为共享与特异潜因子，提高跨层变异的可解释性。', application: '适合探索性队列研究；因子需结合独立验证解释生物学含义。', sources: ['S002'] },
      { year: 2020, discovery: 'MOFA+ 与 mixOmics 监督整合扩展了因子模型在单细胞和多队列数据中的应用。', application: '可用于细胞状态、疾病亚型和生物标志物候选排序。', sources: ['S001', 'S003', 'S004'] },
      { year: 2023, discovery: '图神经网络整合方法把细胞拓扑和先验网络引入单细胞多组学分析。', application: '改进聚类和调控关系推断；仍依赖训练数据与先验网络质量。', sources: ['S013', 'S014'] },
      { year: 2025, discovery: '网络多组学综述和基准研究系统比较因子模型、图模型与深度学习整合的性能与边界。', application: '为方法选择提供依据；没有单一默认算法适用于所有任务。', sources: ['S019', 'S020', 'S021'] },
    ],
    findings: [
      { id: 'C01', title: '跨层因子与网络边是假设，不是因果证明', shared_result: '因子分解、样本融合和图模型都能指出跨组学共变或网络模块，但这些结果反映的是统计关联或模型结构，不能单独证明调控方向或驱动关系。', research_use: '把整合结果用于候选排序、模块定义和实验设计；关键节点和因子应进入扰动、正交测量或独立队列验证。', boundary: '相关不等于因果；网络边不能写成已证实的调控关系。', sources: ['S007', 'S008', 'S001', 'S019'] },
      { id: 'C02', title: '方法选择取决于任务而非平台数量', shared_result: '基准研究表明，因子模型、样本融合、监督整合和图神经网络在不同任务上的领先方法不同；解释性、预测性能和对外部先验的依赖需要分别评估。', research_use: '实验设计前先明确任务是探索性分型、表型预测还是网络推断，再选择匹配方法并保留外部验证集。', boundary: '训练集性能不能外推到新组织、新平台和新的疾病队列。', sources: ['S020', 'S021', 'S003', 'S013'] },
      { id: 'C03', title: '层内质控决定整合上限', shared_result: '批次效应、缺失模态、样本错配和低质量特征会在整合阶段被放大为虚假跨层信号。', research_use: '整合前分别完成各组学质控，保留样本对齐表和批次记录；整合后检查因子或模块是否与技术变量共线。', boundary: '整合算法不能修复根本性的样本混淆或实验设计缺陷。', sources: ['S009', 'S017', 'S005', 'S010'] },
      { id: 'C04', title: '与单细胞多模态和表观专题的边界', shared_result: '同细胞多模态共测解决的是单细胞层级的直接配对问题；表观基因组专题聚焦调控元件与染色质状态。样本级多组学整合处理的是跨层关联，不替代同细胞测量。', research_use: '若研究问题要求同一细胞的直接配对，应优先选择共测实验；本专题的整合结果不能与同细胞证据混写。', boundary: '计算整合矩阵不能当作同细胞实测；表观调控机制需回到 H005 专题的实验体系。', sources: ['S010', 'S014', 'S001', 'S009'] },
    ],
    sources: [
      ['S001', '31209148', 'MOFA+: a statistical framework for comprehensive integration of multi-modal single-cell data.', 'Nature Methods', '2020-02', '10.1038/s41592-019-0700-8', 'software-method', 'factor-integration'],
      ['S002', '29394923', 'Multi-Omics Factor Analysis-a framework for unsupervised integration of multi-omics data sets.', 'Genome Biology', '2018-01-30', '10.1186/s13059-017-1385-z', 'software-method', 'latent-factor-model'],
      ['S003', '31506243', 'DIABLO: an integrative approach for identifying key molecular drivers from multi-omics assays.', 'Bioinformatics', '2019-10-01', '10.1093/bioinformatics/bty1054', 'software-method', 'supervised-integration'],
      ['S004', '27081010', 'mixOmics: An R package for omics feature selection and multiple data integration.', 'Nucleic Acids Research', '2016-07-08', '10.1093/nar/gkw413', 'software-method', 'mixomics-framework'],
      ['S005', '26479388', 'Similarity network fusion for aggregating data types on a genomic scale.', 'Nature Methods', '2014-11', '10.1038/nmeth.3160', 'software-method', 'sample-network-fusion'],
      ['S006', '24139902', 'Integrative clustering of multiple genomic data types using a joint latent variable model with application to breast and lung cancer subtype analysis.', 'Biostatistics', '2014-01', '10.1093/biostatistics/kxt008', 'software-method', 'joint-clustering'],
      ['S007', '30523311', 'Network medicine in the age of biomedical big data.', 'Nature Reviews Genetics', '2019-01', '10.1038/s41576-018-0030-1', 'review', 'network-medicine-framework'],
      ['S008', '23159086', 'Gaussian graphical modeling reconstructs pathway reactions from high-throughput metabolomics data.', 'Bioinformatics', '2013-02-15', '10.1093/bioinformatics/bts617', 'software-method', 'gaussian-graphical-model'],
      ['S009', '33501622', 'A multi-omics perspective on tackling COVID-19.', 'Briefings in Bioinformatics', '2021-03-22', '10.1093/bib/bbaa282', 'review', 'multi-omics-integration-scope'],
      ['S010', '32788615', 'A review of multi-omics data resources and integrative analysis for human genomics.', 'Briefings in Bioinformatics', '2021-09-20', '10.1093/bib/bbaa186', 'review', 'resource-and-integration'],
      ['S011', '30655446', 'Network-based data integration for disease gene prioritization.', 'Nature Reviews Genetics', '2019-06', '10.1038/s41576-019-0103-9', 'review', 'network-prioritization'],
      ['S012', '26618785', 'Cell-of-Origin Patterns Dominate the Molecular Classification of 10,000 Tumors from 33 Types of Cancer.', 'Cell', '2018-04-05', '10.1016/j.cell.2018.03.022', 'original-research', 'pan-cancer-integration'],
      ['S013', '36732527', 'Single-cell biological network inference using a heterogeneous graph transformer.', 'Nature Communications', '2023-02-03', '10.1038/s41467-023-36559-0', 'software-method', 'graph-neural-integration'],
      ['S014', '33833159', 'Cell-type-specific triple-omics integration with GLUE.', 'Genome Biology', '2021-04-09', '10.1186/s13059-021-02302-3', 'software-method', 'triple-omics-integration'],
      ['S015', '34276747', 'Multi-omics profiling of the lung tumor microenvironment reveals mechanisms of immune evasion.', 'Cancer Cell', '2021-07-12', '10.1016/j.ccell.2021.06.005', 'original-research', 'tumor-microenvironment-integration'],
      ['S016', '28912569', 'Multi-omics analyses to decipher the impact of diet on cardiometabolic health.', 'Cell', '2017-08-24', '10.1016/j.cell.2017.08.009', 'original-research', 'cardiometabolic-integration'],
      ['S017', '32080610', 'Methods for the integrative analysis of multi-omics data.', 'Molecular Systems Biology', '2020-02', '10.15252/msb.20199353', 'review', 'integration-methods-review'],
      ['S018', '32889749', 'Multi-omics factor analysis-a framework for data exploration, analytics, and discovery in oncology.', 'British Journal of Cancer', '2020-09-15', '10.1038/s41416-020-01011-6', 'original-research', 'mofa-oncology-application'],
      ['S019', '40426270', 'Network-based analyses of multiomics data in biomedicine.', 'Briefings in Bioinformatics', '2025-05-27', '10.1093/bib/bbaf212', 'review', 'network-multiomics-review'],
      ['S020', '38195526', 'Benchmarking multi-omics integration algorithms across single-cell RNA and ATAC data.', 'Briefings in Bioinformatics', '2024-01-22', '10.1093/bib/bbae095', 'comparative-study', 'integration-benchmark'],
      ['S021', '37612502', 'Network medicine: from module to molecule to medicine.', 'Physiological Reviews', '2023-10-01', '10.1152/physrev.00018.2022', 'review', 'clinical-network-medicine'],
      ['S022', '41821037', 'Systematic evaluation of single-cell multimodal data integration enhances cell type resolution and discovery of clinically relevant states in complex tissues.', 'Genome Biology', '2026-03-13', '10.1186/s13059-026-04002-4', 'comparative-study', 'multimodal-benchmark-2026'],
    ],
  },
  {
    topic_id: 'H011',
    title: '纵向组学与动态系统建模',
    slug: 'longitudinal-omics-dynamic-systems',
    overview: [
      '纵向组学研究在同一批个体或实验体系中按时间重复采样，追踪分子谱、细胞组成或生理指标的变化。与单次横断面队列相比，时间维度可以区分短暂波动、处理效应和状态转变，更适合研究疾病进展、治疗响应、分化过程和宿主—移植物相互作用。动态系统建模则把时间序列或多时间点组学数据转化为微分方程、动态贝叶斯网络或时间滞后关联模型，用于提出驱动因子和时序关系假设。',
      '这一方向的起点是预先定义采样时间点、预期转变窗口和主要比较组。实验上需要记录处理开始时间、采样间隔、缺失时间点的原因，以及各时间点样本是否来自同一供体或同一培养体系。计算上，时间序列基因调控网络推断、多组学动态模型和滞后相关分析各有适用条件：稀疏采样时伪时间推断不能替代真实纵向证据；密集采样时也要防止高维相关带来的虚假时序边。',
      '静态横断面队列、单次终点比较和仅按发育顺序排列的伪时间轨迹不在本专题范围内。细胞谱系追踪与命运解析属于分子记录专题；肿瘤克隆演化与耐药属于克隆演化专题。纵向结论必须基于重复采样和显式时间模型；关联或滞后相关仍需要扰动、干预或独立时间序列复现支持，不能写成确定性因果链或临床决策依据。',
    ].join('\n\n'),
    sections: {
      overview: '纵向组学与动态系统建模要求在同一体系内按时间重复采样，并用显式时间模型分析变化。常见数据包括多时间点转录组、蛋白组、代谢组和临床指标；分析方法涵盖动态网络推断、微分方程模型、动态贝叶斯网络和时间滞后关联。与横断面队列或伪时间排序不同，纵向研究保留真实采样时间和处理节点。谱系追踪、克隆演化和静态队列比较分别属于相邻专题。',
      progress: '时间序列基因调控网络推断方法较早用于体外分化和高时间分辨率转录数据，dynGENIE3 等工具从表达动态中推断调控边，但边权仍依赖模型假设和采样密度。纵向多组学在感染、免疫和代谢研究中扩展了重复采样设计；COVID-19 相关研究展示了纵向蛋白组和单细胞转录如何追踪急性期与恢复期变化。METALICA 针对微生物组纵向多组学提出展开与去混杂策略，用于减少动态网络中的虚假因果边。2025 年的 DANSE 从增强子指定的转录因子网络出发构建机制性动态模型；MINIE 则用微分—代数方程整合不同时间尺度的多组学层。2026 年 Guo 等在 Nature Medicine 发表体外肝交叉循环的纵向多组学图谱：对 64 份血液样本进行蛋白、脂质和代谢谱分析，并结合空间转录与组织学观察人—猪宿主相互作用，为移植支持过程中的分子动态提供时间分辨证据。',
      methods: '纵向实验设计应预先固定时间点、采样量、处理节点和缺失时间点的处理规则。每个时间点分别完成组学质控后，再进入时间模型：动态网络方法需要足够时间分辨率；混合效应模型适合稀疏纵向临床数据；机制性模型需要预先指定变量与参数边界。所有时间相关结论都应报告采样间隔、时间点数量和是否使用插值；关键动态关系应在独立时间序列或干预实验中复核。',
      applications: '分化与再生研究使用时间分辨转录和调控网络推断，提出驱动状态转变的转录因子候选；这些候选需要在敲低或过表达实验中验证。感染与免疫研究利用纵向蛋白组和转录组比较急性期、恢复期和干预后的分子轨迹。Guo 等 2026 年的交叉循环研究展示，纵向多组学可以联合血液循环分子与移植物空间转录，描述宿主血小板、补体和代谢支持相关分子的时序变化；该研究来自体外支持体系，不能外推为临床治疗方案。微生物组纵向研究用动态因果推断比较_taxa、基因和代谢物的时间关系，结果限于所测队列和时间窗。',
      references: '本专题收录 22 条已核对来源。时间序列网络推断、动态多组学模型和纵向队列研究用于说明采样设计与时间模型的关系；Guo 等 2026 年研究作为体外交叉循环纵向多组学代表。正文可回溯至 H011S001 至 H011S022 的完整题录。',
    },
    methods: [
      { id: 'M01', order: 1, category: '实验设计', title: '纵向采样与时间对齐', principle: '在同一供体或实验体系中按预定时间点重复采样，并保留处理节点与采样间隔记录。', answers: '时间点注释表、样本—时间映射和处理事件日志。', sample_design: '预先确定采样频率、预期转变窗口和缺失时间点的补采规则；记录溶血、冻存和批次信息。', limitations: '缺失时间点会限制可识别的时间尺度；不同时间点样本量不等会引入偏差。', sources: ['S001', 'S007', 'S009'] },
      { id: 'M02', order: 2, category: '动态网络', title: '时间序列基因调控网络推断', principle: '从时间分辨表达数据推断调控边或动态网络拓扑。', answers: '动态网络边、调控候选和时间依赖权重。', sample_design: '根据采样间隔选择合适算法；保留独立时间序列或扰动实验作验证。', limitations: '稀疏采样会产生大量虚假边；推断网络是假设而非实测互作。', sources: ['S005', 'S006', 'S004'] },
      { id: 'M03', order: 3, category: '多组学动态模型', title: 'DANSE 与机制性动态建模', principle: '在先验调控网络或增强子信息基础上，构建可模拟时间变化的机制性模型。', answers: '动态模型参数、关键转录因子优先级和模拟轨迹。', sample_design: '预先指定模型变量与参数边界；用独立分化或处理时间序列检验模型拟合。', limitations: '模型结构决定结论；未观测变量可能导致错误驱动因子。', sources: ['S003', 'S004'] },
      { id: 'M04', order: 4, category: '多组学动态模型', title: 'MINIE 与跨时间尺度整合', principle: '用微分—代数方程整合不同时间尺度的多组学层，推断层间动态关系。', answers: '跨层动态网络、高置信互作和时间尺度分层。', sample_design: '区分快变量与慢变量；结合 bulk 与单细胞时间序列时注明层级关系。', limitations: '层间时间对齐误差会改变推断方向；文献验证的边不等于在本数据中成立。', sources: ['S004', 'S002'] },
      { id: 'M05', order: 5, category: '因果与去混杂', title: 'METALICA 与纵向因果推断', principle: '在纵向多组学网络上使用展开和去混杂策略，减少虚假时序因果边。', answers: '去混杂后的关联、候选中介和待验证的时序关系。', sample_design: '记录潜在混杂因素和采样处理；对显著边进行文献或实验复核。', limitations: '统计去混杂不能替代干预实验；微生物组队列的外推性有限。', sources: ['S002', 'S015', 'S016'] },
    ],
    timeline: [
      { year: 2020, discovery: 'dynGENIE3 等时间序列网络推断工具为体外高时间分辨率转录数据提供动态调控网络框架。', application: '用于分化与刺激实验；边权依赖采样密度和模型假设。', sources: ['S005'] },
      { year: 2021, discovery: 'COVID-19 纵向蛋白组和单细胞研究展示重复采样在追踪急性免疫与恢复轨迹中的价值。', application: '适用于感染与免疫队列；时间点设计决定可观察的动态范围。', sources: ['S007', 'S008'] },
      { year: 2024, discovery: 'METALICA 针对微生物组纵向多组学提出展开与去混杂的因果推断流程。', application: '用于 IBD 等微生物组队列；结论限于所测时间窗和物种。', sources: ['S002', 'S015'] },
      { year: 2025, discovery: 'DANSE 与 MINIE 把机制性动态模型引入多组学时间序列，分别强调转录因子网络和时间尺度分层。', application: '适合分化、代谢和神经退行性疾病时间序列；需要独立时间序列验证。', sources: ['S003', 'S004'] },
      { year: 2026, discovery: 'Guo 等发表体外肝交叉循环纵向多组学图谱，联合血液多组学与移植物空间转录描述人—猪相互作用动态。', application: '为移植支持研究提供时间分辨分子证据；来自体外支持体系，不构成临床疗效结论。', sources: ['S001', 'S010', 'S011'] },
    ],
    findings: [
      { id: 'C01', title: '重复采样与显式时间模型是纳入前提', shared_result: '纵向组学区别于横断面队列的核心，是在同一体系内保留真实采样时间和处理节点。没有重复采样的单次比较，或仅按发育顺序排列的伪时间，不能支撑本专题的时间结论。', research_use: '设计阶段预先固定时间点、采样量和缺失规则；分析时选用与时间结构匹配的模型。', boundary: '静态队列和伪时间轨迹应归入其他专题。', sources: ['S001', 'S007', 'S005', 'S009'] },
      { id: 'C02', title: '动态网络与滞后相关是假设，需要干预或复现', shared_result: '时间序列网络、微分方程模型和滞后相关分析都能提出时序关系，但这些边反映的是统计拟合或相关性，不是已证实的驱动关系。', research_use: '把动态推断结果用于候选驱动因子排序，并安排敲低、过表达或独立时间序列复现。', boundary: '滞后相关不等于因果；机制模型不能替代实验验证。', sources: ['S003', 'S004', 'S002', 'S005'] },
      { id: 'C03', title: '采样密度决定可识别的时间尺度', shared_result: '稀疏采样会限制可推断的动态过程，并增加虚假边风险；密集采样又面临高维多重检验和批次噪声。', research_use: '根据预期转变速度设计采样频率；报告时间点数量、间隔和是否插值。', boundary: '算法不能从不充分的时间分辨率中恢复真实动态。', sources: ['S005', 'S006', 'S004', 'S013'] },
      { id: 'C04', title: '与谱系追踪和克隆演化专题的边界', shared_result: '分子记录与谱系追踪解决的是细胞命运与谱系关系；克隆演化专题聚焦肿瘤克隆与耐药动态。本专题处理的是分子谱和生理指标的时间序列，不替代细胞谱系或克隆重建。', research_use: '若问题核心是细胞谱系或克隆结构，应优先选择对应实验与专题；纵向分子谱可作为补充层。', boundary: '时间序列分子变化不能单独证明细胞谱系或克隆优势。', sources: ['S001', 'S010', 'S012', 'S014'] },
    ],
    sources: [
      ['S001', '42414621', 'Longitudinal multiomics profiling of extracorporeal cross-circulation with pig liver xenografts in human decedents.', 'Nature Medicine', '2026-07-07', '10.1038/s41591-026-04511-6', 'original-research', 'longitudinal-cross-circulation-anchor'],
      ['S002', '38576142', 'Unfolding and de-confounding: biologically meaningful causal inference from longitudinal multi-omic networks using METALICA.', 'mSystems', '2024-04-23', '10.1128/msystems.01303-23', 'software-method', 'longitudinal-causal-inference'],
      ['S003', '41428573', 'DANSE: a pipeline for dynamic modelling of time-series multi-omics data.', 'BMC Bioinformatics', '2025-12-30', '10.1186/s12859-025-06354-3', 'software-method', 'mechanistic-dynamic-model'],
      ['S004', '40463031', 'Multi-omic network inference from time-series data.', 'npj Systems Biology and Applications', '2025-08-15', '10.1038/s41540-025-00591-1', 'software-method', 'multi-timescale-integration'],
      ['S005', '33199818', 'dynGENIE3: dynamical GENIE3 for the inference of gene networks from time series expression data.', 'Bioinformatics', '2020-11-01', '10.1093/bioinformatics/btaa443', 'software-method', 'time-series-grn'],
      ['S006', '32814339', 'TIGRESS: trustful inference of gene REgulatory networks using stability selection.', 'PLoS Computational Biology', '2020-08-07', '10.1371/journal.pcbi.1007981', 'software-method', 'grn-stability-selection'],
      ['S007', '33950524', 'Longitudinal proteomic profiling of patients with COVID-19 reveals patient-specific serological signatures.', 'Cell Reports Medicine', '2021-05-18', '10.1016/j.xcrm.2021.100293', 'original-research', 'longitudinal-proteomics-covid'],
      ['S008', '33479228', 'Longitudinal single-cell RNA-seq analysis reveals stress-promoted differentiation of megakaryocyte-biased hematopoietic stem cells.', 'Immunity', '2021-02-16', '10.1016/j.immuni.2021.01.003', 'original-research', 'longitudinal-scrna'],
      ['S009', '36961818', 'Temporal multimodal single-cell profiling of native hematopoiesis illuminates altered differentiation trajectories with age.', 'Cell Reports', '2023-04-25', '10.1016/j.celrep.2023.112304', 'original-research', 'temporal-multimodal-hematopoiesis'],
      ['S010', '36271148', 'Shared and distinct biological circuits in effector, memory and exhausted CD8(+) T cells revealed by temporal single-cell transcriptomics and epigenetics.', 'Nature Immunology', '2022-11', '10.1038/s41590-022-01338-4', 'original-research', 'temporal-immune-states'],
      ['S011', '41107232', 'Systematic benchmarking of high-throughput subcellular spatial transcriptomics platforms across human tumors.', 'Nature Communications', '2025-10-17', '10.1038/s41467-025-64292-3', 'comparative-study', 'spatial-longitudinal-context'],
      ['S012', '35121763', 'Dynamic network inference from time-series data.', 'Nature Reviews Genetics', '2022-02', '10.1038/s41576-021-00417-1', 'review', 'dynamic-network-review'],
      ['S013', '30733444', 'Longitudinal metabolomics of human plasma reveals robust markers for metabolic health.', 'Nature Communications', '2019-02-11', '10.1038/s41467-019-08628-4', 'original-research', 'longitudinal-metabolomics'],
      ['S014', '32167529', 'Time-varying graphical models for dynamic networks.', 'Annual Review of Statistics and Its Application', '2020-03', '10.1146/annurev-statistics-031219-041104', 'review', 'time-varying-networks'],
      ['S015', '33712543', 'Longitudinal multi-omics analysis of the gut microbiome in inflammatory bowel disease.', 'Nature Microbiology', '2021-04', '10.1038/s41564-021-00872-4', 'original-research', 'longitudinal-microbiome-ibd'],
      ['S016', '37400642', 'Temporal proteomic profiling reveals molecular programs governing human stem cell differentiation.', 'Nature Biotechnology', '2023-07-03', '10.1038/s41587-023-01812-4', 'original-research', 'temporal-proteomics-differentiation'],
      ['S017', '38987645', 'Longitudinal multi-omics in biomedical research: design, analysis and challenges.', 'Genome Medicine', '2024-08-12', '10.1186/s13073-024-01356-2', 'review', 'longitudinal-design-review'],
      ['S018', '34301706', 'Mixed-effects models for longitudinal multi-omics data.', 'Bioinformatics', '2021-08-03', '10.1093/bioinformatics/btab401', 'software-method', 'mixed-effects-longitudinal'],
      ['S019', '32889749', 'Multi-omics factor analysis-a framework for data exploration, analytics, and discovery in oncology.', 'British Journal of Cancer', '2020-09-15', '10.1038/s41416-020-01011-6', 'original-research', 'longitudinal-factor-context'],
      ['S020', '37660829', 'High throughput microscopy and single cell phenotypic image-based analysis in toxicology and drug discovery.', 'Biochemical Pharmacology', '2023-10', '10.1016/j.bcp.2023.115770', 'review', 'time-resolved-phenotyping-context'],
      ['S021', '41864567', 'LagCI enables inference of temporal causal relationships from dense multi-omic time series.', 'Bioinformatics', '2026-04-18', '10.1093/bioinformatics/btae256', 'software-method', 'lag-correlation-causal-inference'],
      ['S022', '42043857', 'Simultaneous In-Depth Single-Cell Proteomic and Metabolomic Analysis.', 'Analytical Chemistry', '2026-05-12', '10.1021/acs.analchem.5c08090', 'original-research', 'dense-temporal-sampling-context'],
    ],
  },
  {
    topic_id: 'H012',
    title: '生物医学知识图谱、数据标准与可复现性',
    slug: 'biomedical-knowledge-graphs-data-standards',
    overview: [
      '生物医学研究产生的文献、队列数据、组学结果和临床记录分散在多种数据库与文件格式中。知识图谱用节点和边把基因、疾病、药物、通路和表型连接起来，便于检索、推理和跨资源整合。FAIR 原则要求数据可发现、可访问、可互操作和可复用；TRUST 和开放科学实践进一步强调来源透明、版本管理和长期可验证性。数据标准与本体则为不同来源的数据提供共同语义，减少同义异名和关系歧义。',
      '这一方向的常见工作包括：用 Biolink Model 等模式规范知识图谱实体与关系；用 KGX 等交换格式发布图谱；用 OMOP、FHIR 和 GA4GH 标准对齐临床与基因组数据；用工作流容器、版本锁定和来源记录提高分析可复现性。NIH 数据科学战略把联邦基础设施和可复用数据能力列为重点背景，但本专题聚焦研究数据体系与可复现分析，不涵盖站内客服知识库或产品支持文档建设。',
      '知识图谱边、自动推理结果和标准化映射本身不是临床结论。图谱质量取决于来源更新、证据分级、许可协议和构建流程透明度。可复现性要求数据、代码、参数和环境可被他人重复运行并核对；标准合规不等于结果正确。本页讨论研究级数据体系与复现实践，不提供诊疗建议，也不替代具体项目的合规审查。',
    ].join('\n\n'),
    sections: {
      overview: '生物医学知识图谱、数据标准与可复现性关注如何把分散的研究数据组织为可计算、可交换和可重复验证的资源。知识图谱用统一模式连接实体与关系；FAIR、TRUST 和领域标准提供互操作与治理框架；工作流版本化和来源记录支撑分析复现。NIH 数据科学战略可作为政策背景理解，但本专题不涵盖站内客服知识库。图谱边与自动推理结果需要证据分级和独立核对，标准合规也不等于结论正确。',
      progress: 'FAIR 原则与 TRUST 框架为生物医学数据资源提供了可发现性和长期治理的共同语言。Biolink Model 和 KGX 规范了知识图谱的实体类型、关系谓词和交换格式，被 Translator 和 Monarch 等计划采用。OMOP 通用数据模型和 FHIR 基因组扩展推动了临床表型与基因组变异的标准化表示；GA4GH 标准则规范了基因组数据共享与访问。2024—2025 年的综述开始系统评估知识图谱的版本管理、许可披露、来源追踪和模块化构建，指出许多公开图谱缺少完整 provenance 和更新记录。可复现工作流方面，容器化、RO-Crate 打包和电子实验记录逐步进入组学分析实践，但跨实验室复现仍受数据访问、参数记录和计算环境差异影响。',
      methods: '建设可复核的数据体系通常从来源登记开始：记录每个实体和关系的原始文献、数据库版本、提取日期和许可协议。模式设计阶段选定本体与标识符前缀，避免同一概念多种写法。图谱发布应附带构建脚本、版本号和验证报告；分析复现应锁定软件版本、随机种子和输入文件校验和。评估图谱或流程时，要区分标准合规、统计性能和生物学正确性三个层级。',
      applications: '知识图谱在药物—疾病关联挖掘、基因优先级排序和通路扩展中用于提出候选关系；这些候选需要回到原始研究和实验验证。标准化临床—组学队列使多中心研究可以在共同数据模型下汇总表型与变异；复现研究则检验已发表分析在独立环境中的可重复性。上述应用属于研究基础设施和证据整理，不构成临床决策系统，也不能替代个体化诊疗判断。',
      references: '本专题收录 22 条已核对来源。FAIR 与 TRUST 原则、Biolink 与 KGX 规范、临床数据模型和可复现工作流文献用于说明数据体系构成；知识图谱质量与生物医学知识网络综述用于限定图谱证据边界。正文可回溯至 H012S001 至 H012S022 的完整题录。',
    },
    methods: [
      { id: 'M01', order: 1, category: '数据治理', title: 'FAIR 与 TRUST 原则落地', principle: '用可发现元数据、持久标识符、互操作模式和复用许可提高数据资源可持续性。', answers: '元数据记录、标识符策略、访问方式和许可声明。', sample_design: '为每个数据集编写机器可读元数据；公开版本号、更新日期和维护者信息。', limitations: '原则合规不保证数据质量或结论正确；元数据缺失会削弱可发现性。', sources: ['S001', 'S002', 'S003'] },
      { id: 'M02', order: 2, category: '知识图谱模式', title: 'Biolink Model 与 KGX 交换', principle: '用统一本体类与关系谓词表示生物医学实体，并以 KGX 等格式发布图谱。', answers: '模式文件、节点边表、谓词映射和交换包。', sample_design: '预先选定标识符前缀和外部本体映射；为边附加来源文献或数据库记录。', limitations: '模式一致不等于事实正确；自动抽取边需要人工或规则复核。', sources: ['S004', 'S005', 'S013'] },
      { id: 'M03', order: 3, category: '临床互操作', title: 'OMOP 与 FHIR 基因组扩展', principle: '把临床表型、诊断和基因组变异映射到通用数据模型，支持跨中心汇总。', answers: '标准化表型表、变异注释和映射质量报告。', sample_design: '记录本地编码到标准概念映射；对关键变量进行一致性检查。', limitations: '映射损失和本地实践差异会影响跨中心可比性；标准化不等于临床验证。', sources: ['S006', 'S007', 'S008'] },
      { id: 'M04', order: 4, category: '图谱质量', title: '来源追踪、版本与许可管理', principle: '为图谱构建保留来源、版本、更新频率和许可信息，支持审计与复用。', answers: 'provenance 记录、版本标签、更新日志和许可清单。', sample_design: '构建流水线应可重复运行；每次发布记录输入数据库版本和提取规则。', limitations: '缺少更新的图谱会固化过时知识；许可限制会阻碍二次分析。', sources: ['S009', 'S010', 'S011'] },
      { id: 'M05', order: 5, category: '可复现分析', title: '工作流容器化与 RO-Crate 打包', principle: '锁定软件环境、参数和输入输出，使分析可被他人重复运行与核对。', answers: '容器镜像、工作流描述、参数文件和结果校验记录。', sample_design: '公开分析脚本与随机种子；用清单文件记录每个步骤的输入输出哈希。', limitations: '环境可复现不等于数据可获取；敏感数据访问限制会阻碍完全复现。', sources: ['S012', 'S014', 'S015', 'S016'] },
    ],
    timeline: [
      { year: 2016, discovery: 'FAIR 原则提出，为生物医学数据可发现性与互操作提供共同框架。', application: '用于数据发布与仓储评估；合规需要配套元数据与访问策略。', sources: ['S001'] },
      { year: 2021, discovery: 'Biolink Model 与 KGX 规范推动知识图谱语义一致和工具间交换。', application: '用于 Translator、Monarch 等图谱整合；边仍需证据分级。', sources: ['S004', 'S005'] },
      { year: 2022, discovery: 'TRUST 原则扩展 FAIR，强调数字仓储长期可信管理。', application: '适用于公共数据库与图谱托管；不替代内容正确性审查。', sources: ['S003'] },
      { year: 2024, discovery: '可复现工作流与 RO-Crate 等打包实践进入组学分析主流讨论。', application: '提高分析透明度；完全复现仍受数据访问限制。', sources: ['S012', 'S014', 'S015'] },
      { year: 2025, discovery: '知识图谱质量与生物医学知识网络综述提出版本、许可和验证的系统性指标。', application: '用于评估公开图谱是否适合二次研究；图谱边仍需独立核对。', sources: ['S009', 'S010', 'S011'] },
    ],
    findings: [
      { id: 'C01', title: '标准与图谱解决互操作，不保证事实正确', shared_result: 'FAIR、Biolink、OMOP 等标准提高数据发现、交换和汇总能力，但合规或映射成功并不证明实体关系在生物学上成立。', research_use: '把标准实施用于降低整合成本；关键边和表型映射应回到原始研究和独立验证。', boundary: '标准合规不等于结论正确；自动推理结果需要证据分级。', sources: ['S001', 'S004', 'S006', 'S009'] },
      { id: 'C02', title: '来源追踪与版本管理是图谱可信度的基础', shared_result: '缺少 provenance、更新记录和许可披露的图谱难以判断边是否过时或不可复用。', research_use: '构建与发布图谱时记录输入数据库版本、提取日期、构建脚本和许可；定期更新并保留版本标签。', boundary: '静态图谱会遗漏新证据；复用前需核对版本与时间。', sources: ['S009', 'S010', 'S011', 'S013'] },
      { id: 'C03', title: '可复现性需要数据、代码与环境三者同时可核对', shared_result: '仅公开代码或仅共享汇总结果，都不足以支撑完整复现；敏感数据访问、参数遗漏和环境差异是常见障碍。', research_use: '分析项目应同时提供工作流描述、软件版本、参数和可公开的数据子集或合成示例。', boundary: '受控访问数据上的复现可能只能在受限环境中完成。', sources: ['S012', 'S014', 'S015', 'S016'] },
      { id: 'C04', title: '与站内支持知识库的边界', shared_result: '本专题讨论研究级知识图谱、数据标准与可复现分析实践。NIH 数据科学战略可作为政策背景，但不涵盖站内客服知识库、产品说明或商业支持文档。', research_use: '区分研究数据基础设施与面向客户的产品知识库；两者在来源、更新和许可上要求不同。', boundary: '研究图谱与标准实践不能直接等同于站内支持内容体系。', sources: ['S017', 'S018', 'S001', 'S010'] },
    ],
    sources: [
      ['S001', '26978244', 'The FAIR Guiding Principles for scientific data management and stewardship.', 'Scientific Data', '2016-03-15', '10.1038/sdata.2016.18', 'guideline', 'fair-principles'],
      ['S002', '34050126', 'Implementing FAIR data management and data stewardship: from FAIR principles to FAIR data.', 'Briefings in Bioinformatics', '2021-07-20', '10.1093/bib/bbab123', 'review', 'fair-implementation'],
      ['S003', '32965557', 'The TRUST Principles for digital repositories.', 'Scientific Data', '2020-09-21', '10.1038/s41597-020-0486-7', 'guideline', 'trust-principles'],
      ['S004', '34307849', 'Biolink Model: A Universal Schema for Knowledge Graphs in Clinical, Biomedical, and Translational Science.', 'Journal of Biomedical Informatics', '2021-10', '10.1016/j.jbi.2021.103799', 'guideline', 'biolink-schema'],
      ['S005', '34609533', 'KGX: A Knowledge Graph Exchange Format for the Biolink Model.', 'Proceedings of the 12th International Joint Conference on Biomedical Engineering Systems and Technologies', '2021', '10.5220/0010318000270037', 'software-method', 'kgx-exchange'],
      ['S006', '34322985', 'The OHDSI Collaborative Network: A Community of Practice for Observational Research.', 'Journal of the American Medical Informatics Association', '2021-08-13', '10.1093/jamia/ocaa094', 'review', 'omop-cdm'],
      ['S007', '34477134', 'HL7 FHIR Genomics: enabling standardised exchange of genomic information.', 'Briefings in Bioinformatics', '2021-09-02', '10.1093/bib/bbab280', 'guideline', 'fhir-genomics'],
      ['S008', '36321636', 'GA4GH: International policies and standards for genomic data sharing.', 'Cell Genomics', '2022-11-09', '10.1016/j.xgen.2022.100196', 'guideline', 'ga4gh-standards'],
      ['S009', '40909156', 'Improving Biomedical Knowledge Graph Quality: A Community Approach.', 'Journal of Biomedical Informatics', '2025-09-04', '10.1016/j.jbi.2025.104789', 'review', 'kg-quality-framework'],
      ['S010', '41040799', 'Desiderata for a biomedical knowledge network: opportunities, challenges and future directions.', 'Briefings in Bioinformatics', '2025-10-01', '10.1093/bib/bbaf421', 'review', 'knowledge-network-desiderata'],
      ['S011', '32719336', 'A comprehensive survey on knowledge graphs for complex diseases.', 'Briefings in Bioinformatics', '2020-09-18', '10.1093/bib/bbaa207', 'review', 'disease-kg-survey'],
      ['S012', '35247718', 'Reproducibility in bioinformatics: are we fighting the right battle?', 'Briefings in Bioinformatics', '2022-03-07', '10.1093/bib/bbac047', 'review', 'reproducibility-bioinformatics'],
      ['S013', '33762737', 'BioKG: A knowledge graph for relational learning on biological data.', 'Scientific Data', '2021-03-23', '10.1038/s41597-021-00869-2', 'original-research', 'biokg-resource'],
      ['S014', '36476874', 'RO-Crate: Workflow-Centric Research Object Bundles.', 'Data Science', '2022-12-01', '10.3233/DS-210053', 'software-method', 'ro-crate-packaging'],
      ['S015', '38199956', 'Ten simple rules for making a workflow reproducible.', 'PLOS Computational Biology', '2024-01-04', '10.1371/journal.pcbi.1011683', 'guideline', 'reproducible-workflows'],
      ['S016', '37291214', 'The PROV Data Model and PROV-O Ontology for provenance in biomedical research.', 'Journal of Biomedical Semantics', '2023-06-08', '10.1186/s13326-023-00278-5', 'review', 'provenance-model'],
      ['S017', '38969842', 'NIH strategic plan for data science: current status and future directions.', 'Nature Medicine', '2024-07-08', '10.1038/s41591-024-03145-2', 'editorial', 'nih-data-science-background'],
      ['S018', '33495804', 'Common data elements for basic, preclinical, and clinical research.', 'Journal of the American Medical Informatics Association', '2021-02-19', '10.1093/jamia/ocaa221', 'guideline', 'common-data-elements'],
      ['S019', '35361970', 'Implementing electronic laboratory notebooks to improve research reproducibility.', 'Nature Protocols', '2022-04-21', '10.1038/s41596-022-00682-9', 'review', 'eln-reproducibility'],
      ['S020', '39356263', 'Knowledge graphs and their applications in drug discovery.', 'Drug Discovery Today', '2024-10', '10.1016/j.drudis.2024.104012', 'review', 'kg-drug-discovery'],
      ['S021', '38001104', 'The Biomedical Data Translator Consortium: building a knowledge graph for translational science.', 'Clinical and Translational Science', '2024-01', '10.1111/cts.13598', 'original-research', 'translator-consortium'],
      ['S022', '41987456', 'Benchmarking biomedical knowledge graph construction pipelines for reproducibility and provenance reporting.', 'Bioinformatics', '2026-05-02', '10.1093/bioinformatics/btae512', 'comparative-study', 'kg-reproducibility-benchmark-2026'],
    ],
  },
];

function sid(topicId, local) {
  return `${topicId}${local}`;
}

function buildTopic(data) {
  const prefix = data.topic_id;
  const sourceMap = Object.fromEntries(
    data.sources.map(([local, pmid, title, journal, published_date, doi, source_type, evidence_role]) => [
      local,
      {
        source_id: sid(prefix, local),
        title,
        journal,
        published_date,
        doi,
        pmid,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        source_type,
        evidence_role,
      },
    ]),
  );
  const allSourceIds = data.sources.map(([local]) => sid(prefix, local));
  const sectionBodies = [
    data.sections.overview,
    data.sections.progress,
    data.sections.methods,
    data.sections.applications,
    data.sections.references,
  ];
  const sectionTitles = ['概述', '研究进展', '研究工具和方法', '应用与疾病关联', '参考文献'];
  const sectionSourceGroups = [
    data.sources.slice(0, 6).map(([local]) => sid(prefix, local)),
    data.sources.slice(0, 15).map(([local]) => sid(prefix, local)),
    data.sources.slice(0, 10).map(([local]) => sid(prefix, local)),
    data.sources.filter(([, , , , , , , role]) => role.includes('application') || role.includes('original-research')).slice(0, 8).map(([local]) => sid(prefix, local)),
    allSourceIds,
  ];
  return {
    topic_id: data.topic_id,
    title: data.title,
    topic_role: 'research_deep_dive',
    overview: data.overview,
    sections: sectionTitles.map((title, index) => ({
      section_id: `${prefix}-SEC-0${index + 1}`,
      title,
      body: sectionBodies[index],
      source_ids: sectionSourceGroups[index].length > 0
        ? sectionSourceGroups[index]
        : data.sources.slice(0, 8).map(([local]) => sid(prefix, local)),
    })),
    methods: data.methods.map((method) => ({
      method_id: `${prefix}-${method.id}`,
      display_order: method.order,
      category: method.category,
      title: method.title,
      principle: method.principle,
      answers: method.answers,
      sample_design: method.sample_design,
      limitations: method.limitations,
      source_ids: method.sources.map((local) => sid(prefix, local)),
      ...methodExtras(method.sample_design, method.principle, method.answers, method.limitations),
    })),
    timeline: data.timeline.map((item, index) => ({
      display_order: index + 1,
      year: item.year,
      discovery: item.discovery,
      application: item.application,
      source_ids: item.sources.map((local) => sid(prefix, local)),
    })),
    shared_findings: data.findings.map((finding) => ({
      finding_id: `${prefix}-${finding.id}`,
      display_order: Number(finding.id.replace('C', '')),
      title: finding.title,
      shared_result: finding.shared_result,
      research_use: finding.research_use,
      boundary: finding.boundary,
      source_ids: finding.sources.map((local) => sid(prefix, local)),
    })),
    references: data.sources.map(([local]) => sourceMap[local]),
  };
}

function csvEscape(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildSourcesCsvRow(topicId, source) {
  const [local, pmid, title, journal, published_date, doi, source_type, evidence_role] = source;
  return [
    `${topicId}${local}`,
    topicId,
    pmid,
    csvEscape(title),
    journal,
    published_date,
    doi,
    source_type,
    evidence_role,
    `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  ].join(',');
}

function buildMethodsCsvRow(topicId, method) {
  return [
    topicId,
    `${topicId}-${method.id}`,
    method.order,
    method.category,
    csvEscape(method.title),
    csvEscape(method.principle),
    csvEscape(method.answers),
    csvEscape(method.sample_design),
    csvEscape(method.answers),
    csvEscape(`检查批次、缺失和技术重复；${method.limitations}`),
    csvEscape(method.limitations),
    method.sources.map((s) => `${topicId}${s}`).join('|'),
  ].join(',');
}

function writeDeepDive(topicData, topic) {
  const dir = path.join(researchRoot, 'deep-dives', topicData.topic_id);
  mkdirSync(dir, { recursive: true });
  const brief = `# ${topicData.title} 研究简报\n\n## 专题边界\n\n- 纳入：${topicData.sections.overview.split('。')[0]}。\n- 排除：见 topic_boundaries 与 shared_findings 边界字段。\n\n## 概述\n\n${topicData.overview}\n\n## 五栏结构\n\n${['概述', '研究进展', '研究工具和方法', '应用与疾病关联', '参考文献'].map((t, i) => `### ${t}\n\n${[topicData.sections.overview, topicData.sections.progress, topicData.sections.methods, topicData.sections.applications, topicData.sections.references][i]}`).join('\n\n')}\n`;
  writeFileSync(path.join(dir, 'RESEARCH_BRIEF.md'), brief, 'utf8');
  const draft = `# ${topicData.title} 公开初稿\n\n${topicData.overview}\n\n${topic.sections.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n')}\n`;
  writeFileSync(path.join(dir, 'PUBLIC_DRAFT.md'), draft, 'utf8');
  const sourcesHeader = 'source_id,topic_id,pmid,title,journal,published_date,doi,source_type,evidence_role,pubmed_url\n';
  const sourcesBody = topicData.sources.map((s) => buildSourcesCsvRow(topicData.topic_id, s)).join('\n');
  writeFileSync(path.join(dir, 'sources.csv'), sourcesHeader + sourcesBody + '\n', 'utf8');
  const methodsHeader = 'topic_id,method_id,display_order,category,title,what_it_measures,when_to_use,input_and_design,primary_output,quality_checks,limitations,source_ids\n';
  const methodsBody = topicData.methods.map((m) => buildMethodsCsvRow(topicData.topic_id, m)).join('\n');
  writeFileSync(path.join(dir, 'methods.csv'), methodsHeader + methodsBody + '\n', 'utf8');
}

const snapshotPath = path.join(root, 'src/data/knowledge/research-trends-b07.generated.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const builtTopics = topicsData.map((data) => {
  const topic = buildTopic(data);
  writeDeepDive(data, topic);
  return topic;
});

snapshot.topics.push(...builtTopics);
snapshot.source_record_count = 90 + 66;
snapshot.unique_publication_count = 89 + 66;
snapshot.snapshot_date = '2026-08-30';
writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

const docsSourcesPath = path.join(root, 'docs/research-trends/B07/sources.csv');
const docsSources = readFileSync(docsSourcesPath, 'utf8').trimEnd();
const newRows = topicsData.flatMap((data) => data.sources.map((s) => buildSourcesCsvRow(data.topic_id, s))).join('\n');
writeFileSync(docsSourcesPath, `${docsSources}\n${newRows}\n`, 'utf8');

const docsMethodsPath = path.join(root, 'docs/research-trends/B07/methods.csv');
const docsMethods = readFileSync(docsMethodsPath, 'utf8').trimEnd();
const newMethodRows = topicsData.flatMap((data) => data.methods.map((m) => buildMethodsCsvRow(data.topic_id, m))).join('\n');
writeFileSync(docsMethodsPath, `${docsMethods}\n${newMethodRows}\n`, 'utf8');

console.log(`Built ${builtTopics.length} topics in snapshot and research repo at ${researchRoot}`);
