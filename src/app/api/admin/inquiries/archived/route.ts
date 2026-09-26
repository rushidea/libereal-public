import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { INQUIRY_LIST_SELECT } from '@/lib/prisma-selects';
import { inquiryItemView } from '@/lib/commerce-records';
import { quoteView } from '@/lib/quote-records';

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
    return NextResponse.json({
      inquiries: inquiries.map(({ inquiryItems, quotes, ...inquiry }) => ({
        ...inquiry,
        items: inquiryItems.map(inquiryItemView),
        activeQuote: quotes[0] ? quoteView(quotes[0]) : null,
      })),
    });
  } catch (err) {
    console.error("[admin/inquiries/archived GET]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
