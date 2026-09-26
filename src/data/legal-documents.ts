export type LegalDocumentCategory = 'contract' | 'attachment' | 'sop' | 'index' | 'site';
export type LegalDocumentKind = 'pdf' | 'site';

export type LegalDocumentSeed = {
  id: string;
  version: string;
  title: string;
  category: LegalDocumentCategory;
  kind: LegalDocumentKind;
  fileName?: string;
  sitePath?: string;
  description: string;
  published: boolean;
  requireRegister: boolean;
  requireCheckout: boolean;
  showOnLegalPage: boolean;
  showOnOpenPlatform: boolean;
  sortOrder: number;
};

/** 律师审定文书默认配置（与 docs/legal 目录 PDF 对应） */
export const LEGAL_DOCUMENT_SEEDS: LegalDocumentSeed[] = [
  {
    id: 'site-privacy',
    version: '2025-01-01',
    title: '隐私政策',
    category: 'site',
    kind: 'site',
    sitePath: '/privacy',
    description: '说明我们如何收集、使用与保护您的个人信息。',
    published: true,
    requireRegister: true,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 1,
  },
  {
    id: 'site-terms',
    version: '2026-07-17.3',
    title: '网站使用条款',
    category: 'site',
    kind: 'site',
    sitePath: '/terms',
    description: '使用 LIBEREAL 网站服务的基本规则与责任边界。',
    published: true,
    requireRegister: true,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 2,
  },
  {
    id: 'site-sales-terms',
    version: '2026-07-17.3',
    title: '销售条款和条件',
    category: 'site',
    kind: 'site',
    sitePath: '/legal/sales-terms',
    description: '下单采购适用的价格、交付、退换与争议解决条款。',
    published: true,
    requireRegister: false,
    requireCheckout: true,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 3,
  },
  {
    id: 'index',
    version: '2026-06-30',
    title: '商事文书总索引',
    category: 'index',
    kind: 'pdf',
    fileName: '00-文书总索引',
    description: '律师审定文书清单与使用说明。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 10,
  },
  {
    id: 'supplier-agreement',
    version: '2026-07-17',
    title: '供应商合作协议',
    category: 'contract',
    kind: 'pdf',
    fileName: '01-供应商合作协议',
    description: '与产品供应商/授权代理签订正式合作协议。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 11,
  },
  {
    id: 'brand-authorization',
    version: '2026-06-30',
    title: '品牌授权书模板',
    category: 'contract',
    kind: 'pdf',
    fileName: '02-品牌授权书模板',
    description: '供应商/品牌方提供的合法渠道授权证明（非排他性）。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 12,
  },
  {
    id: 'customer-purchase',
    version: '2026-07-17.3',
    title: '客户采购协议',
    category: 'contract',
    kind: 'pdf',
    fileName: '03-客户采购协议',
    description: '与终端客户签订批量采购或框架合作协议。',
    published: true,
    requireRegister: false,
    requireCheckout: true,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 13,
  },
  {
    id: 'open-platform',
    version: '2026-06-30',
    title: '开放平台入驻协议',
    category: 'contract',
    kind: 'pdf',
    fileName: '04-开放平台入驻协议',
    description: '厂家/品牌方入驻开放平台的合作协议。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: true,
    sortOrder: 14,
  },
  {
    id: 'distribution',
    version: '2026-06-30',
    title: '经销分销协议',
    category: 'contract',
    kind: 'pdf',
    fileName: '05-经销分销协议',
    description: 'LIBEREAL 作为供货方与下游经销商合作。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 15,
  },
  {
    id: 'nda',
    version: '2026-06-30',
    title: '保密协议（NDA）',
    category: 'contract',
    kind: 'pdf',
    fileName: '06-保密协议NDA',
    description: '深度合作前的商业秘密保护协议。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 16,
  },
  {
    id: 'attachment-price',
    version: '2026-06-30',
    title: '价格确认单模板',
    category: 'attachment',
    kind: 'pdf',
    fileName: '附件A-价格确认单模板',
    description: '主合同附件，约定供货价格。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 20,
  },
  {
    id: 'attachment-qualification',
    version: '2026-06-30',
    title: '资质文件提交清单',
    category: 'attachment',
    kind: 'pdf',
    fileName: '附件B-资质文件提交清单',
    description: '合作前资质材料汇总（生产/经销/进口）。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: true,
    sortOrder: 21,
  },
  {
    id: 'attachment-dealer-auth',
    version: '2026-06-30',
    title: '经销商授权委托书模板',
    category: 'attachment',
    kind: 'pdf',
    fileName: '附件C-经销商授权委托书模板',
    description: '经销/采购业务经办人变更时使用。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 22,
  },
  {
    id: 'attachment-quote',
    version: '2026-07-17.2',
    title: '报价单模板',
    category: 'attachment',
    kind: 'pdf',
    fileName: '附件D-报价单模板',
    description: '销售/采购正式报价通用模板。',
    published: true,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: true,
    showOnOpenPlatform: false,
    sortOrder: 23,
  },
  {
    id: 'sop-esign',
    version: '2026-06-30',
    title: '电子合同签署流程 SOP',
    category: 'sop',
    kind: 'pdf',
    fileName: '07-电子合同签署流程SOP',
    description: '内部合同管理标准操作流程（管理员可见）。',
    published: false,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: false,
    showOnOpenPlatform: false,
    sortOrder: 30,
  },
  {
    id: 'sop-lawyer-review',
    version: '2026-06-30',
    title: '大额合作律师审核机制',
    category: 'sop',
    kind: 'pdf',
    fileName: '08-大额合作律师审核机制',
    description: '大额/涉外等场景的律师审核强制流程（管理员可见）。',
    published: false,
    requireRegister: false,
    requireCheckout: false,
    showOnLegalPage: false,
    showOnOpenPlatform: false,
    sortOrder: 31,
  },
];

export type LegalDocumentPublic = {
  id: string;
  version: string;
  title: string;
  category: string;
  kind: LegalDocumentKind;
  description: string | null;
  sitePath: string | null;
  downloadUrl: string | null;
  requireRegister: boolean;
  requireCheckout: boolean;
  showOnLegalPage: boolean;
  showOnOpenPlatform: boolean;
  sortOrder: number;
};
