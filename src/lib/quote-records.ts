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
    items: quote.items.map((item) => {
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
