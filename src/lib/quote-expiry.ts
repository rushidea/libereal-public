/** Inquiry status once its latest quote is past `validUntil` or already marked expired. */
export const QUOTE_EXPIRED_INQUIRY_STATUS = 'quote_expired';

export const DECLINABLE_INQUIRY_STATUSES = ['quote_sent', QUOTE_EXPIRED_INQUIRY_STATUS] as const;

export const DECLINABLE_QUOTE_STATUSES = ['sent', 'expired'] as const;

type QuoteExpiryShape = {
  status?: string | null;
  validUntil?: Date | string | null;
};

export function quoteValidUntilPassed(
  validUntil: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (validUntil == null || validUntil === '') return false;
  const at = validUntil instanceof Date ? validUntil : new Date(validUntil);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

/** A quote the customer can no longer accept: stored `expired`, or `sent` past `validUntil`. */
export function quoteIsExpired(quote: QuoteExpiryShape, now = new Date()): boolean {
  if (quote.status === 'expired') return true;
  return quote.status === 'sent' && quoteValidUntilPassed(quote.validUntil, now);
}

export function presentedQuoteStatus(quote: { status: string; validUntil?: Date | string | null }, now = new Date()): string {
  return quoteIsExpired(quote, now) ? 'expired' : quote.status;
}

/**
 * Read-time inquiry status. A `quote_sent` inquiry whose current quote has expired
 * is shown as `quote_expired` even before the row is lazily persisted.
 */
export function effectiveInquiryStatus(
  status: string,
  quote?: QuoteExpiryShape | null,
  now = new Date(),
): string {
  if (status === QUOTE_EXPIRED_INQUIRY_STATUS) return status;
  if (status === 'quote_sent' && quote && quoteIsExpired(quote, now)) return QUOTE_EXPIRED_INQUIRY_STATUS;
  return status;
}

export function customerCanDeclineQuote(input: {
  inquiryStatus: string;
  quote?: QuoteExpiryShape | null;
  historical?: boolean;
}): boolean {
  if (input.historical || !input.quote) return false;
  if (!DECLINABLE_INQUIRY_STATUSES.includes(input.inquiryStatus as (typeof DECLINABLE_INQUIRY_STATUSES)[number])) return false;
  const status = input.quote.status ?? '';
  return DECLINABLE_QUOTE_STATUSES.includes(status as (typeof DECLINABLE_QUOTE_STATUSES)[number]);
}

export function customerCanAcceptQuote(input: {
  inquiryStatus: string;
  quote?: QuoteExpiryShape | null;
  historical?: boolean;
  now?: Date;
}): boolean {
  if (input.historical || !input.quote) return false;
  if (input.inquiryStatus !== 'quote_sent') return false;
  return input.quote.status === 'sent' && !quoteValidUntilPassed(input.quote.validUntil, input.now ?? new Date());
}
