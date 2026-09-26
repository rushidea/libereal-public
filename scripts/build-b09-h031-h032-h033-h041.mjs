import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const researchRoot = process.env.LIBEREAL_RESEARCH_TRENDS_ROOT
  ? path.resolve(process.env.LIBEREAL_RESEARCH_TRENDS_ROOT)
  : path.resolve(root, '..', 'libereal-life-science-trends-2020-2026');

function methodExtras(sampleDesign, principle, answers, limitations, workflowNote) {
  const workflowPrefix = workflowNote
    ? `${workflowNote} `
    : '记录样本来源、处理条件、读出指标和正交验证；把观察结果与预先定义的研究问题放在同一分析框架中比较。 ';
  return {
    workflow: `设计阶段先确定：${sampleDesign} ${workflowPrefix}这项方法的直接测量或计算依据是：${principle}`,
    quality_control: `用空白、阴性或基线对照界定背景；如果该方法有公认标准，再用阳性对照或参考样本检查流程性能。技术重复与生物学重复应分别记录，分析时还要回看原始数据、样本身份和批次分布。特别要注意：${limitations} 关键发现应根据研究问题，在独立批次、独立样本或正交方法中复核。`,
    result_interpretation: `结果可用于${answers.replace(/^适合/, '').replace(/^用于/, '')} 解读时，应确认结果与预先定义的研究问题、样本层级和对照相符。机制、疾病关联或应用价值仍须由与问题相符的独立证据支持。`,
  };
}

async function fetchPubmedSummaries(pmids) {
  const ids = pmids.join(',');
  const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids}&retmode=json`);
  const data = await res.json();
  return pmids.map((pmid) => {
    const item = data.result[String(pmid)];
    if (!item || item.error) throw new Error(`Missing PubMed record for ${pmid}`);
    const doi = item.articleids?.find((a) => a.idtype === 'doi')?.value ?? '';
    const author = item.authors?.[0]?.name ?? 'Unknown';
    const pubdate = item.pubdate ?? '';
    const published_date = pubdate.length >= 10 ? pubdate.slice(0, 10) : pubdate;
    return {
      pmid: String(pmid),
      title: item.title ?? '',
      authors: `${author} et al.`,
      journal: item.source ?? '',
      published_date,
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  });
}

function makeReference(topicId, index, meta, extras) {
  const num = String(index).padStart(3, '0');
  return {
    source_id: `${topicId}S${num}`,
    title: meta.title,
    authors: meta.authors,
    journal: meta.journal,
    published_date: meta.published_date,
    doi: meta.doi,
    pmid: meta.pmid,
    url: meta.url,
    ...extras,
  };
}

const topicsData = [
  {
    topic_id: 'H031',
    title: '病原体基因组与基因组监测',
    slug: 'pathogen-genomics-surveillance',
    overview: [
      '病原体基因组监测把测序读段、采样地点、时间和宿主信息放进同一套可比较的坐标，用来回答传播链、谱系替换和输入事件，而不是只报告某一株的序列。公开研究已经覆盖呼吸道病毒、肠道病原、猴痘和医院感染，但能看到什么取决于采样框、测序覆盖、引物方案和元数据完整程度。',
      '本方向从实时谱系追踪、国家与区域监测网络、引物与组装流程、污水基因组学出发，集中处理三类问题：基因组如何被映射到可引用的公共坐标；覆盖不足会漏掉哪些传播事件；污水和多病原采样如何把信号从就诊病例扩展到社区。耐药酶学、新抗感染骨架和噬菌体策略由抗微生物耐药专题处理。',
      '比较公开研究时，需要同时交代病原种类、采样框、测序平台、引物版本、谱系命名和数据共享时滞。基因组监测是研究导航，不是诊疗、商品推荐或监管申报指引。某一地区的谱系比例不能外推为全球传播结构。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 取样框与覆盖 | 病原种类、地理范围、病例定义、测序比例和偏倚来源 | 看到的是局部传播还是采样框本身 |\n| 测序与组装 | 平台、引物或捕获方案、覆盖深度和质量控制阈值 | 缺失片段是否会改变谱系或变异判断 |\n| 谱系与变异注释 | 命名版本、参考基因组、突变定义和谱系分配软件 | 不同研究的谱系标签能否直接比较 |\n| 流行病学元数据 | 采样日期、地点、宿主、旅行史和医院暴露 | 系统发育信号能否对应传播事件 |\n| 共享与时滞 | 数据库、上传延迟、仪表盘和版本记录 | 实时结论是否已被后续数据改写 |',
    sections: [
      {
        title: '实时谱系追踪把基因组放进可比较的公共坐标',
        body: 'Nextstrain 证明病原进化可以按连续更新的系统发育和地理映射对外发布。随后的严重急性呼吸综合征冠状病毒 2 基因组流行病学研究进一步证明，地方公共卫生沟通、变异出现与传播耦合，以及测序基础设施，会共同决定监测能否被独立复用。\n\n这些工作适合作为谱系比较的起点。命名版本、参考基因组和上传时滞必须一并记录，不能把某一周的谱系比例写成稳定的全球结构。',
        source_ids: ['H031S001', 'H031S002', 'H031S003', 'H031S004'],
      },
      {
        title: '监测网络能力决定能看到哪些传播事件',
        body: '亚洲低资源地区的病原基因组监测现况、非洲迅速扩展的测序网络、加拿大公共卫生实验室能力评估，以及非洲病原基因组学综述，共同证明覆盖、培训、试剂和数据治理会限制可见的传播事件。\n\n网络能力研究适合判断某一结论是否受采样框约束。测序数量上升不等于代表性足够；缺少元数据的序列只能支持有限的传播推断。',
        source_ids: ['H031S007', 'H031S008', 'H031S010', 'H031S016', 'H031S018'],
      },
      {
        title: '引物方案和医院感染可视化决定监测能否落地',
        body: 'ARTIC 网络引物优化证明扩增子方案会直接影响全基因组覆盖和谱系分配。医院感染基因组仪表盘研究进一步证明，把基因组与临床暴露数据放在同一界面，才能支持院内传播假设。人工智能用于病原监测的讨论则提示计算方法可以辅助分型，但不能替代采样设计和元数据。\n\n引物版本和可视化工具应作为方法学变量报告。方案更新后，旧序列的谱系标签需要重新映射，不能沿用过期注释。',
        source_ids: ['H031S009', 'H031S017', 'H031S019'],
      },
      {
        title: '污水和多病原监测把采样从就诊病例扩展到社区',
        body: '城市污水基因组监测证明可以跟踪阿尔法和德尔塔谱系更替；犹他州污水研究证明奥密克戎可以在临床报告之前被检出。呼吸道、肠道和泌尿病毒的季节性研究，以及亚利桑那州流感基因组监测，进一步证明非临床采样可以覆盖多种病原。\n\n污水信号适合提出社区流行假设。病毒载量、稀释、降解和人口流动性会改变定量解释，不能把污水谱系直接写成个体感染来源。',
        source_ids: ['H031S013', 'H031S014', 'H031S015', 'H031S020'],
      },
      {
        title: '专题边界：监测不等于耐药机制或抗感染策略',
        body: '肺炎链球菌十年基因组监测证明病原基因组可以服务疫苗策略比较；伤寒沙门菌监测证明基因组型与临床结局不必一一对应。猴痘全球基因组监测和仪表盘研究则把该病原纳入可比较的谱系坐标。\n\n本页处理传播、谱系和监测网络。抗微生物耐药机制、新抗感染骨架和噬菌体策略由 H033 专题处理，两页可以交叉引用，但不能把耐药基因检出写成新药证据，也不能把爆发谱系写成抗感染方案。',
        source_ids: ['H031S005', 'H031S006', 'H031S011', 'H031S012'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '监测设计', title: '病例定义、采样框与覆盖评估', principle: '预先规定病原、地理范围、纳入排除标准和测序比例，并估计采样偏倚对谱系频率的影响。', answers: '判断监测看到的是传播事件还是采样框本身。', sample_design: '记录病例定义、哨点分布、测序比例、时间和地理覆盖；保留未测序病例的基线描述。', limitations: '就诊偏倚和试剂中断会系统性改变可见谱系；覆盖不足时不能外推未采样地区。', sources: ['H031S007', 'H031S008', 'H031S010', 'H031S018'] },
      { id: 'M02', order: 2, category: '测序与组装', title: '全基因组测序、引物方案与质量控制', principle: '用扩增子、捕获或宏基因组流程获得病原基因组，并按覆盖深度、缺失片段和污染指标过滤。', answers: '确认谱系和关键变异是否建立在足够覆盖的基因组上。', sample_design: '报告平台、引物或捕获版本、深度阈值和失败率；方案更新后重新组装关键样本。', limitations: '引物脱落会造成假缺失；混合感染和污染会扭曲变异调用。', sources: ['H031S009', 'H031S004', 'H031S019'] },
      { id: 'M03', order: 3, category: '谱系分析', title: '系统发育、谱系分配与传播假设', principle: '把高质量基因组放到公开参考坐标中，结合采样日期和地点提出传播或输入假设。', answers: '比较谱系替换、输入事件和本地持续传播是否被数据支持。', sample_design: '固定命名版本、参考集和钟模型假设；报告未分配序列和替代拓扑。', limitations: '缺少旅行史或采样日期时，系统发育只能给出弱传播约束。', sources: ['H031S001', 'H031S002', 'H031S003', 'H031S010'] },
      { id: 'M04', order: 4, category: '环境监测', title: '污水基因组监测与社区信号', principle: '对污水或环境样本测序，跟踪社区中的病原谱系和多病毒季节性，而不依赖单一就诊病例。', answers: '判断社区流行信号是否早于或宽于临床报告。', sample_design: '记录采样点、流量或人口校正、核酸回收率和对照；关键谱系用临床序列复核。', limitations: '稀释、降解和人口流动会改变定量；污水阳性不能指定个体感染来源。', sources: ['H031S013', 'H031S014', 'H031S015', 'H031S020'] },
      { id: 'M05', order: 5, category: '数据共享', title: '公共数据库、仪表盘与版本管理', principle: '把序列和最低元数据写入可引用数据库或仪表盘，并保留上传时间和命名版本。', answers: '评估其他研究能否复用同一监测坐标，以及结论是否已被后续上传改写。', sample_design: '报告数据库、延迟、仪表盘版本和访问条件；修订谱系后发布变更说明。', limitations: '延迟上传会造成虚假的本地起源；仪表盘可视化不能代替原始比对。', sources: ['H031S001', 'H031S011', 'H031S012', 'H031S017'] },
    ],
    findings: [
      { id: 'C01', title: '实时谱系追踪依赖共享坐标和完整元数据', shared_result: 'Nextstrain 与严重急性呼吸综合征冠状病毒 2 基因组流行病学研究证明，连续更新的系统发育只有在命名版本、采样日期和共享时滞被记录时才能被复用。', research_use: '引用图谱时记录软件、参考集和上传日期；比较不同周次结果时先对齐命名版本。', boundary: '某一周的谱系比例不是稳定的全球传播结构；本页不提供诊疗建议。', sources: ['H031S001', 'H031S002', 'H031S003', 'H031S004'] },
      { id: 'C02', title: '监测网络能力不足会系统性漏掉传播事件', shared_result: '亚洲、非洲和加拿大的能力评估表明，试剂、培训、哨点分布和数据治理会限制可见谱系，测序数量上升不等于代表性足够。', research_use: '报告覆盖比例、哨点类型和未测序病例；能力约束作为结果解释的一部分。', boundary: '不能把高覆盖地区的结论直接外推到未采样地区。', sources: ['H031S007', 'H031S008', 'H031S010', 'H031S016', 'H031S018'] },
      { id: 'C03', title: '污水监测可以提前给出社区信号，但不能指定个体来源', shared_result: '城市污水和流感基因组监测证明，非临床采样可以跟踪谱系更替和多病毒季节性，有时早于临床报告。', research_use: '同步记录流量校正、回收率和对照；关键谱系用临床序列复核。', boundary: '污水阳性不是个体诊断，也不能单独写成传播链证据。', sources: ['H031S013', 'H031S014', 'H031S015', 'H031S020'] },
      { id: 'C04', title: '引物方案和可视化工具是方法学变量', shared_result: 'ARTIC 引物优化和医院感染仪表盘研究说明，扩增子方案与临床元数据整合会改变能被检出和被解释的事件。', research_use: '固定引物版本、覆盖阈值和仪表盘版本；方案更新后重新映射旧序列。', boundary: '可视化不能代替原始比对；人工智能辅助分型不能替代采样设计。', sources: ['H031S009', 'H031S017', 'H031S019'] },
      { id: 'C05', title: '基因组监测与耐药机制必须分层', shared_result: '肺炎链球菌和伤寒监测证明病原基因组可以服务疫苗策略或传播描述，但基因组型不必对应临床结局。猴痘监测扩展了谱系坐标，仍不回答抗感染机制。', research_use: '传播、谱系和监测网络用本页框架；耐药酶学、新骨架和噬菌体策略转到 H033。', boundary: '耐药基因检出不是新药证据；爆发谱系不是抗感染方案。两页可交叉引用，结论分开写。', sources: ['H031S005', 'H031S006', 'H031S011', 'H031S012'] },
    ],
    pmids: [29790939, 32822393, 33795722, 35899481, 34001237, 32684794, 39317773, 37361158, 35252269, 36108049, 37167010, 39442559, 36369689, 37154725, 38793574, 39464779, 38358326, 36153510, 39878472, 38712930],
    refMeta: [
      ['software-method', 'pathogen evolution tracking', 'real-time phylogenetic dashboard', 'shared genomic coordinates', 'resource; depends on uploaded metadata'],
      ['primary_research', 'local SARS-CoV-2 surveillance', 'public health genomic communication', 'local outbreak interpretation', 'single-jurisdiction design'],
      ['primary_research', 'SARS-CoV-2 genomic epidemiology', 'variant emergence and transmission', 'allelic variation with spread', 'observational genomic epidemiology'],
      ['review', 'SARS-CoV-2 sequencing', 'data and sequencing infrastructure', 'surveillance capacity framing', 'review; infrastructure varies by country'],
      ['primary_research', 'pneumococcal genomics', 'decade-long global surveillance', 'vaccine-strategy comparison', 'vaccine context; not outbreak-only'],
      ['primary_research', 'typhoidal Salmonella', 'clinical genomic surveillance', 'no clinical-outcome association', 'hospital series; limited outcome link'],
      ['primary_research', 'Asia lower-resource settings', 'surveillance status survey', 'capacity and coverage gaps', 'survey; not a single outbreak'],
      ['review', 'WHO regional initiatives', 'emergency genomic surveillance', 'network strengthening', 'review of programmes'],
      ['primary_research', 'SARS-CoV-2 ARTIC protocol', 'primer and protocol optimization', 'genome completeness for lineage calls', 'protocol paper; primer-version specific'],
      ['primary_research', 'Africa SARS-CoV-2 epidemic', 'rapidly expanding genomic surveillance', 'continental spread insights', 'coverage still uneven'],
      ['software-method', 'mpox genomics', 'worldwide MPXV dashboard', 'lineage visualization', 'dashboard resource'],
      ['primary_research', 'monkeypox virus', 'global genomic surveillance', 'cross-country lineage comparison', 'surveillance series'],
      ['primary_research', 'urban wastewater', 'Alpha and Delta succession', 'community lineage tracking', 'environmental sampling'],
      ['primary_research', 'Utah wastewater', 'early Omicron detection', 'pre-clinical community signal', 'single-region wastewater'],
      ['primary_research', 'Arizona influenza', 'seasonal genomic surveillance', 'respiratory virus monitoring', 'regional influenza series'],
      ['review', 'Africa pathogen genomics', 'capacity and network growth', 'regional infrastructure', 'review; heterogeneous programmes'],
      ['software-method', 'healthcare-associated infection', 'genomic epidemiology dashboard', 'hospital transmission visualization', 'tooling; needs clinical metadata'],
      ['primary_research', 'Canada public health labs', 'capacity assessment', 'readiness for large-scale surveillance', 'capacity survey'],
      ['review', 'pathogen surveillance methods', 'genomics and AI discussion', 'method horizon', 'review; AI not a substitute for sampling'],
      ['primary_research', 'wastewater multi-virus', 'seasonality of respiratory enteric urinary viruses', 'community multi-pathogen signal', 'environmental; not individual diagnosis'],
    ],
    techBody: '本专题的技术卡包括监测取样框与覆盖评估、全基因组测序与引物质控、系统发育与谱系分配、污水基因组监测，以及公共数据库与仪表盘版本管理。技术选择取决于需要确认的是覆盖偏倚、谱系替换还是社区信号。',
    scopeBody: '本页用于介绍病原体基因组监测中的证据类型、实验设计和适用范围，用于研究导航。不提供诊疗、商品推荐、监管申报或抗感染用药建议。耐药机制与新型抗感染策略见 H033。',
  },
  {
    topic_id: 'H032',
    title: '新型疫苗平台与免疫保护相关物',
    slug: 'vaccine-platforms-correlates-of-protection',
    overview: [
      '疫苗平台研究比较信使核糖核酸、病毒载体、蛋白亚单位和自扩增核糖核酸如何诱导结合抗体、中和抗体和细胞免疫。保护相关物研究则追问：哪些免疫读出与随后的感染、疾病或重症终点共同变化。这两类工作回答的是免疫测量与终点之间的关系，不是个体诊疗方案。',
      '本方向从平台人体试验、中和抗体保护相关物、系统疫苗学和替代平台出发，集中处理三类问题：不同平台诱导的免疫谱有何差异；中和抗体在哪些终点上可以作为保护相关物；系统疫苗学如何提出机制假设而又保持外推边界。保护相关物是研究分层工具，不是诊断阈值或治疗建议。',
      '比较公开研究时，需要同时交代抗原、平台、剂量、间隔、免疫读出、临床终点和随访窗口。本页是研究导航，不是接种建议、商品推荐或监管申报指引。某一试验中的抗体阈值不能直接写成通用保护标准。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 抗原与平台 | 信使核糖核酸、病毒载体、蛋白亚单位或自扩增核糖核酸，以及抗原设计 | 免疫谱差异来自抗原还是递送平台 |\n| 免疫读出 | 结合抗体、中和抗体、记忆 B 细胞、T 细胞和系统组学 | 保护相关物建立在哪一层免疫测量上 |\n| 保护终点 | 感染、有症状疾病、重症或病原特异读出 | 相关物对应的是哪一类临床或实验终点 |\n| 队列与剂量 | 年龄、既往感染、剂次、间隔和加强针 | 阈值能否迁移到其他人群或剂次 |\n| 外推边界 | 变异株、时间衰减和实验室方法 | 相关物是否仍停留在原试验条件 |',
    sections: [
      {
        title: '信使核糖核酸平台在人体试验中诱导了可测量的保护性免疫',
        body: '信使核糖核酸疫苗综述先给出了平台原理和早期人体证据。随后的 BNT162b2 与 mRNA-1273 随机试验证明，该平台可以在大规模人群中降低有症状感染风险。针对 BNT162b2 的系统疫苗学研究进一步证明，接种后出现可重复的先天免疫和适应性免疫程序。\n\n这些试验适合比较平台诱导的免疫谱和疾病终点。试验人群、变异株流行期和随访窗口必须保留，不能把单一试验的效力写成所有信使核糖核酸疫苗的通用性能。',
        source_ids: ['H032S001', 'H032S002', 'H032S003', 'H032S004'],
      },
      {
        title: '中和抗体水平在多项分析中与保护终点共同变化',
        body: '中和抗体水平预测有症状感染保护的分析，以及 mRNA-1273 效力试验的免疫相关物分析，证明结合或中和抗体可以在特定终点上作为保护相关物。Plotkin 的保护相关物框架和后续免疫相关物更新，则把这类读出放回更一般的疫苗评价逻辑。加强针研究进一步证明，相关物需要按剂次重新估计。\n\n抗体相关物适合作为研究分层和桥接假设。实验室方法、变异株和衰减曲线不同时，阈值不能直接搬用。保护相关物也不是个体是否需要治疗的判断依据。',
        source_ids: ['H032S005', 'H032S006', 'H032S012', 'H032S013', 'H032S015'],
      },
      {
        title: '病毒载体和蛋白亚单位提供不同的免疫读出组合',
        body: 'ChAdOx1 随机试验证明病毒载体平台可以诱导保护性免疫并伴随特定安全信号。病毒载体平台综述把天花疫苗到新冠载体的设计谱系放在同一比较框架。NVX-CoV2373 效力试验和重组刺突纳米颗粒早期试验证明，蛋白亚单位加上佐剂也可以达到可测量的保护终点。\n\n跨平台比较应同时报告抗原剂量、佐剂、注射途径和细胞免疫读出。一种平台的抗体数值不能当作另一种平台的保护相关物。',
        source_ids: ['H032S007', 'H032S008', 'H032S009', 'H032S010'],
      },
      {
        title: '自扩增核糖核酸和系统疫苗学扩展了平台比较维度',
        body: '自扩增核糖核酸综述和埃博拉病毒小鼠保护研究证明，该平台可以在更低核酸剂量下诱导保护性免疫，但仍主要停留在临床前或早期评价。系统疫苗学方法综述则证明多组学和单细胞读出可以提出先天免疫程序假设。疫苗诱导保护的持久性综述提醒，相关物会随时间衰减。\n\n这些工作适合提出下一轮平台比较的测量清单。临床前保护不能写成人体效力；组学签名也不能单独代替预先定义的临床终点。',
        source_ids: ['H032S011', 'H032S017', 'H032S018', 'H032S019', 'H032S020'],
      },
      {
        title: '保护相关物是研究分层工具，不是诊疗建议',
        body: '结核疫苗保护相关物综述和严重急性呼吸综合征冠状病毒 2 保护相关物综述都强调，相关物依赖疾病定义、实验室方法和随访设计。把抗体或细胞读出写成诊疗阈值，会越过这些研究所能支持的范围。\n\n本页用于比较疫苗平台和免疫读出。保护相关物可以支持研究分层、桥接设计和机制假设，不能作为诊断、治疗或个体接种决策。监管申报路径也不在本页范围。',
        source_ids: ['H032S014', 'H032S016', 'H032S012', 'H032S013'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '平台比较', title: '抗原设计与疫苗平台对照', principle: '在同一评价框架中比较信使核糖核酸、病毒载体、蛋白亚单位或自扩增核糖核酸的抗原、剂量和免疫程序。', answers: '区分免疫谱差异来自抗原还是递送平台。', sample_design: '预先定义平台、抗原、剂次、间隔和对照疫苗；跨试验比较时对齐终点定义。', limitations: '不同试验的流行株和人群不可直接合并；平台标签不能代替具体处方。', sources: ['H032S001', 'H032S007', 'H032S008', 'H032S011'] },
      { id: 'M02', order: 2, category: '抗体读出', title: '结合抗体与中和抗体测定', principle: '用标准化结合试验和活病毒或假病毒中和试验测量体液免疫，并与临床终点配对。', answers: '判断抗体读出能否作为特定终点的保护相关物。', sample_design: '报告采样时间、实验室方法、国际标准和变异株；保留基线和突破感染样本。', limitations: '方法学差异会改变数值；抗体相关物不是个体诊疗阈值。', sources: ['H032S005', 'H032S006', 'H032S015'] },
      { id: 'M03', order: 3, category: '细胞免疫', title: 'T 细胞与记忆 B 细胞读出', principle: '测量抗原特异 T 细胞和记忆 B 细胞，用于解释抗体未能完全说明的保护差异。', answers: '检查细胞免疫是否补充或修正抗体相关物。', sample_design: '统一刺激抗原、时间点和流式或酶联免疫斑点方案；报告实验室间变异。', limitations: '细胞读出难以标准化；缺少细胞数据时不能断言细胞保护。', sources: ['H032S004', 'H032S009', 'H032S014'] },
      { id: 'M04', order: 4, category: '系统疫苗学', title: '多组学免疫程序与签名', principle: '在接种前后采集转录、蛋白或单细胞数据，寻找与免疫原性或保护终点相关的程序。', answers: '提出可在独立队列中复核的先天或适应性免疫假设。', sample_design: '固定采样窗口、批次校正和预先定义的主要签名；用独立队列验证。', limitations: '组学签名是关联层证据；不能单独代替临床终点。', sources: ['H032S004', 'H032S017', 'H032S018'] },
      { id: 'M05', order: 5, category: '相关物建模', title: '保护相关物估计与外推边界', principle: '把免疫读出与感染、疾病或重症终点建模，并检验阈值在不同剂次、变异株和时间点是否稳定。', answers: '评估相关物能否用于研究分层或桥接，而不能用于个体诊疗。', sample_design: '预先定义终点、模型和分析集；报告衰减、变异株和阴性结果。', limitations: '原试验阈值不能自动迁移；本方法不产生治疗或接种建议。', sources: ['H032S006', 'H032S012', 'H032S013', 'H032S019'] },
    ],
    findings: [
      { id: 'C01', title: '不同疫苗平台诱导的免疫谱需要分开比较', shared_result: '信使核糖核酸、病毒载体和蛋白亚单位试验证明各平台都可以达到可测量的保护终点，但抗原、佐剂和细胞免疫读出并不相同。', research_use: '跨平台比较时对齐抗原、剂次、终点和实验室方法；平台标签与具体处方分开记录。', boundary: '一种平台的效力或抗体数值不能写成另一种平台的性能。', sources: ['H032S001', 'H032S002', 'H032S003', 'H032S007', 'H032S009'] },
      { id: 'C02', title: '中和抗体是常用但非唯一的保护相关物', shared_result: 'Khoury、Gilbert 和加强针相关物研究证明，中和或结合抗体可以在特定终点上预测保护，但阈值依赖剂次、变异株和实验室方法。', research_use: '报告国际标准、变异株和采样时间；按剂次重新估计相关物。', boundary: '抗体阈值不是诊断或治疗标准，也不能用于个体接种决策。', sources: ['H032S005', 'H032S006', 'H032S015', 'H032S013'] },
      { id: 'C03', title: '系统疫苗学提供机制假设，不代替临床终点', shared_result: 'BNT162b2 系统疫苗学和多组学方法综述证明，接种后先天免疫程序可以被重复测量，但仍属于关联层证据。', research_use: '预先定义签名、采样窗口和独立验证队列；组学结果与临床终点分开报告。', boundary: '免疫签名不能单独写成人体效力。', sources: ['H032S004', 'H032S017', 'H032S018'] },
      { id: 'C04', title: '保护相关物依赖终点定义和时间窗口', shared_result: 'Plotkin 框架、结核相关物综述和保护持久性综述都表明，相关物随疾病定义、随访时间和病原特异读出而改变。', research_use: '写清终点是感染、疾病还是重症；报告衰减和突破感染。', boundary: '不能把一种疾病的相关物套用到另一种病原。', sources: ['H032S012', 'H032S014', 'H032S016', 'H032S019'] },
      { id: 'C05', title: '本页比较平台与读出，不提供诊疗建议', shared_result: '保护相关物研究把免疫测量与研究终点联系起来，用于分层和桥接，而不是给出诊断、治疗或监管申报路径。', research_use: '在研究设计中使用相关物；涉及个体医疗决定时离开本页框架。', boundary: '不提供接种建议、商品推荐或监管申报指引。', sources: ['H032S012', 'H032S014', 'H032S016'] },
    ],
    pmids: [29326426, 33301246, 33378609, 34252919, 34002089, 34812653, 33306989, 35889169, 34192426, 32877576, 36678486, 20463105, 31767462, 35661178, 37516771, 39478007, 30317555, 32504952, 38488132, 36303436],
    refMeta: [
      ['review', 'mRNA vaccinology', 'platform review', 'mRNA vaccine principles', 'review; pre-pandemic and early human data'],
      ['primary_research', 'BNT162b2 trial', 'randomized efficacy trial', 'symptomatic COVID-19 endpoint', 'trial population and variant period specific'],
      ['primary_research', 'mRNA-1273 trial', 'randomized efficacy trial', 'symptomatic COVID-19 endpoint', 'trial population and variant period specific'],
      ['primary_research', 'BNT162b2 systems vaccinology', 'human innate and adaptive programmes', 'mechanistic immune signatures', 'associational systems immunology'],
      ['primary_research', 'neutralizing antibody models', 'protection prediction', 'symptomatic infection correlate', 'modelled across studies; method-dependent'],
      ['primary_research', 'mRNA-1273 correlates', 'immune correlates analysis', 'vaccine efficacy trial correlate', 'trial-specific threshold'],
      ['primary_research', 'ChAdOx1 nCoV-19', 'randomized viral-vector trial', 'viral vector platform efficacy', 'interim pooled analysis'],
      ['review', 'viral vector vaccines', 'platform development during COVID-19', 'vector design comparison', 'review; heterogeneous vectors'],
      ['primary_research', 'NVX-CoV2373', 'randomized protein-subunit trial', 'adjuvanted protein platform', 'trial-specific population'],
      ['primary_research', 'spike nanoparticle vaccine', 'phase 1-2 protein vaccine', 'early immunogenicity', 'early-phase; not confirmatory efficacy'],
      ['review', 'self-amplifying RNA', 'alternative RNA platforms', 'saRNA design space', 'review; limited human confirmatory data'],
      ['review', 'vaccine immunology', 'correlates of protection framework', 'general CoP logic', 'conceptual review'],
      ['review', 'immunologic correlates', 'updates on vaccine-induced protection', 'CoP measurement updates', 'review; disease-specific'],
      ['review', 'SARS-CoV-2 immunology', 'correlates of protection and disease', 'COVID-19 CoP synthesis', 'review; methods vary'],
      ['primary_research', 'BNT162b2 booster', 'booster correlate analysis', 'dose-specific CoP', 'booster context only'],
      ['review', 'tuberculosis vaccines', 'immune correlates as research tool', 'TB CoP development', 'review; TB endpoints differ'],
      ['review', 'systems vaccinology', 'big-data vaccine development', 'multi-omics study design', 'review; signatures need validation'],
      ['review', 'systems vaccinology methods', 'multi-omics and single-cell profiling', 'method horizon', 'review; not a single trial'],
      ['review', 'vaccine durability', 'duration of vaccine-induced protection', 'waning and endpoint choice', 'review; pathogen-specific'],
      ['primary_research', 'saRNA Ebola model', 'mouse lethal challenge', 'preclinical saRNA protection', 'animal model; not human efficacy'],
    ],
    techBody: '本专题的技术卡包括疫苗平台对照、结合与中和抗体测定、细胞免疫读出、系统疫苗学签名，以及保护相关物建模。技术选择取决于需要比较的是平台差异、体液相关物还是机制假设。',
    scopeBody: '本页用于介绍新型疫苗平台与免疫保护相关物研究中的证据类型和适用边界，用于研究导航。保护相关物不是诊疗建议，本页不提供接种、诊断、治疗、商品推荐或监管申报指引。',
  },
  {
    topic_id: 'H033',
    title: '抗微生物耐药与新型抗感染策略',
    slug: 'antimicrobial-resistance-anti-infective-strategies',
    overview: [
      '抗微生物耐药研究同时处理两件不同的事：现有药物如何失效，以及新的抗感染策略在什么模型里显示出活性。疾病负担分析给出人群层损失；机制研究追问外膜通透、靶点修饰和酶解；发现平台则检验新骨架、铁载体头孢菌素、噬菌体和序列特异核酸酶。这些层级不能互相替代。',
      '本方向从全球耐药负担、新骨架抗生素、进入路径、噬菌体和 CRISPR 抗感染策略出发，集中处理三类问题：耐药表型由哪一层机制解释；新策略在何种模型和读出下显示活性；这些证据如何与病原传播监测分开。病原体基因组监测由 H031 专题处理，本页不把爆发谱系写成抗感染方案。',
      '比较公开研究时，需要同时交代菌种、耐药表型、靶点、模型系统和安全性读出。本页是研究导航，不是诊疗、商品推荐或监管申报指引。动物或体外活性不能写成临床用药方案。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 耐药表型与基因型 | 菌种、最低抑菌浓度、耐药基因和调控背景 | 失效由酶解、靶点改变还是进入受限解释 |\n| 作用靶点 | 细胞壁、外膜组装、铁摄取或其他节点 | 新策略打击的是哪一层细菌生理 |\n| 模型系统 | 体外、动物感染、噬菌体宿主范围或宏基因组 | 活性停留在哪一证据层级 |\n| 策略类型 | 新骨架小分子、铁载体偶联、噬菌体或序列特异核酸酶 | 不同策略的失败模式是否相同 |\n| 安全与演进 | 毒性、耐药演进和转导风险 | 活性之外还有哪些必须独立测量的结果 |',
    sections: [
      {
        title: '全球疾病负担研究把耐药写成可比较的健康损失',
        body: '2019 年全球细菌耐药负担系统分析证明，耐药可以按死亡和伤残调整生命年在国家和病原层面比较。世界卫生组织非洲区的后续分析进一步证明，区域负担和病原谱并不均匀。\n\n负担研究适合设定监测和发现的优先顺序。疾病负担不是某一药物失效的机制证明，也不能直接指定应使用哪一种抗感染策略。',
        source_ids: ['H033S001', 'H033S020'],
      },
      {
        title: '新骨架抗生素针对细胞壁和外膜组装机器',
        body: 'teixobactin 研究证明新骨架可以在检测限度内抑制病原且当时未观察到耐药。darobactin 系列研究进一步证明，选择性杀伤革兰阴性菌可以通过抑制外膜插入酶 BamA 实现，结构引导的生物合成还能提高活性。抗生素发现科学综述则把这类结果放回培养和筛选平台的长期约束中。\n\n新骨架研究适合提出靶点和耐药演进假设。体外或动物活性不是临床方案，毒性、药代和后续耐药仍需独立评估。',
        source_ids: ['H033S002', 'H033S003', 'H033S004', 'H033S005', 'H033S006', 'H033S007'],
      },
      {
        title: '铁载体头孢菌素和外膜通透说明进入路径同样关键',
        body: '头孢地尔的化学与体内谱研究证明，借助铁摄取进入革兰阴性菌可以扩展头孢菌素活性范围。外膜通透综述和鲍曼不动杆菌耐药机制研究则证明，许多候选物首先败在进入和外排，而不是靶点本身。\n\n进入路径读出应与最低抑菌浓度和靶点生化分开报告。铁载体策略依赖细菌铁摄取状态，模型中的活性不能自动外推到所有感染部位。',
        source_ids: ['H033S008', 'H033S009', 'H033S010', 'H033S011'],
      },
      {
        title: '噬菌体和序列特异核酸酶提供非传统抗感染读出',
        body: '2014 年两项 CRISPR 研究证明，向导核糖核酸可以引导核酸酶产生序列特异的抗菌活性。后续噬菌体衣壳递送 CRISPR-Cas13a 的工作把这一策略推进到耐甲氧西林金黄色葡萄球菌模型。噬菌体治疗综述则讨论宿主范围、耐药演进和转导风险。\n\n这些策略适合作为研究工具和概念验证。噬菌体或核酸酶活性不是常规治疗方案，转导抗性基因的风险必须单独测量。',
        source_ids: ['H033S012', 'H033S013', 'H033S014', 'H033S016', 'H033S017', 'H033S018'],
      },
      {
        title: '专题边界：耐药机制研究不等于病原体传播监测',
        body: '铜绿假单胞菌耐药趋势综述和 CRISPR-Cas 用于对抗耐药的方法讨论，说明机制层证据与传播层证据回答不同问题。检出耐药基因或移动元件，可以支持机制或负担分析，却不能单独重建爆发传播链。\n\n若研究核心是谱系、采样框和污水监测，应使用 H031 专题。本页要求把耐药表型、靶点和抗感染策略放在同一叙述中，并且不把爆发谱系写成用药建议。两页可以交叉引用，结论必须分开写。',
        source_ids: ['H033S015', 'H033S019', 'H033S001', 'H033S010'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '耐药测定', title: '表型药敏与耐药基因分型', principle: '同步测量最低抑菌浓度或折点表型，并检测耐药基因、调控突变和移动元件。', answers: '判断失效由酶解、靶点改变、外排还是进入受限解释。', sample_design: '记录菌种、折点标准、基因检测面板和对照株；表型与基因型不一致时保留原始数据。', limitations: '基因型阳性不等于表型耐药；折点标准更新会使旧结论失效。', sources: ['H033S001', 'H033S011', 'H033S019'] },
      { id: 'M02', order: 2, category: '化合物发现', title: '新骨架筛选与靶点验证', principle: '在不可培养或重新设计的筛选平台中寻找新骨架，并用遗传或结构方法确认靶点。', answers: '提出候选物打击的细菌生理节点，以及耐药演进是否被观察到。', sample_design: '报告筛选文库、宿主菌、耐药演进实验和正交靶点证据；保留阴性骨架。', limitations: '体外杀菌不等于体内疗效；未检出耐药不等于不会出现耐药。', sources: ['H033S002', 'H033S003', 'H033S006', 'H033S007'] },
      { id: 'M03', order: 3, category: '进入路径', title: '外膜通透、外排与铁摄取测定', principle: '定量外膜通透、外排泵和铁载体摄取对化合物积累的影响，并与抑菌活性配对。', answers: '区分活性不足是因为靶点无效还是因为进不去菌体。', sample_design: '使用通透缺陷株、外排抑制和铁限制条件；报告积累量和时间曲线。', limitations: '模型培养基中的铁状态与感染部位不同；通透读出不能代替体内分布。', sources: ['H033S008', 'H033S009', 'H033S010', 'H033S004'] },
      { id: 'M04', order: 4, category: '噬菌体策略', title: '宿主范围、裂解活性与转导风险', principle: '测定噬菌体对目标菌群的宿主范围和裂解动力学，并检查是否转导耐药基因。', answers: '评估噬菌体策略在特定菌群中是否具有可重复的研究活性。', sample_design: '报告噬菌体鉴定、宿主谱、剂量和转导检测；保留耐药演进实验。', limitations: '窄宿主范围限制外推；转导风险使活性不能直接写成治疗方案。', sources: ['H033S016', 'H033S017', 'H033S018'] },
      { id: 'M05', order: 5, category: '序列特异策略', title: 'CRISPR 核酸酶与递送载体评价', principle: '设计针对耐药基因或必需基因的向导核糖核酸，并通过噬菌体或质粒递送检验序列特异杀伤。', answers: '检验核酸酶策略是否只作用于预定序列，以及递送是否成为限制步骤。', sample_design: '设置脱靶对照、递送空载和耐药演进实验；报告递送效率和残留宿主。', limitations: '递送效率往往低于核酸酶本身；序列特异活性不是临床抗感染方案。', sources: ['H033S012', 'H033S013', 'H033S014', 'H033S015'] },
    ],
    findings: [
      { id: 'C01', title: '疾病负担与耐药机制是不同层级的证据', shared_result: '全球和非洲区负担分析证明耐药造成可比较的健康损失，但这些数字不指定失效机制，也不指定应采用哪一种抗感染策略。', research_use: '用负担数据设定优先病原；机制结论仍须回到表型和靶点实验。', boundary: '负担估计不是用药方案，也不能代替实验室机制证据。', sources: ['H033S001', 'H033S020'] },
      { id: 'C02', title: '新骨架仍须独立评估毒性和耐药演进', shared_result: 'teixobactin 和 darobactin 系列证明新骨架可以打击细胞壁或 BamA，但发现综述同时强调筛选平台和后续评估的长期约束。', research_use: '报告靶点、耐药演进实验和正交结构证据；活性与毒性分开写。', boundary: '体外或动物活性不是临床方案。', sources: ['H033S002', 'H033S003', 'H033S004', 'H033S005', 'H033S006'] },
      { id: 'C03', title: '进入路径常常先于靶点决定候选物命运', shared_result: '头孢地尔和外膜通透研究说明，铁摄取、外膜屏障和外排会决定化合物能否到达靶点。', research_use: '配对积累量、通透缺陷株和抑菌读出；铁限制条件单独报告。', boundary: '模型中的进入优势不能自动外推到所有感染部位。', sources: ['H033S008', 'H033S009', 'H033S010', 'H033S011'] },
      { id: 'C04', title: '噬菌体和 CRISPR 是研究策略，不是常规治疗方案', shared_result: '序列特异核酸酶和噬菌体综述证明非传统策略可以在模型中显示活性，同时带来宿主范围、转导和递送限制。', research_use: '预先定义宿主谱、脱靶和转导检测；递送失败作为主要结果报告。', boundary: '模型活性不是诊疗建议，也不构成监管申报指引。', sources: ['H033S012', 'H033S013', 'H033S014', 'H033S016', 'H033S018'] },
      { id: 'C05', title: '耐药机制与病原监测必须分开写', shared_result: '铜绿假单胞菌机制综述和 CRISPR 方法讨论回答的是失效和干预策略，而不是传播链或污水谱系。传播与监测由 H031 处理。', research_use: '机制、靶点和策略用本页框架；谱系、采样框和污水监测转到 H031。', boundary: '耐药基因检出不能重建爆发传播；爆发谱系不能写成抗感染方案。', sources: ['H033S015', 'H033S019', 'H033S001'] },
    ],
    pmids: [35065702, 25561178, 31747680, 33854236, 36308277, 32197064, 23629505, 31724047, 30712199, 29695921, 28348979, 25282355, 25240928, 39271957, 32368102, 39167154, 35889048, 40410050, 38646632, 38134946],
    refMeta: [
      ['primary_research', 'global AMR burden', 'systematic analysis for 2019', 'deaths and DALYs by pathogen', 'burden estimate; not a mechanism study'],
      ['primary_research', 'teixobactin discovery', 'new antibiotic scaffold', 'killing without detected resistance', 'foundational discovery; later resistance still possible'],
      ['primary_research', 'darobactin discovery', 'Gram-negative selective antibiotic', 'BamA-targeting scaffold', 'discovery paper; preclinical'],
      ['primary_research', 'darobactin mechanism', 'BamA structural inhibition', 'outer-membrane insertase target', 'structural mechanism'],
      ['primary_research', 'engineered darobactins', 'cryo-EM guided biosynthesis', 'improved antibiotic activity', 'analogue series; not clinical'],
      ['review', 'antibiotic discovery', 'science of antibiotic discovery', 'screening platform constraints', 'review'],
      ['review', 'antibiotic discovery platforms', 'historical discovery platforms', 'why screens fail', 'review; older platform survey'],
      ['review', 'cefiderocol chemistry', 'siderophore cephalosporin profiles', 'iron-uptake enabled entry', 'review of discovery chemistry'],
      ['review', 'cefiderocol activity', 'carbapenem-resistant Gram-negatives', 'in vitro and early clinical context', 'review; not a prescribing guide'],
      ['review', 'outer membrane permeability', 'antibiotic entry barriers', 'permeability and efflux', 'review'],
      ['review', 'Acinetobacter baumannii', 'pathogenesis and resistance', 'treatment-option research landscape', 'review; not clinical protocol'],
      ['primary_research', 'CRISPR antimicrobials', 'sequence-specific nucleases', 'RNA-guided antibacterial activity', 'foundational in vitro/in vivo model'],
      ['primary_research', 'RNA-guided nucleases', 'efficiently delivered antimicrobials', 'sequence-specific killing', 'foundational delivery study'],
      ['primary_research', 'CRISPR-Cas13a phagemid', 'MRSA-targeted antimicrobial', 'capsid delivery of Cas13a', 'model organism study'],
      ['review', 'CRISPR-Cas and AMR', 'possible uses against resistance', 'method discussion', 'review; translational gap remains'],
      ['review', 'phage therapy', 'management of resistant infections', 'phage as research strategy', 'review; not a treatment protocol'],
      ['review', 'phage products', 'products for fighting AMR', 'product-class overview', 'review; availability varies'],
      ['review', 'phage therapy progress', 'response to antimicrobial resistance', 'recent phage research', 'review'],
      ['review', 'Pseudomonas aeruginosa AMR', 'clinical impact and innovations', 'mechanism and strategy landscape', 'review; species-specific'],
      ['primary_research', 'WHO African region AMR', 'cross-country systematic analysis', 'regional burden', 'burden analysis; not mechanism'],
    ],
    techBody: '本专题的技术卡包括表型药敏与基因分型、新骨架筛选与靶点验证、外膜通透与铁摄取测定、噬菌体宿主范围与转导检测，以及 CRISPR 核酸酶递送评价。技术选择取决于需要确认的是失效机制、进入路径还是非传统策略的模型活性。',
    scopeBody: '本页用于介绍抗微生物耐药与新型抗感染策略研究中的证据类型和适用边界，用于研究导航。不提供诊疗、商品推荐、监管申报或临床用药建议。病原体传播与基因组监测见 H031。',
  },
  {
    topic_id: 'H041',
    title: 'RNA、脂质纳米颗粒与靶向递送',
    slug: 'rna-lipid-nanoparticle-targeted-delivery',
    overview: [
      '核糖核酸药物能否到达预定细胞，很大程度上取决于脂质纳米颗粒的组成、电荷和给药路径。可电离脂质、辅助脂质、胆固醇和聚乙二醇脂质共同决定颗粒在血液中的稳定性、内体逃逸和器官向性。近年来的工作不再只问肝脏能否表达，而是问向性能否被改写到脾、造血干细胞、中枢或其他组织。',
      '本方向从可电离脂质处方、选择性器官靶向、肝外递送和脂质化学搜索出发，集中处理三类问题：脂质组成如何改变生物分布；选择性器官靶向把默认肝脏递送改写到何种程度；表达或沉默读出能够支持什么结论。本页讨论递送研究设计，不提供临床用药、制剂处方或监管申报指引。',
      '比较公开研究时，需要同时交代核酸载荷、脂质摩尔比、粒径、给药路径、器官读出和毒性指标。已获批制剂的脂质技术比较只用于说明处方差异，不能写成用药建议。表达上升不等于临床获益。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 核酸载荷 | 信使核糖核酸、小干扰核糖核酸、质粒或编辑系统 | 读出是表达、沉默还是基因组改写 |\n| 脂质组成 | 可电离脂质、辅助脂质、胆固醇、聚乙二醇脂质和摩尔比 | 稳定性、逃逸和向性由哪一层处方决定 |\n| 器官向性 | 肝、脾、肺、造血、中枢或肿瘤局部 | 默认肝脏递送是否被改写 |\n| 读出指标 | 蛋白表达、基因沉默、编辑效率和细胞类型 | 结果停留在组织平均还是目标细胞 |\n| 毒性与免疫 | 肝酶、补体、细胞因子和重复给药 | 活性之外还有哪些必须报告的代价 |',
    sections: [
      {
        title: '可电离脂质纳米颗粒成为核糖核酸递送的主流载体',
        body: '信使核糖核酸脂质纳米颗粒综述系统整理了可电离脂质、内体逃逸和体内表达之间的关系。递送技术综述和氨基脂质系列研究进一步证明，脂质头基和可电离性质会改变逃逸效率和持续表达。小干扰核糖核酸脂质纳米颗粒的临床转化综述则说明，同一载体类别已经在沉默药物中完成过处方到人体的跨越。\n\n这些工作适合作为处方比较的起点。脂质名称和摩尔比必须写清，不能把“脂质纳米颗粒”当作单一实体。已上市制剂的技术比较只说明处方差异，不构成本页的用药建议。',
        source_ids: ['H041S001', 'H041S005', 'H041S006', 'H041S007', 'H041S008'],
      },
      {
        title: '选择性器官靶向把默认肝脏递送改写成可调向性',
        body: '选择性器官靶向纳米颗粒研究证明，通过补充带电脂质可以把信使核糖核酸和基因编辑载荷导向肺、脾或其他器官。后续方案论文和机制分析进一步证明，向性改变可以在多种制备方法中重复，并与蛋白冠和颗粒电荷有关。\n\n器官靶向结果适合提出向性假设。组织平均表达不等于目标细胞已被转染；给药路径和剂量窗口会显著改变分布。',
        source_ids: ['H041S002', 'H041S003', 'H041S004'],
      },
      {
        title: '肝外递送需要同时改脂质组成和给药路径',
        body: '肝外核酸递送综述总结了屏障、蛋白冠和免疫清除如何把颗粒重新导向肝脏。提高鞘磷脂比例、加入胆汁酸脂质，以及用小分子改写无配体向性的研究，分别证明组成微调可以增加肝外表达。体内造血干细胞递送则把目标从实质器官推进到稀有细胞群。\n\n肝外结果必须报告细胞类型，而不是只报告器官匀浆。屏障和免疫反应会使同一处方在不同物种中表现不同。',
        source_ids: ['H041S010', 'H041S011', 'H041S012', 'H041S015', 'H041S020'],
      },
      {
        title: '脂质化学和机器学习正在扩大可电离脂质的搜索空间',
        body: '组合化学与机器学习筛选证明，可电离脂质结构可以按转染效率被加速搜索。胺头基优化和肝脏表达处方研究提供了更传统的化学迭代对照。降低肝毒性并增强脾向性的缩酮酯脂质，以及肽可电离脂质的组织和编辑研究，进一步说明化学改写可以同时改变活性和毒性。\n\n化学搜索适合提出可重复的构效假设。高通量转染分数不能代替体内分布、重复给药和免疫读出。',
        source_ids: ['H041S014', 'H041S018', 'H041S019', 'H041S017', 'H041S016'],
      },
      {
        title: '专题边界：递送研究不是临床用药建议',
        body: '血脑屏障穿越脂质纳米颗粒和已获批制剂的脂质技术比较，说明递送研究可以讨论人体相关处方，但讨论对象仍是载体性质，不是给药方案。嵌合抗原受体 T 细胞工程化等应用只证明该载体能把信使核糖核酸送进特定细胞。\n\n本页用于比较核糖核酸载荷、脂质处方和器官向性。表达、沉默或编辑读出不是疗效结论，也不提供制剂处方、临床用药或监管申报指引。疫苗平台中的免疫保护相关物由 H032 处理；本页不把递送效率写成接种建议。',
        source_ids: ['H041S013', 'H041S006', 'H041S009', 'H041S001'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '处方与工艺', title: '脂质组成、混合工艺与颗粒表征', principle: '按预定摩尔比混合可电离脂质、辅助脂质、胆固醇和聚乙二醇脂质，并测定粒径、电荷和包封率。', answers: '确认不同处方在物理化学层是否真的被做成不同颗粒。', sample_design: '固定混合方法、核酸脂质比和储存条件；报告批次间粒径和包封率。', limitations: '实验室规模工艺不能直接外推到放大生产；表征合格不等于体内向性相同。', sources: ['H041S001', 'H041S007', 'H041S008', 'H041S003'] },
      { id: 'M02', order: 2, category: '生物分布', title: '器官向性、蛋白冠与给药路径', principle: '在给药后按时间点测量各器官的核酸、脂质或报告基因表达，并记录蛋白冠和注射途径。', answers: '判断默认肝脏递送是否被改写，以及改写发生在器官还是细胞层。', sample_design: '预先定义器官列表、剂量和取样时间；关键器官做细胞类型分选或原位验证。', limitations: '组织匀浆会掩盖细胞偏好；物种差异使小鼠分布不能直接写成人体分布。', sources: ['H041S002', 'H041S004', 'H041S010', 'H041S015'] },
      { id: 'M03', order: 3, category: '功能读出', title: '表达、沉默与基因组编辑测定', principle: '按载荷类型测量蛋白表达、目标基因沉默或编辑效率，并与细胞类型而不是器官平均值对齐。', answers: '确认核酸是否在目标细胞中发挥预定功能。', sample_design: '设置未处理、空载和序列对照；报告剂量反应和持续时间。', limitations: '瞬时表达不等于持久功能；编辑读出需要脱靶分析。', sources: ['H041S012', 'H041S009', 'H041S016', 'H041S011'] },
      { id: 'M04', order: 4, category: '安全读出', title: '肝毒性、免疫激活与重复给药', principle: '同步测量肝酶、细胞因子、补体和体重或组织病理，并在重复给药后复查向性是否改变。', answers: '判断活性提高是否伴随不可接受的毒性或免疫代价。', sample_design: '预设毒性终点、采样窗口和重复给药间隔；报告个体变异。', limitations: '动物毒性谱不能写成人体安全性；体外细胞因子不能代替体内免疫。', sources: ['H041S017', 'H041S006', 'H041S013', 'H041S001'] },
      { id: 'M05', order: 5, category: '化学优化', title: '可电离脂质搜索与配体或组成微调', principle: '通过组合化学、机器学习或配体添加搜索新脂质，并用同一生物分布和功能读出比较。', answers: '检验化学改写是否稳定改变向性、逃逸或毒性。', sample_design: '固定比较基准处方；新脂质至少在两个独立动物批次中复核。', limitations: '高通量转染分数容易过拟合；配体修饰可能改变稳定性。', sources: ['H041S014', 'H041S019', 'H041S020', 'H041S018'] },
    ],
    findings: [
      { id: 'C01', title: '脂质组成决定稳定性和默认向性', shared_result: '可电离脂质综述、氨基脂质系列和小干扰核糖核酸转化研究证明，头基、可电离性质和摩尔比会共同改变逃逸、表达和肝脏默认分布。', research_use: '写清四种脂质的摩尔比、粒径和包封率；不同处方分开比较。', boundary: '“脂质纳米颗粒”不是单一实体；已上市制剂比较不是用药建议。', sources: ['H041S001', 'H041S005', 'H041S006', 'H041S007'] },
      { id: 'C02', title: '选择性器官靶向可以改写但不是消除肝脏分布', shared_result: '选择性器官靶向的发现、方案和机制研究证明，补充带电脂质可以把载荷导向肺或脾，同时仍需报告肝脏残留和细胞类型。', research_use: '记录补充脂质、给药路径和细胞层读出；器官匀浆与分选结果分开写。', boundary: '组织平均表达不等于目标细胞转染。', sources: ['H041S002', 'H041S003', 'H041S004'] },
      { id: 'C03', title: '肝外递送同时受组成、屏障和免疫限制', shared_result: '肝外递送综述、鞘磷脂和胆汁酸改写，以及造血干细胞体内递送，说明组成微调可以增加肝外信号，但屏障和清除仍在。', research_use: '报告细胞类型、屏障模型和免疫读出；物种差异单独讨论。', boundary: '小鼠肝外表达不能直接写成人体靶向。', sources: ['H041S010', 'H041S011', 'H041S012', 'H041S015'] },
      { id: 'C04', title: '化学搜索必须配上体内分布和毒性', shared_result: '机器学习筛选、胺头基优化和低肝毒性脾向性脂质证明，化学空间可以被加速搜索，但转染分数不能代替体内重复给药。', research_use: '新脂质至少用生物分布、功能和毒性三组读出比较；保留失败结构。', boundary: '高通量分数不是递送成功的充分证据。', sources: ['H041S014', 'H041S017', 'H041S019', 'H041S016'] },
      { id: 'C05', title: '递送读出不是临床用药或制剂处方', shared_result: '血脑屏障递送和已获批制剂技术比较说明，人体相关处方可以被讨论，但讨论对象是载体性质。表达、沉默或编辑不是疗效。', research_use: '把结果写成递送效率、细胞类型和毒性；涉及用药或申报时离开本页。', boundary: '本页不提供临床用药、制剂处方或监管申报指引。疫苗保护相关物见 H032。', sources: ['H041S013', 'H041S006', 'H041S009', 'H041S001'] },
    ],
    pmids: [34394960, 32251383, 36316378, 34933999, 31397996, 34757287, 29653760, 30846391, 31951421, 38621638, 37564393, 37499029, 39962245, 38740955, 38164140, 40890498, 39387241, 32691013, 34647548, 36617516],
    refMeta: [
      ['review', 'mRNA LNP delivery', 'lipid nanoparticle review', 'ionizable LNP principles', 'review; formulation class overview'],
      ['primary_research', 'SORT nanoparticles', 'selective organ targeting', 'tissue-specific mRNA and CRISPR delivery', 'mouse and formulation-specific'],
      ['primary_research', 'SORT preparation', 'multiple technical methods', 'reproducible organ targeting', 'protocol paper'],
      ['primary_research', 'SORT mechanism', 'tissue-specific delivery mechanism', 'protein corona and charge', 'mechanistic mouse study'],
      ['review', 'siRNA LNP translation', 'clinical translation of siRNA LNPs', 'approved-class formulation lessons', 'review of technology class; not a prescription'],
      ['review', 'approved LNP comparison', 'siRNA and mRNA drug lipid technologies', 'formulation differences among approved products', 'comparison of technologies; not dosing advice'],
      ['primary_research', 'amino lipid series', 'improved endosomal escape', 'sustained pharmacology in NHP', 'non-human primate; specific lipid series'],
      ['review', 'therapeutic mRNA delivery', 'delivery technology advances', 'carrier landscape', 'review'],
      ['primary_research', 'CAR T engineering', 'ionizable LNP mRNA in human T cells', 'ex vivo cell engineering', 'cell-therapy context; not in-vivo dosing'],
      ['review', 'extrahepatic LNP delivery', 'challenges and opportunities', 'barriers beyond the liver', 'review'],
      ['primary_research', 'sphingomyelin LNPs', 'hepatic and extrahepatic expression', 'composition-tuned tropism', 'formulation study'],
      ['primary_research', 'in vivo HSC modification', 'mRNA delivery to hematopoietic stem cells', 'rare-cell targeting', 'specialized in vivo model'],
      ['primary_research', 'BBB-crossing LNPs', 'mRNA delivery to the central nervous system', 'barrier-crossing formulation', 'preclinical CNS model'],
      ['primary_research', 'ionizable lipid ML', 'machine learning and combinatorial chemistry', 'accelerated lipid discovery', 'computational-experimental screen'],
      ['primary_research', 'bile-acid LNPs', 'enhanced extrahepatic mRNA delivery', 'composition change for extrahepatic signal', 'preclinical formulation'],
      ['primary_research', 'peptide-ionizable LNPs', 'tissue-specific mRNA and prime editing', 'peptide-modified tropism', 'preclinical; editing context'],
      ['primary_research', 'ketal-ester ionizable lipid', 'reduced hepatotoxicity and spleen tropism', 'toxicity-tropism trade-off', 'preclinical vaccine-delivery context'],
      ['primary_research', 'hepatic mRNA LNP', 'optimized mRNA and ionizable LNP', 'liver expression optimization', 'hepatic default delivery'],
      ['primary_research', 'lipid amine-head groups', 'in vivo mRNA delivery optimization', 'head-group structure-activity', 'chemistry iteration'],
      ['primary_research', 'ligand-independent tropism', 'small-molecule retargeting of siRNA-LNP', 'liver versus myeloid tropism', 'preclinical retargeting'],
    ],
    techBody: '本专题的技术卡包括脂质处方与颗粒表征、器官向性与蛋白冠、表达或编辑功能读出、肝毒性与免疫，以及可电离脂质化学搜索。技术选择取决于需要确认的是颗粒是否做成、向性是否改写，还是活性伴随何种毒性。',
    scopeBody: '本页用于介绍核糖核酸脂质纳米颗粒与靶向递送研究中的证据类型和适用边界，用于研究导航。不提供临床用药、制剂处方、商品推荐或监管申报指引。疫苗平台与保护相关物见 H032。',
  },
];

function buildTopic(topicData, pubmedMeta) {
  const { topic_id } = topicData;
  const references = pubmedMeta.map((meta, i) =>
    makeReference(topic_id, i + 1, meta, {
      source_type: topicData.refMeta[i][0],
      study_context: topicData.refMeta[i][1],
      study_design: topicData.refMeta[i][2],
      usable_for: topicData.refMeta[i][3],
      limitations: topicData.refMeta[i][4],
    }),
  );

  const sections = [
    {
      section_id: `${topic_id}-SEC-01`,
      title: '比较不同研究时应先看什么',
      body: topicData.comparisonTable,
      source_ids: [],
    },
    ...topicData.sections.map((section, i) => ({
      section_id: `${topic_id}-SEC-${String(i + 2).padStart(2, '0')}`,
      title: section.title,
      body: section.body,
      source_ids: section.source_ids,
    })),
    {
      section_id: `${topic_id}-SEC-${String(topicData.sections.length + 2).padStart(2, '0')}`,
      title: '研究技术',
      body: topicData.techBody,
      source_ids: [],
    },
    {
      section_id: `${topic_id}-SEC-${String(topicData.sections.length + 3).padStart(2, '0')}`,
      title: '科研参考范围',
      body: topicData.scopeBody,
      source_ids: [],
    },
  ];

  const methods = topicData.methods.map((m) => {
    const extras = methodExtras(m.sample_design, m.principle, m.answers, m.limitations);
    return {
      method_id: `${topic_id}-${m.id}`,
      display_order: m.order,
      category: m.category,
      title: m.title,
      principle: m.principle,
      answers: m.answers,
      sample_design: m.sample_design,
      limitations: m.limitations,
      source_ids: m.sources,
      ...extras,
    };
  });

  const shared_findings = topicData.findings.map((f) => ({
    finding_id: `${topic_id}-${f.id}`,
    display_order: Number(f.id.replace('C', '')),
    title: f.title,
    shared_result: f.shared_result,
    research_use: f.research_use,
    boundary: f.boundary,
    source_ids: f.sources,
  }));

  return {
    topic_id,
    title: topicData.title,
    topic_role: 'research_deep_dive',
    overview: topicData.overview,
    sections,
    methods,
    shared_findings,
    references,
  };
}

function writeDeepDive(topicData, topic) {
  const dir = path.join(researchRoot, 'deep-dives', topicData.topic_id);
  mkdirSync(dir, { recursive: true });

  const brief = `# ${topicData.title} 研究简报

## 专题边界

- 纳入：${topicData.techBody.split('。')[0]}。
- 排除：${topicData.scopeBody}

## 概述

${topicData.overview}

## 五栏结构

### 概述

${topicData.overview.split('\n\n')[0]}

### 研究进展

${topicData.sections.map((s) => `#### ${s.title}\n\n${s.body}`).join('\n\n')}

### 研究工具和方法

${topicData.techBody}

### 应用与疾病关联

${topicData.sections[topicData.sections.length - 1].body}

### 参考文献

本专题收录 ${topic.references.length} 条已核对来源。正文可回溯至 ${topicData.topic_id}S001 至 ${topicData.topic_id}S020 的完整题录。
`;

  const sourcesCsv = [
    'source_id,topic_id,pmid,title,journal,published_date,doi,source_type,evidence_role,pubmed_url',
    ...topic.references.map((r) =>
      [r.source_id, topicData.topic_id, r.pmid, `"${r.title.replace(/"/g, '""')}"`, r.journal, r.published_date, r.doi, r.source_type, r.usable_for, r.url].join(','),
    ),
  ].join('\n');

  const methodsCsv = [
    'topic_id,method_id,display_order,category,title,what_it_measures,when_to_use,input_and_design,primary_output,quality_checks,limitations,source_ids',
    ...topic.methods.map((m) =>
      [topicData.topic_id, m.method_id, m.display_order, m.category, m.title, m.principle, m.answers, m.sample_design, m.answers, m.quality_control.slice(0, 120), m.limitations, m.source_ids.join('|')].join(','),
    ),
  ].join('\n');

  const publicDraft = `# ${topicData.title} 公开初稿

${topic.overview}

${topic.sections.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n')}
`;

  writeFileSync(path.join(dir, 'RESEARCH_BRIEF.md'), brief, 'utf8');
  writeFileSync(path.join(dir, 'sources.csv'), `${sourcesCsv}\n`, 'utf8');
  writeFileSync(path.join(dir, 'methods.csv'), `${methodsCsv}\n`, 'utf8');
  writeFileSync(path.join(dir, 'PUBLIC_DRAFT.md'), publicDraft, 'utf8');
}

async function main() {
  const topics = [];
  for (const topicData of topicsData) {
    const pubmedMeta = await fetchPubmedSummaries(topicData.pmids);
    const topic = buildTopic(topicData, pubmedMeta);
    if (topic.sections.length !== 8) throw new Error(`${topicData.topic_id} sections: ${topic.sections.length}`);
    if (topic.methods.length !== 5) throw new Error(`${topicData.topic_id} methods`);
    if (topic.references.length !== 20) throw new Error(`${topicData.topic_id} references`);
    const refIds = new Set(topic.references.map((r) => r.source_id));
    for (const sid of [...topic.sections.flatMap((s) => s.source_ids), ...topic.methods.flatMap((m) => m.source_ids), ...topic.shared_findings.flatMap((f) => f.source_ids)]) {
      if (!refIds.has(sid)) throw new Error(`${topicData.topic_id} missing ${sid}`);
    }
    writeDeepDive(topicData, topic);
    topics.push(topic);
    console.log(`Built ${topicData.topic_id}: ${topic.references.length} references`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const snapshot = {
    schema_version: 'research-deep-dive-public-v0.1',
    batch_id: 'B09',
    title: '感染监测、疫苗与核酸递送',
    publication_status: 'snapshot_ready',
    frontend_status: 'snapshot_ready',
    topics,
  };

  const outJson = path.join(root, 'src', 'data', 'knowledge', 'research-trends-b09.generated.json');
  writeFileSync(outJson, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outJson} with ${topics.length} topics`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
