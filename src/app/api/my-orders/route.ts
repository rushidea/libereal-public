import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { inquiryItemView, orderItemView } from '@/lib/commerce-records';
import { quoteView } from '@/lib/quote-records';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import type { Prisma } from '@prisma/client';
import { getReadableOrganizationIds } from '@/lib/organization-record-access';
import { listOrganizationIdsForPermission } from '@/lib/organization-service';

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.user.id as string;
    const [readableOrganizationIds, orderCreatingOrganizationIds, inquiryCreatingOrganizationIds] = await Promise.all([
      getReadableOrganizationIds(userId),
      listOrganizationIdsForPermission(userId, 'organization.orders.create'),
      listOrganizationIdsForPermission(userId, 'organization.inquiries.create'),
    ]);
    const inquiryWhere: Prisma.InquiryWhereInput = {
    OR: [
        { ownerScope: 'personal', email, status: { not: 'closed' } },
        ...(readableOrganizationIds.length ? [{ ownerScope: 'organization', organizationId: { in: readableOrganizationIds } }] : []),
        ...(inquiryCreatingOrganizationIds.length ? [{ ownerScope: 'organization', userId, organizationId: { in: inquiryCreatingOrganizationIds } }] : []),
      ],
    };
    const orderWhere: Prisma.OrderWhereInput = {
      OR: [
        { ownerScope: 'personal', email },
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

    const inquiriesWithOrderCount = inquiries.map((inq) => ({
      ...inq,
      items: inq.inquiryItems.map(inquiryItemView),
      inquiryItems: undefined,
      activeQuote: inq.quotes[0] ? quoteView(inq.quotes[0]) : null,
      quotes: undefined,
      orderCount: countMap.get(inq.id) || 0,
    }));

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
