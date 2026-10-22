import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { INQUIRY_LIST_SELECT } from '@/lib/prisma-selects';
import { quoteView } from '@/lib/quote-records';
import { viewInquiryItemGroups } from '@/lib/inquiry-item-brands';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const session = await requireAdmin('inquiries.read');
  if (session instanceof NextResponse) return session;

  try {
    const inquiries = await prisma.inquiry.findMany({
      where: { archivedAt: { not: null } },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: INQUIRY_LIST_SELECT,
    });
    const itemViews = await viewInquiryItemGroups(inquiries.map((inquiry) => inquiry.inquiryItems));
    return NextResponse.json({
      inquiries: inquiries.map((row, index) => {
        const { inquiryItems, quotes, ...inquiry } = row;
        void inquiryItems;
        return {
          ...inquiry,
          items: itemViews[index],
          activeQuote: quotes[0] ? quoteView(quotes[0]) : null,
        };
      }),
    });
  } catch (err) {
    console.error("[admin/inquiries/archived GET]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
