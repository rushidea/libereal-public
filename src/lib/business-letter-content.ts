/** Shared by the editor and server. Only plain text and named fields are editable. */
export const LETTER_FIELDS = {
  salutation: '称呼',
  business_reference: '业务编号',
  products: '产品、包装与数量',
  details: '本次沟通事项',
  signature: '公司与联系人落款',
} as const;
export type LetterFields = Record<keyof typeof LETTER_FIELDS, string>;
export type LetterTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  revision: number;
};
export const LETTER_STARTERS: Omit<LetterTemplate, 'id' | 'revision'>[] = [
  {
    name: '供应商询价函', enabled: false,
    subject: '询价函：{{business_reference}}',
    body: '{{salutation}}\n\n您好！\n\n烦请贵司就以下产品提供书面报价及供货信息：\n\n{{products}}\n\n请说明人民币报价、折扣、税费、运费、预计货期、报价有效期与付款条件。\n\n{{details}}\n\n本函仅用于询价及供货条件核实，不构成采购订单或付款承诺。具体采购以我司另行批准的正式采购单为准。\n\n感谢支持，敬候回复。\n\n{{signature}}',
  },
  {
    name: '业务跟进函', enabled: false,
    subject: '业务跟进：{{business_reference}}',
    body: '{{salutation}}\n\n您好！\n\n关于 {{business_reference}}，现与您确认以下事项：\n\n{{details}}\n\n烦请回复相关进展。感谢支持！\n\n{{signature}}',
  },
];
export const LETTER_STATUS_LABELS: Record<string, string> = {
  draft: '待确认', approved: '已确认，待发送', sending: '发送中，勿重复提交',
  accepted: '邮件服务商已接收', rejected: '邮件服务商拒绝，需核对', unknown: '发送结果未知，需核对',
};
