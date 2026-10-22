import { effectiveQuoteQuantityConstraint } from '@/lib/quote-acceptance';

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  sent: '已发送',
  accepted: '已接受',
  superseded: '已替代',
  expired: '已过期',
  declined: '已放弃',
};

type QuoteItemRecord = {
  id: string;
  inquiryItemId: string | null;
  productId: string | null;
  catalogNumber: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  orderedQty: number;
  lineTotal: number;
  leadTime: string | null;
  available: boolean;
  notes: string | null;
  metadata?: string | null;
};

export type QuoteRecord = {
  id: string;
  version: number;
  status: string;
  subtotal: number;
  currency: string;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declineReasonCode?: string | null;
  declineNote?: string | null;
  declinedAt?: Date | null;
  declinedByUserId?: string | null;
  declinedByEmail?: string | null;
  createdAt: Date;
  items: QuoteItemRecord[];
};

// Decline fields are returned only by reads that already authorize the caller:
// GET /api/inquiries — admin inquiries.read
// GET /api/inquiries/[id] — personal owner, organization record access, or admin inquiries.read
// GET /api/my-orders — logged-in account (own records, or organization visibility already applied by that route)
export function quoteView(quote: QuoteRecord) {
  return {
    id: quote.id,
    version: quote.version,
    status: quote.status,
    subtotal: quote.subtotal,
    currency: quote.currency,
    validUntil: quote.validUntil,
    sentAt: quote.sentAt,
    acceptedAt: quote.acceptedAt,
    declineReasonCode: quote.declineReasonCode ?? null,
    declineNote: quote.declineNote ?? null,
    declinedAt: quote.declinedAt ?? null,
    declinedByUserId: quote.declinedByUserId ?? null,
    declinedByEmail: quote.declinedByEmail ?? null,
    createdAt: quote.createdAt,
    items: quote.items.map((item) => {
      const constraint = effectiveQuoteQuantityConstraint(item.quantity, item.metadata);
      let variantId: string | null = null;
      let spec: string | null = null;
      let unit: string | null = null;
      try {
        const metadata = item.metadata ? JSON.parse(item.metadata) as Record<string, unknown> : {};
        variantId = typeof metadata.variantId === 'string' ? metadata.variantId : null;
        spec = typeof metadata.spec === 'string' ? metadata.spec : null;
        unit = typeof metadata.unit === 'string' ? metadata.unit : null;
      } catch { /* malformed metadata is ignored */ }
      return {
        id: item.id,
        inquiryItemId: item.inquiryItemId,
        productId: item.productId,
        catalogNumber: item.catalogNumber,
        name: item.name,
        price: item.unitPrice,
        quantity: item.quantity,
        orderedQty: item.orderedQty,
        minQuantity: constraint.minQuantity,
        quantityStep: constraint.quantityStep,
        lineTotal: item.lineTotal,
        leadTime: item.leadTime,
        available: item.available,
        notes: item.notes,
        metadata: item.metadata ?? null,
        variantId,
        spec,
        unit,
        ordered: item.orderedQty >= item.quantity,
      };
    }),
  };
}
