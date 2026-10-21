import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { quoteView } from '@/lib/quote-records';
import { loadQuoteProductTaxonomy } from '@/lib/quote-item-taxonomy';
import { writeAuditLog } from '@/lib/audit';
import { reviewCommerceLinesWithCatalog } from '@/lib/commerce-line-catalog';
import { decideCommerceLineReview, reviewCommerceLines } from '@/lib/commerce-line-review';
import {
  InquiryQuotePublishRejected,
  assessInquiryQuotePublish,
  claimInquiryForQuotePublish,
} from '@/lib/inquiry-quote-publish';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, verifyAndPriceItems } from '@/lib/pricing';
import { mergeQuoteConstraintMetadata, packageConstraintFromVariant, readExplicitQuantityConstraint } from '@/lib/quote-acceptance';

function metadataBrand(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim() : null;
  } catch {
    return null;
  }
}

function metadataObject(metadata: string | null | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function metadataVariantId(metadata: string | null | undefined): string | null {
  const value = metadataObject(metadata)?.variantId;
  return typeof value === 'string' && value.trim() ? value : null;
}

// 发布报价。权限：管理员 inquiries.write。不要求 pricing.write，也不额外要求 MFA。
// 只有询价仍可报价时才发布：pending_quote、待确认、待人工审核，以及尚未下单、未接受的 quote_sent / quote_expired。
// 已放弃、已关闭、已归档、已下单或报价已接受时返回 409。状态条件与写入在同一事务的条件更新里完成。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('inquiries.write');
  if (user instanceof NextResponse) return user;

  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { inquiryItems: { orderBy: { position: 'asc' } } },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }
    const publishDecision = await assessInquiryQuotePublish(prisma, id);
    if (!publishDecision.ok) {
      return NextResponse.json({ error: publishDecision.error, code: publishDecision.code }, { status: publishDecision.status });
    }

    const body = await req.json();
    const items = body.items ?? inquiry.inquiryItems.map((item) => ({
      productId: item.productId,
      catalogNumber: item.catalogNumber,
      brand: metadataBrand(item.metadata),
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      leadTime: item.leadTime,
      available: item.available,
    }));
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }
    // 权限仍是 inquiries.write。单价和数量先做规则核对：硬错误直接拒绝，软警告需 confirmWarnings 后才发布。
    const quotedLines = (items as Array<Record<string, unknown>>).map((item, index) => {
      const inquiryItem = inquiry.inquiryItems[index];
      return {
        index,
        name: typeof item.name === 'string' ? item.name : inquiryItem?.name,
        spec: typeof item.spec === 'string' ? item.spec : null,
        catalogNumber: typeof item.catalogNumber === 'string' ? item.catalogNumber : inquiryItem?.catalogNumber,
        unitPrice: item.price !== undefined ? item.price : item.unitPrice !== undefined ? item.unitPrice : inquiryItem?.unitPrice,
        quantity: item.quantity !== undefined ? item.quantity : inquiryItem?.quantity ?? 1,
      };
    });
    const preliminaryReview = reviewCommerceLines(quotedLines);
    if (preliminaryReview.errors.length > 0) {
      const invalidLines = decideCommerceLineReview(preliminaryReview, false);
      if (!invalidLines.ok) return NextResponse.json(invalidLines.body, { status: invalidLines.status });
    }
    const manualAdjustments = Object.fromEntries(items
      .filter((item: Record<string, unknown>) => (typeof item.catalogNumber === 'string' || typeof item.productId === 'string') && Number.isFinite(Number(item.price ?? item.unitPrice)))
      .map((item: Record<string, unknown>) => [String(item.catalogNumber ?? item.productId), {
        type: 'fixed_price' as const,
        value: Number(item.price ?? item.unitPrice),
        reason: '管理员人工报价',
      }]));
    const priced = await verifyAndPriceItems(items.map((item: Record<string, unknown>, position: number) => ({
      productId: typeof item.productId === 'string' ? item.productId : inquiry.inquiryItems[position]?.productId,
      catalogNumber: typeof item.catalogNumber === 'string' ? item.catalogNumber : inquiry.inquiryItems[position]?.catalogNumber,
      brand: typeof item.brand === 'string' && item.brand.trim()
        ? item.brand.trim()
        : metadataBrand(inquiry.inquiryItems[position]?.metadata),
      name: String(item.name ?? inquiry.inquiryItems[position]?.name ?? 'Unknown'),
      price: Number(item.price ?? item.unitPrice),
      quantity: Number(quotedLines[position].quantity),
    })), { customerEmail: inquiry.email, manualAdjustments, allowManualAdjustment: true });
    const lineReview = await reviewCommerceLinesWithCatalog(priced.verifiedItems.map((pricedItem, index) => {
      const item = items[index] as Record<string, unknown>;
      const inquiryItem = inquiry.inquiryItems[index];
      return {
        index,
        productId: pricedItem.productId ?? (typeof item.productId === 'string' ? item.productId : inquiryItem?.productId),
        variantId: pricedItem.variantId
          ?? (typeof item.variantId === 'string' ? item.variantId : metadataVariantId(inquiryItem?.metadata)),
        name: String(item.name ?? inquiryItem?.name ?? pricedItem.name),
        spec: pricedItem.spec ?? (typeof item.spec === 'string' ? item.spec : null),
        catalogNumber: pricedItem.catalogNumber ?? (typeof item.catalogNumber === 'string' ? item.catalogNumber : inquiryItem?.catalogNumber),
        unitPrice: pricedItem.unitPrice,
        quantity: pricedItem.quantity,
      };
    }));
    const lineDecision = decideCommerceLineReview(lineReview, body.confirmWarnings);
    if (!lineDecision.ok) return NextResponse.json(lineDecision.body, { status: lineDecision.status });
    const variantIds = Array.from(new Set(priced.verifiedItems
      .map((item, position) => item.variantId
        || (typeof (items[position] as Record<string, unknown>).variantId === 'string'
          ? (items[position] as Record<string, unknown>).variantId as string
          : metadataVariantId(inquiry.inquiryItems[position]?.metadata)))
      .filter((variantId): variantId is string => Boolean(variantId))));
    const variants = variantIds.length
      ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, packageType: true, baseQuantity: true } })
      : [];
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const normalizedItems = priced.verifiedItems.map((pricedItem, position) => {
      const item = items[position] as Record<string, unknown>;
      const inquiryItem = inquiry.inquiryItems[position];
      const requestConstraint = readExplicitQuantityConstraint(item);
      const inquiryConstraint = readExplicitQuantityConstraint(metadataObject(inquiryItem?.metadata));
      const variantId = pricedItem.variantId
        || (typeof item.variantId === 'string' ? item.variantId : metadataVariantId(inquiryItem?.metadata));
      const variantConstraint = packageConstraintFromVariant(variantId ? variantsById.get(variantId) : null);
      return {
        inquiryItemId: inquiryItem?.id ?? null,
        position,
        productId: pricedItem.productId ?? (typeof item.productId === 'string' ? item.productId : inquiryItem?.productId),
        catalogNumber: pricedItem.catalogNumber ?? (typeof item.catalogNumber === 'string' ? item.catalogNumber : inquiryItem?.catalogNumber),
        name: String(item.name ?? inquiryItem?.name ?? 'Unknown'),
        unitPrice: pricedItem.unitPrice,
        quantity: pricedItem.quantity,
        lineTotal: pricedItem.lineTotal,
        leadTime: typeof item.actualLeadTime === 'string' ? item.actualLeadTime : typeof item.leadTime === 'string' ? item.leadTime : null,
        available: item.available !== false,
        notes: typeof item.notes === 'string' ? item.notes : null,
        metadata: mergeQuoteConstraintMetadata(inquiryItem?.metadata, {
          minQuantity: requestConstraint.minQuantity ?? inquiryConstraint.minQuantity ?? variantConstraint.minQuantity,
          quantityStep: requestConstraint.quantityStep ?? inquiryConstraint.quantityStep ?? variantConstraint.quantityStep,
        }, pricedItem.quantity),
        pricingSnapshot: pricedItem.pricingSnapshot,
      };
    });
    const sentAt = new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : new Date(sentAt.getTime() + 30 * 86400000);
    if (Number.isNaN(validUntil.getTime()) || validUntil <= sentAt) {
      return NextResponse.json({ error: 'validUntil must be a future date' }, { status: 400 });
    }
    const quote = await prisma.$transaction(async (tx) => {
      const claimed = await claimInquiryForQuotePublish(tx, id);
      if (claimed !== 1) {
        const decision = await assessInquiryQuotePublish(tx, id);
        throw new InquiryQuotePublishRejected(decision.ok
          ? { status: 409, code: 'INQUIRY_NOT_QUOTABLE', error: '询价状态已变化，请刷新后重试' }
          : decision);
      }
      const latest = await tx.quote.findFirst({ where: { inquiryId: id }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.quote.updateMany({ where: { inquiryId: id, status: { in: ['draft', 'sent'] } }, data: { status: 'superseded' } });
      const created = await tx.quote.create({
        data: {
          inquiryId: id,
          version: (latest?.version ?? 0) + 1,
          status: 'sent',
          subtotal: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
          validUntil,
          sentAt,
          createdBy: user.id,
          items: { create: normalizedItems },
        },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      await enqueueBackgroundTask('quote.expire', { quoteId: created.id }, {
        runAt: validUntil,
        priority: 10,
        dedupeKey: `quote-expire:${created.id}`,
      }, tx);
      await enqueueBackgroundTask('email.send', {
        kind: 'quote',
        to: inquiry.email,
        subject: 'LIBEREAL · 报价通知',
        message: '您的询价单已收到报价，请查看并确认产品。',
        path: '/account/inquiries',
      }, {
        priority: 5,
        dedupeKey: `quote-email:${created.id}`,
      }, tx);
      if (lineDecision.warnings.length > 0) {
        await writeAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: 'quote.warnings_confirmed',
          resource: 'inquiries',
          targetType: 'Quote',
          targetId: created.id,
          reason: '管理员确认报价核对警告后发布',
          metadata: {
            inquiryId: id,
            confirmWarnings: true,
            warnings: lineDecision.warnings,
          },
        }, tx);
      }
      return created;
    });

    await prisma.notification.create({
      data: {
        email: inquiry.email,
        role: 'customer',
        type: 'quote_received',
        title: '报价通知',
        content: '您的询价单已收到报价，请查看并确认产品',
        linkUrl: '/account/inquiries',
        metadata: JSON.stringify({ inquiryId: id }),
      },
    });

    const quoteTaxonomy = await loadQuoteProductTaxonomy(quote.items.map((item) => item.productId));
    return NextResponse.json({ success: true, quote: quoteView(quote, quoteTaxonomy) });
  } catch (err) {
    if (err instanceof InquiryQuotePublishRejected) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof Error && err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品需要确认品牌后再报价。' }, { status: 400 });
    }
    console.error('[inquiries/[id]/quote POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
