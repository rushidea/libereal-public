import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { quoteView } from '@/lib/quote-records';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, verifyAndPriceItems } from '@/lib/pricing';

function metadataBrand(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim() : null;
  } catch {
    return null;
  }
}

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
      quantity: Math.max(1, Number(item.quantity) || 1),
    })), { customerEmail: inquiry.email, manualAdjustments, allowManualAdjustment: true });
    const normalizedItems = priced.verifiedItems.map((pricedItem, position) => {
      const item = items[position] as Record<string, unknown>;
      const inquiryItem = inquiry.inquiryItems[position];
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
        pricingSnapshot: pricedItem.pricingSnapshot,
      };
    });
    const sentAt = new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : new Date(sentAt.getTime() + 30 * 86400000);
    if (Number.isNaN(validUntil.getTime()) || validUntil <= sentAt) {
      return NextResponse.json({ error: 'validUntil must be a future date' }, { status: 400 });
    }
    const quote = await prisma.$transaction(async (tx) => {
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
      await tx.inquiry.update({ where: { id }, data: { status: 'quote_sent' } });
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

    return NextResponse.json({ success: true, quote: quoteView(quote) });
  } catch (err) {
    if (err instanceof Error && err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品需要确认品牌后再报价。' }, { status: 400 });
    }
    console.error('[inquiries/[id]/quote POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
