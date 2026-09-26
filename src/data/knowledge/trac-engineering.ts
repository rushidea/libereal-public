export type KnowledgeProductCard = {
  mappingId: 'PM001' | 'PM002';
  productId: string;
  brand: string;
  catalogNumber: string;
  productName: string;
  componentRole: string;
  displayLabel: string;
  evidenceBadge: string;
  riskLabels: readonly string[];
  mandatoryDisclaimer: string;
};

export type KnowledgeRequirementCoverage = {
  requirementId: 'PR001' | 'PR002' | 'PR003' | 'PR004';
  status: 'component_only' | 'no_candidate';
  label: string;
  explanation: string;
  missingEvidence: string;
};

export type KnowledgeSeoAsset = {
  assetId: 'SEO001' | 'SEO002';
  primaryKeyword: string;
  intent: string;
  contentType: string;
  requiredSections: readonly string[];
  allowedClaims: readonly string[];
  disallowedClaims: readonly string[];
  forbiddenClaimCodes: readonly string[];
  evidenceIds: readonly string[];
  productEvidenceIds: readonly string[];
  productMappingIds: readonly string[];
  indexingPolicy: 'noindex';
  publicationScope: 'internal_staging_only';
  reviewStatus: 'sol_approved';
};

export type KnowledgeFaqIntent = {
  intentId: 'FAQ001' | 'FAQ002' | 'FAQ003' | 'FAQ004';
  intentName: string;
  exampleQuestions: readonly string[];
  clarifyingQuestions: readonly string[];
  answerOutline: readonly string[];
  mandatoryDisclaimer: string;
  allowedClaims: readonly string[];
  disallowedClaims: readonly string[];
  forbiddenClaimCodes: readonly string[];
  evidenceIds: readonly string[];
  productEvidenceIds: readonly string[];
  productMappingIds: readonly string[];
  productActionPolicy: 'view_only_no_recommendation';
  escalationRule: string;
  publicationScope: 'internal_staging_only';
  reviewStatus: 'sol_approved';
};

const releaseForbiddenClaimCodes = [
  'generic_therapeutic_target',
  'efficacy_marker',
  'persistence_marker',
  'clinical_release_criterion',
  'universal_outcome_improvement',
] as const;

export const tracEngineeringKnowledge = {
  releaseId: 'R001',
  consensusId: 'C001',
  categoryId: 'C08',
  hotspotId: 'H023',
  title: 'TRAC 工程位点：证据边界与科研组件候选',
  eyebrow: '内部 staging 预览',
  evidenceBadge: '受限工程语境证据',
  scope:
    'TRAC 仅作为工程化人 T 细胞研究中的构建与表征位点呈现，解释受具体构建、制造流程、供体与模型限制。',
  context:
    '适用于 CRISPR 工程化 CAR-T / TCR-T 的科研构建与表征，不是通用治疗靶点或临床放行标准。',
  requiredLimitations: [
    '不是通用治疗靶点',
    '不是疗效或持久性标志物',
    '不是临床放行标准',
    '不支持普遍改善结局的结论',
  ],
  products: [
    {
      mappingId: 'PM001',
      productId: 'cmobucrk604ckhcchzvmcx2w9',
      brand: 'Sigma-Aldrich',
      catalogNumber: 'CAS9PL-50UG',
      productName: 'Cas9 Plus Protein',
      componentRole: 'SpCas9 RNP nuclease',
      displayLabel: 'Cas9 RNP 核酸酶组件（非 TRAC 专用）',
      evidenceBadge: '准确货号已核验；TRAC 工作流为技术等价证据',
      riskLabels: ['仅供科研', '非 TRAC 专用', '非完整方案', '准确 TRAC 工作流未验证'],
      mandatoryDisclaimer:
        '仅供科研工作流筛选。准确货号尚未在所引 TRAC 原代人 T 细胞研究中直接验证；不得表述为完整方案、临床级产品、疗效证据或放行标准。',
    },
    {
      mappingId: 'PM002',
      productId: 'cmobucsdm04j7hcchsujatn21',
      brand: 'Sigma-Aldrich',
      catalogNumber: 'TRACRRNA05N-5NMOL',
      productName: 'SygRNA ™ Cas9 合成 tracrRNA',
      componentRole: 'SpCas9 RNP guide scaffold',
      displayLabel: 'SpCas9 tracrRNA scaffold（不含 TRAC 靶向 crRNA）',
      evidenceBadge: '准确货号已核验；目标特异 crRNA 仍缺失',
      riskLabels: ['仅供科研', 'TRACRRNA 不是 TRAC 位点', '不具目标特异性', '非供体或递送产品'],
      mandatoryDisclaimer:
        '货号中的 TRACRRNA 指 trans-activating crRNA，并非人类 TRAC 基因位点。仅作为科研工作流组件候选；不得表述为 TRAC 专用试剂、完整方案、临床级产品或疗效证据。',
    },
  ] satisfies readonly KnowledgeProductCard[],
  coverage: [
    {
      requirementId: 'PR001',
      status: 'component_only',
      label: '编辑组件：部分覆盖',
      explanation: '已核验两个通用 SpCas9 RNP 组件，但没有证据证明准确货号构成特定 TRAC 编辑方案。',
      missingEvidence: 'TRAC 靶向 crRNA、准确构建、供体设计、递送条件、脱靶与表征对照。',
    },
    {
      requirementId: 'PR002',
      status: 'no_candidate',
      label: '供体模板与递送：暂无合格候选',
      explanation: '现有证据说明非病毒 RNP+HDR 工作流，但尚无可与 Libereal 准确产品身份连接的供体模板或递送产品。',
      missingEvidence: '准确产品身份、载荷与同源设计、路线特异的原代人 T 细胞兼容性。',
    },
    {
      requirementId: 'PR003',
      status: 'no_candidate',
      label: '靶向整合验证：暂无合格候选',
      explanation: '尚无产品同时支持 on-target junction、残余供体、检出限及非预期整合边界。',
      missingEvidence: '检测对照、检出限、残余供体区分与非预期整合的正交验证。',
    },
    {
      requirementId: 'PR004',
      status: 'no_candidate',
      label: '工程化 T 细胞表征：暂无合格候选',
      explanation: '现有 TCR α/β 流式产品资料缺少工程化 T 细胞样本、对照和预期读出定义。',
      missingEvidence: '准确分析物与克隆、工程化 T 细胞样本语境、对照、预期读出及持久性限制。',
    },
  ] satisfies readonly KnowledgeRequirementCoverage[],
  seoAssets: [
    {
      assetId: 'SEO001',
      primaryKeyword: 'TRAC 工程位点研究',
      intent: '研究语境解释',
      contentType: '证据边界页',
      requiredSections: ['适用语境', 'TRAC 与 tracrRNA 消歧', '多源证据概览', '禁止外推', '组件与空缺'],
      allowedClaims: ['特定工程化人 T 细胞研究中的构建与表征位点', '解释受构建、制造、供体和模型限制'],
      disallowedClaims: ['通用治疗靶点', '疗效或持久性标志物', '临床放行标准', '普遍改善结局', '完整实验方案', '产品推荐'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E007', 'E008', 'E009', 'E030', 'E031'],
      productEvidenceIds: ['PES001', 'PES002', 'PES003', 'PES004'],
      productMappingIds: ['PM001', 'PM002'],
      indexingPolicy: 'noindex',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
    {
      assetId: 'SEO002',
      primaryKeyword: 'TRAC 靶向工程的组件与验证边界',
      intent: '研究工作流证据缺口',
      contentType: '研究需求说明页',
      requiredSections: ['编辑组件部分覆盖', '供体与递送空缺', '靶向整合验证空缺', '工程化细胞表征空缺', '不允许的替代方案'],
      allowedClaims: ['两个通用科研组件候选已核验', '特定 TRAC 工作流仍缺靶向设计、递送、验证和表征证据'],
      disallowedClaims: ['TRAC 专用试剂', '完整方案', '通用 PCR 或流式产品证明质量或安全性', '推荐购买'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E008', 'E009', 'E030', 'E031'],
      productEvidenceIds: ['PES001', 'PES002', 'PES003', 'PES004', 'PES005'],
      productMappingIds: ['PM001', 'PM002'],
      indexingPolicy: 'noindex',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
  ] satisfies readonly KnowledgeSeoAsset[],
  faqIntents: [
    {
      intentId: 'FAQ001',
      intentName: 'TRAC 与 tracrRNA 是否是同一概念',
      exampleQuestions: ['TRACRRNA 货号是否代表 TRAC 位点试剂？', 'tracrRNA 能否直接用于 TRAC 靶向编辑？'],
      clarifyingQuestions: ['你指的是人类 TRAC 基因位点，还是 SpCas9 tracrRNA？', '是否已有 TRAC 靶向 crRNA 序列和构建设计？'],
      answerOutline: ['先作术语消歧', '说明 tracrRNA 不携带靶点特异性', '说明 TRAC 位点需要独立靶向设计', '给出受限组件边界'],
      mandatoryDisclaimer: 'TRACRRNA 指 trans-activating crRNA，并非人类 TRAC 基因位点；现有候选不含 TRAC 靶向 crRNA，也不构成完整方案。',
      allowedClaims: ['解释 TRAC 位点与 tracrRNA 的功能差异', '说明 PM002 是通用 SpCas9 RNP 骨架候选'],
      disallowedClaims: ['TRACRRNA 是 TRAC 专用试剂', '无需 crRNA 即可靶向 TRAC', '完整方案', '临床或疗效主张'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E008', 'E009', 'E031'],
      productEvidenceIds: ['PES003', 'PES004'],
      productMappingIds: ['PM002'],
      productActionPolicy: 'view_only_no_recommendation',
      escalationRule: '需要序列、构建、递送参数或临床用途时，拒绝外推并转人工科研支持。',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
    {
      intentId: 'FAQ002',
      intentName: 'TRAC 工程位点能说明疗效或持久性吗',
      exampleQuestions: ['TRAC 靶向整合是否一定提高 CAR-T 效果？', 'TRAC 是否可作为持久性标志物或放行标准？'],
      clarifyingQuestions: ['具体构建、供体、制造流程、疾病模型和读出是什么？', '讨论的是预临床结果，还是临床产品放行？'],
      answerOutline: ['说明限定构建与表征语境', '保留负向持久性证据', '拒绝把单一读出提升为通用结论'],
      mandatoryDisclaimer: 'TRAC 的现有共识只限特定工程化人 T 细胞研究语境；不能据此推断通用疗效、持久性或临床放行适用性。',
      allowedClaims: ['构建、制造、供体和模型会影响解释', '存在特定预临床持久性权衡'],
      disallowedClaims: ['普遍改善结局', '疗效标志物', '持久性标志物', '临床放行标准', '临床建议'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E007', 'E008', 'E009', 'E030', 'E031'],
      productEvidenceIds: [],
      productMappingIds: [],
      productActionPolicy: 'view_only_no_recommendation',
      escalationRule: '涉及患者治疗、临床决策、放行标准或产品疗效时，停止回答并升级人工专业支持。',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
    {
      intentId: 'FAQ003',
      intentName: '现有 Cas9 与 tracrRNA 组件能否构成 TRAC 编辑方案',
      exampleQuestions: ['Cas9 Plus Protein 和 tracrRNA 能否直接做 TRAC 编辑？', '还缺少哪些要素？'],
      clarifyingQuestions: ['是否已有 TRAC 靶向 crRNA、供体模板、递送方式和细胞来源？', '需要科研筛选，还是完整验证方案？'],
      answerOutline: ['说明 PR001 仅部分覆盖', '区分 PM001 与 PM002 的组件角色', '列出不可缺失的工作流记录', '呈现 PR002–PR004 空缺'],
      mandatoryDisclaimer: 'PM001/PM002 仅供科研工作流筛选，准确货号未在所引 TRAC 原代人 T 细胞研究中直接验证；不得表述为完整方案、临床级产品、疗效证据或放行标准。',
      allowedClaims: ['解释两个通用组件的角色', '列出尚缺的工作流与证据', '查看商品详情的身份信息'],
      disallowedClaims: ['可直接完成 TRAC 编辑', '推荐组合', '具体递送条件', '供体设计', '临床级主张'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E008', 'E009', 'E031'],
      productEvidenceIds: ['PES001', 'PES002', 'PES003', 'PES004', 'PES005'],
      productMappingIds: ['PM001', 'PM002'],
      productActionPolicy: 'view_only_no_recommendation',
      escalationRule: '要求精确序列、剂量、递送条件、供体设计或完整 SOP 时，升级人工科研支持。',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
    {
      intentId: 'FAQ004',
      intentName: '如何理解 TRAC 靶向整合验证和工程化细胞表征的证据要求',
      exampleQuestions: ['一次阳性 PCR 是否足够证明 TRAC 靶向整合？', '通用 TCR 流式抗体能否证明工程化细胞质量？'],
      clarifyingQuestions: ['要验证 on-target junction、残余供体，还是非预期整合？', '样本、对照和检出限要求是什么？'],
      answerOutline: ['说明 PR003 的正交验证边界', '说明 PR004 的分析物、样本、对照和读出要求', '指出当前没有合格产品候选'],
      mandatoryDisclaimer: '现有目录没有同时满足 TRAC 靶向整合验证或工程化 T 细胞表征要求的合格候选；单一阳性 PCR 或通用流式抗体不能证明产品质量、安全性、持久性或临床放行。',
      allowedClaims: ['解释检测与表征需要的证据维度', '说明当前产品空缺和人工升级路径'],
      disallowedClaims: ['阳性 PCR 作为完整验证', '通用流式抗体作为质量或安全证明', '临床放行判断', '推荐购买'],
      forbiddenClaimCodes: releaseForbiddenClaimCodes,
      evidenceIds: ['E009', 'E030', 'E031'],
      productEvidenceIds: [],
      productMappingIds: [],
      productActionPolicy: 'view_only_no_recommendation',
      escalationRule: '涉及检出限、非预期整合、安全评估、质量体系或临床放行时，升级人工方法与质量支持。',
      publicationScope: 'internal_staging_only',
      reviewStatus: 'sol_approved',
    },
  ] satisfies readonly KnowledgeFaqIntent[],
} as const;
