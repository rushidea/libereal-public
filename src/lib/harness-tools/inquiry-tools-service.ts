import type { BackgroundTask, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { isUniqueConstraintError } from '@/lib/checkout-idempotency';
import { reviewCommerceLinesWithCatalog } from '@/lib/commerce-line-catalog';
import { reviewCommerceLines } from '@/lib/commerce-line-review';
import {
  buildFeedbackSummaryMap,
  emptyFeedbackSummary,
  toAdminFeedbackView,
} from '@/lib/inquiry-feedback';
import { viewInquiryItems } from '@/lib/inquiry-item-brands';
import {
  assessInquiryQuotePublish,
  currentCatalogRepricingDraft,
} from '@/lib/inquiry-quote-publish';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { discountPricingFailure, verifyAndPriceItems } from '@/lib/pricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { applySettledQuoteExpiry, settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import { loadQuoteProductTaxonomy } from '@/lib/quote-item-taxonomy';
import { quoteContentHash, quoteView } from '@/lib/quote-records';
import {
  SUPPLIER_MAIL_HEADER_TASK,
  supplierMailHeadersForReview,
  supplierMailReceiptConflict,
  supplierMailReceiptLink,
} from '@/lib/supplier-mail-headers';
import { SUPPLIER_WRITTEN_QUOTE_REQUIRED } from '@/lib/supplier-quote-policy';
import {
  prepareSupplierQuoteReview,
  supplierQuoteErrorMessage,
  supplierQuoteReviewView,
} from '@/lib/supplier-quote-review';
import { deliveryReviewable } from '@/lib/task-delivery-review';
import type { HarnessErrorClass, HarnessLeaseHeader, HarnessPrincipal } from './auth';
import { assertActiveLeaseForWrite, readInquiryLeaseSummary } from './lease-service';

type Db = Prisma.TransactionClient | typeof prisma;

const IDEMPOTENCY_TASK_TYPE = 'aiops.control.harness_idempotency';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export class HarnessServiceError extends Error {
  status: number;
  errorClass: HarnessErrorClass;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    errorClass: HarnessErrorClass,
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HarnessServiceError';
    this.status = status;
    this.errorClass = errorClass;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

function metadataObject(metadata: string | null | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function metadataText(metadata: string | null | undefined, key: string): string | null {
  const value = metadataObject(metadata)?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectSupplierReviewIds(items: Array<{ metadata: string | null }>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const reqMap = jsonObject(item.metadata).supplierQuoteRequests;
    if (reqMap && typeof reqMap === 'object' && !Array.isArray(reqMap)) {
      for (const value of Object.values(reqMap as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) ids.add(value.trim());
      }
    }
    const revMap = jsonObject(item.metadata).supplierQuoteReviews;
    if (revMap && typeof revMap === 'object' && !Array.isArray(revMap)) {
      for (const value of Object.values(revMap as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) ids.add(value.trim());
      }
    }
  }
  return [...ids].sort();
}

export async function computeInquiryVersion(db: Db, inquiryId: string): Promise<string | null> {
  const inquiry = await db.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true,
      status: true,
      archivedAt: true,
      hasUnresolvedPricing: true,
      subtotal: true,
      notes: true,
      paymentMethod: true,
      leadTime: true,
      inquiryItems: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          productId: true,
          catalogNumber: true,
          name: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          available: true,
          leadTime: true,
          metadata: true,
        },
      },
      quotes: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          status: true,
          subtotal: true,
          validUntil: true,
          sentAt: true,
          acceptedAt: true,
          declinedAt: true,
        },
      },
      feedbacks: {
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          handlingStatus: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!inquiry) return null;

  const reviewIds = collectSupplierReviewIds(inquiry.inquiryItems);
  const supplierReviewTasks = reviewIds.length
    ? await db.backgroundTask.findMany({
        where: { id: { in: reviewIds }, type: 'inquiry.supplier_written_quote' },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, updatedAt: true },
      })
    : [];

  return pricingContentHash({
    id: inquiry.id,
    status: inquiry.status,
    archivedAt: inquiry.archivedAt?.toISOString() ?? null,
    hasUnresolvedPricing: inquiry.hasUnresolvedPricing,
    subtotal: inquiry.subtotal,
    notes: inquiry.notes ?? null,
    paymentMethod: inquiry.paymentMethod ?? null,
    leadTime: inquiry.leadTime ?? null,
    items: inquiry.inquiryItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      catalogNumber: item.catalogNumber,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      available: item.available,
      leadTime: item.leadTime,
      metadata: item.metadata ?? null,
    })),
    quotes: inquiry.quotes.map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      subtotal: q.subtotal,
      validUntil: q.validUntil?.toISOString() ?? null,
      sentAt: q.sentAt?.toISOString() ?? null,
      acceptedAt: q.acceptedAt?.toISOString() ?? null,
      declinedAt: q.declinedAt?.toISOString() ?? null,
    })),
    feedbacks: inquiry.feedbacks.map((f) => ({
      id: f.id,
      handlingStatus: f.handlingStatus,
      updatedAt: f.updatedAt.toISOString(),
    })),
    supplierReviewTasks: supplierReviewTasks.map((t) => ({
      id: t.id,
      status: t.status,
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

export async function getInquiryContextForHarness(inquiryId: string) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: {
      inquiryItems: { orderBy: { position: 'asc' } },
      quotes: {
        orderBy: { version: 'desc' },
        include: { items: { orderBy: { position: 'asc' } } },
      },
    },
  });
  if (!inquiry) {
    throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
  }

  const settled = await settleExpiredQuotes(prisma, [inquiry.id]);
  const currentInquiry = applySettledQuoteExpiry(inquiry, settled);
  const { inquiryItems, quotes, ...inquiryBase } = currentInquiry;

  const [itemViews, quoteTaxonomy, feedbackRows, publishDecision, catalogDraft, inquiryVersion] =
    await Promise.all([
      viewInquiryItems(inquiryItems),
      loadQuoteProductTaxonomy(
        quotes.flatMap((q) => q.items.map((item) => item.productId)),
      ),
      prisma.inquiryFeedback.findMany({
        where: { inquiryId: inquiry.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      assessInquiryQuotePublish(prisma, inquiry.id),
      currentCatalogRepricingDraft(prisma, inquiry.id),
      computeInquiryVersion(prisma, inquiry.id),
    ]);

  const feedbackSummary =
    buildFeedbackSummaryMap(feedbackRows, 'admin').get(inquiry.id) ??
    emptyFeedbackSummary();

  return {
    inquiryVersion,
    data: {
      inquiry: {
        ...inquiryBase,
        items: itemViews,
      },
      activeQuote: quotes[0] ? quoteView(quotes[0], quoteTaxonomy) : null,
      quoteVersions: quotes.map((q) => quoteView(q, quoteTaxonomy)),
      catalogRepricingDraft: catalogDraft
        ? {
            id: catalogDraft.id,
            version: catalogDraft.version,
            contentHash: quoteContentHash(catalogDraft),
            subtotal: catalogDraft.subtotal,
          }
        : null,
      publishDecision,
      feedbackSummary,
    },
  };
}

export async function getCustomerFeedbackForHarness(inquiryId: string) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, status: true },
  });
  if (!inquiry) {
    throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
  }

  const [rows, inquiryVersion] = await Promise.all([
    prisma.inquiryFeedback.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    computeInquiryVersion(prisma, inquiryId),
  ]);

  const summary =
    buildFeedbackSummaryMap(rows, 'admin').get(inquiryId) ??
    emptyFeedbackSummary();

  return {
    inquiryVersion,
    data: {
      inquiryId,
      dataTrustBoundary: 'untrusted_external_business_data' as const,
      feedbackSummary: summary,
      feedbacks: rows.map(toAdminFeedbackView),
    },
  };
}

export async function getSupplierQuoteEvidenceForHarness(inquiryId: string) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true },
  });
  if (!inquiry) {
    throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
  }

  const [rawEntries, inquiryVersion] = await Promise.all([
    supplierQuoteReviewView(prisma, inquiryId),
    computeInquiryVersion(prisma, inquiryId),
  ]);

  const entries = await Promise.all(
    rawEntries.map(async (entry) =>
      entry.status === 'awaiting_human' && entry.reviewId && entry.requestHash
        ? {
            ...entry,
            ...(await supplierMailHeadersForReview(
              inquiryId,
              entry.reviewId,
              entry.requestHash,
            )),
          }
        : entry,
    ),
  );

  return {
    inquiryVersion,
    data: {
      inquiryId,
      dataTrustBoundary: 'untrusted_external_business_data' as const,
      entries,
    },
  };
}

type InquiryDeliveryTaskRow = Pick<
  BackgroundTask,
  'id' | 'type' | 'status' | 'dedupeKey' | 'attempts' | 'lastError' | 'result' | 'updatedAt'
>;

export async function getInquiryHumanActionsAndReceiptsForHarness(
  inquiryId: string,
  environment?: string,
) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true,
      status: true,
      archivedAt: true,
      hasUnresolvedPricing: true,
      inquiryItems: {
        orderBy: { position: 'asc' },
        select: { id: true, metadata: true },
      },
      quotes: {
        orderBy: { version: 'desc' },
        include: { items: { orderBy: { position: 'asc' } } },
      },
      feedbacks: {
        where: { handlingStatus: 'pending' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          feedbackType: true,
          channel: true,
          createdAt: true,
        },
      },
    },
  });
  if (!inquiry) {
    throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
  }

  const reviewIds = collectSupplierReviewIds(inquiry.inquiryItems);
  const draftQuotes = inquiry.quotes.filter((quote) => quote.status === 'draft');

  const [supplierReviewRows, mailHeaderRows, deliveryRows, activeLease, inquiryVersion] =
    await Promise.all([
      reviewIds.length
        ? prisma.backgroundTask.findMany({
            where: { id: { in: reviewIds }, type: 'inquiry.supplier_written_quote' },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      prisma.backgroundTask.findMany({
        where: {
          type: SUPPLIER_MAIL_HEADER_TASK,
          payload: { contains: inquiryId },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.$queryRaw<InquiryDeliveryTaskRow[]>`
        SELECT id, type, status, dedupeKey, attempts, lastError, result, updatedAt
        FROM BackgroundTask
        WHERE type IN ('email.send', 'sms.send', 'order.reminder')
          AND (
            dedupeKey IN (SELECT 'quote-email:' || id FROM Quote WHERE inquiryId = ${inquiryId})
            OR json_extract(CASE WHEN json_valid(payload) THEN payload END, '$.inquiryId') = ${inquiryId}
            OR json_extract(CASE WHEN json_valid(payload) THEN payload END, '$.scope.inquiryId') = ${inquiryId}
            OR json_extract(CASE WHEN json_valid(payload) THEN payload END, '$.source.scope.inquiryId') = ${inquiryId}
          )
        ORDER BY createdAt DESC, id DESC
      `,
      environment ? readInquiryLeaseSummary(prisma, environment, inquiryId) : Promise.resolve(null),
      computeInquiryVersion(prisma, inquiryId),
    ]);

  const supplierQuoteTasks = supplierReviewRows.map((task) => {
    const payloadObj = jsonObject(task.payload);
    const scope = (payloadObj.scope ?? {}) as Record<string, unknown>;
    return {
      id: task.id,
      status: task.status,
      inquiryItemId: typeof scope.inquiryItemId === 'string' ? scope.inquiryItemId : null,
      requestHash: typeof payloadObj.requestHash === 'string' ? payloadObj.requestHash : null,
      outboundSent: payloadObj.outboundSent === true,
      updatedAt: task.updatedAt.toISOString(),
    };
  });

  const supplierMailHeaderTasks = mailHeaderRows
    .filter((task) => supplierMailReceiptLink(task)?.inquiryId === inquiryId)
    .map((task) => ({
      id: task.id,
      status: task.status,
      conflict: supplierMailReceiptConflict(task),
      updatedAt: task.updatedAt.toISOString(),
    }));

  const draftQuotesAwaitingPublish = draftQuotes.map((quote) => ({
    id: quote.id,
    version: quote.version,
    contentHash: quoteContentHash(quote),
    subtotal: quote.subtotal,
  }));

  const deliveryTasks = deliveryRows.map((task) => {
    const outcome = jsonObject(task.result).outcome;
    const reviewable = deliveryReviewable(task);
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      dedupeKey: task.dedupeKey ?? null,
      attempts: task.attempts,
      lastError: task.lastError ? task.lastError.slice(0, 300) : null,
      outcome: typeof outcome === 'string' ? outcome : reviewable ? 'unknown' : null,
      reviewable,
      updatedAt: task.updatedAt.toISOString(),
    };
  });

  const reasons: string[] = [];
  if (inquiry.feedbacks.length > 0) {
    reasons.push(`待处理客户反馈 ${inquiry.feedbacks.length} 条`);
  }
  const awaitingSupplierTasks = supplierQuoteTasks.filter((t) => t.status === 'awaiting_human');
  if (awaitingSupplierTasks.length > 0) {
    reasons.push(`待人工供应商书面询价/回填 ${awaitingSupplierTasks.length} 项`);
  }
  const awaitingMailTasks = supplierMailHeaderTasks.filter((t) => t.status === 'awaiting_human');
  if (awaitingMailTasks.length > 0) {
    reasons.push(`待人工核对供应商来信邮件头 ${awaitingMailTasks.length} 项`);
  }
  if (draftQuotesAwaitingPublish.length > 0) {
    reasons.push(`待管理员核对发布报价草稿 ${draftQuotesAwaitingPublish.length} 份`);
  }
  if (deliveryTasks.some((t) => t.reviewable)) {
    reasons.push('存在待核对投递回执');
  }

  return {
    inquiryVersion,
    data: {
      inquiryId,
      inquiryStatus: inquiry.status,
      archivedAt: inquiry.archivedAt?.toISOString() ?? null,
      hasUnresolvedPricing: inquiry.hasUnresolvedPricing,
      waitingOnHuman: reasons.length > 0,
      reasons,
      pendingFeedbacks: inquiry.feedbacks.map((f) => ({
        id: f.id,
        feedbackType: f.feedbackType,
        channel: f.channel,
        createdAt: f.createdAt.toISOString(),
      })),
      supplierQuoteTasks,
      supplierMailHeaderTasks,
      draftQuotesAwaitingPublish,
      deliveryTasks,
      activeLease,
    },
  };
}

export interface PreviewLineOverrideInput {
  inquiryItemId: string;
  quantity?: number;
}

export interface QuotePreviewMissingInfoItem {
  inquiryItemId: string;
  catalogNumber: string | null;
  code: string;
  message: string;
}

export async function previewInquiryQuoteForHarness(
  inquiryId: string,
  input?: { lineOverrides?: PreviewLineOverrideInput[] },
) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: {
      inquiryItems: { orderBy: { position: 'asc' } },
    },
  });
  if (!inquiry) {
    throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
  }

  const overrideMap = new Map<string, number>();
  if (input?.lineOverrides !== undefined) {
    if (!Array.isArray(input.lineOverrides) || input.lineOverrides.length > 100) {
      throw new HarnessServiceError(400, 'validation_error', 'INVALID_LINE_OVERRIDES', 'lineOverrides 格式无效');
    }
    const knownItemIds = new Set(inquiry.inquiryItems.map((item) => item.id));
    for (const override of input.lineOverrides) {
      if (
        !override ||
        typeof override !== 'object' ||
        typeof override.inquiryItemId !== 'string' ||
        !override.inquiryItemId.trim()
      ) {
        throw new HarnessServiceError(400, 'validation_error', 'INVALID_LINE_OVERRIDES', 'lineOverrides 缺少有效的 inquiryItemId');
      }
      const itemId = override.inquiryItemId.trim();
      if (!knownItemIds.has(itemId)) {
        throw new HarnessServiceError(400, 'validation_error', 'UNKNOWN_INQUIRY_ITEM', `询价明细不存在: ${itemId}`);
      }
      if (overrideMap.has(itemId)) {
        throw new HarnessServiceError(400, 'validation_error', 'DUPLICATE_LINE_OVERRIDE', `重复的询价明细覆盖: ${itemId}`);
      }
      if (override.quantity !== undefined) {
        if (typeof override.quantity !== 'number' || !Number.isInteger(override.quantity) || override.quantity <= 0) {
          throw new HarnessServiceError(400, 'validation_error', 'INVALID_QUANTITY', '数量必须为正整数');
        }
        overrideMap.set(itemId, override.quantity);
      }
    }
  }

  const [publishDecision, catalogDraft, inquiryVersion] = await Promise.all([
    assessInquiryQuotePublish(prisma, inquiryId),
    currentCatalogRepricingDraft(prisma, inquiryId),
    computeInquiryVersion(prisma, inquiryId),
  ]);

  const lookupItems = inquiry.inquiryItems.map((item) => ({
    inquiryItemId: item.id,
    productId: item.productId,
    variantId: metadataText(item.metadata, 'variantId'),
    catalogNumber: item.catalogNumber,
    brand: metadataText(item.metadata, 'brand'),
    name: item.name,
    price: item.unitPrice ?? 0,
    quantity: overrideMap.get(item.id) ?? item.quantity,
  }));

  const pricingContext = {
    inquiryId,
    userId: inquiry.userId,
    customerEmail: inquiry.email,
    allowQuoteRequired: true,
    allowManualAdjustment: false,
    allowClientFallback: false,
    strictQuantity: true,
    requireDiscountPriority: Boolean(catalogDraft),
  };

  type VerifiedLine = Awaited<ReturnType<typeof verifyAndPriceItems>>['verifiedItems'][number];
  const pricedByItemId = new Map<string, VerifiedLine>();
  const missingInfo: QuotePreviewMissingInfoItem[] = [];

  try {
    const batchResult = await verifyAndPriceItems(lookupItems, pricingContext);
    batchResult.verifiedItems.forEach((verified, index) => {
      const sourceItem = inquiry.inquiryItems[index];
      if (sourceItem) pricedByItemId.set(sourceItem.id, verified);
    });
  } catch {
    for (let index = 0; index < lookupItems.length; index += 1) {
      const sourceItem = inquiry.inquiryItems[index];
      const lookupItem = lookupItems[index];
      try {
        const single = await verifyAndPriceItems([lookupItem], pricingContext);
        if (single.verifiedItems[0]) {
          pricedByItemId.set(sourceItem.id, single.verifiedItems[0]);
        }
      } catch (err) {
        const code = err instanceof Error ? err.message : 'PRICING_FAILED';
        const message = discountPricingFailure(err) ?? supplierQuoteErrorMessage(err);
        missingInfo.push({
          inquiryItemId: sourceItem.id,
          catalogNumber: sourceItem.catalogNumber,
          code,
          message,
        });
      }
    }
  }

  const lines = inquiry.inquiryItems.map((sourceItem, index) => {
    const priced = pricedByItemId.get(sourceItem.id);
    if (!priced) {
      return {
        index,
        inquiryItemId: sourceItem.id,
        productId: sourceItem.productId,
        variantId: metadataText(sourceItem.metadata, 'variantId'),
        catalogNumber: sourceItem.catalogNumber,
        name: sourceItem.name,
        quantity: lookupItems[index].quantity,
        unitPrice: null,
        lineTotal: null,
        source: 'error' as const,
        quoteRequired: true,
        available: sourceItem.available,
        leadTime: sourceItem.leadTime,
        discountPolicy: null,
      };
    }

    const snapshot = jsonObject(priced.pricingSnapshot);
    if (snapshot.reason === SUPPLIER_WRITTEN_QUOTE_REQUIRED) {
      missingInfo.push({
        inquiryItemId: sourceItem.id,
        catalogNumber: priced.catalogNumber,
        code: SUPPLIER_WRITTEN_QUOTE_REQUIRED,
        message: '该销售包装须先人工发函并核验供应商书面回复，再继续报价',
      });
    } else if (
      priced.quoteRequired &&
      typeof snapshot.productId === 'string' &&
      snapshot.productId.length > 0
    ) {
      missingInfo.push({
        inquiryItemId: sourceItem.id,
        catalogNumber: priced.catalogNumber,
        code: 'QUOTE_REQUIRED',
        message: '该商品为询价模式或缺少目录价，不能自动核算',
      });
    } else if (priced.source === 'fallback') {
      missingInfo.push({
        inquiryItemId: sourceItem.id,
        catalogNumber: priced.catalogNumber,
        code: 'CATALOG_ITEM_UNMATCHED',
        message: '商品未匹配到已核验目录，须先核对商品资料或人工报价',
      });
    } else if (priced.quoteRequired) {
      missingInfo.push({
        inquiryItemId: sourceItem.id,
        catalogNumber: priced.catalogNumber,
        code: 'QUOTE_REQUIRED',
        message: '该商品为询价模式或缺少目录价，不能自动核算',
      });
    }

    return {
      index,
      inquiryItemId: sourceItem.id,
      productId: priced.productId,
      variantId: priced.variantId ?? null,
      catalogNumber: priced.catalogNumber,
      brand: priced.brand ?? null,
      name: priced.name,
      quantity: priced.quantity,
      unitPrice: priced.quoteRequired || priced.source === 'fallback' ? null : priced.unitPrice,
      lineTotal: priced.quoteRequired || priced.source === 'fallback' ? null : priced.lineTotal,
      source: priced.source,
      quoteRequired: priced.quoteRequired === true,
      available: priced.available ?? sourceItem.available,
      leadTime: priced.leadTime ?? sourceItem.leadTime,
      discountPolicy: typeof snapshot.discountPolicy === 'string' ? snapshot.discountPolicy : null,
    };
  });

  const reviewableLines = lines.filter(
    (line): line is typeof line & { unitPrice: number } =>
      typeof line.unitPrice === 'number' && !line.quoteRequired && line.source === 'db',
  );
  const preliminaryReview = reviewCommerceLines(
    reviewableLines.map((line) => ({
      index: line.index,
      lineId: line.inquiryItemId,
      name: line.name,
      catalogNumber: line.catalogNumber,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    })),
  );
  const catalogReview = reviewableLines.length
    ? await reviewCommerceLinesWithCatalog(
        reviewableLines.map((line) => ({
          index: line.index,
          lineId: line.inquiryItemId,
          productId: line.productId,
          variantId: line.variantId,
          name: line.name,
          catalogNumber: line.catalogNumber,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        })),
      )
    : { findings: [], errors: [], warnings: [] };

  const allErrors = [...preliminaryReview.errors, ...catalogReview.errors];
  const allWarnings = [...preliminaryReview.warnings, ...catalogReview.warnings];
  const pricedSubtotal = Math.round(
    lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0) * 100,
  ) / 100;

  const readyToDraft =
    publishDecision.ok &&
    missingInfo.length === 0 &&
    allErrors.length === 0 &&
    lines.length > 0 &&
    lines.every((line) => !line.quoteRequired && line.source === 'db');

  const previewBody = {
    inquiryId,
    publishDecision,
    catalogRepricingDraft: catalogDraft
      ? {
          id: catalogDraft.id,
          version: catalogDraft.version,
          contentHash: quoteContentHash(catalogDraft),
          subtotal: catalogDraft.subtotal,
        }
      : null,
    pricedSubtotal,
    readyToDraft,
    lines,
    missingInfo,
    lineReview: {
      errors: allErrors,
      warnings: allWarnings,
    },
    outboundSent: false as const,
    quotePublished: false as const,
  };

  return {
    inquiryVersion,
    data: {
      ...previewBody,
      previewHash: pricingContentHash(previewBody),
    },
  };
}

export interface PrepareSupplierReviewInput {
  inquiryItemId: string;
  quantity?: number;
  renewalReason?: string;
  expectedInquiryVersion: string;
  idempotencyKey: string;
}

export async function prepareSupplierQuoteReviewForHarness(
  inquiryId: string,
  input: PrepareSupplierReviewInput,
  principal: HarnessPrincipal,
  leaseHeader?: HarnessLeaseHeader | null,
) {
  const inquiryItemId = typeof input.inquiryItemId === 'string' ? input.inquiryItemId.trim() : '';
  if (!inquiryItemId || inquiryItemId.length > 160) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_INQUIRY_ITEM_ID', 'inquiryItemId 无效');
  }
  if (typeof input.expectedInquiryVersion !== 'string' || !SHA256_HEX_RE.test(input.expectedInquiryVersion)) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_INQUIRY_VERSION', 'expectedInquiryVersion 必须为 64 位 SHA-256 摘要');
  }
  if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 格式无效');
  }
  if (input.quantity !== undefined && (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity) || input.quantity <= 0)) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_QUANTITY', 'quantity 必须为正整数');
  }
  const renewalReason = typeof input.renewalReason === 'string' ? input.renewalReason.trim() : undefined;
  if (input.renewalReason !== undefined && (!renewalReason || renewalReason.length > 500)) {
    throw new HarnessServiceError(400, 'validation_error', 'INVALID_RENEWAL_REASON', 'renewalReason 须为 1~500 字');
  }

  const dedupeKey = `harness-idem:${pricingContentHash({
    env: principal.environment,
    clientId: principal.clientId,
    action: 'prepare_supplier_quote_review',
    inquiryId,
    idempotencyKey: input.idempotencyKey,
  })}`;
  const requestPayloadHash = pricingContentHash({
    inquiryId,
    inquiryItemId,
    quantity: input.quantity ?? null,
    renewalReason: renewalReason ?? null,
  });

  const actor = {
    id: `harness:${principal.clientId}`,
    email: `${principal.clientId}@harness.local`,
  };

  const replayOrConflict = (existing: { payload: string; result: string | null }, currentVersion: string | null) => {
    const savedPayload = jsonObject(existing.payload);
    if (savedPayload.requestPayloadHash !== requestPayloadHash) {
      throw new HarnessServiceError(
        409,
        'idempotency_conflict',
        'IDEMPOTENCY_CONFLICT',
        '幂等键已用于不同参数的供应商询价准备请求',
      );
    }
    const savedResult = jsonObject(existing.result);
    return {
      status: 200,
      inquiryVersion: currentVersion ?? (typeof savedResult.inquiryVersionAfter === 'string' ? savedResult.inquiryVersionAfter : null),
      data: {
        ...savedResult,
        replayed: true,
      },
    };
  };

  try {
    return await prisma.$transaction(async (tx) => {
      await assertActiveLeaseForWrite(tx, inquiryId, principal, leaseHeader);

      const existingReceipt = await tx.backgroundTask.findUnique({ where: { dedupeKey } });
      if (existingReceipt) {
        const currentVersion = await computeInquiryVersion(tx, inquiryId);
        return replayOrConflict(existingReceipt, currentVersion);
      }

      const currentVersion = await computeInquiryVersion(tx, inquiryId);
      if (!currentVersion) {
        throw new HarnessServiceError(404, 'not_found', 'INQUIRY_NOT_FOUND', '未找到指定询价单');
      }
      if (currentVersion !== input.expectedInquiryVersion) {
        throw new HarnessServiceError(
          409,
          'version_conflict',
          'VERSION_CONFLICT',
          '询价状态已变化，请先刷新获取最新 inquiryVersion 后重试',
          true,
          { currentInquiryVersion: currentVersion },
        );
      }

      const itemExists = await tx.inquiryItem.findFirst({
        where: { id: inquiryItemId, inquiryId },
        select: { id: true },
      });
      if (!itemExists) {
        throw new HarnessServiceError(404, 'not_found', 'INQUIRY_ITEM_NOT_FOUND', '未找到指定询价明细行');
      }

      let prepared: Awaited<ReturnType<typeof prepareSupplierQuoteReview>>;
      try {
        prepared = await prepareSupplierQuoteReview(tx, {
          inquiryId,
          inquiryItemId,
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
          ...(renewalReason !== undefined ? { renewalReason } : {}),
          actor,
        });
      } catch (err) {
        const code = err instanceof Error ? err.message : 'SUPPLIER_QUOTE_PREPARE_FAILED';
        const message = supplierQuoteErrorMessage(err);
        if (
          [
            'SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED',
            'BRAND_CATALOG_PRICE_REQUIRED',
            'BRAND_NOT_ACTIVE',
          ].includes(code)
        ) {
          throw new HarnessServiceError(409, 'missing_info', code, message);
        }
        throw new HarnessServiceError(409, 'validation_error', code, message);
      }

      await writeAuditLog(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          action: 'harness.inquiry.supplier_quote_prepared',
          resource: 'inquiries',
          targetType: 'Inquiry',
          targetId: inquiryId,
          after: {
            reviewId: prepared.reviewId,
            requestHash: prepared.requestHash,
            status: prepared.status,
            outboundSent: false,
          },
          metadata: {
            clientId: principal.clientId,
            environment: principal.environment,
            idempotencyKey: input.idempotencyKey,
            expectedInquiryVersion: input.expectedInquiryVersion,
          },
          reason: 'Harness M2 准备供应商书面询价（未自动发送外部邮件）',
        },
        tx,
      );

      const inquiryVersionAfter = await computeInquiryVersion(tx, inquiryId);
      const resultPayload = {
        inquiryId,
        inquiryItemId,
        reviewId: prepared.reviewId,
        requestHash: prepared.requestHash,
        status: prepared.status,
        outboundSent: false as const,
        scope: prepared.scope,
        inquiryVersionAfter,
      };

      await tx.backgroundTask.create({
        data: {
          type: IDEMPOTENCY_TASK_TYPE,
          status: 'succeeded',
          maxAttempts: 1,
          completedAt: new Date(),
          dedupeKey,
          payload: JSON.stringify({
            requestPayloadHash,
            inquiryId,
            inquiryItemId,
            clientId: principal.clientId,
            environment: principal.environment,
          }),
          result: JSON.stringify(resultPayload),
        },
      });

      return {
        status: 201,
        inquiryVersion: inquiryVersionAfter,
        data: {
          ...resultPayload,
          replayed: false,
        },
      };
    });
  } catch (err) {
    if (err instanceof HarnessServiceError) throw err;
    if (isUniqueConstraintError(err)) {
      const existingReceipt = await prisma.backgroundTask.findUnique({ where: { dedupeKey } });
      if (existingReceipt) {
        const currentVersion = await computeInquiryVersion(prisma, inquiryId);
        return replayOrConflict(existingReceipt, currentVersion);
      }
    }
    throw err;
  }
}

export function mapHarnessServiceError(err: unknown) {
  if (err instanceof HarnessServiceError) {
    return {
      status: err.status,
      errorClass: err.errorClass,
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      details: err.details,
    };
  }
  return {
    status: 500,
    errorClass: 'internal_error' as const,
    code: 'INTERNAL_ERROR',
    message: 'Harness 工具处理失败',
    retryable: false,
  };
}
