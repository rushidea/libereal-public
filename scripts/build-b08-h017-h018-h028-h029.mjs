import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
    topic_id: 'H017',
    title: '多器官生物衰老与健康寿命机制',
    slug: 'multi-organ-biological-aging-healthspan',
    overview: [
      '衰老在不同器官和组织中并不以同一速度或同一分子程序发生。血液、粪便或单一组织样本可以反映部分变化，却难以回答：哪些改变是全身性的，哪些是器官特异的，哪些与功能下降或疾病风险共同出现。多器官衰老研究因此需要把取样部位、细胞类型、功能读出和随访时间放在同一设计里，而不是把全身指标当作所有器官的代理。',
      '本方向从多组织单细胞图谱、器官特异性衰老时钟、系统循环因子和表观遗传读出出发，集中处理三类问题：不同器官共享与特异的衰老特征如何分层；局部细胞状态变化与器官功能、健康寿命终点如何配对；观察到的关联能否在独立队列、扰动实验或纵向取样中被复核。由此可以把分子变化放回具体器官和细胞语境，而不是把单一生物标志物写成全身衰老的完整解释。',
      '比较公开研究时，需要同时交代物种、年龄范围、取样器官、细胞分型依据、功能测量和随访设计。跨器官重复出现的程序仍须回到具体组织解释。抗衰老产品宣传、个体化延寿建议不在本页范围；细胞器应激与死亡读出由细胞器互作专题处理，分子记录与谱系追踪由谱系追踪专题处理。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 器官与细胞层级 | 取样器官、细胞类型、区域或层位、单细胞或 bulk | 观察到的是器官平均信号还是特定细胞状态 |\n| 衰老读出 | 转录、表观、蛋白、代谢、功能或形态指标 | 多种读出是否指向同一过程还是不同层面 |\n| 时间设计 | 横断面、纵向取样、干预前后、寿命或健康寿命终点 | 结果支持关联、时间关系还是特定扰动效应 |\n| 系统性因素 | 免疫、代谢、微生物组、循环因子和共病 | 器官变化是否伴随可测量的全身背景 |\n| 验证层级 | 独立队列、扰动、正交测量和功能实验 | 关联能否推进到可检验的机制假设 |',
    sections: [
      {
        title: '多器官衰老图谱需要保留器官与细胞语境',
        body: '小鼠多组织衰老单细胞图谱显示，不同器官在细胞组成、应激反应和免疫相关程序上既有共享特征，也有明显器官特异性。配套研究进一步指出，经典衰老标志在不同器官呈现不同时间轨迹，不能把某一器官的细胞比例变化直接外推到全身。\n\n图谱结果适合提出器官间可比较的候选程序，仍需配对功能测量、病理注释和独立队列验证。同一细胞类型名称在不同器官中可能对应不同状态空间，比较时应保留器官标签和分型依据。',
        source_ids: ['H017S001', 'H017S002', 'H017S010', 'H017S011'],
      },
      {
        title: '衰老标志物研究正在从清单走向器官特异时间结构',
        body: '2023 年更新的衰老特征综述强调，不同组织中的分子、细胞和系统变化需要分别测量，并区分原因、代偿和后果。器官特异性衰老时钟和多组学签名研究提示，全身衰老评分可能掩盖局部器官轨迹。\n\n把某一表观时钟或蛋白组评分写成所有器官的共同衰老速度，会忽略取样器官和细胞构成。时钟结果适合作为分层变量或关联分析，不能单独替代器官功能或健康寿命终点。',
        source_ids: ['H017S003', 'H017S012', 'H017S013', 'H017S014'],
      },
      {
        title: '系统循环环境与神经、免疫和代谢器官共同变化',
        body: '衰老系统循环环境研究指出，血液来源因子可以影响神经发生和认知相关过程；这类证据来自特定模型和读出，不能外推为所有器官的共同驱动因子。炎症衰老概念把慢性低度炎症与年龄相关疾病风险联系起来，近期综述进一步讨论如何为炎症衰老测量建立更精确的指标。\n\n循环因子、免疫细胞组成和器官局部细胞状态应分开记录。血液测量有助于描述全身背景，却不能代替脑、肝、脂肪或肌肉等组织中的细胞与空间信息。',
        source_ids: ['H017S004', 'H017S005', 'H017S006', 'H017S015'],
      },
      {
        title: '表观遗传与部分重编程研究提供机制线索，不是临床方案',
        body: '表观遗传时钟比较研究说明，不同时钟在组织、细胞类型和异常长寿人群中的表现并不一致。部分重编程和表观遗传重置研究在动物模型中显示，某些细胞状态可以被改写，但剂量、持续时间、靶向细胞类型和安全性边界仍需独立评估。\n\n这些工作属于机制与概念验证层级，不提供个体化干预建议，也不能把体外或动物中的年轻化读出直接写成人体疗效。与全身循环因子研究一样，需要报告具体细胞类型和器官范围。',
        source_ids: ['H017S007', 'H017S008', 'H017S009', 'H017S016'],
      },
      {
        title: '健康寿命终点、微生物组与免疫重组需要分层报告',
        body: '自然产物与饮食干预综述显示，部分分子或行为干预可以在动物中改善健康寿命相关终点，但物种、剂量、起点年龄和测量终点差异很大。多组学衰老研究综述强调，要把分子层变化与功能、病理和生存结局放在同一框架中评价。\n\n微生物组年龄轨迹和免疫亚群动态研究提示，肠—免疫—代谢轴可以与多个器官衰老表型相关，但这些变化通常与饮食、感染史和共病共同出现。研究若只报告分子或菌群指标而未说明功能或寿命终点，应被视为关联层证据；微生物组或免疫指标也不能单独写成某一器官衰老的充分解释，更不能延伸为抗衰老产品结论。',
        source_ids: ['H017S013', 'H017S014', 'H017S015', 'H017S016', 'H017S017', 'H017S018', 'H017S019', 'H017S020'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '样本设计', title: '多器官配对取样与功能读出', principle: '在同一动物或队列中按预定器官列表取样，并同步记录器官功能、病理、代谢或行为读出。', answers: '判断分子变化对应哪一器官，以及是否与功能下降或健康寿命终点共同出现。', sample_design: '预先规定器官列表、年龄点、性别、品系、禁食状态和保存方式；每个器官保留病理或功能对照。', limitations: '不是所有器官都能在人体中配对取样；动物模型中的器官对应关系不能直接外推到人体。', sources: ['H017S001', 'H017S002', 'H017S010'] },
      { id: 'M02', order: 2, category: '单细胞与空间组学', title: '多组织单细胞图谱与细胞状态注释', principle: '在多个器官分别进行单细胞或单核转录组测量，再用一致的分型流程比较细胞组成和状态程序。', answers: '区分器官共享与特异的细胞状态变化，并识别需要原位或蛋白验证的候选群体。', sample_design: '统一解离方案、批次设计和参考注释；关键细胞状态用原位 RNA、蛋白或谱系标记复核。', limitations: '解离会损失空间关系并可能偏向耐受细胞；聚类标签不能代替功能或因果验证。', sources: ['H017S001', 'H017S010', 'H017S011', 'H017S019'] },
      { id: 'M03', order: 3, category: '衰老时钟与多组学', title: '器官或细胞类型特异的衰老时钟', principle: '利用 DNA 甲基化、转录组、蛋白组或其他组学层构建年龄预测模型，并分别在组织或细胞类型范围内评估。', answers: '比较不同器官或细胞类型的衰老轨迹是否一致，以及时钟偏离是否与疾病或功能相关。', sample_design: '报告训练队列、组织来源、批次校正和外部验证；不要把全身时钟直接套用到未验证器官。', limitations: '时钟反映的是统计年龄关联，不是单一衰老机制；不同算法和特征集结果可能不一致。', sources: ['H017S007', 'H017S012', 'H017S013', 'H017S014'] },
      { id: 'M04', order: 4, category: '系统循环因子', title: '血浆、血清交换与循环组学', principle: '通过血浆组学、血清交换或循环因子扰动，检验血液来源信号与特定器官功能或细胞状态的关系。', answers: '提出系统环境是否影响神经、免疫或代谢器官状态的机制假设。', sample_design: '记录供体年龄、处理时间、交换体积和读出窗口；配对器官组织和行为或功能测量。', limitations: '交换实验高度依赖模型和操作条件；循环关联不能单独证明某一因子因果驱动器官衰老。', sources: ['H017S004', 'H017S005', 'H017S006', 'H017S015'] },
      { id: 'M05', order: 5, category: '扰动与纵向随访', title: '遗传、饮食或表观扰动及健康寿命终点', principle: '在可控条件下改变候选通路、饮食或表观状态，并追踪器官分子读出、功能变化和健康寿命相关终点。', answers: '检验图谱提出的器官或系统层关联能否在扰动后重现，并与功能结局配对。', sample_design: '预先定义主要终点、样本量和取样时间；报告阴性结果和器官特异性效应。', limitations: '动物健康寿命终点不能直接写成人体干预效果；短期分子变化不等于长期功能获益。', sources: ['H017S008', 'H017S009', 'H017S016', 'H017S018'] },
    ],
    findings: [
      { id: 'C01', title: '多器官衰老同时包含共享程序与器官特异轨迹', shared_result: '多组织单细胞图谱和器官特异性衰老时钟研究表明，不同器官可以同时出现若干共享应激或免疫相关程序，但细胞组成、时间轨迹和功能关联并不一致。跨器官重复信号需要保留器官和细胞类型标签。', research_use: '记录取样器官、细胞分型依据、年龄点和功能读出；共享程序与器官特异程序分开报告。', boundary: '不能把某一器官的图谱结果直接外推为全身衰老机制；抗衰老产品或个体化干预不在本页范围。', sources: ['H017S001', 'H017S002', 'H017S012', 'H017S013'] },
      { id: 'C02', title: '系统循环因子与局部器官变化是不同层级的证据', shared_result: '衰老系统循环环境和炎症衰老研究提示，血液来源信号可以与神经、免疫和代谢器官状态共同变化，但不同研究中的因子、模型和读出并不相同。', research_use: '配对血浆或血清组学、器官组织取样和功能测量；循环指标与组织细胞状态分开分析。', boundary: '关联不等于某一循环因子因果驱动器官衰老；血液测量不能代替组织原位信息。', sources: ['H017S004', 'H017S005', 'H017S006', 'H017S015'] },
      { id: 'C03', title: '表观时钟与部分重编程是机制线索，不是疗效结论', shared_result: '表观遗传时钟比较和部分重编程研究显示，某些细胞或组织层面的表观状态可以被改写，但不同时钟在组织与细胞类型中的表现存在差异，动物模型中的恢复也不等于人体疗效。', research_use: '报告时钟训练范围、靶向细胞类型、处理剂量和安全性读出；与功能或寿命终点配对。', boundary: '不能把动物或体外年轻化写成临床抗衰老方案；机制验证仍需要独立队列和正交测量。', sources: ['H017S007', 'H017S008', 'H017S009', 'H017S016'] },
      { id: 'C04', title: '微生物组与免疫重组需要回到器官语境解释', shared_result: '微生物组年龄轨迹和免疫亚群动态研究表明，肠—免疫—代谢轴可以与多个器官衰老表型相关，但这些变化通常与饮食、感染史和共病共同出现。', research_use: '同步记录菌群组成、免疫表型和目标器官取样；干预研究保留对照和预设终点。', boundary: '微生物组或免疫指标变化不能单独写成器官衰老的充分解释；与代谢性炎症等专题的通用细胞应激需分开表述。', sources: ['H017S017', 'H017S018', 'H017S019', 'H017S020'] },
      { id: 'C05', title: '健康寿命终点必须与分子关联分开评价', shared_result: '多组学衰老研究和动物干预综述都强调，分子层变化、器官功能和生存或健康寿命终点可能不同步；只报告组学指标而未说明功能结局的研究应被视为关联层证据。', research_use: '预先定义健康寿命、虚弱或疾病发病终点，并与分子读出在同一设计中配对。', boundary: '不能把不同研究的终点改善写成同一种机制；本页不提供治疗或延寿建议。', sources: ['H017S013', 'H017S014', 'H017S015', 'H017S016'] },
    ],
    pmids: [32669714, 32669715, 36599349, 24833586, 40813813, 21886162, 28470125, 33268865, 34035273, 33847263, 38274125, 40684321, 42015851, 42398771, 33309907, 41959494, 42176809, 42662153, 41053866, 42642496],
    refMeta: [
      ['primary_research', 'mouse multi-tissue ageing', 'multi-tissue scRNA-seq atlas', 'organ-specific ageing signatures', 'mouse atlas; cross-sectional design'],
      ['primary_research', 'mouse ageing hallmarks', 'organ-specific hallmark timing', 'temporal organ signatures', 'companion analysis; not human direct evidence'],
      ['review', 'ageing biology', 'updated hallmarks framework', 'shared and distinct ageing layers', 'review; not experimental proof'],
      ['review', 'human ageing', 'inflammaging concept', 'chronic inflammation and age-related disease', 'review; heterogeneous human data'],
      ['review', 'human ageing', 'inflammaging metrics', 'precision measurement boundaries', 'review; metrics still evolving'],
      ['primary_research', 'mouse parabiosis model', 'ageing systemic milieu', 'circulating factors and neurogenesis', 'model-specific; limited organs sampled'],
      ['review', 'human epigenetic clocks', 'clock comparison', 'tissue and population differences', 'review; clocks are statistical estimators'],
      ['primary_research', 'mouse eye reprogramming', 'partial epigenetic reprogramming', 'restoration of youthful epigenetic information', 'single organ model; not clinical intervention'],
      ['primary_research', 'mouse muscle', 'in vivo partial reprogramming', 'regeneration-associated epigenetic changes', 'muscle-specific; safety not established in humans'],
      ['primary_research', 'mouse ageing atlas reanalysis', 'global ageing signatures', 'cross-organ comparison', 'computational reanalysis; depends on source atlas'],
      ['review', 'ageing biology', 'hallmark causes and consequences', 'framework for mechanism hypotheses', 'review; causal order not established'],
      ['review', 'ageing multi-omics', 'multi-omics integration', 'study design for ageing research', 'review; methods vary by tissue'],
      ['primary_research', 'human multi-omics ageing', 'organ clock signatures', 'organ-specific ageing patterns', 'conceptual and cohort-dependent'],
      ['review', 'ageing interventions', 'systemic recalibration and epigenetic resetting', 'complementary intervention hypotheses', 'review; human evidence limited'],
      ['review', 'animal healthspan studies', 'dietary and natural product interventions', 'healthspan endpoint variability', 'review; animal models predominate'],
      ['primary_research', 'single-cell age estimation', 'scMLEAge method', 'cell-level age inference', 'preprint-indexed; requires validation'],
      ['review', 'ageing theory', 'triadic ageing framework', 'conceptual synthesis', 'theoretical; not direct measurement'],
      ['primary_research', 'human microbiome ageing', 'microbiome age trajectories', 'ecosystem-level associations', 'associational; causality not established'],
      ['primary_research', 'human immune ageing', 'microRNA dynamics in immune subsets', 'immune ageing and atherosclerosis context', 'specific disease context'],
      ['primary_research', 'C. elegans microbiome', 'gut microbiota and ageing regulation', 'conserved pathway hypotheses', 'model organism; limited direct human translation'],
    ],
    techBody: '本专题的技术卡包括多器官配对取样与功能读出、多组织单细胞图谱、器官或细胞类型特异的衰老时钟、循环因子与血浆组学，以及遗传或表观扰动与健康寿命终点随访。技术选择取决于需要确认的是器官特异变化、系统循环背景还是干预后的功能结局。',
    scopeBody: '本页用于介绍多器官生物衰老与健康寿命研究中的证据类型、实验设计和适用范围，不提供抗衰老产品宣传、个体化延寿建议或临床干预推荐。',
  },
  {
    topic_id: 'H018',
    title: '细胞器互作与铁死亡',
    slug: 'organelle-interactions-ferroptosis',
    overview: [
      '铁死亡是一种依赖铁和脂质过氧化的调节性细胞死亡方式，与凋亡、坏死和焦亡在形态学、生化特征和调控节点上不同。近年研究不再只关注单一分子，而是追问：线粒体、内质网、溶酶体和相关膜接触位点如何通过脂质代谢、抗氧化系统和离子稳态共同决定铁死亡敏感性。细胞器定位改变和膜接触重塑，因此成为连接代谢应激与死亡读出的关键层面。',
      '本方向从铁死亡核心通路、细胞器间脂质与钙信号交换、内质网应激和线粒体功能障碍出发，集中处理三类问题：哪些细胞器扰动会改变脂质过氧化阈值；不同死亡方式如何在同一细胞中竞争或串联；组织特异性模型中的死亡读出能否与人体样本观察对应。由此可以把铁死亡放回具体细胞器和亚细胞位置，而不是把单一标志物当作所有应激反应的终点。',
      '比较公开研究时，需要同时交代细胞类型、死亡诱导条件、抑制剂和正交死亡标志物。通用代谢应激和炎症性细胞器应激与代谢性炎症专题存在交叉，但本页聚焦细胞器定位扰动与铁死亡等死亡读出。治疗性清除衰老细胞或抗肿瘤策略不在本页展开为临床建议。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 死亡方式 | 铁死亡、凋亡、坏死、焦亡和自噬相关读出 | 观察到的是特异死亡还是混合死亡 |\n| 细胞器层面 | 线粒体、内质网、溶酶体、脂滴和膜接触位点 | 扰动发生在哪一亚细胞位置 |\n| 代谢与氧化 | 铁稳态、脂质组成、GPX4 通路和 ROS 来源 | 死亡阈值由哪类代谢失衡推动 |\n| 诱导与抑制 | 药物、基因扰动、缺氧、ER 应激或脂质过载 | 结果是否依赖特定诱导背景 |\n| 模型系统 | 细胞系、原代细胞、类器官或动物组织 | 机制能否回到目标组织的死亡读出 |',
    sections: [
      {
        title: '铁死亡是脂质过氧化与抗氧化系统失衡的调节性死亡',
        body: '铁死亡由铁依赖的脂质过氧化驱动，GPX4 等抗氧化系统是关键抑制节点。综述和机制研究指出，铁死亡与代谢、氧化还原和疾病状态紧密相连，但不同组织中的敏感性差异很大。\n\n在比较研究时，应同时报告铁死亡抑制剂和并行死亡标志物，避免把一般细胞毒性误判为铁死亡。脂质过氧化本身也不等于铁死亡，需要与形态学和生化读出共同判断。',
        source_ids: ['H018S001', 'H018S002', 'H018S013', 'H018S014'],
      },
      {
        title: '线粒体是脂质 ROS 放大和铁死亡执行的重要平台',
        body: '线粒体相关研究提示，线粒体 ROS、VDAC 寡聚化和线粒体—内质网膜接触位点变化，都可以改变铁死亡阈值。OPA1 等线粒体塑形蛋白研究进一步显示，线粒体功能状态与铁死亡和整合应激反应之间存在交叉调控。\n\n线粒体读出适合提出亚细胞定位假设，仍需用靶向抑制、成像和独立死亡标志物验证。线粒体损伤也见于其他死亡方式，不能单凭 ROS 上升写成铁死亡。',
        source_ids: ['H018S004', 'H018S005', 'H018S006', 'H018S016', 'H018S017'],
      },
      {
        title: '内质网应激和膜接触位点参与设定铁死亡敏感性',
        body: '内质网应激传感器 PERK 与膜接触位点相关研究提出，内质网—线粒体接触重塑可以影响铁死亡进程。脂质代谢酶 ACSL4 等研究说明，特定磷脂种类在脂质过氧化放大中具有关键作用。\n\n这些结果把铁死亡与内质网脂质合成、钙稳态和应激信号联系起来，但仍依赖具体细胞类型和诱导条件。ER 应激本身可以触发多种下游命运，需要并行检测铁死亡、凋亡和坏死读出。',
        source_ids: ['H018S003', 'H018S007', 'H018S008', 'H018S011', 'H018S012'],
      },
      {
        title: '铁稳态和膜转运决定铁死亡是否达到阈值',
        body: '铁代谢综述指出，铁输入、储存和输出通路共同塑造铁死亡敏感性；SLC40A1 等转运蛋白研究把铁稳态与疾病语境联系起来。铁死亡与衰老相关应激的综述进一步提示，氧化还原失衡和脂质重塑可以共同提高死亡易感性。\n\n铁染色或铁蛋白水平变化只能说明铁稳态改变，不能单独证明铁死亡已经发生。不同细胞对铁载量和脂质组成的基线差异，会显著影响抑制剂和保护剂效果。',
        source_ids: ['H018S009', 'H018S010', 'H018S013', 'H018S014'],
      },
      {
        title: '组织损伤模型中的死亡串联与专题边界',
        body: '肾脏疾病和肺高压等模型研究显示，铁死亡可与凋亡、焦亡和其他应激反应共同出现，提示细胞器应激结果具有情境依赖性。在组织损伤模型中，应报告多种死亡标志物和时序取样。\n\n代谢过载和慢性炎症也可以诱导细胞器应激，但代谢性炎症专题主要处理器官免疫与代谢耦合。本页聚焦细胞器定位扰动后的铁死亡等死亡读出；若研究核心是人体组织免疫代谢状态，应优先使用 H035 专题框架，不应把炎症因子升高直接写成铁死亡证据。',
        source_ids: ['H018S002', 'H018S013', 'H018S015', 'H018S018', 'H018S019', 'H018S020'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '死亡判定', title: '铁死亡特异读出与并行死亡标志物', principle: '联合脂质过氧化探针、铁稳态指标、GPX4 通路状态和形态学特征，并用凋亡、坏死或焦亡抑制剂与标志物做并行排除。', answers: '判断观察到的细胞丢失是否主要由铁死亡贡献，而不是混合死亡。', sample_design: '预先定义诱导剂、抑制剂、时间点和细胞密度；保留未处理对照和独立重复。', limitations: '多数读出是间接指标；抑制剂具有脱靶效应，不能单独作为因果证据。', sources: ['H018S001', 'H018S002', 'H018S013'] },
      { id: 'M02', order: 2, category: '亚细胞成像', title: '线粒体、内质网与膜接触位点成像', principle: '使用高分辨率成像或电子显微镜观察线粒体形态、内质网应激、脂滴和膜接触位点在诱导前后的变化。', answers: '定位细胞器互作重塑是否先于脂质过氧化上升和死亡发生。', sample_design: '固定时间点序列、活细胞染料和共定位定量；报告成像分辨率和分析阈值。', limitations: '成像显示关联不等于分子直接作用；固定样本可能改变膜结构。', sources: ['H018S004', 'H018S005', 'H018S006', 'H018S016'] },
      { id: 'M03', order: 3, category: '脂质与铁代谢', title: '脂质组、铁染色和转运蛋白扰动', principle: '定量关键磷脂种类、铁载量和铁转运蛋白表达，并通过遗传或药理扰动检验其对铁死亡敏感性的影响。', answers: '区分脂质组成改变和铁稳态失衡哪一层更接近死亡阈值变化。', sample_design: '配对脂质组与铁代谢读出；ACSL4、GPX4 等关键节点设置正负向对照。', limitations: '脂质组结果高度依赖提取方法和细胞类型；扰动效应可能是间接的。', sources: ['H018S003', 'H018S009', 'H018S010', 'H018S011'] },
      { id: 'M04', order: 4, category: '应激通路', title: '内质网应激与整合应激反应检测', principle: '检测 PERK、IRE1 或 ATF4 等应激节点激活，并评估其与铁死亡诱导的时间关系。', answers: '判断 ER 应激是铁死亡的上游触发、并行过程还是保护性反应。', sample_design: '时间序列取样、应激激动剂和抑制剂并行；保留蛋白质翻译抑制对照。', limitations: '应激通路具有双向效应；抑制应激不一定阻断铁死亡。', sources: ['H018S007', 'H018S008', 'H018S012', 'H018S017'] },
      { id: 'M05', order: 5, category: '组织模型', title: '原代细胞、类器官和疾病组织样本', principle: '在更接近生理的模型中重复细胞系结果，并配对病理、损伤标志和患者样本伦理审批信息。', answers: '检验细胞器互作—铁死亡关系是否存在于目标组织而不仅限于细胞系。', sample_design: '报告供体信息、培养条件、诱导背景和临床病理注释；关键结论在第二模型复现。', limitations: '离体模型缺少完整微环境；患者样本通常是横断面观察。', sources: ['H018S015', 'H018S018', 'H018S019', 'H018S020'] },
    ],
    findings: [
      { id: 'C01', title: '铁死亡需要特异生化与形态学证据，不能只靠单一标志物', shared_result: '铁死亡研究普遍强调脂质过氧化、铁稳态和 GPX4 通路的联合证据；单一 ROS 升高或细胞活力下降不足以区分类铁死亡。', research_use: '并行使用铁死亡抑制剂、脂质过氧化探针和其他死亡标志物；报告时间序列。', boundary: '不能把一般细胞毒性或凋亡写成铁死亡；治疗性清除策略不在本页展开。', sources: ['H018S001', 'H018S002', 'H018S013', 'H018S014'] },
      { id: 'C02', title: '线粒体与内质网膜接触位点改变死亡阈值', shared_result: '线粒体 ROS、VDAC 寡聚化、OPA1 调控和 PERK 相关膜接触研究提示，细胞器定位和膜接触重塑可以影响铁死亡敏感性，但效应依赖细胞类型和诱导条件。', research_use: '记录亚细胞成像、膜接触定量和诱导时序；关键节点用遗传扰动验证。', boundary: '细胞器形态相关不等于特定分子直接因果；其他死亡方式可并行出现。', sources: ['H018S004', 'H018S005', 'H018S006', 'H018S007', 'H018S008'] },
      { id: 'C03', title: '脂质组成与铁稳态共同塑造铁死亡易感性', shared_result: 'ACSL4 相关磷脂代谢和铁转运蛋白研究说明，脂质过氧化底物供应与铁可用量共同决定铁死亡是否达到阈值。', research_use: '配对脂质组、铁代谢读出和 GPX4 状态；比较不同细胞基线。', boundary: '铁或脂质指标变化本身不是铁死亡发生的充分证据。', sources: ['H018S003', 'H018S009', 'H018S010', 'H018S011'] },
      { id: 'C04', title: '组织损伤模型中常出现多种死亡方式串联', shared_result: '肾脏疾病、肺高压和肿瘤微环境研究表明，铁死亡可与其他程序性死亡和应激反应共同出现，结论具有模型和组织特异性。', research_use: '在组织模型中保留多种死亡读出和病理注释；抑制一种死亡方式后检查替代路径。', boundary: '模型中的死亡串联不能直接写成人体治疗靶点。', sources: ['H018S015', 'H018S018', 'H018S019', 'H018S020'] },
      { id: 'C05', title: '通用代谢应激应回到代谢性炎症专题', shared_result: '代谢过载和慢性炎症可以诱导细胞器应激，但代谢性炎症专题主要处理器官免疫与代谢耦合。本页要求把细胞器定位扰动与铁死亡等死亡读出直接对应。', research_use: '若核心问题是脂肪组织或肝脏免疫状态，使用 H035 专题框架；若核心是死亡方式判定，保留细胞器与死亡读出。', boundary: '炎症因子升高不能单独写成铁死亡证据；两个专题可交叉引用但不应混写结论。', sources: ['H018S002', 'H018S013', 'H018S015'] },
    ],
    pmids: [22632970, 28985560, 35027735, 39142278, 34401974, 36447047, 28515000, 38508867, 36835065, 38462161, 41205728, 34345202, 39346540, 42267631, 42225830, 35678504, 42622731, 42636946, 42659810, 42010894],
    refMeta: [
      ['primary_research', 'cell death biology', 'ferroptosis definition', 'iron-dependent lipid peroxidation death', 'foundational cell-line work'],
      ['review', 'cell death and metabolism', 'ferroptosis regulatory nexus', 'metabolism-redox-disease links', 'review; context-dependent'],
      ['primary_research', 'lipid metabolism', 'ACSL4 phosphorylation', 'lipid peroxidation amplification', 'mechanistic cell study'],
      ['primary_research', 'mitochondria', 'OPA1 and ferroptosis', 'mitochondrial ROS and ISR cross-talk', 'specific pathway context'],
      ['primary_research', 'mitochondria', 'VDAC1 oligomerization', 'ferroptosis in kidney injury model', 'model-specific'],
      ['review', 'cell death', 'mitochondria and inflammation', 'organelle death-associated inflammation', 'review; multiple death modes'],
      ['review', 'organelle biology', 'mitochondria-ER calcium', 'organelle stress and cell death', 'review; not ferroptosis-specific only'],
      ['review', 'iron metabolism', 'SLC40A1 and ferroptosis', 'iron handling in disease', 'review; transporter context varies'],
      ['review', 'cell stress', 'ferroptosis and senescence', 'stress interplay', 'review; association not causality'],
      ['review', 'stress signaling', 'integrated stress response', 'metabolic adaptation', 'review; broad ISR biology'],
      ['primary_research', 'ER stress', 'PERK and MAMs', 'ER-mitochondria contacts in ferroptosis', 'mechanistic study'],
      ['primary_research', 'ER stress', 'PERK-Nrf2-HO-1 pathway', 'ferroptosis induction context', 'cell-line and compound context'],
      ['review', 'metabolic disease', 'ferroptosis in metabolism', 'disease-associated ferroptosis', 'review; heterogeneous evidence'],
      ['primary_research', 'cell size', 'ferroptosis susceptibility', 'physical state modulates death', 'in vitro mechanism'],
      ['primary_research', 'cancer immunity', 'ferroptosis in glial tumours', 'immune landscape modulation', 'disease-specific'],
      ['review', 'kidney injury', 'mitochondria ROS and mitophagy', 'organelle stress in AKI', 'related organelle stress context'],
      ['primary_research', 'kidney disease', 'ferroptosis crosstalk', 'multiple programmed death modes', 'tissue model'],
      ['primary_research', 'pulmonary hypertension', 'mitochondria-centered signaling', 'metabolic reprogramming and stress', 'disease model'],
      ['primary_research', 'intervertebral disc', 'estrogen and ferroptosis', 'tissue degeneration context', 'specific tissue model'],
      ['review', 'muscle atrophy', 'ferroptosis role', 'skeletal muscle stress', 'review; limited human data'],
    ],
    techBody: '本专题的技术卡包括铁死亡特异判定、线粒体与内质网成像、脂质组与铁代谢分析、应激通路检测，以及原代细胞和组织模型验证。方法组合取决于需要确认的是死亡方式、细胞器定位还是组织级联反应。',
    scopeBody: '本页用于介绍细胞器互作与铁死亡研究中的证据类型、实验设计和适用范围，不提供诊断、治疗或药物开发建议。',
  },
  {
    topic_id: 'H028',
    title: '脑细胞图谱与跨尺度参考图谱',
    slug: 'brain-cell-cross-scale-atlas',
    overview: [
      '脑细胞图谱研究正在从“列出有哪些细胞类型”推进到“在不同尺度上如何对齐和引用”。单细胞转录组、空间转录组、表观组、连接组学和成像数据各自提供不同分辨率的信息，但研究者在比较物种、脑区、发育阶段或技术平台时，往往缺少统一的细胞类型坐标系。跨尺度参考图谱的目标，是把分子定义、空间位置、连接关系和功能属性放到可比较框架中，而不是把某一种技术的结果当作完整真相。',
      '本方向从人类和小鼠脑细胞分类、BICCN 等多模态细胞普查、全脑空间图谱和跨物种映射方法出发，集中处理三类问题：参考图谱如何定义和修订细胞类型；不同尺度数据如何配准到同一细胞坐标；图谱资源如何被独立研究引用而不被误写成疾病机制。由此可以把图谱当作研究基础设施，把机制研究留给疾病验证专题。',
      '比较公开研究时，需要同时交代物种、脑区、发育阶段、技术平台、批次和注释版本。疾病相关细胞状态变化由神经退行性疾病细胞图谱专题处理；本页不讨论治疗靶点或临床分层。图谱中的细胞类型命名不等于功能因果，空间邻接也不等于细胞间直接调控。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 尺度层级 | 单细胞、空间、连接组、成像或多模态整合 | 数据覆盖的是分子、位置还是连接关系 |\n| 物种与发育阶段 | 人、小鼠、非人灵长类、胎儿、成年或衰老 | 细胞类型定义是否可跨物种迁移 |\n| 脑区范围 | 皮层、海马、全脑、血管或特定核团 | 局部图谱能否支持全脑外推 |\n| 注释版本 | 聚类分辨率、参考映射算法和发布版本 | 不同版本之间是否可直接比较 |\n| 使用场景 | 参考注释、数据整合、新细胞发现或方法基准 | 图谱被用作资源还是机制证据 |',
    sections: [
      {
        title: '成人脑细胞图谱正在覆盖更完整的分子与空间维度',
        body: '跨成人大脑细胞类型的转录组多样性研究，以及全脑分子定义和空间分辨图谱，为脑细胞分类提供了高分辨率参考。小鼠全脑空间转录组图谱和单细胞空间图谱进一步把细胞类型放回三维位置。\n\n这些资源适合作为注释参考和新细胞类型发现起点。图谱发布版本、聚类分辨率和取样脑区必须一并记录，不能把某一版本的标签直接当作所有研究的默认注释。',
        source_ids: ['H028S001', 'H028S002', 'H028S003', 'H028S004'],
      },
      {
        title: 'BICCN 等多模态普查强调细胞类型需要多证据定义',
        body: '哺乳动物初级运动皮层多模态细胞普查和 MERFISH 空间图谱显示，转录、表观、形态和电生理特征可以共同约束细胞类型定义。BICCN 数据生态指南为跨实验室数据访问和版本管理提供了框架。\n\n多模态一致支持时，细胞类型注释更稳健；若只有单一组学层，应标明为假设性分类。不同模态之间的缺失和不完全对应需要在整合时显式处理。',
        source_ids: ['H028S005', 'H028S006', 'H028S007', 'H028S009'],
      },
      {
        title: '跨物种比较需要映射算法，而不是简单同名标签',
        body: '人类与小鼠皮层细胞类型比较研究指出，保守类型与物种特异特征并存。跨物种细胞类型分配算法进一步说明，直接把小鼠标签贴到人类数据会遗漏物种差异。\n\n跨尺度参考图谱因此需要保留映射置信度、未匹配细胞和物种特异节点。比较研究应报告映射方法与拒绝率，而不是只展示同名细胞类型。',
        source_ids: ['H028S008', 'H028S010', 'H028S011', 'H028S012'],
      },
      {
        title: '发育、血管和非神经元成分扩展了参考图谱边界',
        body: '人类脑血管发育到成年和疾病状态的单细胞图谱，以及非人灵长类多模态寿命图谱，提示脑细胞参考体系需要覆盖内皮、周细胞、免疫和基质细胞，而不仅是神经元和胶质细胞。空间组学综述也强调脑空间图谱正在向多区域、多尺度整合发展。\n\n把神经元图谱外推到全脑微环境会遗漏血管和免疫成分。发育阶段差异意味着成人图谱不能直接用于胎儿或疾病早期样本注释，除非重新映射并验证。',
        source_ids: ['H028S013', 'H028S014', 'H028S015', 'H028S016'],
      },
      {
        title: '整合算法与疾病语境的边界',
        body: '图对比学习和多组学整合方法可以提高批次间注释一致性，但整合参数和参考版本会影响结果。整合结果适合提高注释一致性和发现新状态，不能单独证明细胞类型在体内的功能或因果作用。\n\n脑细胞参考图谱描述的是参考状态下的细胞类型与空间组织。疾病中的细胞状态变化需要在病例—对照设计中单独验证；若研究核心是比较患病与对照组织，应使用 H029 专题。本页只提供跨尺度参考坐标，不提供疾病机制或治疗靶点结论。',
        source_ids: ['H028S001', 'H028S008', 'H028S009', 'H028S017', 'H028S018', 'H028S019', 'H028S020'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '参考构建', title: '多模态细胞类型定义与版本管理', principle: '联合转录、表观、形态或电生理证据定义细胞类型，并发布可追踪的注释版本和元数据。', answers: '为后续研究提供可引用的细胞坐标系和修订记录。', sample_design: '记录物种、脑区、发育阶段、样本数和平台；每个版本保留变更说明和下载入口。', limitations: '参考图谱是群体汇总，不代表所有个体差异；版本更新会使旧注释失效。', sources: ['H028S005', 'H028S006', 'H028S009', 'H028S014'] },
      { id: 'M02', order: 2, category: '空间定位', title: '空间转录组与全脑图谱配准', principle: '把单细胞或单核转录组映射到空间切片或全脑坐标，保留位置不确定性和配准误差。', answers: '判断细胞类型在脑区、层位或核团中的分布，并比较不同尺度图谱。', sample_design: '使用统一坐标系、切片方向标记和配准质量指标；关键区域用原位杂交或成像复核。', limitations: '空间点位可能混合多个细胞；配准误差会改变邻域关系。', sources: ['H028S002', 'H028S003', 'H028S004', 'H028S007'] },
      { id: 'M03', order: 3, category: '跨物种映射', title: '保守与物种特异细胞类型分配', principle: '通过同源基因、嵌入映射或图模型，把一种物种的细胞类型对应到另一种物种的参考空间，并报告未匹配细胞。', answers: '比较人类与小鼠或其他模型中的保守与分歧细胞特征。', sample_design: '保留映射置信度阈值、拒绝率和独立验证集；不要强制一对一标签。', limitations: '映射算法依赖参考质量；物种差异可能导致错误对应。', sources: ['H028S008', 'H028S010', 'H028S011', 'H028S012'] },
      { id: 'M04', order: 4, category: '多尺度整合', title: '连接组、成像与转录组联合注释', principle: '把连接组学、成像形态学和分子谱系整合到同一细胞或区域坐标，用于多尺度参考构建。', answers: '检查分子定义的细胞类型是否具有可重复的空间和连接特征。', sample_design: '记录成像分辨率、连接组采样密度和跨模态配准方法；保留原始数据链接。', limitations: '不同尺度数据难以完全同细胞配对；整合结果是模型估计。', sources: ['H028S005', 'H028S013', 'H028S016', 'H028S019'] },
      { id: 'M05', order: 5, category: '数据复用', title: '参考映射、整合基准与独立验证', principle: '把新数据映射到公开参考图谱，并用独立样本、原位验证或正交模态检查注释稳定性。', answers: '评估新队列或新平台能否复用现有细胞坐标，以及何处需要修订参考。', sample_design: '报告参考版本、映射算法、批次校正和基准指标；发现新状态时提交修订建议。', limitations: '复用参考不能代替疾病机制验证；批次差异可导致虚假新类型。', sources: ['H028S009', 'H028S015', 'H028S017', 'H028S018', 'H028S020'] },
    ],
    findings: [
      { id: 'C01', title: '脑细胞类型需要多模态和版本化参考', shared_result: '成人脑转录组图谱、全脑空间图谱和 BICCN 多模态普查表明，稳健的细胞类型定义依赖多证据支持和可追踪版本，而不是一次性聚类标签。', research_use: '引用图谱时记录版本、脑区、物种和平台；更新后重新映射而非沿用旧标签。', boundary: '参考图谱描述正常或参考状态，不等于疾病机制；疾病验证由 H029 专题处理。', sources: ['H028S001', 'H028S002', 'H028S005', 'H028S009'] },
      { id: 'C02', title: '空间位置是跨尺度整合的必要维度', shared_result: 'MERFISH、全脑空间转录组和成像配准研究显示，同一分子类型在不同脑区的比例和邻域关系可以显著不同，脱离空间语境的转录标签不完整。', research_use: '保留切片方向、配准误差和层位注释；关键分布用原位方法复核。', boundary: '空间邻接提示组织关系，不能单独证明细胞间直接调控。', sources: ['H028S003', 'H028S004', 'H028S007', 'H028S016'] },
      { id: 'C03', title: '跨物种映射必须报告置信度和未匹配细胞', shared_result: '人类与小鼠皮层比较及跨物种分配算法研究指出，保守类型与物种特异特征并存，强制同名映射会掩盖差异。', research_use: '使用映射置信度、拒绝率和独立验证集；物种特异节点单独注释。', boundary: '跨物种相似性不等于功能等价；模型动物结果需要人体样本复核。', sources: ['H028S008', 'H028S010', 'H028S011', 'H028S012'] },
      { id: 'C04', title: '血管、免疫和发育样本扩展了参考图谱边界', shared_result: '脑血管图谱、非人灵长类寿命图谱和空间组学综述提示，脑细胞参考体系必须覆盖非神经元成分和发育阶段差异。', research_use: '根据研究问题选择发育阶段和细胞谱系范围；成人图谱用于胎儿或疾病样本时需重新映射。', boundary: '参考范围不全会造成注释偏差；缺失成分不能凭推断补全。', sources: ['H028S013', 'H028S014', 'H028S015', 'H028S020'] },
      { id: 'C05', title: '整合算法改善注释一致性，但不构成机制证据', shared_result: '图对比学习、多组学整合和映射工具可以提高批次间注释一致性，但整合参数和参考版本会影响结果。', research_use: '报告算法、参数、批次校正和基准指标；新状态用独立样本验证。', boundary: '计算整合不能代替功能或因果实验；图谱资源不等于治疗靶点。', sources: ['H028S017', 'H028S018', 'H028S019', 'H028S020'] },
    ],
    pmids: [37824663, 38092912, 40132589, 34616075, 34616063, 35771910, 31435019, 36526433, 37390046, 38987604, 26571460, 33278823, 42612631, 41274934, 42510785, 41723114, 42402308, 42608748, 42609459, 42237602],
    refMeta: [
      ['primary_research', 'adult human brain', 'transcriptomic cell diversity', 'reference cell types across brain', 'atlas resource'],
      ['primary_research', 'adult mouse brain', 'molecular spatial whole-brain atlas', 'cell types with spatial coordinates', 'mouse reference'],
      ['primary_research', 'adult mouse brain', 'single-cell spatial atlas', 'spatial transcriptomic whole brain', 'platform-specific'],
      ['primary_research', 'mouse motor cortex', 'multimodal cell census', 'BICCN multimodal reference', 'reference atlas'],
      ['primary_research', 'mouse motor cortex', 'MERFISH spatial atlas', 'spatially resolved cell atlas', 'spatial reference'],
      ['primary_research', 'human and mouse cortex', 'cortical organization comparison', 'conserved and divergent organization', 'cross-species reference'],
      ['primary_research', 'human and mouse cortex', 'conserved cell types', 'cross-species cortical types', 'mapping baseline'],
      ['primary_research', 'cross-species scRNA-seq', 'heterogeneous graph mapping', 'cell-type assignment', 'computational mapping'],
      ['review', 'BICCN ecosystem', 'data access and versioning', 'reference data infrastructure', 'resource guide'],
      ['primary_research', 'human brain vasculature', 'development to disease atlas', 'vascular cell reference', 'includes disease contexts as reference'],
      ['primary_research', 'adult human brain', 'canonical genetic signatures', 'baseline brain expression reference', 'bulk reference'],
      ['primary_research', 'human brain', 'connectomic cell characterization', 'region-specific cell features', 'multi-feature reference'],
      ['primary_research', 'macaque lifespan', 'multimodal brain atlas', 'cross-scale primate reference', 'non-human primate'],
      ['software-method', 'mouse brain mapping', 'ANTsX ecosystem', 'cross-scale registration tools', 'tooling'],
      ['review', 'brain spatial omics', 'spatial genomics atlases', 'field overview', 'review'],
      ['primary_research', 'human brain cortex', 'multiomic regulatory atlas', 'regulatory drivers of cell types', 'multi-omic reference'],
      ['review', 'brain scRNA-seq', 'atlas opportunities and challenges', 'study design for brain atlases', 'review'],
      ['software-method', 'atlas integration', 'graph contrastive learning', 'unified integration', 'computational method'],
      ['primary_research', 'mouse brain development', 'periventricular zone atlas', 'developmental reference', 'developmental atlas'],
      ['primary_research', 'human white matter', 'spatiotemporal morphometry signatures', 'white matter cell context', 'specific region atlas'],
    ],
    techBody: '本专题的技术卡包括多模态细胞类型定义、空间转录组与全脑配准、跨物种细胞类型映射、连接组与成像整合，以及参考映射与基准验证。方法选择取决于需要建立参考、整合多尺度数据，还是复用现有图谱注释。',
    scopeBody: '本页用于介绍脑细胞跨尺度参考图谱的资源范围、整合方法和适用边界，不提供疾病机制、诊断或治疗建议。',
  },
  {
    topic_id: 'H029',
    title: '神经退行性疾病细胞图谱与机制',
    slug: 'neurodegenerative-cell-atlas-mechanisms',
    overview: [
      '神经退行性疾病研究正在从单一标志物或单一脑区描述，转向在细胞分辨率下比较患病与对照组织的组成、状态和空间关系。阿尔茨海默病、帕金森病、额颞叶痴呆和其他神经退行性疾病中，神经元、小胶质细胞、星形胶质细胞、少突胶质细胞和血管相关细胞都可以呈现疾病阶段特异的转录或蛋白状态，但这些状态是否驱动病理、反映代偿或只是伴随现象，仍需要独立验证。',
      '本方向从疾病组织单细胞与单核图谱、空间转录组、多区域对照设计和蛋白组学分型出发，集中处理三类问题：哪些细胞状态与病理蛋白、神经退行性进程或认知结局相关；参考图谱上的异常状态如何在空间上分布；图谱关联如何推进到功能扰动、队列复核和体液标志物验证。参考图谱资源由脑细胞跨尺度参考图谱专题提供，本页聚焦疾病样本中的验证层。',
      '比较公开研究时，需要同时交代诊断标准、病理分期、脑区、取样批次、对照匹配和抗体制备。图谱中的关联不等于因果机制，也不能直接写成治疗靶点或诊断阈值。液体活检和循环标志物研究可作为补充层，但不能代替组织细胞图谱中的空间与细胞类型信息。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 疾病定义 | 诊断标准、病理分期、遗传背景和共病 | 细胞状态变化对应哪一疾病阶段 |\n| 脑区与取样 | 皮层、海马、黑质、脉络丛或其他区域 | 局部发现能否外推到全脑 |\n| 细胞分辨率 | 单细胞、单核、空间或蛋白组分层 | 观察到的是哪类细胞及其位置 |\n| 病理对照 | 淀粉样蛋白、tau、路易体或 TDP-43 负荷 | 细胞状态与病理沉积如何配对 |\n| 验证层级 | 独立队列、功能扰动、体液标志物或成像 | 图谱关联能否推进到可检验机制 |',
    sections: [
      {
        title: '阿尔茨海默病多区域图谱揭示细胞状态与病理分区相关',
        body: '多区域单细胞研究、SEA-AD 多模态图谱和认知功能相关图谱显示，阿尔茨海默病中神经元、胶质细胞和血管相关细胞呈现区域和病理阶段依赖的状态变化。单细胞转录研究也指出，疾病相关小胶质细胞和星形胶质细胞状态需要与淀粉样蛋白和 tau 病理分区配对阅读。\n\n这些图谱适合提出疾病相关细胞状态和空间生态假设。关联本身不能证明某一细胞群驱动病理进展，仍需遗传扰动、纵向取样或独立队列复核。',
        source_ids: ['H029S001', 'H029S002', 'H029S003', 'H029S004', 'H029S005'],
      },
      {
        title: '小胶质细胞状态是 AD 研究中最活跃的验证对象之一',
        body: '人类小胶质细胞单细胞研究揭示与阿尔茨海默病相关的亚群；后续研究进一步讨论不同队列中疾病相关小胶质细胞模式是否可重复。tau 和淀粉样蛋白相关小胶质细胞谱也提示，不同病理蛋白对应的状态并不完全相同。\n\n小胶质细胞状态命名在不同研究间尚未完全统一。比较时应保留抗体面板、病理分期和脑区信息，并用蛋白或空间原位证据验证关键状态。',
        source_ids: ['H029S005', 'H029S006', 'H029S007', 'H029S008'],
      },
      {
        title: '帕金森病和路易体病需要区分中枢与外周免疫读出',
        body: '帕金森病脑组织单细胞转录和蛋白研究、外周免疫单细胞分析，以及人脑转录组 bulk 与单细胞比较研究，说明路易体病相关变化可以同时出现在脑内细胞和网络免疫层。不同取样部位和疾病分期会导致细胞组成差异。\n\n中枢组织图谱与外周免疫图谱回答的问题不同，不能互相替代。黑质、皮层和脑干等区域的结果也不应直接合并为单一“帕金森图谱”。',
        source_ids: ['H029S009', 'H029S010', 'H029S011', 'H029S012'],
      },
      {
        title: '额颞叶痴呆和其他神经退行性疾病扩展了细胞图谱边界',
        body: 'GRN 相关额颞叶痴呆的单核研究和额岛皮层图谱提示，神经退行性病变可以伴随神经血管功能障碍和区域特异细胞重组。泛神经退行性蛋白组研究进一步显示，不同疾病可能存在可分的分子亚型。\n\n疾病特异图谱需要与遗传背景和病理蛋白类型共同阅读。把一种疾病的细胞状态标签直接套用到另一种神经退行性疾病，会掩盖分子和区域差异。',
        source_ids: ['H029S013', 'H029S014', 'H029S015', 'H029S016'],
      },
      {
        title: '验证分层与参考图谱边界',
        body: 'tau 种子人源神经元嵌合体、脉络丛免疫细胞富集和神经元来源 cfDNA 等研究，代表从图谱关联走向功能或体液验证的不同路径。这些验证层可以相互补充，但各自有适用边界。\n\n脑细胞参考图谱提供正常状态下的细胞坐标，疾病研究描述的是相对参考的偏离。若目标是建立跨尺度参考坐标，应使用 H028 专题。本页要求把疾病相关细胞状态、病理配对和验证实验放在同一叙述中，并明确哪些结论仍停留在关联层，不提供临床诊断或治疗建议。',
        source_ids: ['H029S002', 'H029S003', 'H029S016', 'H029S017', 'H029S018', 'H029S019', 'H029S020'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '疾病样本设计', title: '病例—对照配对与病理分期', principle: '在明确诊断和病理分期的前提下，配对取样患病与对照脑组织，并记录年龄、性别、死后间隔、脑区和共病。', answers: '判断细胞状态变化是否与特定疾病阶段和脑区相关，而不是批次或取样偏倚。', sample_design: '预先定义纳入排除标准、病理评分方法和取样部位；保留独立验证队列。', limitations: '死后组织不能反映生前动态；对照匹配不完美会混淆年龄和疾病效应。', sources: ['H029S001', 'H029S002', 'H029S003', 'H029S004'] },
      { id: 'M02', order: 2, category: '单细胞与单核图谱', title: '疾病组织 sc/snRNA-seq 与参考映射', principle: '对疾病和对照组织进行单细胞或单核转录组测序，并映射到公开脑细胞参考图谱以识别疾病相关状态。', answers: '发现哪些细胞类型或状态在疾病中富集、缺失或发生转录重编程。', sample_design: '记录参考版本、批次校正、双细胞过滤和映射置信度；关键状态用原位 RNA 或蛋白验证。', limitations: '核测序丢失胞质信号；参考映射可能把新状态错误归并到旧标签。', sources: ['H029S004', 'H029S005', 'H029S006', 'H029S007'] },
      { id: 'M03', order: 3, category: '空间组学', title: '病理分区引导的空间转录组', principle: '在空间上把细胞状态与淀粉样蛋白、tau、路易体或其他病理沉积区域对应，并保留层位和邻域关系。', answers: '检查疾病相关细胞状态是局限于病理邻近区，还是广泛分布于更大脑区。', sample_design: '同步病理染色、空间切片定位和邻域分析；报告切片厚度和配准质量。', limitations: '空间点位混合多个细胞；病理染色与分子切片不完全同位置。', sources: ['H029S002', 'H029S003', 'H029S008', 'H029S018'] },
      { id: 'M04', order: 4, category: '多模态与蛋白组', title: '转录—蛋白联合与疾病分型', principle: '联合转录组、蛋白组或其他分子层，在疾病队列中寻找可重复的细胞状态或分子亚型。', answers: '区分转录变化是否落实到蛋白层，以及是否存在跨疾病共享或特异分型。', sample_design: '配对样本、统一质控和独立队列验证；报告阴性结果和亚型稳定性。', limitations: '蛋白组覆盖度有限；亚型标签需要外部验证才能用于临床分层。', sources: ['H029S009', 'H029S015', 'H029S016', 'H029S019'] },
      { id: 'M05', order: 5, category: '机制验证', title: '扰动模型、体液标志物与独立队列复核', principle: '通过遗传或病理种子模型、神经元来源 cfDNA 或其他体液标志物，在组织图谱之外检验候选细胞状态或通路。', answers: '评估图谱关联能否推进到可重复的功能或体液读出。', sample_design: '报告模型来源、干预、读出和与人体样本的对应关系；体液研究保留前瞻性验证设计。', limitations: '体外或动物模型不等于人体效应；体液标志物不能恢复空间细胞信息。', sources: ['H029S017', 'H029S018', 'H029S020', 'H029S014'] },
    ],
    findings: [
      { id: 'C01', title: '疾病相关细胞状态必须与病理分区和脑区配对', shared_result: '阿尔茨海默病多区域图谱和 tau/淀粉样蛋白相关小胶质细胞研究表明，细胞状态变化高度依赖病理分区和取样脑区，脱离病理语境的转录差异难以解释。', research_use: '同步记录病理评分、脑区和参考映射版本；关键状态用原位验证。', boundary: '关联不等于致病驱动；不能把细胞状态直接写成治疗靶点。', sources: ['H029S001', 'H029S002', 'H029S003', 'H029S008'] },
      { id: 'C02', title: '小胶质细胞和星形胶质细胞状态命名需要跨研究校准', shared_result: '多项 AD 小胶质细胞和星形胶质细胞研究揭示了疾病相关状态，但命名、标志物和队列差异导致跨研究比较困难。', research_use: '保留抗体面板、批次和病理分期；优先使用可重复的蛋白或空间标志物。', boundary: '状态标签是描述性工具，不是已证实的因果实体。', sources: ['H029S005', 'H029S006', 'H029S007', 'H029S018'] },
      { id: 'C03', title: '帕金森病和其他退行性疾病需要疾病特异图谱', shared_result: '帕金森病脑组织和外周免疫研究、FTD 和泛神经退行性蛋白组研究都表明，不同疾病的细胞重组模式并不相同。', research_use: '按疾病、遗传背景和病理蛋白类型分别建图谱；避免跨疾病强制同名标签。', boundary: '一种疾病的细胞状态不能外推到另一种神经退行性疾病。', sources: ['H029S009', 'H029S010', 'H029S013', 'H029S015'] },
      { id: 'C04', title: '验证层包括扰动模型、体液标志物和独立队列', shared_result: 'tau 种子嵌合体、脉络丛免疫富集、神经元来源 cfDNA 和 SEA-AD 基准研究代表不同验证路径，可相互补充但各有边界。', research_use: '预先定义验证问题：机制、体液筛查还是队列复现；不同验证层分开报告。', boundary: '体外或体液结果不能代替组织空间图谱；基准结果不等于临床性能。', sources: ['H029S017', 'H029S018', 'H029S019', 'H029S020'] },
      { id: 'C05', title: '参考图谱与疾病机制必须分层', shared_result: '脑细胞参考图谱提供坐标系，疾病研究描述的是相对参考的偏离。若目标是建立跨尺度参考，应使用 H028 专题；若目标是疾病验证，本页要求保留病理、对照和验证设计。', research_use: '引用 H028 参考版本并在疾病样本中报告偏离；机制结论需独立验证。', boundary: '图谱资源不等于疾病机制；本页不提供诊断或治疗建议。', sources: ['H029S002', 'H029S003', 'H029S016', 'H029S019'] },
    ],
    pmids: [39402332, 39048816, 37774677, 31042697, 32989152, 33257666, 34292312, 33609158, 39475571, 35879464, 41875888, 39090623, 38578357, 42599802, 42635110, 42465485, 42523377, 42465286, 42626456, 42661225],
    refMeta: [
      ['primary_research', 'human AD brain', 'SEA-AD multimodal atlas', 'disease cell atlas resource', 'atlas with pathology pairing'],
      ['primary_research', 'human AD brain', 'multiregion single-cell dissection', 'region-specific disease states', 'human postmortem'],
      ['primary_research', 'human ageing and AD', 'cognitive function cell atlas', 'resilience and dementia correlates', 'association with cognitive endpoints'],
      ['primary_research', 'human AD brain', 'single-cell transcriptomics', 'early disease cell programs', 'foundational disease atlas'],
      ['primary_research', 'human AD brain', 'single-nucleus endothelial study', 'vascular cell dysregulation', 'nuclei-based'],
      ['primary_research', 'human microglia', 'AD-associated microglia subset', 'disease-associated microglia', 'subset definition'],
      ['primary_research', 'human AD brain', 'microglia single-cell patterns', 'cross-study microglia patterns', 'review of patterns'],
      ['primary_research', 'human AD brain', 'Abeta and tau microglia profiles', 'pathology-associated microglia', 'pathology pairing'],
      ['primary_research', 'human PD brain', 'single-cell transcriptomic and proteomic', 'PD brain cell states', 'multimodal disease atlas'],
      ['primary_research', 'human FTD', 'GRN-associated neurovascular dysfunction', 'FTD snRNA-seq', 'genetic subtype context'],
      ['primary_research', 'neurodegeneration cohort', 'pan-neurodegeneration proteomics', 'disease subtypes', 'proteomic stratification'],
      ['primary_research', 'human PD cohort', 'peripheral immunoprofiling', 'Lewy body and PD immune context', 'peripheral not brain tissue'],
      ['primary_research', 'human PD brain', 'bulk versus single-cell transcriptomics', 'method comparison in PD', 'design comparison'],
      ['primary_research', 'human AD brain', 'choroid plexus macrophages', 'TTN+ macrophage enrichment', 'region-specific immune'],
      ['primary_research', 'human AD brain', 'hippocampal pathway regulators', 'mTOR and insulin upstream changes', 'mechanistic association'],
      ['primary_research', 'human AD model', 'tau-seeded neuronal chimeras', 'mature AD pathology modeling', 'in vitro validation'],
      ['primary_research', 'human FTD cortex', 'frontoinsular cortex atlas', 'FTD molecular correlates', 'region-specific disease atlas'],
      ['primary_research', 'AD benchmark', 'SEA-AD DREAM challenge', 'community benchmarking', 'methods benchmark not mechanism'],
      ['primary_research', 'human blood', 'neuron-derived cfDNA', 'blood-based AD detection', 'fluid biomarker layer'],
      ['primary_research', 'neurodegeneration model', 'HSPA8 and EV-mediated pathology', 'mechanistic pathway study', 'model-specific mechanism'],
    ],
    techBody: '本专题的技术卡包括病例—对照脑组织设计、疾病组织单细胞与单核图谱、病理引导的空间转录组、转录—蛋白联合分型，以及扰动模型与体液标志物验证。方法组合取决于需要确认的是疾病相关细胞状态、空间分布还是可重复验证层。',
    scopeBody: '本页用于介绍神经退行性疾病细胞图谱与机制研究中的证据类型、验证边界和适用范围，不提供诊断、治疗或临床分层建议。',
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
    batch_id: 'B08',
    title: '衰老、细胞应激与神经图谱',
    publication_status: 'snapshot_ready',
    frontend_status: 'snapshot_ready',
    topics,
  };

  const outJson = path.join(root, 'src', 'data', 'knowledge', 'research-trends-b08.generated.json');
  writeFileSync(outJson, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outJson} with ${topics.length} topics`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
