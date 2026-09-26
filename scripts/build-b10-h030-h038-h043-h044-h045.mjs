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
    topic_id: 'H030',
    title: '神经接口、高密度记录与神经调控',
    slug: 'neural-interfaces-recording-neuromodulation',
    overview: [
      '神经接口研究同时处理三件不同的事：如何稳定读出大量神经元的放电，如何把这些放电映射到运动、感觉或语言意图，以及如何用刺激闭环调节回路。高密度硅探针把记录通道推进到上千，脑机接口把解码指标写成可比较的字符率或抓取成功率，自适应脑深部刺激则把局部场电位当成调控输入。这三层证据不能互相替代。',
      '本方向从 Neuropixels 高密度记录、运动与感觉脑机接口、语音与文字解码，以及闭环神经调控出发，集中处理三类问题：记录密度和稳定性如何限制可见的群体动态；解码性能建立在哪一类任务和反馈上；刺激闭环回答的是回路可调性，而不是手术适应证。脑细胞图谱由相邻专题处理，本页不把细胞类型名录写成接口性能。',
      '比较公开研究时，需要同时交代电极类型、通道数、脑区、任务、解码指标和慢性稳定性。本页是研究导航，不是诊疗、植入手术指南、商品推荐或监管申报指引。某一被试的字符率或步态改善不能写成通用临床方案。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 电极与通道 | 硅探针、聚合物电极、微电极阵列、通道数和间距 | 看到的是局部回路还是稀疏采样 |\n| 记录对象 | 物种、脑区、细胞层和慢性或急性植入 | 群体动态能否迁移到其他皮层 |\n| 任务与读出 | 运动、感觉、书写、语音或步态，以及成功指标 | 解码性能对应哪一类行为终点 |\n| 刺激与闭环 | 开环、自适应或感觉反馈，以及生理标记 | 调控改变的是症状评分还是回路信号 |\n| 稳定性与安全 | 单位产率、漂移、组织反应和不良事件 | 实验室演示能否支持长期记录假设 |',
    sections: [
      {
        title: '高密度硅探针把群体放电写成可比较的通道坐标',
        body: 'Neuropixels 研究证明，全集成硅探针可以在啮齿动物中同时记录数百个神经元。Neuropixels 2.0 进一步证明微型化探针能够支持更长期、更稳定的高密度记录。随后的全脑分布式编码、小鼠视觉系统放电调查和自发行为驱动的全脑活动研究，共同证明高通道记录可以同时描述任务相关发放与行为伴随的维度。\n\n人体皮层 Neuropixels 记录和聚合物电极的多脑区慢性记录，则把同一记录逻辑推进到人和可弯曲电极。这些工作适合比较通道密度、漂移和单位产率。通道数上升不等于目标回路已被完整采样，急性记录也不能自动外推为慢性接口性能。',
        source_ids: ['H030S001', 'H030S002', 'H030S003', 'H030S004', 'H030S005', 'H030S006', 'H030S007'],
      },
      {
        title: '运动脑机接口在有限被试中达到可测量的抓取和步态读出',
        body: '四肢瘫痪被试的机械臂抓取研究，以及高表现神经假体控制试验，证明皮层放电可以驱动到达和抓握。体感皮层微刺激研究进一步证明，人工触觉可以在人体中被引出，并改善机械臂控制。脊髓损伤后的脑脊接口步行研究则证明，解码与刺激可以耦合成步态读出。\n\n这些试验适合比较任务定义、反馈方式和成功率。个案表现不是手术适应证，也不能写成可推广的康复方案。感觉反馈读出与运动解码必须分开报告。',
        source_ids: ['H030S008', 'H030S009', 'H030S015', 'H030S016', 'H030S014'],
      },
      {
        title: '书写和语音神经假体把解码终点改写成交流速率',
        body: '手写脑机接口研究证明，尝试书写的皮层轨迹可以解码为文字。失语瘫痪患者的语音神经假体、高表现语音神经假体，以及语音解码与虚拟形象控制研究，进一步证明尝试说话的神经活动可以映射到词、句或面部动画。\n\n交流类接口适合用字符率、词错误率和词汇量比较。实验室词汇表和提示条件下的速率，不能写成日常交流能力；电极位置和训练时长必须一并记录。',
        source_ids: ['H030S010', 'H030S011', 'H030S012', 'H030S013'],
      },
      {
        title: '自适应脑深部刺激把局部场电位当作闭环输入',
        body: '帕金森病自适应脑深部刺激研究证明，可以用β振荡等生理标记调节刺激。长期无线神经记录研究进一步证明，电路发现和自适应刺激可以在植入后持续采集。脑深部刺激技术综述和新兴调控技术综述，则把电极、算法和感知刺激放进同一比较框架。\n\n闭环研究适合比较生理标记、调节规则和症状读出。回路可调性不是手术指南，开环有效的靶点也不能自动写成自适应方案。',
        source_ids: ['H030S017', 'H030S018', 'H030S019', 'H030S020'],
      },
      {
        title: '专题边界：接口研究不是临床植入手术指南',
        body: '人体 Neuropixels 和聚合物电极证明记录方法可以进入人脑或慢性植入，但这些论文回答的是信号质量和空间覆盖，而不是适应证、手术路径或术后管理。脑深部刺激技术综述讨论装置与算法，同样不是手术操作手册。\n\n本页用于比较记录密度、解码终点和闭环标记。细胞类型与疾病图谱见 H028、H029。某一被试的字符率、抓取成功或步态改善，不能写成诊疗或植入建议。',
        source_ids: ['H030S006', 'H030S007', 'H030S019', 'H030S001'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '高密度记录', title: '硅探针与聚合物电极的通道覆盖评估', principle: '用高密度电极同步采集多通道细胞外电位，并按单位产率、漂移和脑区覆盖描述记录窗口。', answers: '判断可见群体动态受通道密度还是采样窗限制。', sample_design: '记录电极型号、通道数、脑区、急慢性条件和单位筛选阈值；保留未分配通道。', limitations: '通道数上升不等于回路被完整采样；急性产率不能外推为慢性稳定性。', sources: ['H030S001', 'H030S002', 'H030S006', 'H030S007'] },
      { id: 'M02', order: 2, category: '群体动态', title: '发放排序与单次试验群体轨迹', principle: '把多通道发放对齐到行为事件，估计任务相关维度和自发行为伴随的活动。', answers: '区分任务编码与行为伴随的全脑波动。', sample_design: '固定对齐事件、行为视频或运动学和预处理；报告未解释方差。', limitations: '排序错误会扭曲轨迹；缺少行为计量时不能断言编码内容。', sources: ['H030S003', 'H030S004', 'H030S005'] },
      { id: 'M03', order: 3, category: '解码接口', title: '运动、书写与语音脑机接口', principle: '用皮层群体活动预测运动、文字或语音终点，并按预先定义的成功指标评估。', answers: '比较解码性能对应哪一类交流或运动终点。', sample_design: '预先定义词汇表或工作空间、训练时长和离线对照；报告错误类型。', limitations: '实验室提示条件不能写成日常功能；个案速率不能外推到未测试人群。', sources: ['H030S008', 'H030S010', 'H030S011', 'H030S012'] },
      { id: 'M04', order: 4, category: '感觉反馈', title: '皮层微刺激与人工触觉', principle: '按频率、幅度和电极位点刺激体感皮层，测量主观感觉和闭环控制增益。', answers: '检验人工感觉是否改变运动接口的控制读出。', sample_design: '报告刺激参数、感觉问卷和对照位点；运动读出与感觉读出分开写。', limitations: '引出感觉不等于恢复自然触觉；刺激安全窗因人而异。', sources: ['H030S015', 'H030S016', 'H030S014'] },
      { id: 'M05', order: 5, category: '闭环调控', title: '自适应脑深部刺激与生理标记', principle: '用局部场电位或其他标记实时调节刺激强度或时序，并与开环对照比较。', answers: '判断调控改变的是回路标记还是预先定义的症状读出。', sample_design: '固定标记定义、调节规则和临床评分窗口；保留开环日对照。', limitations: '标记可调不是手术适应证；一种疾病的β规则不能套用到其他回路。', sources: ['H030S017', 'H030S018', 'H030S019', 'H030S020'] },
    ],
    findings: [
      { id: 'C01', title: '记录密度决定可见的群体动态，但不等于回路已被完整采样', shared_result: 'Neuropixels 系列、全脑发放调查和人体皮层记录证明，高通道可以同时描述任务发放与行为伴随波动，但覆盖仍受探针位置和急慢性条件限制。', research_use: '报告通道数、脑区、单位产率和漂移；急性与慢性结果分开比较。', boundary: '通道数上升不是完整回路图谱，也不能写成植入适应证。', sources: ['H030S001', 'H030S002', 'H030S003', 'H030S004', 'H030S006'] },
      { id: 'C02', title: '运动接口的成功指标绑定特定任务和反馈', shared_result: '机械臂抓取、人工触觉和脑脊步行研究证明，皮层放电可以驱动可测量的运动终点，而感觉反馈会改变控制读出。', research_use: '写清任务空间、反馈方式和成功率定义；感觉与运动读出分开记录。', boundary: '个案抓取或步态改善不是康复或手术方案。', sources: ['H030S008', 'H030S009', 'H030S014', 'H030S015', 'H030S016'] },
      { id: 'C03', title: '交流类神经假体用字符率和词错误率比较，而不是日常交流能力', shared_result: '手写和语音神经假体证明尝试书写或说话的神经活动可以映射到文字或虚拟形象，但词汇表和提示条件限制外推。', research_use: '报告词汇量、提示方式和错误类型；实验室速率与生活场景分开写。', boundary: '字符率不是语言功能恢复的证明。', sources: ['H030S010', 'H030S011', 'H030S012', 'H030S013'] },
      { id: 'C04', title: '闭环调控证明回路可调，不指定手术适应证', shared_result: '自适应脑深部刺激和无线记录研究证明，生理标记可以调节刺激，技术综述则把装置与算法放进同一框架。', research_use: '固定标记、调节规则和开环对照；症状评分与回路信号分开报告。', boundary: '标记可调不是手术指南，也不能写成通用治疗方案。', sources: ['H030S017', 'H030S018', 'H030S019', 'H030S020'] },
      { id: 'C05', title: '本页比较记录、解码与调控，不提供植入手术建议', shared_result: '人体记录和方法综述讨论的是信号与装置性质。细胞图谱和疾病机制由相邻专题处理。', research_use: '把结果写成通道覆盖、解码终点和闭环标记；涉及手术或用药时离开本页。', boundary: '不提供诊疗、植入手术指南、商品推荐或监管申报指引。', sources: ['H030S006', 'H030S007', 'H030S019', 'H030S001'] },
    ],
    pmids: [29120427, 33859006, 31776518, 33473216, 31000656, 35102333, 30502044, 22596161, 23253623, 33981047, 34260835, 37612500, 37612505, 37225984, 27738096, 34016775, 23852650, 33941932, 33244188, 31477926],
    refMeta: [
      ['primary_research', 'mouse high-density silicon probes', 'fully integrated Neuropixels recordings', 'multi-neuron extracellular coverage', 'acute/chronic rodent; probe-specific'],
      ['primary_research', 'miniaturized Neuropixels 2.0', 'stable long-term high-density recordings', 'reduced drift chronic recording', 'probe generation specific'],
      ['primary_research', 'mouse brain-wide coding', 'distributed choice and engagement signals', 'population coding across regions', 'task and species specific'],
      ['primary_research', 'mouse visual system', 'large-scale spiking survey', 'hierarchical visual responses', 'visual hierarchy; not a BCI trial'],
      ['primary_research', 'brainwide activity', 'spontaneous behavior coupling', 'behavior-related population dimensions', 'observational population study'],
      ['primary_research', 'human cortex Neuropixels', 'single-neuron resolution in human cortex', 'human high-density recording feasibility', 'intraoperative/human implant context; not a surgical guide'],
      ['primary_research', 'polymer electrodes', 'chronic multi-region recordings', 'flexible probe stability', 'device-specific chronic series'],
      ['primary_research', 'human motor BCI', 'neurally controlled robotic arm', 'reach and grasp performance', 'small-N human trial'],
      ['primary_research', 'human neuroprosthetic control', 'high-performance tetraplegia BCI', 'reach-and-grasp endpoint', 'single-participant performance'],
      ['primary_research', 'handwriting BCI', 'attempted handwriting decoding', 'brain-to-text communication rate', 'laboratory vocabulary and cues'],
      ['primary_research', 'speech neuroprosthesis', 'decoding speech in anarthria', 'word and sentence communication', 'single-participant NEJM report'],
      ['primary_research', 'speech neuroprosthesis', 'high-performance speech decoding', 'spoken-word communication rate', 'laboratory prompting conditions'],
      ['primary_research', 'speech avatar BCI', 'speech decoding and facial avatar', 'multimodal communication readout', 'specialized vocabulary and training'],
      ['primary_research', 'brain-spine interface', 'walking after spinal cord injury', 'gait with decoded stimulation', 'single-series neuromodulation; not a rehab protocol'],
      ['primary_research', 'human microstimulation', 'somatosensory cortex ICMS', 'evoked tactile percepts', 'parameter-specific percepts'],
      ['primary_research', 'sensory BCI feedback', 'tactile ICMS during robotic control', 'feedback-improved arm control', 'closed-loop feedback in one task'],
      ['primary_research', 'adaptive DBS', 'beta-triggered stimulation in Parkinson disease', 'closed-loop symptom comparison', 'small clinical physiology series'],
      ['primary_research', 'chronic neural streaming', 'wireless recordings for adaptive stimulation', 'circuit discovery plus closed-loop', 'device and indication specific'],
      ['review', 'deep brain stimulation technology', 'electrodes algorithms sensing', 'DBS device comparison', 'review; not an operative guide'],
      ['review', 'emerging DBS technologies', 'sensing and adaptive stimulation', 'closed-loop method horizon', 'review; algorithm-specific'],
    ],
    techBody: '本专题的技术卡包括高密度电极覆盖评估、发放排序与群体轨迹、运动或语音解码、皮层微刺激反馈，以及自适应脑深部刺激。技术选择取决于需要确认的是记录窗口、解码终点还是回路可调性。',
    scopeBody: '本页用于介绍神经接口、高密度记录与神经调控研究中的证据类型和适用边界，用于研究导航。不提供诊疗、植入手术指南、商品推荐或监管申报指引。脑细胞图谱见 H028、H029。',
  },
  {
    topic_id: 'H038',
    title: '多重与超灵敏分子诊断',
    slug: 'multiplex-ultrasensitive-molecular-diagnostics',
    overview: [
      '多重与超灵敏分子诊断追问的是分析性能：低丰度核酸或蛋白如何被计数，多个靶标如何在同一反应中被分开，错误碱基如何从真变异中剥离。数字分区、纠错测序、CRISPR 检测和多重蛋白成像回答的是不同层级的灵敏度与特异性，不能互相替代。',
      '本方向从数字聚合酶链式反应、纠错测序、CRISPR 核酸检测和多重蛋白或空间成像出发，集中处理三类问题：分区计数如何把相对定量改写成绝对拷贝；分子条形码如何压低测序错误；多重读出如何在靶标之间保持正交。循环标志物的疾病用途由液体活检专题处理，本页不把分析灵敏度写成临床筛查性能。',
      '比较公开研究时，需要同时交代靶标类型、分区或条形码策略、多重规模、对照和检出限定义。本页是研究导航，不是诊断产品说明书、诊疗或监管申报指引。实验室检出限不能写成临床诊断阈值。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 分析物 | 核酸、蛋白或空间表位，以及靶标数目 | 灵敏度比较是否在同一分子层级 |\n| 计数策略 | 数字分区、条形码纠错或单分子免疫 | 检出限由泊松计数还是错误率决定 |\n| 多重规模 | 单管靶标数、通道串扰和正交验证 | 多重是否以特异性为代价 |\n| 对照与标准 | 空白、野生型背景、参考物质和重复 | 阳性是否超过分析背景 |\n| 解释边界 | 样本类型、预处理和临床终点是否另测 | 分析性能能否写成疾病判断 |',
    sections: [
      {
        title: '数字分区把相对荧光改写成可计数的分子拷贝',
        body: '数字聚合酶链式反应把反应分割为大量独立分区，用阳性分区比例估计拷贝数。高通量微滴数字系统和随后的绝对定量对照，证明微滴分区可以在拷贝数和稀有变异上给出可重复计数。乳液微粒上的单分子扩增进一步证明，稀有序列可以在单分子水平被富集和定量。\n\n分区方法适合比较拷贝数、等位基因分数和线性范围。分区均匀性和空滴率必须报告；绝对计数仍受提取回收率限制，不能单独写成临床诊断。',
        source_ids: ['H038S001', 'H038S002', 'H038S003', 'H038S004'],
      },
      {
        title: '分子条形码把测序错误从稀有真变异中剥离',
        body: 'Safe-SeqS 证明唯一标识符可以标记每个起始分子，从而识别测序过程中产生的错误。CAPP-Seq 证明捕获测序可以在较广患者覆盖下定量循环肿瘤核酸。整合数字错误抑制进一步证明，双链条形码和背景建模可以再压低错误率。\n\n纠错测序适合比较等位基因检出限和背景错误。文库复杂度和对照血浆决定能报告的最低分数；分析灵敏度不是癌症筛查性能，循环标志物的疾病用途见 H037。',
        source_ids: ['H038S005', 'H038S006', 'H038S007'],
      },
      {
        title: 'CRISPR 核酸酶把靶标识别改写成便携检测读出',
        body: 'CRISPR-Cas13a 检测证明，靶标结合可以释放非特异核酸酶活性并产生荧光或侧流读出。随后的多重便携平台把 Cas13、Cas12a 和 Csm6 组合到同一检测框架。Cas12a 的单链核酸酶活性和严重急性呼吸综合征冠状病毒 2 的 Cas12 侧流检测，以及一锅 SHERLOCK 检测，进一步证明该读出可以离开实验室测序流程。\n\nCRISPR 检测适合比较靶标设计、扩增前置和读出形式。向导特异性和扩增步骤决定灵敏度；研究用检测不是获批诊断产品说明书。',
        source_ids: ['H038S008', 'H038S009', 'H038S010', 'H038S011', 'H038S012'],
      },
      {
        title: '多重蛋白和空间成像把靶标从单通道扩展到面板',
        body: '单分子酶联免疫证明蛋白可以在亚飞摩尔浓度被计数。彩色编码探针的多重转录测量，以及邻近延伸分析及其 96 重扩展，证明蛋白或多核苷酸面板可以在同一微量样本中并行读出。质谱流式成像、多重离子束成像和 CODEX 则把多重推进到组织空间坐标。\n\n多重蛋白和成像适合比较面板规模、交叉反应和空间分辨率。通道串扰和抗体或探针验证必须单独报告；面板阳性不是疾病诊断。',
        source_ids: ['H038S013', 'H038S014', 'H038S015', 'H038S016', 'H038S017', 'H038S018', 'H038S019'],
      },
      {
        title: '专题边界：分析性能不是诊断产品说明书',
        body: '自动化嵌套多重聚合酶链式反应系统证明多病原面板可以在同一反应中给出检测结果，但这类研究比较的是分析覆盖和操作流程，不是某一注册产品的使用说明。循环肿瘤核酸的超灵敏定量同样停留在方法层。\n\n本页用于比较灵敏度、多重规模和错误控制。液体活检的疾病分层与监测见 H037。实验室检出限不能写成临床诊断阈值，也不构成商品推荐或监管申报指引。',
        source_ids: ['H038S020', 'H038S006', 'H038S007', 'H038S001'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '数字计数', title: '数字分区与微滴绝对定量', principle: '把核酸反应分割为大量独立分区，用阳性比例按泊松模型估计拷贝数。', answers: '比较拷贝数或稀有等位基因分数是否高于分区背景。', sample_design: '报告分区数、空滴率、提取回收和参考物质；保留未扩增对照。', limitations: '回收率不足会低估拷贝；绝对计数不是临床诊断阈值。', sources: ['H038S001', 'H038S002', 'H038S003', 'H038S004'] },
      { id: 'M02', order: 2, category: '纠错测序', title: '分子条形码与数字错误抑制', principle: '给每个起始分子加唯一标识，并在家族内核对以区分真变异与扩增或测序错误。', answers: '判断报告的低频率变异是否超过背景错误。', sample_design: '固定条形码设计、家族大小阈值和对照血浆；报告文库复杂度。', limitations: '复杂度不足会假阴性；分析灵敏度不是筛查性能。', sources: ['H038S005', 'H038S006', 'H038S007'] },
      { id: 'M03', order: 3, category: 'CRISPR 检测', title: '核酸酶旁切活性与便携读出', principle: '用向导核糖核酸识别靶标，借助 Cas13 或 Cas12 旁切活性产生荧光或侧流信号。', answers: '检验预定序列能否在选定读出形式上被特异检出。', sample_design: '设置错配向导、无靶标和近源序列对照；报告扩增前置步骤。', limitations: '前置扩增往往决定灵敏度；研究检测不是产品说明书。', sources: ['H038S008', 'H038S009', 'H038S010', 'H038S011'] },
      { id: 'M04', order: 4, category: '多重蛋白', title: '单分子免疫与邻近延伸面板', principle: '用单分子计数或邻近连接/延伸把低丰度蛋白变成可计数信号，并在同一微量样本中并行多个靶标。', answers: '比较蛋白面板的检出限和靶标间正交性。', sample_design: '报告校准曲线、交叉反应和基质效应；关键靶标用正交免疫复核。', limitations: '抗体试剂批次会改变数值；面板阳性不是疾病判断。', sources: ['H038S013', 'H038S015', 'H038S016', 'H038S014'] },
      { id: 'M05', order: 5, category: '空间多重', title: '组织多重成像与通道串扰控制', principle: '在同一组织切片上循环或质谱读出数十个表位，并把信号对齐到细胞坐标。', answers: '判断空间共定位是否建立在通过串扰控制的通道上。', sample_design: '固定抗体验证、循环次序和空白循环；报告细胞分割参数。', limitations: '通道串扰会造成假共定位；成像面板不是诊断产品。', sources: ['H038S017', 'H038S018', 'H038S019'] },
    ],
    findings: [
      { id: 'C01', title: '数字分区给出绝对拷贝估计，但仍受回收率约束', shared_result: '数字聚合酶链式反应和微滴系统证明阳性分区比例可以估计拷贝数，乳液单分子扩增则把稀有序列计数推进到单分子。', research_use: '报告分区数、空滴率和提取回收；拷贝数与临床终点分开写。', boundary: '绝对计数不是诊断阈值。', sources: ['H038S001', 'H038S002', 'H038S003', 'H038S004'] },
      { id: 'C02', title: '条形码纠错决定低频率变异能否从错误中分开', shared_result: 'Safe-SeqS、CAPP-Seq 和数字错误抑制证明，分子标识和双链核对可以压低测序背景，使更低等位基因分数可被报告。', research_use: '固定家族阈值、对照血浆和文库复杂度；未通过纠错的变异单独标记。', boundary: '分析灵敏度不是癌症筛查性能。循环标志物疾病用途见 H037。', sources: ['H038S005', 'H038S006', 'H038S007'] },
      { id: 'C03', title: 'CRISPR 检测提供便携读出，不替代测序纠错', shared_result: 'Cas13 与 Cas12 平台证明靶标结合可以产生荧光或侧流信号，一锅法进一步缩短步骤，但向导设计和扩增前置仍决定性能。', research_use: '报告向导序列、错配对照和是否前置扩增；读出形式与定量范围分开写。', boundary: '研究用检测不是获批产品说明书。', sources: ['H038S008', 'H038S009', 'H038S010', 'H038S011', 'H038S012'] },
      { id: 'C04', title: '多重蛋白和成像扩展面板，也放大串扰', shared_result: '单分子免疫、邻近延伸和空间多重成像证明同一微量样本或切片可以并行多个靶标，同时要求交叉反应和通道验证。', research_use: '报告面板规模、校准和空白循环；空间共定位需通过串扰控制。', boundary: '面板阳性不是疾病诊断。', sources: ['H038S013', 'H038S015', 'H038S016', 'H038S017', 'H038S019'] },
      { id: 'C05', title: '本页比较分析性能，不提供诊断产品说明', shared_result: '多重病原面板和超灵敏循环核酸方法比较的是覆盖与错误控制。疾病分层由液体活检专题处理。', research_use: '把结果写成检出限、多重规模和错误率；涉及诊疗或申报时离开本页。', boundary: '不提供诊疗、商品推荐、产品说明书或监管申报指引。', sources: ['H038S020', 'H038S006', 'H038S001'] },
    ],
    pmids: [10430926, 22035192, 23995387, 16791214, 21586637, 24705333, 27018799, 28408723, 29449508, 29449511, 32300245, 32937062, 20495550, 18278033, 21646338, 24755770, 24584193, 24584119, 30078711, 22039434],
    refMeta: [
      ['primary_research', 'digital PCR principle', 'partitioned single-molecule PCR', 'absolute copy-number logic', 'foundational method; early implementation'],
      ['primary_research', 'droplet digital PCR', 'high-throughput droplet system', 'absolute DNA copy quantitation', 'platform paper; extraction still limits yield'],
      ['primary_research', 'ddPCR versus qPCR', 'absolute versus analog quantification', 'copy-number method comparison', 'method comparison; assay-specific'],
      ['primary_research', 'BEAMing', 'emulsion single-molecule PCR', 'rare variant counting', 'foundational emulsion method'],
      ['primary_research', 'Safe-SeqS', 'unique identifiers for sequencing', 'error-suppressed rare mutation calls', 'sequencing-error control; library complexity dependent'],
      ['primary_research', 'CAPP-Seq', 'ultrasensitive circulating tumor DNA', 'broad-coverage ctDNA quantitation', 'analytical method; not a screening claim'],
      ['primary_research', 'integrated digital error suppression', 'duplex barcoding and background modeling', 'lower ctDNA detection limit', 'method paper; plasma-control dependent'],
      ['primary_research', 'SHERLOCK Cas13a', 'CRISPR nucleic-acid detection', 'target-activated collateral cleavage', 'foundational CRISPR diagnostic'],
      ['primary_research', 'SHERLOCKv2', 'Cas13 Cas12a Csm6 multiplex platform', 'portable multiplex nucleic-acid readout', 'platform demonstration'],
      ['primary_research', 'Cas12a DETECTR chemistry', 'target-activated ssDNase activity', 'Cas12a collateral detection', 'biochemical mechanism'],
      ['primary_research', 'DETECTR SARS-CoV-2', 'Cas12 lateral-flow detection', 'rapid CRISPR viral readout', 'research assay; not a product insert'],
      ['primary_research', 'SHERLOCK one-pot', 'single-tube CRISPR SARS-CoV-2 test', 'simplified CRISPR workflow', 'one-pot research protocol'],
      ['primary_research', 'digital ELISA', 'single-molecule protein counting', 'subfemtomolar protein detection', 'analytical sensitivity; matrix effects remain'],
      ['primary_research', 'nCounter probes', 'color-coded probe pairs', 'multiplex transcript counting', 'transcript panel method'],
      ['primary_research', 'proximity extension assay', 'homogeneous antibody PEA', 'low-abundance protein detection', 'early PEA implementation'],
      ['primary_research', '96-plex PEA', 'homogeneous multiplex immunoassay', 'scaled protein panel', 'panel-specific antibody reagents'],
      ['primary_research', 'imaging mass cytometry', 'multiplexed tissue imaging', 'subcellular multiplex protein maps', 'metal-tag imaging; antibody validation required'],
      ['primary_research', 'MIBI breast tumors', 'multiplexed ion beam imaging', 'high-dimensional tissue protein maps', 'imaging method; not a diagnostic device'],
      ['primary_research', 'CODEX spleen', 'DNA-barcoded multiplex imaging', 'spatial immune architecture', 'mouse spleen demonstration'],
      ['primary_research', 'FilmArray nested multiplex PCR', 'automated multi-pathogen panel', 'syndromic multiplex detection', 'analytical panel; not a product insert'],
    ],
    techBody: '本专题的技术卡包括数字分区绝对定量、分子条形码纠错、CRISPR 便携检测、单分子或邻近延伸蛋白面板，以及组织多重成像。技术选择取决于需要确认的是拷贝数、低频率变异、便携读出还是空间多重。',
    scopeBody: '本页用于介绍多重与超灵敏分子诊断研究中的证据类型和适用边界，用于研究导航。不提供诊疗、诊断产品说明书、商品推荐或监管申报指引。液体活检与循环标志物见 H037。',
  },
  {
    topic_id: 'H043',
    title: '去中心化临床研究与数字终点',
    slug: 'decentralized-clinical-trials-digital-endpoints',
    overview: [
      '去中心化临床研究把访视、知情同意和数据采集从单一研究中心部分转移到参与者所在地。数字终点则用可穿戴设备、智能手机或传感器连续测量功能、节律或症状。这两类工作回答的是参与方式和测量方式，不是某一申办方案应当如何撰写。',
      '本方向从试验数字化理由、可穿戴与智能手机终点、远程房颤识别和留存，以及务实或去中心化运营出发，集中处理三类问题：数字测量经过了哪一层验证；远程参与改变了哪些偏倚；务实网络如何把终点写进可比较的协议。本页不提供申办方案模板。',
      '比较公开研究时，需要同时交代去中心化成分、传感器、验证层级、留存和终点定义。本页是研究导航，不是诊疗、商品推荐或监管申报指引。某一应用的探索性终点不能写成注册终点。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 去中心化成分 | 远程知情、居家访视、直达参与者给药或远程随访 | 改变的是准入、依从还是终点采集 |\n| 传感器与任务 | 手表、手机、加速度计或主动测试 | 数字读出对应哪一类功能或生理 |\n| 验证层级 | 核实、分析验证和临床验证 | 读出停留在工程层还是终点层 |\n| 留存与代表 | 脱落、数字鸿沟和未完成采集 | 完成样本是否仍代表原队列 |\n| 协议与运营 | 网络、中心实验室和安全监测 | 远程流程能否被独立复用 |',
    sections: [
      {
        title: '试验数字化先把测量和参与方式写成可检验的设计问题',
        body: '数字化临床试验综述证明，远程访视和连续传感器可以改变招募和终点采集，同时也带来数据完整和公平准入问题。移动健康综述和数字生物标志物框架进一步证明，传感器读出必须先经过核实与验证，才能进入终点讨论。数字医学测量入门则把计量单位、参考标准和临床有意义变化分开。\n\n这些工作适合作为设计清单。数字化不等于去中心化已经完成；未经验证的传感器输出不能写成试验终点。',
        source_ids: ['H043S001', 'H043S002', 'H043S003', 'H043S004'],
      },
      {
        title: '可穿戴和智能手机终点需要按验证层级分开报告',
        body: 'V3 框架证明传感器数字健康技术应依次完成核实、分析验证和临床验证。随后的扩展框架把使用者中心和可扩展性补进同一逻辑。可穿戴设备在临床试验中的讨论、帕金森病智能手机测试、远程智能手机监测，以及 III 期探索性应用终点，共同证明手机或手表读出可以生成可分析的功能测量。英国生物银行腕部加速度计则把同类传感器推进到人群规模。\n\n数字终点适合比较验证层级、采样率和缺失模式。探索性应用终点不是注册终点；人群加速度计也不是某一适应证的疗效证明。',
        source_ids: ['H043S005', 'H043S006', 'H043S007', 'H043S008', 'H043S009', 'H043S010', 'H043S011'],
      },
      {
        title: '远程识别和留存决定数字队列还能代表谁',
        body: '智能手表大规模房颤识别研究证明，消费级可穿戴可以在未经诊所筛查的人群中提出心律异常提示，并进入后续心电图确认。远程数字健康研究的留存指标评估进一步证明，提醒、任务负担和人群特征会系统性改变谁留到终点。\n\n远程识别适合提出筛查或预警假设。应用阳性不是临床诊断；高脱落会使完成样本偏离原目标人群。',
        source_ids: ['H043S012', 'H043S013'],
      },
      {
        title: '务实网络和去中心化运营把流程从单一中心拆开',
        body: 'PCORnet 的启动和 ADAPTABLE 相关讨论证明，电子健康记录网络可以支持务实对照和参与者中心随访。阿司匹林剂量比较效果研究和临床医生参与分析，进一步证明大型务实试验可以在常规诊疗环境中完成终点采集。Trials@Home 的概念验证和监管互动记录，则把去中心化活动、数据完整和审评沟通写成可引用的运营经验。\n\n运营研究适合比较哪些访视被远程化、安全监测如何保持。这些论文不是申办方案模板，也不能替代具体试验的伦理和数据治理。',
        source_ids: ['H043S014', 'H043S015', 'H043S016', 'H043S017', 'H043S018', 'H043S019'],
      },
      {
        title: '专题边界：数字终点框架不是申办方案模板',
        body: '传感器数字健康技术的分层参考测量框架，说明分析验证需要预先指定参考标准，而不是把应用输出直接写入方案终点。数字化综述同样把公平准入和数据完整列为独立问题。\n\n本页用于比较去中心化成分、验证层级和留存。真实世界证据与目标试验模拟见 H044。本页不提供申办方案模板、诊疗、商品推荐或监管申报指引。',
        source_ids: ['H043S020', 'H043S005', 'H043S001', 'H043S004'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '设计拆分', title: '去中心化成分与访视映射', principle: '把知情、给药、访视和安全监测拆成可远程或必须到场的单元，并预先定义数据完整规则。', answers: '判断远程成分改变的是准入、依从还是终点采集。', sample_design: '列出每项活动的地点、责任方和补救路径；保留到场对照访视。', limitations: '数字化标签不能代替成分清单；远程流程不是方案模板。', sources: ['H043S001', 'H043S014', 'H043S018'] },
      { id: 'M02', order: 2, category: '传感器验证', title: '核实、分析验证与临床验证', principle: '按 V3 顺序检查传感器输出是否对应预定物理量，并与参考测量和临床有意义变化对齐。', answers: '确认数字读出停留在工程层、分析层还是终点层。', sample_design: '预先指定参考标准、采样率和缺失规则；探索性读出单独标记。', limitations: '未完成临床验证的读出不能写成注册终点。', sources: ['H043S005', 'H043S006', 'H043S020', 'H043S004'] },
      { id: 'M03', order: 3, category: '数字功能', title: '智能手机与可穿戴功能测试', principle: '用主动任务或被动传感测量运动、节律或症状，并估计日内和日间变异。', answers: '比较数字功能读出能否追踪预先定义的临床变化。', sample_design: '固定任务脚本、佩戴依从和对照临床量表；报告缺失时段。', limitations: '应用界面和人群数字素养会改变完成率；探索性终点不是疗效。', sources: ['H043S007', 'H043S008', 'H043S009', 'H043S010'] },
      { id: 'M04', order: 4, category: '远程识别', title: '消费级预警与确认路径', principle: '用可穿戴不规则节律或其他信号提出提示，再进入心电图或临床确认。', answers: '判断远程提示的阳性预测是否建立在确认路径上。', sample_design: '报告提示规则、确认检查和未完成确认的比例；诊断与提示分开写。', limitations: '应用阳性不是临床诊断；自愿佩戴造成选择偏倚。', sources: ['H043S012', 'H043S011', 'H043S002'] },
      { id: 'M05', order: 5, category: '留存与运营', title: '远程留存、代表性和安全监测', principle: '跟踪脱落、任务负担和未完成采集，并检查完成样本是否仍覆盖原纳入人群。', answers: '评估数字队列在终点时还代表谁。', sample_design: '预先定义留存指标、提醒策略和安全升级路径；报告数字鸿沟。', limitations: '高留存不等于代表性足够；运营经验不是申办模板。', sources: ['H043S013', 'H043S016', 'H043S017', 'H043S019'] },
    ],
    findings: [
      { id: 'C01', title: '数字化先改变测量和参与，不自动产生合格终点', shared_result: '数字化综述和数字生物标志物框架证明，远程访视和传感器必须先经过核实与验证，才能进入终点讨论。', research_use: '先列出去中心化成分和验证层级；未验证输出单独标记。', boundary: '数字化标签不是终点已经成立。', sources: ['H043S001', 'H043S002', 'H043S003', 'H043S004'] },
      { id: 'C02', title: '可穿戴读出按 V3 分层，探索性应用终点不能写成注册终点', shared_result: 'V3 及扩展框架、帕金森病手机测试和人群加速度计证明，传感器可以生成可分析的功能测量，但验证层级决定能写到哪一步。', research_use: '报告参考标准、采样率和缺失；探索性读出与主要终点分开。', boundary: 'III 期探索性应用终点不是注册终点。', sources: ['H043S005', 'H043S006', 'H043S008', 'H043S009', 'H043S010'] },
      { id: 'C03', title: '远程提示必须连接确认路径，留存决定样本还代表谁', shared_result: '智能手表房颤研究和远程留存评估证明，消费级提示可以进入确认检查，而任务负担会改变谁留到终点。', research_use: '报告提示规则、确认完成率和脱落；完成样本与原队列对照。', boundary: '应用阳性不是临床诊断。', sources: ['H043S012', 'H043S013', 'H043S011'] },
      { id: 'C04', title: '务实网络可以支持参与者中心随访，但不是方案模板', shared_result: 'PCORnet、ADAPTABLE 和 Trials@Home 证明，电子健康记录网络和去中心化活动可以在常规环境中完成大型对照，同时留下监管沟通和医生参与记录。', research_use: '写清哪些访视远程化、安全如何升级；运营经验与具体方案分开。', boundary: '本页不提供申办方案模板。', sources: ['H043S014', 'H043S015', 'H043S016', 'H043S018', 'H043S019'] },
      { id: 'C05', title: '本页比较参与方式和测量方式，不提供申报指引', shared_result: '分层参考测量框架把分析验证锚定在预先指定的参考标准上。真实世界证据方法由 H044 处理。', research_use: '把结果写成成分清单、验证层级和留存；涉及申报或诊疗时离开本页。', boundary: '不提供诊疗、商品推荐、申办方案模板或监管申报指引。', sources: ['H043S020', 'H043S005', 'H043S001'] },
    ],
    pmids: [32821856, 25877894, 30868107, 32095767, 32337371, 39856145, 29205294, 29701258, 34373643, 35224425, 28146576, 31722151, 32128451, 24821743, 26301537, 33999548, 33541120, 40888335, 41044886, 39918870],
    refMeta: [
      ['review', 'digitizing clinical trials', 'remote visits and continuous sensors', 'trial participation and endpoint design', 'review; not a protocol template'],
      ['review', 'mobile health', 'emerging mHealth measurement', 'sensor and connectivity framing', 'review; early mHealth landscape'],
      ['review', 'digital biomarkers', 'safe and effective digital biomarkers', 'biomarker adoption conditions', 'conceptual framework'],
      ['review', 'digital medicine measurement', 'primer on measurement', 'units references and meaningful change', 'primer; not a trial protocol'],
      ['review', 'V3 framework', 'verification analytical and clinical validation', 'fit-for-purpose sensor evidence', 'method framework'],
      ['review', 'V3+ extension', 'user-centricity and scalability', 'extended sensor validation', 'framework extension'],
      ['review', 'wearables in trials', 'hype and hypothesis', 'wearable endpoint caution', 'review; device class heterogeneous'],
      ['primary_research', 'Parkinson smartphone tests', 'phase 1 exploratory digital outcomes', 'smartphone motor testing', 'early-phase exploratory endpoints'],
      ['primary_research', 'remote smartphone monitoring', 'Parkinson disease and therapy response', 'passive and active smartphone measures', 'observational digital monitoring'],
      ['primary_research', 'phase 3 smartphone app', 'exploratory digital endpoint', 'app-based Parkinson outcome', 'exploratory; not a registrational endpoint'],
      ['primary_research', 'UK Biobank accelerometry', 'population wrist-worn activity', 'large-scale physical-activity measurement', 'population resource; not a drug trial'],
      ['primary_research', 'Apple Heart Study', 'smartwatch irregular-rhythm notification', 'remote atrial-fibrillation signal', 'notification plus confirmation; not a diagnosis'],
      ['primary_research', 'remote study retention', 'cross-study 100000-participant evaluation', 'who remains in digital studies', 'retention analysis; selection bias'],
      ['primary_research', 'PCORnet launch', 'national patient-centered network', 'pragmatic multi-site infrastructure', 'network paper; governance varies'],
      ['review', 'ADAPTABLE and PCORnet', 'pragmatic trial paradigm', 'EHR-enabled pragmatic follow-up', 'commentary on design'],
      ['primary_research', 'ADAPTABLE aspirin dosing', 'pragmatic comparative effectiveness', 'aspirin dose clinical endpoints', 'pragmatic trial; indication-specific'],
      ['primary_research', 'ADAPTABLE clinician engagement', 'site and clinician participation', 'operational engagement in pragmatic trials', 'operations analysis'],
      ['primary_research', 'Trials@Home RADIAL', 'proof-of-concept decentralization', 'remote trial activities', 'operational demonstration; not a template'],
      ['primary_research', 'RADIAL regulatory interactions', 'decentralization learnings with regulators', 'regulatory communication record', 'operations; not official guidance'],
      ['review', 'sensor DHT reference measures', 'hierarchical analytical validation', 'choosing reference standards', 'method framework'],
    ],
    techBody: '本专题的技术卡包括去中心化成分映射、V3 传感器验证、智能手机与可穿戴功能测试、远程提示与确认，以及留存和安全监测。技术选择取决于需要确认的是测量是否成立、提示是否经过确认，还是完成样本是否仍有代表性。',
    scopeBody: '本页用于介绍去中心化临床研究与数字终点中的证据类型和适用边界，用于研究导航。不提供诊疗、申办方案模板、商品推荐或监管申报指引。真实世界证据见 H044。',
  },
  {
    topic_id: 'H044',
    title: '真实世界证据与目标试验模拟',
    slug: 'real-world-evidence-target-trial-emulation',
    overview: [
      '真实世界证据把电子健康记录、理赔和登记写成可用于决策讨论的观察数据。目标试验模拟则要求先写出若随机试验存在时的方案，再按同一纳入、时零和治疗策略去组织观察数据。模拟可以减少某些自伤偏倚，但模拟成功不等于因果已经证实。',
      '本方向从目标试验方案、用真实世界数据效仿随机试验、具体模拟实例，以及报告与可复现模板出发，集中处理三类问题：时零和资格如何对齐；数据库分析与原试验在哪些设计上必然不同；报告标准让哪些选择可被复核。去中心化数字终点由 H043 处理，本页不把传感器验证写成因果估计。',
      '比较公开研究时，需要同时交代目标试验方案、数据源、时零、治疗策略、混杂调整和阴性对照。本页是研究导航，不是诊疗、商品推荐或监管申报指引。目标试验模拟不是因果已证实。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 目标试验方案 | 资格、时零、治疗策略、终点和估计目标 | 观察分析效仿的是哪一场试验 |\n| 数据源 | 电子健康记录、理赔、登记或其链接 | 暴露和终点能否被同样定义 |\n| 时零与资格 | 资格评估是否与治疗赋值同时发生 | 是否引入永生时间或选择偏倚 |\n| 混杂与对照 | 调整集、工具变量、阴性对照和校准 | 残差混杂被检查到哪一步 |\n| 报告与复现 | 协议模板、代码和数据使用条件 | 他人能否按同一方案重做 |',
    sections: [
      {
        title: '目标试验方案先把观察分析应效仿的随机试验写出来',
        body: '当随机试验不可得时用大数据效仿目标试验的论文，证明观察研究可以按资格、时零和治疗策略重新组织。公共卫生研究方法论文进一步把这一逻辑写成加强观察数据因果推断的框架。指定目标试验以防永生时间偏倚，以及把观察研究按随机试验方式分析的早期应用，共同证明许多偏倚来自方案没写清，而不是数据本身不可用。\n\n这些工作适合作为方案对照清单。写出目标试验是设计步骤，不是已经得到因果结论。',
        source_ids: ['H044S001', 'H044S002', 'H044S003', 'H044S004'],
      },
      {
        title: '用非随机数据库效仿随机试验会暴露设计差异',
        body: 'RCT-DUPLICATE 的首批结果证明，部分心血管结局试验可以在真实世界数据中被接近，另一些则因治疗策略或终点定义无法对齐。对 32 项试验的效仿以及用随机试验校准真实世界研究，进一步证明一致性依赖适应证、比较器和测量窗口。真实世界证据能告诉我们什么的讨论，则把适用范围限制在数据所能支持的问题上。\n\n效仿研究适合比较哪些试验可被数据库抓住。接近原试验估计不是普遍可替代随机试验；失败的效仿同样是主要结果。',
        source_ids: ['H044S006', 'H044S007', 'H044S008', 'H044S005'],
      },
      {
        title: '已发表的目标试验模拟把方案选择写成可检查的分析',
        body: '美国退伍军人中两种信使核糖核酸疫苗的比较效果研究，证明目标试验模拟可以在同一医疗系统中估计接种策略的相对结果。倾向评分方法讨论、时零对齐说明，以及目标试验方案从何而来的方法论文，进一步证明资格与治疗赋值必须落在同一时点。肿瘤监管与临床决策中的目标试验模拟综述，则把该框架放到决策讨论中，同时保留观察限制。\n\n应用研究适合检查时零、治疗策略和终点是否写全。单一系统的疫苗比较不能写成所有观察研究都已证实因果。',
        source_ids: ['H044S009', 'H044S015', 'H044S018', 'H044S017', 'H044S019'],
      },
      {
        title: '报告模板让模拟中的关键选择可以被复核',
        body: 'TARGET 声明的期刊版本要求观察性目标试验模拟报告资格、时零和估计目标。HARPER 协议模板及其价值评估版本，以及用常规诊疗数据重做真实世界研究的可复现性评估，证明同一问题在不同团队或数据源中可能得出不同数值。联盟推进随机试验效仿的工作则把校准和协议预注册写成可引用实践。\n\n报告标准适合作为复核清单。模板完整不等于估计无偏；可复现失败应作为方法结果报告。',
        source_ids: ['H044S010', 'H044S011', 'H044S012', 'H044S013', 'H044S014', 'H044S020'],
      },
      {
        title: '专题边界：目标试验模拟不是因果已证实',
        body: '新药申请中的真实世界证据审评经验说明，监管档案可以引用真实世界数据，但引用本身不是本页的申报指引，也不证明观察估计已经等同随机试验。写出目标试验、完成效仿或通过报告清单，仍然停留在设计与报告层。\n\n本页用于比较方案完整性、数据对齐和可复现。去中心化数字终点见 H043，联邦数据与实施科学见 H045。本页不把模拟成功写成因果已证实，也不提供诊疗或申报路径。',
        source_ids: ['H044S016', 'H044S005', 'H044S001', 'H044S002'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '方案指定', title: '目标试验方案与估计目标', principle: '在看数据估计之前，先写资格、时零、治疗策略、终点和估计目标。', answers: '确认观察分析效仿的是哪一场可写出的随机试验。', sample_design: '把方案要素写成表格；数据中无法操作的条目单独列出。', limitations: '方案写清不是因果已证实；无法操作的条目必须公开列出，不能悄悄改掉。', sources: ['H044S001', 'H044S002', 'H044S017'] },
      { id: 'M02', order: 2, category: '时零对齐', title: '资格、治疗赋值与永生时间检查', principle: '让资格评估与治疗策略赋值发生在同一时零，并检查随访是否在赋值之后才开始。', answers: '判断是否引入永生时间或资格后选择。', sample_design: '画出时零图；报告赋值前事件和延迟进入。', limitations: '时零对不齐会使效应方向都不可信。', sources: ['H044S003', 'H044S004', 'H044S018'] },
      { id: 'M03', order: 3, category: '数据库效仿', title: '用真实世界数据效仿已完成随机试验', principle: '按原试验的关键方案要素重建队列，并比较方向、区间和失败原因。', answers: '评估该试验能否被现有数据库抓住，以及差异来自设计还是混杂。', sample_design: '预先定义成功接近的标准、阴性对照和无法对齐的条目。', limitations: '接近原试验不是普遍可替代随机试验。', sources: ['H044S006', 'H044S007', 'H044S008'] },
      { id: 'M04', order: 4, category: '混杂检查', title: '调整集、倾向评分与阴性对照', principle: '用预先指定的混杂集或倾向评分平衡基线，并用阴性对照或校准试验检查残差偏倚。', answers: '检查残差混杂是否大到足以改写结论方向。', sample_design: '报告平衡表、截断和阴性对照结果；失败对照不得删除。', limitations: '未测量混杂无法被评分完全消除。', sources: ['H044S015', 'H044S009', 'H044S008'] },
      { id: 'M05', order: 5, category: '报告复现', title: 'TARGET、HARPER 与独立重做', principle: '按报告声明和协议模板公开关键选择，并在可能时用独立数据或独立团队重做。', answers: '评估他人能否按同一方案复核或复现。', sample_design: '提供协议、代码条件和数据使用范围；复现差异单独成文。', limitations: '模板完整不等于无偏；本方法不产生申报结论。', sources: ['H044S010', 'H044S012', 'H044S014', 'H044S020'] },
    ],
    findings: [
      { id: 'C01', title: '先写目标试验，再动数据', shared_result: '目标试验框架和永生时间论文证明，资格、时零和治疗策略写不清时，偏倚可以在分析前就已形成。', research_use: '把方案要素制成对照表；无法操作的条目公开列出。', boundary: '写出方案不是因果已证实。', sources: ['H044S001', 'H044S002', 'H044S003', 'H044S004'] },
      { id: 'C02', title: '数据库效仿会成功也会失败，失败同样是结果', shared_result: 'RCT-DUPLICATE 和校准研究证明，部分试验可被真实世界数据接近，另一些因策略或终点无法对齐。', research_use: '预先定义接近标准；把无法对齐的设计差异写成主要发现。', boundary: '接近原试验不是随机试验的普遍替代。', sources: ['H044S006', 'H044S007', 'H044S008', 'H044S005'] },
      { id: 'C03', title: '应用模拟必须把时零和治疗策略写到可检查', shared_result: '疫苗比较效果和时零对齐论文证明，资格与赋值必须落在同一时点，倾向评分可能只是混杂检查的一层。', research_use: '提供时零图、平衡表和阴性对照；单一系统结果限制外推。', boundary: '一次模拟成功不能写成所有观察研究已证实因果。', sources: ['H044S009', 'H044S015', 'H044S018', 'H044S017'] },
      { id: 'C04', title: '报告模板让选择可复核，但不消除偏倚', shared_result: 'TARGET、HARPER 和可复现性评估证明，同一问题在不同团队或数据中可能得出不同数值，因此协议和代码必须可核对。', research_use: '按声明报告资格、时零和估计目标；复现差异单独成文。', boundary: '模板完整不等于估计无偏。', sources: ['H044S010', 'H044S012', 'H044S014', 'H044S020'] },
      { id: 'C05', title: '本页比较设计与报告，不把模拟写成已证实因果', shared_result: '真实世界证据的适用范围由数据所能支持的问题决定。审评档案引用真实世界数据，也不构成本页的申报指引。', research_use: '把结果写成方案完整性、对齐情况和可复现；涉及诊疗或申报时离开本页。', boundary: '目标试验模拟不是因果已证实。不提供诊疗、商品推荐或监管申报指引。', sources: ['H044S016', 'H044S005', 'H044S001'] },
    ],
    pmids: [26994063, 34596980, 27237061, 18854702, 27959688, 33327727, 37097356, 34027993, 34942066, 40903028, 40899949, 36215113, 36241338, 36045130, 25995287, 40276902, 41921517, 41526041, 41643147, 36408668],
    refMeta: [
      ['review', 'target trial emulation', 'emulate a trial when RCT unavailable', 'protocol-first observational design', 'foundational TTE paper; design not proof'],
      ['review', 'public-health causal methods', 'strengthening inference from observational data', 'target-trial framing in NEJM', 'method essay'],
      ['review', 'immortal time bias', 'specify the target trial first', 'prevent self-inflicted time-zero errors', 'method paper'],
      ['primary_research', 'hormone therapy example', 'analyze observational data like a trial', 'early target-trial style analysis', 'single-question application'],
      ['review', 'real-world evidence', 'what RWE is and can tell', 'scope of RWD questions', 'conceptual NEJM essay'],
      ['primary_research', 'RCT-DUPLICATE first results', 'emulate cardiovascular outcome trials', 'agreement and non-agreement cases', 'selected trial set'],
      ['primary_research', '32-trial emulation', 'nonrandomized database analyses', 'when emulation tracks RCTs', 'heterogeneous indications'],
      ['primary_research', 'calibrating RWE', 'infliximab effectiveness versus trials', 'calibration against RCTs', 'indication-specific calibration'],
      ['primary_research', 'veteran vaccine TTE', 'BNT162b2 versus mRNA-1273', 'comparative effectiveness emulation', 'single health-system cohort'],
      ['review', 'TARGET statement', 'reporting observational TTE studies', 'minimum reporting items', 'reporting guideline'],
      ['review', 'TARGET statement JAMA', 'transparent TTE reporting', 'journal reporting checklist', 'companion reporting statement'],
      ['review', 'HARPER template', 'harmonized RWE protocol template', 'protocol reproducibility', 'template; not an estimator'],
      ['review', 'HARPER Value Health', 'hypothesis-evaluating RWE protocols', 'structured protocol elements', 'template companion'],
      ['primary_research', 'RWE reproducibility', 'repeat studies in clinical practice data', 'cross-team result variation', 'reproducibility audit'],
      ['review', 'propensity-score methods', 'analyze observational data like experiments', 'balance and truncation choices', 'method review'],
      ['primary_research', 'FDA RWE in approvals', 'RWE in NDAs and BLAs 2020-2024', 'how RWE appeared in files', 'regulatory descriptive study; not guidance'],
      ['review', 'where target trials come from', 'specify protocols when repurposing data', 'protocol origin and constraints', 'method paper'],
      ['review', 'time-zero alignment', 'eligibility and assignment at time zero', 'avoid misaligned follow-up', 'method paper'],
      ['review', 'TTE in oncology decisions', 'regulatory and clinical uses in cancer', 'decision-context TTE', 'review; not a causal proof'],
      ['review', 'RCT emulation initiative', 'advance RWE through RCT emulation', 'pre-registration and calibration practice', 'initiative description'],
    ],
    techBody: '本专题的技术卡包括目标试验方案指定、时零与永生时间检查、数据库效仿已完成随机试验、混杂与阴性对照，以及 TARGET 与 HARPER 报告复现。技术选择取决于需要确认的是方案能否写出、时零是否对齐，还是估计能否被他人复核。',
    scopeBody: '本页用于介绍真实世界证据与目标试验模拟研究中的证据类型和适用边界，用于研究导航。目标试验模拟不是因果已证实。不提供诊疗、商品推荐或监管申报指引。数字终点见 H043，联邦数据见 H045。',
  },
  {
    topic_id: 'H045',
    title: '联邦临床数据、精准队列与实施科学',
    slug: 'federated-clinical-data-precision-cohorts',
    overview: [
      '联邦临床数据研究追问：多机构记录如何在不集中搬运可识别病历时完成分析。精准队列把基因、电子健康记录和同意条款写成可复用的研究资源。实施科学则测量有效干预在常规环境中被采用、适应和维持的条件。这三层工作共享数据治理问题，但回答的不是同一类问题。',
      '本方向从联邦学习、人群精准队列、共同数据模型与研究网络，以及实施框架出发，集中处理三类问题：模型如何在本地更新后只交换参数；队列的同意和代表性格局是什么；实施结果如何与临床效果分开测量。本页讨论研究导航，联邦数据不是可对外出售的病人清单。',
      '比较公开研究时，需要同时交代治理、去标识或联邦协议、队列纳入、共同数据模型和实施结果定义。本页不是诊疗、商品推荐或监管申报指引。网络规模不等于数据可以任意外传。',
    ].join('\n\n'),
    comparisonTable: '| 比较内容 | 应记录的信息 | 关系到什么判断 |\n| --- | --- | --- |\n| 数据移动 | 联邦学习、安全聚合或去标识集中 | 分析是否要求记录离开原机构 |\n| 队列构成 | 同意、招募框、基因组和电子健康记录链接 | 精准队列代表谁、不代表谁 |\n| 共同模型 | OMOP、研究网络和表型定义 | 跨站点变量是否真的可比 |\n| 实施结果 | 采用、可行性、保真、成本和维持 | 测量的是效果还是落地条件 |\n| 治理边界 | 准入、再识别风险和禁止再识别条款 | 资源能否被二次研究使用 |',
    sections: [
      {
        title: '联邦学习让模型参数在机构之间移动，而不是病历本身',
        body: '联邦学习综述证明，多机构可以在本地训练后只交换参数或梯度，从而降低集中搬运可识别记录的需要。医学中的联邦学习研究进一步证明，多中心协作可以在不共享病人级数据的条件下训练模型。针对严重急性呼吸综合征冠状病毒 2 预后的联邦预测，以及去中心化保密的群体学习，分别证明该策略可以用于临床预测和跨站点机器学习。\n\n联邦方法适合比较通信轮次、站点异质性和隐私假设。参数交换不是零风险；模型反演和站点漂移仍须单独评估。联邦数据也不是可对外出售的病人清单。',
        source_ids: ['H045S001', 'H045S004', 'H045S003', 'H045S002'],
      },
      {
        title: '精准队列把同意、基因组和健康记录放进可引用的资源',
        body: '英国生物银行和 All of Us 研究规划证明，大规模同意队列可以同时提供问卷、测量、基因组和健康记录链接。电子病历与基因组网络证明，医疗机构可以在常规记录上做基因组研究。表型组关联扫描则证明，一种基因型可以对照数百种电子病历表型提出假设。\n\n队列资源适合比较同意范围、代表性和数据准入。队列规模不是人群普查；同意条款决定哪些二次分析被允许。',
        source_ids: ['H045S005', 'H045S006', 'H045S007', 'H045S008'],
      },
      {
        title: '共同数据模型和研究网络让跨站点表型可以重复使用',
        body: '观察性健康数据科学与信息学网络证明，共同数据模型可以把多站点记录映射到同一分析坐标。主动安全监测的共同数据模型验证，为这一映射提供了早期方法学对照。以患者为中心的全国研究网络，以及国家冠状病毒队列协作的设计与基础设施，进一步证明网络可以在治理框架下支持多站点表型和务实研究。\n\n网络研究适合比较表型定义、映射损失和准入条件。映射成功不等于原始记录可以外传，也不等于病人身份可被重新识别后使用。',
        source_ids: ['H045S009', 'H045S010', 'H045S011', 'H045S012'],
      },
      {
        title: '实施科学把采用、保真和维持写成与效果分开的结果',
        body: '统一实施研究框架把干预、内部环境和过程放进同一评估结构。RE-AIM 把到达、效果、采用、实施和维持分开计数。效果-实施混合设计证明两类问题可以在同一研究中同时提问。实施结果的概念区分、动态可持续性框架、实施策略汇编，以及组织准备理论，分别给出结果定义、长期适应、策略清单和启动条件。\n\n实施研究适合比较落地条件，而不是重复证明临床效果。实施成功不是疗效替代，框架选择必须预先说明。',
        source_ids: ['H045S013', 'H045S014', 'H045S015', 'H045S016', 'H045S017', 'H045S018', 'H045S019'],
      },
      {
        title: '专题边界：联邦数据不是可对外出售的病人清单',
        body: '面向非专科读者的实施科学导论提醒，实施研究测量的是干预如何进入常规环境。联邦学习和精准队列讨论的是分析与同意，而不是把可识别病历编成可售名单。网络规模和模型性能都不能改变这一边界。\n\n本页用于比较治理、联邦协议、队列代表性和实施结果。数字终点见 H043，目标试验模拟见 H044。本页不提供诊疗、商品推荐或监管申报指引，也不提供可识别病人资料。',
        source_ids: ['H045S020', 'H045S001', 'H045S006', 'H045S012'],
      },
    ],
    methods: [
      { id: 'M01', order: 1, category: '联邦分析', title: '本地训练与参数聚合', principle: '各站点在本地数据上训练，只交换参数、梯度或安全聚合结果，而不集中可识别记录。', answers: '判断多中心模型是否能在不搬运病历的条件下训练。', sample_design: '报告站点数目、通信轮次、隐私假设和站点漂移；保留中心化对照。', limitations: '参数交换不是零风险；模型反演仍可能泄露信息。', sources: ['H045S001', 'H045S002', 'H045S003', 'H045S004'] },
      { id: 'M02', order: 2, category: '精准队列', title: '同意、基因组与记录链接', principle: '在明确同意下链接问卷、测量、基因组和健康记录，并描述代表性和准入。', answers: '确认队列能支持哪一类二次研究，以及不覆盖谁。', sample_design: '写清招募框、同意版本、数据层级和退出规则；报告缺失模式。', limitations: '队列规模不是普查；同意范围外的分析不被本资源授权。', sources: ['H045S005', 'H045S006', 'H045S007'] },
      { id: 'M03', order: 3, category: '表型复用', title: '共同数据模型与跨站点表型', principle: '把本地编码映射到共同数据模型，并用可共享的表型定义在多站点重复提取。', answers: '检查跨站点变量是否真的可比，以及映射损失有多大。', sample_design: '报告映射规则、表型版本和站点间阳性率；保留无法映射的字段。', limitations: '映射成功不等于原始记录可外传。', sources: ['H045S008', 'H045S009', 'H045S010', 'H045S012'] },
      { id: 'M04', order: 4, category: '实施结果', title: '采用、保真、成本与维持', principle: '把实施结果与临床效果分开预先定义，并选择混合设计或单一实施研究。', answers: '区分研究回答的是疗效还是落地条件。', sample_design: '预先指定实施结果、数据来源和评估窗口；效果与实施分析分开。', limitations: '实施成功不是疗效替代。', sources: ['H045S015', 'H045S016', 'H045S014', 'H045S013'] },
      { id: 'M05', order: 5, category: '策略与准备', title: '实施策略汇编与组织准备', principle: '用策略清单和环境评估描述准备采取哪些行动，以及组织是否具备启动条件。', answers: '判断失败更可能来自策略选择还是准备不足。', sample_design: '记录选用的策略、适应内容和准备测量；长期维持单独随访。', limitations: '策略清单不是万能配方；准备评分不能代替现场观察。', sources: ['H045S018', 'H045S019', 'H045S017', 'H045S020'] },
    ],
    findings: [
      { id: 'C01', title: '联邦学习移动的是参数，不是可出售的病历', shared_result: '联邦学习和群体学习研究证明，多中心可以在不集中病人级记录的条件下训练模型，但参数交换仍有反演和漂移问题。', research_use: '报告站点、轮次和隐私假设；中心化对照用于检查性能损失。', boundary: '联邦数据不是可对外出售的病人清单。', sources: ['H045S001', 'H045S002', 'H045S003', 'H045S004'] },
      { id: 'C02', title: '精准队列的价值由同意和代表性决定，而不是人数', shared_result: '英国生物银行、All of Us 和电子病历基因组网络证明，可复用资源依赖同意范围、链接完整性和谁被纳入。', research_use: '写清招募框、同意版本和数据层级；二次分析不得超出授权。', boundary: '队列规模不是人群普查。', sources: ['H045S005', 'H045S006', 'H045S007', 'H045S008'] },
      { id: 'C03', title: '共同数据模型让表型可重复，不授权记录外传', shared_result: '观察性健康数据网络、共同数据模型验证、PCORnet 和冠状病毒队列协作证明，映射后的表型可以跨站点复用，同时受治理约束。', research_use: '固定表型版本和映射规则；报告无法映射的字段。', boundary: '网络规模不等于可识别病历可以离开原机构。', sources: ['H045S009', 'H045S010', 'H045S011', 'H045S012'] },
      { id: 'C04', title: '实施结果必须与临床效果分开写', shared_result: '统一实施框架、RE-AIM、混合设计和实施结果定义证明，采用、保真和维持是独立结果，不能用疗效数字代替。', research_use: '预先指定实施结果和评估窗口；混合设计中两类分析分开报告。', boundary: '实施成功不是疗效替代。', sources: ['H045S013', 'H045S014', 'H045S015', 'H045S016'] },
      { id: 'C05', title: '本页比较治理与落地条件，不提供可识别病人资料', shared_result: '策略汇编、组织准备和导论性实施科学把启动条件写成可测量对象。联邦与队列资源讨论的是分析授权，不是病人名单。', research_use: '把结果写成治理、代表性和实施结果；涉及诊疗或申报时离开本页。', boundary: '不提供诊疗、商品推荐、监管申报指引或可出售病人清单。数字终点见 H043，目标试验模拟见 H044。', sources: ['H045S018', 'H045S019', 'H045S020', 'H045S001'] },
    ],
    pmids: [33015372, 34040261, 34526699, 32724046, 25826379, 31412182, 23743551, 20335276, 26262116, 22037893, 24821743, 32805036, 19664226, 10474547, 22310560, 20957426, 24088228, 25889199, 19840381, 26376626],
    refMeta: [
      ['review', 'federated learning in digital health', 'multi-site training without pooling records', 'parameter exchange instead of record transfer', 'review; inversion risk remains'],
      ['primary_research', 'Swarm Learning', 'decentralized confidential clinical ML', 'blockchain-coordinated learning', 'method demonstration'],
      ['primary_research', 'federated COVID outcomes', 'predict clinical outcomes across hospitals', 'multi-national federated prediction', 'COVID-era prediction; site shift'],
      ['primary_research', 'federated learning in medicine', 'multi-institutional collaboration', 'no patient-level sharing', 'institutional FL case'],
      ['primary_research', 'UK Biobank', 'open-access cohort resource', 'questionnaire measures genomes health records', 'resource; consented volunteers'],
      ['primary_research', 'All of Us Research Program', 'national precision-medicine cohort', 'diverse consented EHR and genomics', 'program description; representation still evolving'],
      ['review', 'eMERGE Network', 'EHR-linked genomics network', 'genomic research in routine records', 'network review'],
      ['primary_research', 'PheWAS', 'phenome-wide association scan', 'one genotype versus many EHR phenotypes', 'hypothesis-generating scan'],
      ['review', 'OHDSI', 'observational research opportunities', 'common-data-model network', 'network essay'],
      ['primary_research', 'OMOP common data model', 'validation for active safety surveillance', 'mapped multi-source EHR', 'early CDM validation'],
      ['primary_research', 'PCORnet launch', 'national patient-centered network', 'pragmatic multi-site data', 'network launch paper'],
      ['primary_research', 'N3C', 'rationale design infrastructure', 'national COVID EHR collaborative', 'infrastructure paper; governance constrained'],
      ['review', 'CFIR', 'consolidated framework for implementation', 'intervention context and process', 'framework'],
      ['review', 'RE-AIM', 'reach effectiveness adoption implementation maintenance', 'public-health impact accounting', 'framework'],
      ['review', 'hybrid designs', 'effectiveness plus implementation', 'dual-question study design', 'design paper'],
      ['review', 'implementation outcomes', 'conceptual distinctions and measurement', 'adoption fidelity cost sustainment', 'outcomes taxonomy'],
      ['review', 'dynamic sustainability framework', 'sustainment amid ongoing change', 'adaptation over time', 'framework'],
      ['primary_research', 'ERIC compilation', 'refined implementation strategies', 'strategy menu for change', 'consensus compilation'],
      ['review', 'organizational readiness', 'theory of readiness for change', 'start-up conditions', 'theory paper'],
      ['review', 'implementation science primer', 'introduction for non-specialists', 'what implementation studies measure', 'primer'],
    ],
    techBody: '本专题的技术卡包括联邦参数聚合、同意队列链接、共同数据模型表型、实施结果测量，以及策略汇编与组织准备。技术选择取决于需要确认的是数据能否不离开原机构、队列代表谁，还是干预如何进入常规环境。',
    scopeBody: '本页用于介绍联邦临床数据、精准队列与实施科学研究中的证据类型和适用边界，用于研究导航。联邦数据不是可对外出售的病人清单。不提供诊疗、商品推荐或监管申报指引。数字终点见 H043，目标试验模拟见 H044。',
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
    batch_id: 'B10',
    title: '神经技术、分子诊断与数字临床证据',
    publication_status: 'snapshot_ready',
    frontend_status: 'snapshot_ready',
    topics,
  };

  const outJson = path.join(root, 'src', 'data', 'knowledge', 'research-trends-b10.generated.json');
  writeFileSync(outJson, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outJson} with ${topics.length} topics`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
