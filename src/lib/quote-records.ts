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
  createdAt: Date;
  items: QuoteItemRecord[];
};

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
    createdAt: quote.createdAt,
    items: quote.items.map((item) => ({
      id: item.id,
      inquiryItemId: item.inquiryItemId,
      productId: item.productId,
      catalogNumber: item.catalogNumber,
      name: item.name,
      price: item.unitPrice,
      quantity: item.quantity,
      orderedQty: item.orderedQty,
      lineTotal: item.lineTotal,
      leadTime: item.leadTime,
      available: item.available,
      notes: item.notes,
      ordered: item.orderedQty >= item.quantity,
    })),
  };
}
