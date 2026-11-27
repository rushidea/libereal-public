import {
  inquiryFeedbackChannelLabel,
  inquiryFeedbackHandlingStatusLabel,
  inquiryFeedbackTypeLabel,
  type AdminFeedbackView,
} from '@/lib/inquiry-feedback';
import { QUOTE_STATUS_LABELS } from '@/lib/quote-records';
import { effectiveInquiryStatus, presentedQuoteStatus } from '@/lib/quote-expiry';
import { quoteDeclineReasonLabel } from '@/lib/quote-decline';
import type { SupplierQuoteReply } from '@/lib/supplier-quote-review';

export type TimelineCategory = 'inquiry' | 'supplier' | 'quote' | 'feedback';
export type TimelineSortOrder = 'desc' | 'asc';
export type TimelineEventTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type TimelineEventType =
  | 'inquiry_created'
  | 'supplier_quote_prepared'
  | 'supplier_quote_replied'
  | 'quote_version'
  | 'quote_operation_log'
  | 'customer_feedback'
  | 'quote_declined';

export const TIMELINE_CATEGORY_LABELS: Record<TimelineCategory, string> = {
  inquiry: '客户询价',
  supplier: '供应商',
  quote: '报价',
  feedback: '客户反馈',
};

export interface AdminInquiryItem {
  notes?: string | null;
  metadata?: string | null;
  available?: boolean | null;
  id?: string;
  inquiryItemId?: string | null;
  name?: string;
  brand?: string | null;
  catalogNumber?: string | null;
  variantId?: string | null;
  spec?: string | null;
  unit?: string | null;
  quantity?: number;
  orderedQty?: number;
  price?: number | null;
  lineTotal?: number | null;
  leadTime?: string | null;
  customerLeadTime?: string | null;
  actualLeadTime?: string | null;
  product?: {
    name?: string;
    brand?: string;
    catalogNumber?: string;
    promotionalPrice?: number;
    price?: number;
  };
}

export interface AdminQuoteItem extends Omit<AdminInquiryItem, 'price'> {
  price?: number;
}

export interface AdminQuoteVersion {
  id: string;
  version: number;
  status: string;
  subtotal?: number;
  currency?: string;
  catalogRepricing?: boolean;
  contentHash?: string;
  validUntil?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  declineReasonCode?: string | null;
  declineNote?: string | null;
  declinedAt?: string | null;
  declinedByEmail?: string | null;
  createdAt?: string;
  items: AdminQuoteItem[];
}

export interface AdminInquiryRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  institution: string;
  department?: string | null;
  address?: string | null;
  items: AdminInquiryItem[];
  subtotal: number;
  hasUnresolvedPricing?: boolean;
  status: string;
  createdAt: string;
  paymentMethod?: string | null;
  notes?: string | null;
  userId?: string | null;
  activeQuote?: AdminQuoteVersion | null;
  quoteVersions?: AdminQuoteVersion[];
  feedbackSummary?: { totalCount: number; pendingCount: number };
  operationLogs?: string | null;
}

export interface TimelineSupplierEntry {
  inquiryItemId: string;
  name: string;
  error?: string;
  scope?: {
    catalogNumber: string;
    brand: string;
    quantity: number;
    cataloguePrice: number;
    currency?: string;
    customerPricing: { finalPrice: number; steps: { reason: string }[] };
  };
  quantityChangeSource?: { quoteId: string; quoteHash: string } | null;
  reviewId?: string | null;
  requestHash?: string | null;
  status?: string;
  owner?: string | null;
  requestedAt?: string | null;
  confirmedAt?: string | null;
  reply?: SupplierQuoteReply | null;
  mailReceipts?: { receiptId: string; emailId: number; sender: string }[];
  hasMoreMailReceipts?: boolean;
  continuation?: { status: string; reason: string; inquiryItemId: string } | unknown[] | null;
}

export interface InquiryOperationLogItem {
  name: string;
  price: number | null;
  quantity: number;
  leadTime?: string | null;
}

export interface InquiryOperationLogEntry {
  adminEmail?: string;
  adminId?: string;
  time: string;
  quoteId?: string;
  items?: InquiryOperationLogItem[];
}

interface TimelineEventBase {
  id: string;
  type: TimelineEventType;
  category: TimelineCategory;
  timestamp: string;
  timestampMs: number;
  causalOrder: number;
  defaultExpanded: boolean;
  title: string;
  statusLabel: string;
  summary: string;
  tone: TimelineEventTone;
}

export interface InquiryCreatedTimelineEvent extends TimelineEventBase {
  type: 'inquiry_created';
  category: 'inquiry';
  inquiry: AdminInquiryRecord;
}

export interface SupplierPreparedTimelineEvent extends TimelineEventBase {
  type: 'supplier_quote_prepared';
  category: 'supplier';
  entry: TimelineSupplierEntry;
}

export interface SupplierRepliedTimelineEvent extends TimelineEventBase {
  type: 'supplier_quote_replied';
  category: 'supplier';
  entry: TimelineSupplierEntry;
  reply: SupplierQuoteReply;
}

export interface QuoteVersionTimelineEvent extends TimelineEventBase {
  type: 'quote_version';
  category: 'quote';
  quote: NormalizedQuote;
  effectiveStatus: string;
  isActiveQuote: boolean;
  operationLog: InquiryOperationLogEntry | null;
}

export interface QuoteOperationLogTimelineEvent extends TimelineEventBase {
  type: 'quote_operation_log';
  category: 'quote';
  log: InquiryOperationLogEntry;
}

export interface CustomerFeedbackTimelineEvent extends TimelineEventBase {
  type: 'customer_feedback';
  category: 'feedback';
  feedback: AdminFeedbackView;
}

export interface QuoteDeclinedTimelineEvent extends TimelineEventBase {
  type: 'quote_declined';
  category: 'feedback';
  quoteId: string;
  quoteVersion: number;
  declineReasonCode?: string | null;
  declineNote?: string | null;
  declinedAt?: string | null;
  declinedByEmail?: string | null;
}

export type TimelineEvent =
  | InquiryCreatedTimelineEvent
  | SupplierPreparedTimelineEvent
  | SupplierRepliedTimelineEvent
  | QuoteVersionTimelineEvent
  | QuoteOperationLogTimelineEvent
  | CustomerFeedbackTimelineEvent
  | QuoteDeclinedTimelineEvent;

export interface NormalizedQuote extends AdminQuoteVersion {
  subtotal: number;
  currency: string;
  explicitTimestamp: string | null;
}

export type ProgressStepStatus = 'completed' | 'current' | 'attention' | 'skipped' | 'pending';

export interface ProgressStep {
  key: 'inquiry' | 'supplier' | 'quote' | 'feedback';
  category: TimelineCategory;
  label: '客户发起' | '供应商核价' | '报价演进' | '客户反馈';
  status: ProgressStepStatus;
  subtitle: string;
}

export interface CurrentActionAlert {
  level: 'warning' | 'info';
  title: string;
  description: string;
  target: 'action' | 'timeline';
  filterCategory?: TimelineCategory;
  actionLabel: string;
}

const LOG_MATCH_WINDOW_MS = 120_000;

const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  not_prepared: '待准备询价',
  awaiting_human: '等待书面回复',
  succeeded: '回复已核对',
  expired: '回复已过期',
  source_changed: '条件已变化',
};

function parseTimestampMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

function toIsoString(value: Date | string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  }
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? fallback : trimmed;
}

/** Formats a date/time value in `zh-CN` locale, returning `fallback` when missing or invalid. */
export function formatDateTimeSafe(
  value: Date | string | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString('zh-CN');
}

function isOrderRevisionLine(item: AdminInquiryItem): boolean {
  if (!item.metadata) return false;
  try {
    return typeof (JSON.parse(item.metadata) as Record<string, unknown>).repricingOrderId === 'string';
  } catch {
    return false;
  }
}

export function resolveEditableInquiryItems(inquiry: AdminInquiryRecord): AdminInquiryItem[] {
  const activeQuote = inquiry.activeQuote;
  const isCatalogDraft = activeQuote?.status === 'draft' && Boolean(activeQuote.catalogRepricing);
  const hasUnorderedActiveQuote = !isCatalogDraft
    && Boolean(activeQuote)
    && activeQuote?.status !== 'accepted'
    && !activeQuote?.items?.every((item) => (item.orderedQty ?? 0) >= (item.quantity ?? 1));

  if (hasUnorderedActiveQuote && activeQuote?.items?.length) {
    const quoteByInquiryItemId = new Map<string, AdminQuoteItem>();
    for (const qItem of activeQuote.items) {
      if (qItem.inquiryItemId) quoteByInquiryItemId.set(qItem.inquiryItemId, qItem);
    }
    return inquiry.items.map((item, idx) => {
      const matched = (item.id ? quoteByInquiryItemId.get(item.id) : undefined) ?? activeQuote.items[idx];
      if (!matched) return item;
      return {
        ...item,
        price: matched.price ?? item.price,
        quantity: matched.quantity ?? item.quantity,
        leadTime: matched.leadTime ?? item.leadTime,
      };
    });
  }
  return inquiry.items;
}

/** Safely parses `Inquiry.operationLogs` JSON string into normalized log entries. */
export function parseInquiryOperationLogs(raw?: string | null): InquiryOperationLogEntry[] {
  if (!raw || typeof raw !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: InquiryOperationLogEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.time !== 'string' || !record.time.trim()) continue;
    if (!Number.isFinite(Date.parse(record.time))) continue;
    const items = Array.isArray(record.items)
      ? record.items
          .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object' && !Array.isArray(line))
          .map((line) => ({
            name: typeof line.name === 'string' && line.name.trim() ? line.name : '未知产品',
            price: typeof line.price === 'number' && Number.isFinite(line.price) ? line.price : null,
            quantity: typeof line.quantity === 'number' && Number.isFinite(line.quantity) ? line.quantity : 1,
            leadTime: typeof line.leadTime === 'string' ? line.leadTime : null,
          }))
      : undefined;
    entries.push({
      adminEmail: typeof record.adminEmail === 'string' ? record.adminEmail : undefined,
      adminId: typeof record.adminId === 'string' ? record.adminId : undefined,
      time: record.time,
      quoteId: typeof record.quoteId === 'string' ? record.quoteId : undefined,
      items,
    });
  }
  return entries;
}

function computeItemsSubtotal(items: readonly AdminInquiryItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 1), 0);
}

function normalizeQuotes(inquiry: AdminInquiryRecord): NormalizedQuote[] {
  const quoteMap = new Map<string, AdminQuoteVersion>();
  for (const q of inquiry.quoteVersions ?? []) {
    quoteMap.set(q.id, q);
  }
  if (inquiry.activeQuote) {
    const existing = quoteMap.get(inquiry.activeQuote.id);
    if (existing) {
      const aq = inquiry.activeQuote;
      quoteMap.set(aq.id, {
        ...existing,
        ...aq,
        subtotal: aq.subtotal ?? existing.subtotal,
        currency: aq.currency ?? existing.currency,
        createdAt: aq.createdAt ?? existing.createdAt,
        sentAt: aq.sentAt ?? existing.sentAt,
        acceptedAt: aq.acceptedAt ?? existing.acceptedAt,
        validUntil: aq.validUntil ?? existing.validUntil,
        declineReasonCode: aq.declineReasonCode ?? existing.declineReasonCode,
        declineNote: aq.declineNote ?? existing.declineNote,
        declinedAt: aq.declinedAt ?? existing.declinedAt,
        declinedByEmail: aq.declinedByEmail ?? existing.declinedByEmail,
        items: aq.items?.length ? aq.items : existing.items,
      });
    } else {
      quoteMap.set(inquiry.activeQuote.id, inquiry.activeQuote);
    }
  }
  return Array.from(quoteMap.values()).map((quote) => ({
    ...quote,
    subtotal: typeof quote.subtotal === 'number' ? quote.subtotal : computeItemsSubtotal(quote.items ?? []),
    currency: quote.currency ?? 'CNY',
    explicitTimestamp: quote.sentAt ?? quote.createdAt ?? null,
  }));
}

function matchLogsToQuotes(
  quotes: readonly NormalizedQuote[],
  logs: readonly InquiryOperationLogEntry[],
): { logByQuoteId: Map<string, InquiryOperationLogEntry>; unmatchedLogs: InquiryOperationLogEntry[] } {
  interface MatchCandidate {
    priority: number;
    distanceMs: number;
    isDraft: number;
    quoteIndex: number;
    logIndex: number;
  }
  const candidates: MatchCandidate[] = [];
  for (let logIndex = 0; logIndex < logs.length; logIndex += 1) {
    const log = logs[logIndex];
    const logMs = parseTimestampMs(log.time);
    for (let quoteIndex = 0; quoteIndex < quotes.length; quoteIndex += 1) {
      const quote = quotes[quoteIndex];
      const quoteMs = quote.explicitTimestamp ? parseTimestampMs(quote.explicitTimestamp) : NaN;
      const isDirectQuoteMatch = Boolean(log.quoteId && log.quoteId === quote.id);
      if (isDirectQuoteMatch) {
        candidates.push({
          priority: 0,
          distanceMs: Number.isFinite(quoteMs) ? Math.abs(logMs - quoteMs) : 0,
          isDraft: quote.status === 'draft' ? 1 : 0,
          quoteIndex,
          logIndex,
        });
        continue;
      }
      if (quote.explicitTimestamp && Number.isFinite(quoteMs)) {
        const distanceMs = Math.abs(logMs - quoteMs);
        if (distanceMs <= LOG_MATCH_WINDOW_MS) {
          candidates.push({
            priority: 1,
            distanceMs,
            isDraft: quote.status === 'draft' ? 1 : 0,
            quoteIndex,
            logIndex,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => (
    (a.priority - b.priority)
    || (a.distanceMs - b.distanceMs)
    || (a.isDraft - b.isDraft)
    || (a.quoteIndex - b.quoteIndex)
    || (a.logIndex - b.logIndex)
  ));

  const matchedLogs = new Set<number>();
  const matchedQuotes = new Set<number>();
  const logByQuoteId = new Map<string, InquiryOperationLogEntry>();

  for (const candidate of candidates) {
    if (matchedLogs.has(candidate.logIndex) || matchedQuotes.has(candidate.quoteIndex)) continue;
    matchedLogs.add(candidate.logIndex);
    matchedQuotes.add(candidate.quoteIndex);
    logByQuoteId.set(quotes[candidate.quoteIndex].id, logs[candidate.logIndex]);
  }

  const unmatchedLogs = logs.filter((_, idx) => !matchedLogs.has(idx));
  return { logByQuoteId, unmatchedLogs };
}

export function sortTimelineEvents<T extends TimelineEvent>(
  events: readonly T[],
  sortOrder: TimelineSortOrder = 'desc',
): T[] {
  return [...events].sort((a, b) => {
    if (sortOrder === 'desc') {
      const timeDiff = b.timestampMs - a.timestampMs;
      if (timeDiff !== 0) return timeDiff;
      const causalDiff = b.causalOrder - a.causalOrder;
      if (causalDiff !== 0) return causalDiff;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    }
    const timeDiff = a.timestampMs - b.timestampMs;
    if (timeDiff !== 0) return timeDiff;
    const causalDiff = a.causalOrder - b.causalOrder;
    if (causalDiff !== 0) return causalDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function summarizeInquiryNotes(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? '';
  if (!trimmed) return '';
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

export function buildAdminInquiryTimeline({
  inquiry,
  supplierEntries = [],
  feedbacks = [],
  sortOrder = 'desc',
  now = new Date(),
}: {
  inquiry: AdminInquiryRecord;
  supplierEntries?: readonly TimelineSupplierEntry[];
  feedbacks?: readonly AdminFeedbackView[];
  sortOrder?: TimelineSortOrder;
  now?: Date;
}): TimelineEvent[] {
  const fallbackCreated = toIsoString(inquiry.createdAt, new Date(0).toISOString());
  const events: TimelineEvent[] = [];

  // 1. inquiry_created
  const notePreview = summarizeInquiryNotes(inquiry.notes);
  events.push({
    id: `inquiry_created:${inquiry.id}`,
    type: 'inquiry_created',
    category: 'inquiry',
    timestamp: fallbackCreated,
    timestampMs: parseTimestampMs(fallbackCreated),
    causalOrder: 10,
    defaultExpanded: true,
    title: '客户提交询价',
    statusLabel: `${inquiry.items.length} 项产品`,
    summary: notePreview ? `初始备注：${notePreview}` : `${inquiry.institution} · ${inquiry.name}`,
    tone: 'info',
    inquiry,
  });

  // 2 & 3. supplier_quote_prepared & supplier_quote_replied
  supplierEntries.forEach((entry, index) => {
    const scopeLabel = entry.scope ? `${entry.scope.brand} ${entry.scope.catalogNumber}` : entry.name;
    const qtyText = entry.scope ? `× ${entry.scope.quantity} 包` : '';
    const preparedTs = entry.requestedAt ?? fallbackCreated;
    const preparedDefaultExpanded = Boolean(entry.error) || entry.status !== 'succeeded';
    const statusLabel = entry.error
      ? '核价异常'
      : (SUPPLIER_STATUS_LABELS[entry.status ?? ''] ?? '待核对');
    const preparedTone: TimelineEventTone = entry.error
      ? 'danger'
      : entry.status === 'succeeded'
        ? 'success'
        : entry.status === 'awaiting_human'
          ? 'info'
          : 'warning';

    events.push({
      id: `supplier_quote_prepared:${index}:${entry.inquiryItemId}:${entry.scope?.quantity ?? 'na'}`,
      type: 'supplier_quote_prepared',
      category: 'supplier',
      timestamp: preparedTs,
      timestampMs: parseTimestampMs(preparedTs),
      causalOrder: 20,
      defaultExpanded: preparedDefaultExpanded,
      title: `供应商核价准备 · ${scopeLabel}`,
      statusLabel,
      summary: entry.error
        ? entry.error
        : [qtyText, entry.owner ? `负责人：${entry.owner}` : '未指定负责人'].filter(Boolean).join(' · '),
      tone: preparedTone,
      entry,
    });

    if (entry.reply) {
      const repliedTs = entry.confirmedAt ?? entry.requestedAt ?? fallbackCreated;
      const isExpiredReply = entry.status === 'expired';
      events.push({
        id: `supplier_quote_replied:${index}:${entry.inquiryItemId}:${entry.scope?.quantity ?? 'na'}`,
        type: 'supplier_quote_replied',
        category: 'supplier',
        timestamp: repliedTs,
        timestampMs: parseTimestampMs(repliedTs),
        causalOrder: 30,
        defaultExpanded: false,
        title: `供应商书面回复 · ${entry.reply.supplier}`,
        statusLabel: isExpiredReply ? '已过期' : '已核对',
        summary: `采购价 ¥${entry.reply.supplierUnitPrice.toFixed(2)} · 客户价 ¥${entry.reply.customerUnitPrice.toFixed(2)} · 货期：${entry.reply.leadTime}`,
        tone: isExpiredReply ? 'warning' : 'success',
        entry,
        reply: entry.reply,
      });
    }
  });

  // 4. quote_version & quote_operation_log
  const quotes = normalizeQuotes(inquiry);
  const logs = parseInquiryOperationLogs(inquiry.operationLogs);
  const { logByQuoteId, unmatchedLogs } = matchLogsToQuotes(quotes, logs);

  for (const quote of quotes) {
    const effectiveStatus = presentedQuoteStatus({ status: quote.status, validUntil: quote.validUntil ?? null }, now);
    const isActiveQuote = quote.id === inquiry.activeQuote?.id;
    const defaultExpanded = isActiveQuote || ['draft', 'sent', 'accepted'].includes(effectiveStatus);
    const quoteTs = quote.sentAt ?? quote.createdAt ?? fallbackCreated;
    const statusLabel = QUOTE_STATUS_LABELS[effectiveStatus] ?? effectiveStatus;
    const matchedLog = logByQuoteId.get(quote.id) ?? null;

    const tone: TimelineEventTone = effectiveStatus === 'accepted'
      ? 'success'
      : effectiveStatus === 'declined'
        ? 'danger'
        : effectiveStatus === 'expired'
          ? 'warning'
          : ['draft', 'sent'].includes(effectiveStatus)
            ? 'info'
            : 'neutral';

    events.push({
      id: `quote_version:${quote.id}`,
      type: 'quote_version',
      category: 'quote',
      timestamp: quoteTs,
      timestampMs: parseTimestampMs(quoteTs),
      causalOrder: 40,
      defaultExpanded,
      title: `报价第 ${quote.version} 版${quote.catalogRepricing ? '（重算）' : ''}`,
      statusLabel,
      summary: `总额 ¥${quote.subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} · 共 ${quote.items?.length ?? 0} 项${matchedLog?.adminEmail ? ` · 操作人：${matchedLog.adminEmail}` : ''}`,
      tone,
      quote,
      effectiveStatus,
      isActiveQuote,
      operationLog: matchedLog,
    });

    if (quote.declineReasonCode || quote.declineNote || quote.declinedAt) {
      const declineTs = quote.declinedAt ?? quote.sentAt ?? quote.createdAt ?? fallbackCreated;
      const reasonLabel = quoteDeclineReasonLabel(quote.declineReasonCode);
      events.push({
        id: `quote_declined:${quote.id}`,
        type: 'quote_declined',
        category: 'feedback',
        timestamp: declineTs,
        timestampMs: parseTimestampMs(declineTs),
        causalOrder: 60,
        defaultExpanded: true,
        title: `客户放弃报价第 ${quote.version} 版`,
        statusLabel: '已放弃',
        summary: [reasonLabel || null, quote.declineNote?.trim() || null].filter(Boolean).join(' · ') || '客户已放弃报价',
        tone: 'danger',
        quoteId: quote.id,
        quoteVersion: quote.version,
        declineReasonCode: quote.declineReasonCode,
        declineNote: quote.declineNote,
        declinedAt: quote.declinedAt,
        declinedByEmail: quote.declinedByEmail,
      });
    }
  }

  unmatchedLogs.forEach((log, index) => {
    events.push({
      id: `quote_operation_log:${index}:${log.time}`,
      type: 'quote_operation_log',
      category: 'quote',
      timestamp: log.time,
      timestampMs: parseTimestampMs(log.time),
      causalOrder: 42,
      defaultExpanded: false,
      title: '历史报价操作记录',
      statusLabel: '已记录',
      summary: `${log.adminEmail || log.adminId || '管理员'} · ${log.items?.length ?? 0} 项明细`,
      tone: 'neutral',
      log,
    });
  });

  // 5. customer_feedback
  for (const feedback of feedbacks) {
    const fbTs = toIsoString(feedback.createdAt, fallbackCreated);
    const isPending = feedback.handlingStatus === 'pending';
    const actorTag = feedback.actorType === 'admin_proxy' ? '客服代录' : '客户提交';
    events.push({
      id: `customer_feedback:${feedback.id}`,
      type: 'customer_feedback',
      category: 'feedback',
      timestamp: fbTs,
      timestampMs: parseTimestampMs(fbTs),
      causalOrder: 50,
      defaultExpanded: isPending,
      title: `${actorTag} · ${inquiryFeedbackTypeLabel(feedback.feedbackType)}`,
      statusLabel: inquiryFeedbackHandlingStatusLabel(feedback.handlingStatus),
      summary: `${inquiryFeedbackChannelLabel(feedback.channel)}${feedback.channelReference ? ` (${feedback.channelReference})` : ''}：${feedback.content}`,
      tone: isPending ? 'warning' : feedback.handlingStatus === 'resolved' ? 'success' : 'neutral',
      feedback,
    });
  }

  return sortTimelineEvents(events, sortOrder);
}

export function buildInquiryProgressSteps({
  inquiry,
  supplierEntries = [],
  feedbacks = [],
  now = new Date(),
}: {
  inquiry: AdminInquiryRecord;
  supplierEntries?: readonly TimelineSupplierEntry[];
  feedbacks?: readonly AdminFeedbackView[];
  now?: Date;
}): ProgressStep[] {
  const effStatus = effectiveInquiryStatus(inquiry.status, inquiry.activeQuote, now);
  const quotes = normalizeQuotes(inquiry);
  const latestQuote = inquiry.activeQuote
    ? quotes.find((q) => q.id === inquiry.activeQuote!.id) ?? quotes[0] ?? null
    : quotes[0] ?? null;
  const hasDeclinedMetadata = quotes.some((q) => Boolean(q.declineReasonCode || q.declineNote || q.declinedAt));
  const isDeclined = effStatus === 'declined' || hasDeclinedMetadata;
  const isClosed = effStatus === 'closed';
  const isAccepted = inquiry.activeQuote?.status === 'accepted' || isClosed;

  const catalogDraft = inquiry.activeQuote?.status === 'draft' && inquiry.activeQuote.catalogRepricing
    ? inquiry.activeQuote
    : null;
  const pendingOrderReview = Boolean(
    catalogDraft?.items.some((item) => isOrderRevisionLine(item) && item.available !== false),
  );

  // Step 1: 客户发起
  const step1: ProgressStep = {
    key: 'inquiry',
    category: 'inquiry',
    label: '客户发起',
    status: 'completed',
    subtitle: inquiry.items.length > 0 ? `${inquiry.items.length} 项产品` : '已提交询价',
  };

  // Step 2: 供应商核价
  const supplierErrors = supplierEntries.filter((entry) => Boolean(entry.error));
  const supplierAttention = supplierEntries.filter(
    (entry) => !entry.error && ['expired', 'source_changed', 'not_prepared'].includes(entry.status ?? ''),
  );
  const supplierAwaiting = supplierEntries.filter((entry) => !entry.error && entry.status === 'awaiting_human');
  const supplierSucceeded = supplierEntries.filter((entry) => !entry.error && entry.status === 'succeeded');
  const supplierBlocked = supplierErrors.length > 0 || supplierAttention.length > 0 || supplierAwaiting.length > 0;

  let step2: ProgressStep;
  if (supplierEntries.length === 0) {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: 'skipped',
      subtitle: '免核价',
    };
  } else if (supplierSucceeded.length === supplierEntries.length) {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: 'completed',
      subtitle: `已完成 ${supplierSucceeded.length} 项核价`,
    };
  } else if (isDeclined || isClosed) {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: supplierSucceeded.length > 0 ? 'completed' : 'skipped',
      subtitle: supplierSucceeded.length > 0 ? `已完成 ${supplierSucceeded.length} 项` : '已终止无需继续',
    };
  } else if (supplierErrors.length > 0 || supplierEntries.some((e) => e.status === 'expired' || e.status === 'source_changed')) {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: 'attention',
      subtitle: supplierErrors.length > 0 ? '核价条件异常' : '需重新核对或续报',
    };
  } else if (supplierEntries.some((e) => e.status === 'not_prepared')) {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: 'attention',
      subtitle: '待准备人工询价',
    };
  } else {
    step2 = {
      key: 'supplier',
      category: 'supplier',
      label: '供应商核价',
      status: 'current',
      subtitle: `等待供应商回复 (${supplierAwaiting.length}/${supplierEntries.length})`,
    };
  }

  // Step 3: 报价演进
  let step3: ProgressStep;
  const latestEffectiveQuoteStatus = latestQuote
    ? presentedQuoteStatus({ status: latestQuote.status, validUntil: latestQuote.validUntil ?? null }, now)
    : null;

  if (isDeclined) {
    step3 = quotes.length > 0
      ? {
          key: 'quote',
          category: 'quote',
          label: '报价演进',
          status: 'completed',
          subtitle: `已发第 ${latestQuote?.version ?? quotes.length} 版（已放弃）`,
        }
      : {
          key: 'quote',
          category: 'quote',
          label: '报价演进',
          status: 'skipped',
          subtitle: '未发送报价',
        };
  } else if (isAccepted) {
    step3 = {
      key: 'quote',
      category: 'quote',
      label: '报价演进',
      status: 'completed',
      subtitle: latestQuote ? `第 ${latestQuote.version} 版已接受` : '已完成报价',
    };
  } else if (effStatus === 'quote_expired') {
    step3 = {
      key: 'quote',
      category: 'quote',
      label: '报价演进',
      status: 'attention',
      subtitle: latestQuote ? `第 ${latestQuote.version} 版已过期` : '报价已过期',
    };
  } else if (catalogDraft) {
    step3 = pendingOrderReview
      ? {
          key: 'quote',
          category: 'quote',
          label: '报价演进',
          status: 'attention',
          subtitle: `第 ${catalogDraft.version} 版待订单复核`,
        }
      : {
          key: 'quote',
          category: 'quote',
          label: '报价演进',
          status: 'current',
          subtitle: `第 ${catalogDraft.version} 版重算草稿待发`,
        };
  } else if (effStatus === 'quote_sent' || latestEffectiveQuoteStatus === 'sent') {
    step3 = {
      key: 'quote',
      category: 'quote',
      label: '报价演进',
      status: 'completed',
      subtitle: latestQuote ? `已发第 ${latestQuote.version} 版` : '已发送报价',
    };
  } else if (supplierBlocked) {
    step3 = {
      key: 'quote',
      category: 'quote',
      label: '报价演进',
      status: 'pending',
      subtitle: '待核价完成后报价',
    };
  } else {
    step3 = {
      key: 'quote',
      category: 'quote',
      label: '报价演进',
      status: 'current',
      subtitle: '待核价并发送报价',
    };
  }

  // Step 4: 客户反馈
  const pendingFeedbackCount = feedbacks.filter((fb) => fb.handlingStatus === 'pending').length;
  const handledFeedbackCount = feedbacks.filter((fb) => fb.handlingStatus === 'resolved' || fb.handlingStatus === 'ignored').length;

  let step4: ProgressStep;
  if (pendingFeedbackCount > 0) {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'attention',
      subtitle: `${pendingFeedbackCount} 条待处理反馈`,
    };
  } else if (isDeclined) {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'attention',
      subtitle: '客户已放弃报价',
    };
  } else if (isAccepted) {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'completed',
      subtitle: handledFeedbackCount > 0 ? `已接受 · 处理 ${handledFeedbackCount} 条反馈` : '客户已接受报价',
    };
  } else if (effStatus === 'quote_sent') {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'current',
      subtitle: handledFeedbackCount > 0 ? `已处理 ${handledFeedbackCount} 条 · 等待确认` : '等待客户确认或反馈',
    };
  } else if (effStatus === 'quote_expired') {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'attention',
      subtitle: '报价过期，待重新报价',
    };
  } else if (handledFeedbackCount > 0) {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'completed',
      subtitle: `已处理 ${handledFeedbackCount} 条反馈`,
    };
  } else {
    step4 = {
      key: 'feedback',
      category: 'feedback',
      label: '客户反馈',
      status: 'pending',
      subtitle: '等待发送报价',
    };
  }

  return [step1, step2, step3, step4];
}

export function buildCurrentActionAlert({
  inquiry,
  supplierEntries = [],
  feedbacks = [],
  now = new Date(),
}: {
  inquiry: AdminInquiryRecord;
  supplierEntries?: readonly TimelineSupplierEntry[];
  feedbacks?: readonly AdminFeedbackView[];
  now?: Date;
}): CurrentActionAlert | null {
  const effStatus = effectiveInquiryStatus(inquiry.status, inquiry.activeQuote, now);
  if (effStatus === 'closed' || effStatus === 'declined') return null;

  const pendingFeedbackCount = feedbacks.filter((fb) => fb.handlingStatus === 'pending').length;
  if (pendingFeedbackCount > 0) {
    return {
      level: 'warning',
      title: `有 ${pendingFeedbackCount} 条待处理客户反馈`,
      description: '客户在报价后提出了沟通或修改意见，请先在时间线中核对并记录处理结果。',
      target: 'timeline',
      filterCategory: 'feedback',
      actionLabel: '查看待处理反馈',
    };
  }

  const hasSupplierProblem = supplierEntries.some(
    (entry) => Boolean(entry.error) || entry.status === 'expired' || entry.status === 'source_changed',
  );
  if (hasSupplierProblem) {
    return {
      level: 'warning',
      title: '供应商核价需要处理',
      description: '部分商品的供应商询价条件已变化、过期或核对异常，请在操作台重新处理。',
      target: 'action',
      filterCategory: 'supplier',
      actionLabel: '前往处理核价',
    };
  }

  const hasNotPrepared = supplierEntries.some((entry) => !entry.error && entry.status === 'not_prepared');
  const hasAwaitingHuman = supplierEntries.some((entry) => !entry.error && entry.status === 'awaiting_human');
  if (hasNotPrepared || hasAwaitingHuman) {
    return {
      level: 'info',
      title: hasNotPrepared ? '需准备人工供应商询价' : '等待核对供应商书面回复',
      description: hasNotPrepared
        ? '有商品达到品牌核价门槛，请在操作台指派负责人并准备询价。'
        : '取得供应商书面报价后，请在操作台回填并核对结果。',
      target: 'action',
      filterCategory: 'supplier',
      actionLabel: '前往供应商核价',
    };
  }

  const catalogDraft = inquiry.activeQuote?.status === 'draft' && inquiry.activeQuote.catalogRepricing
    ? inquiry.activeQuote
    : null;
  if (catalogDraft) {
    const pendingOrderReview = catalogDraft.items.some((item) => isOrderRevisionLine(item) && item.available !== false);
    if (pendingOrderReview) {
      return {
        level: 'warning',
        title: `待完成原订单价格复核（第 ${catalogDraft.version} 版）`,
        description: '需先登记客户对原订单金额与供货条件的确认，才可发送重算报价。',
        target: 'action',
        filterCategory: 'quote',
        actionLabel: '前往订单复核',
      };
    }
    return {
      level: 'info',
      title: `第 ${catalogDraft.version} 版重算草稿待发送`,
      description: '目录价或供应商条件已更新，请在操作台核对后发送给客户。',
      target: 'action',
      filterCategory: 'quote',
      actionLabel: '前往确认发送',
    };
  }

  if (effStatus === 'quote_expired') {
    return {
      level: 'warning',
      title: '当前报价已过期',
      description: '客户已无法接受过期报价，请在操作台核对最新价格与货期后重新发送。',
      target: 'action',
      filterCategory: 'quote',
      actionLabel: '前往重新报价',
    };
  }

  if (['pending_quote', '待确认', '待人工审核'].includes(effStatus)) {
    return {
      level: 'info',
      title: '待核价并发送报价',
      description: '请在操作台核对商品单价、数量与货期后，提交报价给客户。',
      target: 'action',
      filterCategory: 'quote',
      actionLabel: '前往报价操作台',
    };
  }

  return null;
}
