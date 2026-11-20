export const INQUIRY_FEEDBACK_TYPES = [
  'price_negotiation',
  'terms_change',
  'consultation',
  'intent_confirm',
] as const;

export type InquiryFeedbackType = (typeof INQUIRY_FEEDBACK_TYPES)[number];

export const INQUIRY_FEEDBACK_TYPE_LABELS: Record<InquiryFeedbackType, string> = {
  price_negotiation: '价格协商',
  terms_change: '货期/数量/条款修改',
  consultation: '一般咨询',
  intent_confirm: '意向确认（待正式下单）',
};

export const INQUIRY_FEEDBACK_CHANNELS = [
  'website',
  'wechat',
  'email',
  'phone',
  'offline',
  'other',
] as const;

export type InquiryFeedbackChannel = (typeof INQUIRY_FEEDBACK_CHANNELS)[number];

export const ADMIN_PROXY_FEEDBACK_CHANNELS = [
  'wechat',
  'email',
  'phone',
  'offline',
  'other',
] as const;

export type AdminProxyFeedbackChannel = (typeof ADMIN_PROXY_FEEDBACK_CHANNELS)[number];

export const INQUIRY_FEEDBACK_CHANNEL_LABELS: Record<InquiryFeedbackChannel, string> = {
  website: '站内',
  wechat: '微信',
  email: '邮件',
  phone: '电话',
  offline: '线下',
  other: '其他',
};

export const INQUIRY_FEEDBACK_HANDLING_STATUSES = [
  'pending',
  'resolved',
  'ignored',
] as const;

export type InquiryFeedbackHandlingStatus = (typeof INQUIRY_FEEDBACK_HANDLING_STATUSES)[number];

export const INQUIRY_FEEDBACK_HANDLING_STATUS_LABELS: Record<InquiryFeedbackHandlingStatus, string> = {
  pending: '待处理',
  resolved: '已处理',
  ignored: '已忽略',
};

export const QUOTE_BOUND_FEEDBACK_TYPES: ReadonlySet<string> = new Set([
  'price_negotiation',
  'terms_change',
  'intent_confirm',
]);

export const INQUIRY_FEEDBACK_CONTENT_MAX = 2000;
export const INQUIRY_FEEDBACK_CHANNEL_REF_MAX = 200;
export const INQUIRY_FEEDBACK_RESOLUTION_NOTE_MAX = 1000;
export const INQUIRY_FEEDBACK_REQUEST_ID_MAX = 128;

export function isInquiryFeedbackType(value: unknown): value is InquiryFeedbackType {
  return typeof value === 'string' && (INQUIRY_FEEDBACK_TYPES as readonly string[]).includes(value);
}

export function isInquiryFeedbackChannel(value: unknown): value is InquiryFeedbackChannel {
  return typeof value === 'string' && (INQUIRY_FEEDBACK_CHANNELS as readonly string[]).includes(value);
}

export function isAdminProxyFeedbackChannel(value: unknown): value is AdminProxyFeedbackChannel {
  return typeof value === 'string' && (ADMIN_PROXY_FEEDBACK_CHANNELS as readonly string[]).includes(value);
}

export function isInquiryFeedbackHandlingStatus(value: unknown): value is InquiryFeedbackHandlingStatus {
  return typeof value === 'string' && (INQUIRY_FEEDBACK_HANDLING_STATUSES as readonly string[]).includes(value);
}

export function inquiryFeedbackTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return (INQUIRY_FEEDBACK_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

export function inquiryFeedbackChannelLabel(channel: string | null | undefined): string {
  if (!channel) return '';
  return (INQUIRY_FEEDBACK_CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

export function inquiryFeedbackHandlingStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return (INQUIRY_FEEDBACK_HANDLING_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export type InquiryFeedbackRecord = {
  id: string;
  inquiryId: string;
  quoteId: string | null;
  quoteVersion: number | null;
  actorType: string;
  actorUserId: string | null;
  actorEmail: string;
  actorName: string | null;
  channel: string;
  channelReference: string | null;
  feedbackType: string;
  content: string;
  handlingStatus: string;
  handledByAdminId: string | null;
  handledByAdminEmail: string | null;
  handledAt: Date | string | null;
  resolutionNote: string | null;
  resolvedByQuoteId: string | null;
  clientRequestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

export type CustomerFeedbackView = {
  id: string;
  inquiryId: string;
  quoteId: string | null;
  quoteVersion: number | null;
  actorType: string;
  authorLabel: string;
  channel: string;
  channelReference: string | null;
  feedbackType: string;
  content: string;
  handlingStatus: string;
  handledAt: Date | string | null;
  createdAt: Date | string;
};

export type AdminFeedbackView = {
  id: string;
  inquiryId: string;
  quoteId: string | null;
  quoteVersion: number | null;
  actorType: string;
  actorUserId: string | null;
  actorEmail: string;
  actorName: string | null;
  channel: string;
  channelReference: string | null;
  feedbackType: string;
  content: string;
  handlingStatus: string;
  handledByAdminId: string | null;
  handledByAdminEmail: string | null;
  handledAt: Date | string | null;
  resolutionNote: string | null;
  resolvedByQuoteId: string | null;
  clientRequestId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string | null;
};

export type FeedbackSummary<TView> = {
  totalCount: number;
  pendingCount: number;
  latestFeedback: TView | null;
};

/**
 * 客户侧脱敏视图：严格白名单字段，绝不返回 resolutionNote、handledByAdminId、
 * handledByAdminEmail、actorUserId、actorEmail、ip、userAgent、resolvedByQuoteId。
 */
export function toCustomerFeedbackView(row: InquiryFeedbackRecord): CustomerFeedbackView {
  const authorLabel = row.actorType === 'admin_proxy'
    ? '客服代录'
    : (row.actorName?.trim() || '客户');
  return {
    id: row.id,
    inquiryId: row.inquiryId,
    quoteId: row.quoteId ?? null,
    quoteVersion: row.quoteVersion ?? null,
    actorType: row.actorType,
    authorLabel,
    channel: row.channel,
    channelReference: row.channelReference ?? null,
    feedbackType: row.feedbackType,
    content: row.content,
    handlingStatus: row.handlingStatus,
    handledAt: row.handledAt ?? null,
    createdAt: row.createdAt,
  };
}

export function toAdminFeedbackView(row: InquiryFeedbackRecord): AdminFeedbackView {
  return {
    id: row.id,
    inquiryId: row.inquiryId,
    quoteId: row.quoteId ?? null,
    quoteVersion: row.quoteVersion ?? null,
    actorType: row.actorType,
    actorUserId: row.actorUserId ?? null,
    actorEmail: row.actorEmail,
    actorName: row.actorName ?? null,
    channel: row.channel,
    channelReference: row.channelReference ?? null,
    feedbackType: row.feedbackType,
    content: row.content,
    handlingStatus: row.handlingStatus,
    handledByAdminId: row.handledByAdminId ?? null,
    handledByAdminEmail: row.handledByAdminEmail ?? null,
    handledAt: row.handledAt ?? null,
    resolutionNote: row.resolutionNote ?? null,
    resolvedByQuoteId: row.resolvedByQuoteId ?? null,
    clientRequestId: row.clientRequestId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
  };
}

export function emptyFeedbackSummary<TView = CustomerFeedbackView>(): FeedbackSummary<TView> {
  return {
    totalCount: 0,
    pendingCount: 0,
    latestFeedback: null,
  };
}

export function buildFeedbackSummaryMap(
  rows: InquiryFeedbackRecord[],
  audience: 'customer',
): Map<string, FeedbackSummary<CustomerFeedbackView>>;
export function buildFeedbackSummaryMap(
  rows: InquiryFeedbackRecord[],
  audience: 'admin',
): Map<string, FeedbackSummary<AdminFeedbackView>>;
export function buildFeedbackSummaryMap(
  rows: InquiryFeedbackRecord[],
  audience: 'customer' | 'admin' = 'customer',
): Map<string, FeedbackSummary<CustomerFeedbackView | AdminFeedbackView>> {
  const map = new Map<string, FeedbackSummary<CustomerFeedbackView | AdminFeedbackView>>();
  for (const row of rows) {
    let entry = map.get(row.inquiryId);
    if (!entry) {
      entry = { totalCount: 0, pendingCount: 0, latestFeedback: null };
      map.set(row.inquiryId, entry);
    }
    entry.totalCount += 1;
    if (row.handlingStatus === 'pending') {
      entry.pendingCount += 1;
    }
    const rowTime = new Date(row.createdAt).getTime();
    const latestTime = entry.latestFeedback ? new Date(entry.latestFeedback.createdAt).getTime() : -Infinity;
    if (!entry.latestFeedback || rowTime > latestTime) {
      entry.latestFeedback = audience === 'admin' ? toAdminFeedbackView(row) : toCustomerFeedbackView(row);
    }
  }
  return map;
}
