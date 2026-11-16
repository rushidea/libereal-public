import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { prepareSupplierQuoteReview, recordSupplierQuoteReply, supplierQuoteErrorMessage, supplierQuoteReviewView } from '@/lib/supplier-quote-review';
import type { Prisma } from '@prisma/client';
import { repriceQuotesAfterCatalogChange } from '@/lib/quote-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';

async function continueOriginalQuote(tx: Prisma.TransactionClient, inquiryId: string, reviewId: string, actor: { id: string; email: string }) {
  const task = await tx.backgroundTask.findUniqueOrThrow({ where: { id: reviewId } });
  const request = jsonObject(task.payload);
  const scope = request.scope as { inquiryItemId: string; quantity: number; productId: string; variantId?: string | null; catalogNumber: string; brand: string };
  const latest = await tx.quote.findFirst({ where: { inquiryId }, orderBy: { version: 'desc' } });
  if (!latest || !['draft', 'sent', 'accepted', 'expired'].includes(latest.status)) return null;
  const orders = await tx.order.findMany({ where: { inquiryId, archivedAt: null, status: { in: ['pending', 'unpaid'] } }, select: { id: true } });
  return repriceQuotesAfterCatalogChange(tx, {
    impact: { quoteIds: [latest.id], pendingOrderIds: orders.map(order => order.id), contents: [] },
    changes: [{ productId: scope.productId, variantId: scope.variantId, catalogNumber: scope.catalogNumber, brand: scope.brand }],
    // This is a source-bound quote review, not a new foundation-data approval.
    approvalHash: request.requestHash as string, supplierReviewId: reviewId,
    ...(request.quantityChange ? { quantityChange: { inquiryItemId: scope.inquiryItemId, quantity: scope.quantity } } : {}),
    operationKey: pricingContentHash({ kind: 'supplier_quote_review', reviewId, status: task.status, previousQuoteId: latest.id }), actor,
  });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin('inquiries.write');
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  try { return NextResponse.json({ entries: await supplierQuoteReviewView(prisma, id) }); }
  catch (error) { return NextResponse.json({ error: supplierQuoteErrorMessage(error) }, { status: 409 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin('inquiries.write');
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !['prepare', 'record_reply'].includes(String(body.action))) return NextResponse.json({ error: '询价操作无效' }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      if (body.action === 'prepare') {
        if (typeof body.inquiryItemId !== 'string' || !body.inquiryItemId
          || (body.renewalReason !== undefined && (typeof body.renewalReason !== 'string' || !body.renewalReason.trim() || body.renewalReason.length > 500))) {
          throw new Error('SUPPLIER_QUOTE_REPLY_INVALID');
        }
        if (body.quantity !== undefined && (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity))) throw new Error('SUPPLIER_QUOTE_QUANTITY_INVALID');
        const prepared = await prepareSupplierQuoteReview(tx, { inquiryId: id, inquiryItemId: body.inquiryItemId, quantity: body.quantity as number | undefined,
          actor, ...(body.quantityChange ? { quantityChange: body.quantityChange as Parameters<typeof prepareSupplierQuoteReview>[1]['quantityChange'] } : {}),
          ...(typeof body.renewalReason === 'string' ? { renewalReason: body.renewalReason } : {}) });
        const continuation = await continueOriginalQuote(tx, id, prepared.reviewId, actor);
        await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'inquiry.supplier_quote_prepared',
          resource: 'inquiries', targetType: 'Inquiry', targetId: id,
          after: { reviewId: prepared.reviewId, requestHash: prepared.requestHash, ownerId: actor.id, outboundSent: false },
          reason: '按已确认的目录价门槛准备人工供应商询价' }, tx);
        return { ...prepared, continuation };
      }
      if (typeof body.reviewId !== 'string' || typeof body.requestHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(body.requestHash)) throw new Error('SUPPLIER_QUOTE_REVIEW_CHANGED');
      const recorded = await recordSupplierQuoteReply(tx, { inquiryId: id, reviewId: body.reviewId,
        requestHash: body.requestHash, reply: body.reply, actor });
      const continuation = recorded.recorded ? await continueOriginalQuote(tx, id, recorded.reviewId, actor) : null;
      if (recorded.recorded) await writeAuditLog({ actorId: actor.id, actorEmail: actor.email,
        action: 'inquiry.supplier_quote_reply_confirmed', resource: 'inquiries', targetType: 'Inquiry', targetId: id,
        after: { reviewId: recorded.reviewId, replyHash: recorded.replyHash, inquiryItemId: recorded.inquiryItemId,
          continuation: 'original_inquiry_quote_preparation', customerMessageSent: false, purchaseApproved: false },
        reason: '人工核对供应商书面回复和本次客户报价，回填原询价并接续报价准备' }, tx);
      return { ...recorded, continuation };
    }, { timeout: 60_000 });
    return NextResponse.json({ result, entries: await supplierQuoteReviewView(prisma, id) });
  } catch (error) {
    return NextResponse.json({ error: supplierQuoteErrorMessage(error) }, { status: 409 });
  }
}
