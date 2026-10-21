import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { quoteView } from '@/lib/quote-records';
import { applySettledQuoteExpiry, settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import { loadQuoteProductTaxonomy } from '@/lib/quote-item-taxonomy';
import { viewInquiryItemGroups } from '@/lib/inquiry-item-brands';

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
    const settled = await settleExpiredQuotes(prisma, inquiries.map((inquiry) => inquiry.id));
    const visible = inquiries.map((inquiry) => applySettledQuoteExpiry(inquiry, settled));
    const itemViews = await viewInquiryItemGroups(visible.map((inquiry) => inquiry.inquiryItems));
    const quoteTaxonomy = await loadQuoteProductTaxonomy(visible.flatMap((inquiry) => (
      inquiry.quotes.flatMap((quote) => quote.items.map((item) => item.productId))
    )));
    return NextResponse.json(visible.map((row, index) => {
      const { inquiryItems, quotes, ...inquiry } = row;
      void inquiryItems;
      return {
        ...inquiry,
        items: itemViews[index],
        activeQuote: quotes[0] ? quoteView(quotes[0], quoteTaxonomy) : null,
        quoteVersions: quotes.map((quote) => quoteView(quote, quoteTaxonomy)),
      };
    }));
  } catch (err) {
    console.error('[inquiries GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
