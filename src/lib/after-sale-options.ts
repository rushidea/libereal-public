export const afterSaleIssues = {
  delay: '催货或延期', cancellation: '取消订单', quality: '质量问题', technical: '使用或技术问题',
  incorrect: '错发', shortage: '少发或遗失', damage: '运输破损', temperature: '温控异常',
  return: '退换货申请', invoice: '发票更正、红冲或重开', other: '其他售后事项',
} as const;

export const afterSaleRemedies = {
  refund_withdraw: '确认放弃未付余额',
  follow_up: '跟进并答复', keep: '客户接受现状', return: '退回', exchange: '换货',
  resend: '补发', refund: '准备退款', invoice: '办理发票更正', cancel: '核对取消结果',
} as const;

export const afterSaleActions = {
  open: '登记售后', claim: '接手跟进', link_shortfall: '关联履约结果', add_evidence: '补充往来记录', technical: '回填技术意见',
  agreement: '登记客户书面决定', physical: '核对实际履约结果', invoice_outcome: '回填发票处理结果',
  supplier: '登记供应商处理', prepare_refund: '准备退款资料', approve_refund: '批准退款',
  refund_result: '登记实际退款结果', stop_refund: '核对原退款指令终止', review_refund_source: '核对原渠道实际到账',
  approve_exchange: '批准已获书面同意的免费换货', attribute_resend: '核对同批准补件的实际归属', close: '确认客户侧办结',
} as const;
export type AfterSaleAction = keyof typeof afterSaleActions;
export type AfterSaleIssue = keyof typeof afterSaleIssues;
export type AfterSaleRemedy = keyof typeof afterSaleRemedies;
export const afterSaleStates: Record<string, string> = {
  reported: '待接手', reviewing: '经办人跟进中', awaiting_technical: '等待供应商或品牌技术意见',
  awaiting_customer: '等待客户决定', awaiting_fulfillment: '等待退换补发结果', awaiting_invoice: '等待人工票据处理',
  awaiting_refund: '待备妥退款资料', refund_prepared: '待财务批准退款', refund_approved: '等待实际退款回执',
  refund_followup: '等待客户明确同意剩余退款安排',
  awaiting_close: '待核对办结', closed: '客户侧已办结', unreviewed: '待核对供应商侧',
  following: '供应商跟进中', no_claim: '已核实无需向供方追偿', resolved: '供应商侧已独立办结',
};
export const afterSaleChannels = { email: '客户邮件', koncket: '客户网站沟通', handoff: '内部人工移交', fulfillment: '原履约记录', account: '客户订单页' } as const;
export function afterSaleLabel(value: string) {
  return afterSaleStates[value] ?? value;
}
export function hasChoice<T extends object>(choices: T, value: unknown): value is keyof T & string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(choices, value);
}
