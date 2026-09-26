export type ResearchTrendNavTopic = {
  id: string;
  label: string;
  slug: string;
  href: string;
  status: 'published' | 'building';
};

export type ResearchTrendNavSection = {
  id: string;
  label: string;
  topics: ResearchTrendNavTopic[];
};

export type ResearchTrendNavGroup = {
  id: string;
  label: string;
  sections: ResearchTrendNavSection[];
};

const topic = (
  id: string,
  label: string,
  slug: string,
  status: ResearchTrendNavTopic['status'] = 'building',
): ResearchTrendNavTopic => ({ id, label, slug, href: `/research/trends/${slug}`, status });

export const researchTrendNavigation: ResearchTrendNavGroup[] = [
  {
    id: 'F01',
    label: '计算、结构与分子工程',
    sections: [
      {
        id: 'F01-01',
        label: '计算生物医学',
        topics: [
          topic('H001', '多模态生物分子结构与相互作用预测', 'biomolecular-structure-interaction-prediction', 'published'),
          topic('H002', 'AI 分子设计与虚拟筛选', 'ai-molecular-design-virtual-screening', 'published'),
          topic('H003', 'AI 表型分析与实验决策支持', 'ai-phenotyping-experimental-decision-support', 'published'),
        ],
      },
      {
        id: 'F01-02',
        label: '结构与蛋白工程',
        topics: [
          topic('H014', '冷冻电镜、原位结构与动态构象', 'cryo-em-in-situ-structural-dynamics', 'published'),
          topic('H015', '从头蛋白设计与工程化生物分子', 'de-novo-protein-biomolecule-design', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F02',
    label: '基因组、单细胞与系统生物学',
    sections: [
      {
        id: 'F02-01',
        label: '基因组与编辑',
        topics: [
          topic('H004', '长读长、人类泛基因组与复杂变异', 'long-read-pangenome-complex-variants', 'published'),
          topic('H005', '单细胞调控基因组与表观基因组', 'single-cell-regulatory-epigenomics', 'published'),
          topic('H006', 'CRISPR 精准编辑与功能筛选', 'crispr-precision-editing-screening', 'published'),
        ],
      },
      {
        id: 'F02-02',
        label: '单细胞与空间测量',
        topics: [
          topic('H007', '高通量单细胞转录组与扰动筛选', 'single-cell-transcriptomics-perturbation-screening', 'published'),
          topic('H008', '空间转录组与空间多组学', 'spatial-transcriptomics-multiomics', 'published'),
          topic('H009', '单细胞多模态与原位测量', 'single-cell-multimodal-in-situ-measurement', 'published'),
        ],
      },
      {
        id: 'F02-03',
        label: '多组学与数据体系',
        topics: [
          topic('H010', '多组学整合与网络生物学', 'multiomics-network-biology', 'published'),
          topic('H011', '纵向组学与动态系统建模', 'longitudinal-omics-dynamic-systems', 'published'),
          topic('H012', '生物医学知识图谱、数据标准与可复现性', 'biomedical-knowledge-graphs-data-standards', 'published'),
        ],
      },
      {
        id: 'F02-04',
        label: '细胞命运与衰老',
        topics: [
          topic('H016', '分子记录、谱系追踪与命运解析', 'molecular-recording-lineage-tracing', 'published'),
          topic('H017', '多器官生物衰老与健康寿命机制', 'multi-organ-biological-aging-healthspan', 'published'),
          topic('H018', '细胞器互作与铁死亡', 'organelle-interactions-ferroptosis', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F03',
    label: '人体模型与生物制造',
    sections: [
      {
        id: 'F03-01',
        label: '类器官与器官芯片',
        topics: [
          topic('H019', '患者来源类器官与疾病模型', 'patient-derived-organoids-disease-models', 'published'),
          topic('H020', '器官芯片与微生理系统', 'organ-chips-microphysiological-systems', 'published'),
        ],
      },
      {
        id: 'F03-02',
        label: '规模化制造',
        topics: [
          topic('H021', '类器官与干细胞规模化制造', 'scalable-organoid-stem-cell-manufacturing', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F04',
    label: '免疫与肿瘤',
    sections: [
      {
        id: 'F04-01',
        label: '空间免疫与细胞治疗',
        topics: [
          topic('H022', '肿瘤空间免疫', 'tumor-spatial-immunity', 'published'),
          topic('H023', 'CAR-T、TCR-T 与工程化免疫细胞', 'engineered-immune-cell-therapies', 'published'),
          topic('H024', '免疫检查点与组合免疫调控', 'immune-checkpoints-combination-immunomodulation', 'published'),
        ],
      },
      {
        id: 'F04-02',
        label: '肿瘤生态与精准分层',
        topics: [
          topic('H025', '肿瘤异质性与微环境生态', 'tumor-heterogeneity-microenvironment-ecosystems', 'published'),
          topic('H026', '克隆演化、转移与耐药', 'clonal-evolution-metastasis-drug-resistance', 'published'),
          topic('H027', '分子分层与功能精准肿瘤学', 'molecular-stratification-functional-oncology', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F05',
    label: '神经、感染与代谢',
    sections: [
      {
        id: 'F05-01',
        label: '神经图谱与神经技术',
        topics: [
          topic('H028', '脑细胞图谱与跨尺度参考图谱', 'brain-cell-cross-scale-atlas', 'published'),
          topic('H029', '神经退行性疾病细胞图谱与机制', 'neurodegenerative-cell-atlas-mechanisms', 'published'),
          topic('H030', '神经接口、高密度记录与神经调控', 'neural-interfaces-recording-neuromodulation', 'published'),
        ],
      },
      {
        id: 'F05-02',
        label: '感染、疫苗与耐药',
        topics: [
          topic('H031', '病原体基因组与基因组监测', 'pathogen-genomics-surveillance', 'published'),
          topic('H032', '新型疫苗平台与免疫保护相关物', 'vaccine-platforms-correlates-of-protection', 'published'),
          topic('H033', '抗微生物耐药与新型抗感染策略', 'antimicrobial-resistance-anti-infective-strategies', 'published'),
        ],
      },
      {
        id: 'F05-03',
        label: '微生物组与心代谢',
        topics: [
          topic('H034', '微生物组代谢物与宿主互作', 'microbiome-metabolites-host-interactions', 'published'),
          topic('H035', '代谢性炎症与慢性疾病', 'metabolic-inflammation-chronic-disease', 'published'),
          topic('H036', '肥胖、脂肪肝与心代谢多组学', 'obesity-fatty-liver-cardiometabolic-multiomics', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F06',
    label: '分子检测与临床证据',
    sections: [
      {
        id: 'F06-01',
        label: '分子诊断与循环标志物',
        topics: [
          topic('H037', '液体活检与循环分子标志物', 'liquid-biopsy-circulating-biomarkers', 'published'),
          topic('H038', '多重与超灵敏分子诊断', 'multiplex-ultrasensitive-molecular-diagnostics', 'published'),
        ],
      },
      {
        id: 'F06-02',
        label: '数字临床研究与真实世界证据',
        topics: [
          topic('H043', '去中心化临床研究与数字终点', 'decentralized-clinical-trials-digital-endpoints', 'published'),
          topic('H044', '真实世界证据与目标试验模拟', 'real-world-evidence-target-trial-emulation', 'published'),
          topic('H045', '联邦临床数据、精准队列与实施科学', 'federated-clinical-data-precision-cohorts', 'published'),
        ],
      },
    ],
  },
  {
    id: 'F07',
    label: '药物发现、递送与转化',
    sections: [
      {
        id: 'F07-01',
        label: '候选发现与靶点验证',
        topics: [
          topic('H040', '表型筛选、靶点验证与候选优选', 'phenotypic-screening-target-validation', 'published'),
        ],
      },
      {
        id: 'F07-02',
        label: '核酸与靶向递送',
        topics: [
          topic('H041', 'RNA、脂质纳米颗粒与靶向递送', 'rna-lipid-nanoparticle-targeted-delivery', 'published'),
        ],
      },
      {
        id: 'F07-03',
        label: '药代、安全性与人体相关模型',
        topics: [
          topic('H042', '人体相关药代、药效与安全性模型', 'human-relevant-pkpd-adme-tox-models', 'published'),
        ],
      },
    ],
  },
];

export const researchTrendTopics = researchTrendNavigation.flatMap((group) =>
  group.sections.flatMap((section) =>
    section.topics.map((item) => ({ ...item, groupId: group.id, groupLabel: group.label, sectionId: section.id, sectionLabel: section.label })),
  ),
);

export const researchTrendTopicBySlug = new Map(researchTrendTopics.map((item) => [item.slug, item]));

export const researchTrendHrefById: Readonly<Record<string, string>> = Object.fromEntries(
  researchTrendTopics.map((item) => [item.id, item.href]),
);
