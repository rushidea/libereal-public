import { Prisma, type PrismaClient } from '@prisma/client';
import { QUOTE_EXPIRED_INQUIRY_STATUS, quoteValidUntilPassed } from '@/lib/quote-expiry';

type QuoteDb = Prisma.TransactionClient | PrismaClient;

export type SettledQuoteExpiry = {
  expiredQuoteIds: string[];
  expiredInquiryIds: string[];
};

export const EMPTY_SETTLED_QUOTE_EXPIRY: SettledQuoteExpiry = {
  expiredQuoteIds: [],
  expiredInquiryIds: [],
};

type SettleQuote = {
  id: string;
  inquiryId: string;
  version: number;
  status: string;
  validUntil: Date | null;
  inquiry: { email: string };
};

/**
 * Mark sent quotes past `validUntil` as expired and move their inquiry from
 * `quote_sent` to `quote_expired` when the latest quote is expired.
 * Does not add a scheduler; callers are reads, decline/accept, and the existing quote.expire task.
 * A notification is written only for a quote that this call actually flips from sent to expired.
 */
export async function settleExpiredQuotes(
  db: QuoteDb,
  inquiryIds: string[],
  now = new Date(),
): Promise<SettledQuoteExpiry> {
  const ids = [...new Set(inquiryIds.filter((id) => id))];
  if (ids.length === 0) return EMPTY_SETTLED_QUOTE_EXPIRY;
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => settleWithin(tx, ids, now));
  }
  return settleWithin(db, ids, now);
}

async function settleWithin(
  tx: Prisma.TransactionClient,
  inquiryIds: string[],
  now: Date,
): Promise<SettledQuoteExpiry> {
  const quotes = await tx.quote.findMany({
    where: { inquiryId: { in: inquiryIds } },
    orderBy: [{ inquiryId: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      inquiryId: true,
      version: true,
      status: true,
      validUntil: true,
      inquiry: { select: { email: true } },
    },
  });

  const latestByInquiry = new Map<string, SettleQuote>();
  const due: SettleQuote[] = [];
  for (const quote of quotes) {
    if (!latestByInquiry.has(quote.inquiryId)) latestByInquiry.set(quote.inquiryId, quote);
    if (quote.status === 'sent' && quoteValidUntilPassed(quote.validUntil, now)) due.push(quote);
  }

  const expiredQuoteIds: string[] = [];
  for (const quote of due) {
    const flipped = await tx.quote.updateMany({
      where: { id: quote.id, status: 'sent' },
      data: { status: 'expired' },
    });
    if (flipped.count !== 1) continue;
    expiredQuoteIds.push(quote.id);
    await tx.notification.create({
      data: {
        email: quote.inquiry.email,
        role: 'customer',
        type: 'quote_expired',
        title: '报价已过期',
        content: `询价单的第 ${quote.version} 版报价已过期`,
        linkUrl: '/account/inquiries',
        metadata: JSON.stringify({ inquiryId: quote.inquiryId, quoteId: quote.id }),
      },
    });
  }

  const flippedIds = new Set(expiredQuoteIds);
  const candidateInquiryIds = [...latestByInquiry.entries()]
    .filter(([, latest]) => (flippedIds.has(latest.id) ? 'expired' : latest.status) === 'expired')
    .map(([inquiryId]) => inquiryId);
  if (candidateInquiryIds.length === 0) {
    return { expiredQuoteIds, expiredInquiryIds: [] };
  }

  const waiting = await tx.inquiry.findMany({
    where: { id: { in: candidateInquiryIds }, status: 'quote_sent' },
    select: { id: true },
  });
  const expiredInquiryIds = waiting.map((inquiry) => inquiry.id);
  if (expiredInquiryIds.length > 0) {
    await tx.inquiry.updateMany({
      where: { id: { in: expiredInquiryIds }, status: 'quote_sent' },
      data: { status: QUOTE_EXPIRED_INQUIRY_STATUS },
    });
  }
  return { expiredQuoteIds, expiredInquiryIds };
}

export function applySettledQuoteExpiry<
  TQuote extends { id: string; status: string },
  TInquiry extends { id: string; status: string; quotes: TQuote[] },
>(inquiry: TInquiry, settled: SettledQuoteExpiry): TInquiry {
  const expiredQuotes = new Set(settled.expiredQuoteIds);
  const inquiryExpired = settled.expiredInquiryIds.includes(inquiry.id);
  if (!inquiryExpired && !inquiry.quotes.some((quote) => expiredQuotes.has(quote.id))) return inquiry;
  return {
    ...inquiry,
    status: inquiryExpired ? QUOTE_EXPIRED_INQUIRY_STATUS : inquiry.status,
    quotes: inquiry.quotes.map((quote) => (
      expiredQuotes.has(quote.id) ? { ...quote, status: 'expired' } : quote
    )),
  };
}
