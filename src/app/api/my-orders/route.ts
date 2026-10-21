import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { orderItemView } from '@/lib/commerce-records';
import { viewInquiryItemGroups } from '@/lib/inquiry-item-brands';
import { quoteView } from '@/lib/quote-records';
import { applySettledQuoteExpiry, settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import { loadQuoteProductTaxonomy } from '@/lib/quote-item-taxonomy';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import type { Prisma } from '@prisma/client';
import { getReadableOrganizationIds } from '@/lib/organization-record-access';
import { listOrganizationIdsForPermission } from '@/lib/organization-service';
import { verifiedStoredEmail } from '@/lib/verified-email-access';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const identity = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const verifiedEmail = verifiedStoredEmail(identity);
    const [readableOrganizationIds, orderCreatingOrganizationIds, inquiryCreatingOrganizationIds] = await Promise.all([
      getReadableOrganizationIds(userId),
      listOrganizationIdsForPermission(userId, 'organization.orders.create'),
      listOrganizationIdsForPermission(userId, 'organization.inquiries.create'),
    ]);
    const inquiryWhere: Prisma.InquiryWhereInput = {
    OR: [
        { ownerScope: 'personal', userId, status: { not: 'closed' } },
        ...(verifiedEmail ? [{ ownerScope: 'personal' as const, email: verifiedEmail, status: { not: 'closed' as const } }] : []),
        ...(readableOrganizationIds.length ? [{ ownerScope: 'organization', organizationId: { in: readableOrganizationIds } }] : []),
        ...(inquiryCreatingOrganizationIds.length ? [{ ownerScope: 'organization', userId, organizationId: { in: inquiryCreatingOrganizationIds } }] : []),
      ],
    };
    const orderWhere: Prisma.OrderWhereInput = {
      OR: [
        { ownerScope: 'personal', customerId: userId },
        ...(verifiedEmail ? [{ ownerScope: 'personal' as const, email: verifiedEmail }] : []),
        ...(readableOrganizationIds.length ? [{ ownerScope: 'organization', organizationId: { in: readableOrganizationIds } }] : []),
        ...(orderCreatingOrganizationIds.length ? [{ ownerScope: 'organization', customerId: userId, organizationId: { in: orderCreatingOrganizationIds } }] : []),
      ],
    };
    const [inquiries, orders] = await Promise.all([
      prisma.inquiry.findMany({
        where: inquiryWhere,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          inquiryItems: { orderBy: { position: 'asc' } },
          quotes: { orderBy: { version: 'desc' }, take: 1, include: { items: { orderBy: { position: 'asc' } } } },
        },
      }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          orderItems: { orderBy: { position: 'asc' } },
          paymentAttempts: { where: { provider: 'alipay' }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    // Add orderCount to each inquiry
    const inquiryIds = inquiries.map((i) => i.id);
    const orderCounts = inquiryIds.length
      ? await prisma.order.groupBy({
          by: ['inquiryId'],
          where: { inquiryId: { in: inquiryIds } },
          _count: { _all: true },
        })
      : [];
    const countMap = new Map(orderCounts.map((c) => [c.inquiryId, c._count._all]));

    const settled = await settleExpiredQuotes(prisma, inquiries.map((inquiry) => inquiry.id));
    const visibleInquiries = inquiries.map((inquiry) => applySettledQuoteExpiry(inquiry, settled));
    const inquiryItemViews = await viewInquiryItemGroups(visibleInquiries.map((inq) => inq.inquiryItems));
    const quoteTaxonomy = await loadQuoteProductTaxonomy(visibleInquiries.flatMap((inquiry) => (
      inquiry.quotes.flatMap((quote) => quote.items.map((item) => item.productId))
    )));
    const inquiriesWithOrderCount = visibleInquiries.map((inq, index) => {
      const { userId: creatorUserId, inquiryItems, quotes, ...publicInquiry } = inq;
      void creatorUserId;
      void inquiryItems;
      return {
        ...publicInquiry,
        items: inquiryItemViews[index],
        inquiryItems: undefined,
        activeQuote: quotes[0] ? quoteView(quotes[0], quoteTaxonomy) : null,
        quotes: undefined,
        orderCount: countMap.get(inq.id) || 0,
      };
    });

    return NextResponse.json({
      inquiries: inquiriesWithOrderCount,
      orders: orders.map(({ orderItems, paymentAttempts, ...order }) => ({
        ...order,
        items: orderItems.map(orderItemView),
        payment: getAlipayPaymentSummary(order, paymentAttempts[0]),
      })),
    });
  } catch (err) {
    console.error('[my-orders GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
