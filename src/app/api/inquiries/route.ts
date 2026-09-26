import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { inquiryItemView } from '@/lib/commerce-records';
import { quoteView } from '@/lib/quote-records';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const admin = await requireAdmin('inquiries.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const inquiries = await prisma.inquiry.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        institution: true,
        department: true,
        address: true,
        notes: true,
        paymentMethod: true,
        leadTime: true,
        operationLogs: true,
        userId: true,
        organizationId: true,
        ownerScope: true,
        status: true,
        subtotal: true,
        inquiryItems: { orderBy: { position: 'asc' } },
        quotes: { orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } },
        createdAt: true,
        archivedAt: true,
      },
    });
    return NextResponse.json(inquiries.map(({ inquiryItems, quotes, ...inquiry }) => ({
      ...inquiry,
      items: inquiryItems.map(inquiryItemView),
      activeQuote: quotes[0] ? quoteView(quotes[0]) : null,
      quoteVersions: quotes.map(quoteView),
    })));
  } catch (err) {
    console.error('[inquiries GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
