import type { Prisma } from '@prisma/client';

type ItemRecord = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function itemName(item: ItemRecord): string {
  const product = item.product && typeof item.product === 'object'
    ? item.product as ItemRecord
    : null;
  return text(item.name) ?? text(product?.name) ?? 'Unknown';
}

export function toInquiryItemCreates(items: ItemRecord[]): Prisma.InquiryItemCreateWithoutInquiryInput[] {
  return items.map((item, position) => {
    const unitPrice = number(item.price) ?? number(item.unitPrice);
    const quantity = positiveInteger(item.quantity);
    const knownKeys = new Set([
      'productId', 'catalogNumber', 'name', 'product', 'price', 'unitPrice', 'clientPrice',
      'quantity', 'lineTotal', 'leadTime', 'actualLeadTime', 'available', 'ordered',
      'pricingSource', 'pricingSnapshot',
    ]);
    const metadata = Object.fromEntries(Object.entries(item).filter(([key]) => !knownKeys.has(key)));

    return {
      position,
      productId: text(item.productId),
      catalogNumber: text(item.catalogNumber),
      name: itemName(item),
      unitPrice,
      clientPrice: number(item.clientPrice),
      quantity,
      lineTotal: number(item.lineTotal) ?? (unitPrice == null ? null : unitPrice * quantity),
      leadTime: text(item.actualLeadTime) ?? text(item.leadTime),
      available: typeof item.available === 'boolean' ? item.available : null,
      ordered: item.ordered === true,
      pricingSource: text(item.pricingSource),
      metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    };
  });
}

export function toOrderItemCreates(items: ItemRecord[]): Prisma.OrderItemCreateWithoutOrderInput[] {
  return items.map((item, position) => ({
    position,
    productId: text(item.productId),
    catalogNumber: text(item.catalogNumber),
    name: itemName(item),
    brand: text(item.brand),
    unitPrice: number(item.price) ?? number(item.unitPrice) ?? 0,
    clientPrice: number(item.clientPrice),
    quantity: positiveInteger(item.quantity),
    shippedQty: nonNegativeInteger(item.shippedQty),
    leadTime: text(item.actualLeadTime) ?? text(item.leadTime),
    status: text(item.status) ?? 'pending',
    metadata: text(item.metadata),
    pricingSnapshot: text(item.pricingSnapshot),
  }));
}

type InquiryItemView = {
  productId: string | null;
  catalogNumber: string | null;
  name: string;
  unitPrice: number | null;
  clientPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  leadTime: string | null;
  available: boolean | null;
  ordered: boolean;
  pricingSource: string | null;
  metadata: string | null;
};

function customerLeadTimeFromMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return text(parsed.customerLeadTime);
  } catch {
    return null;
  }
}

type OrderItemView = {
  id: string;
  productId: string | null;
  catalogNumber: string | null;
  name: string;
  brand: string | null;
  unitPrice: number;
  clientPrice: number | null;
  quantity: number;
  shippedQty: number;
  leadTime: string | null;
  status: string;
  pricingSnapshot: string | null;
  metadata?: string | null;
};

export function inquiryItemView(item: InquiryItemView) {
  let variantId: string | null = null;
  let spec: string | null = null;
  let unit: string | null = null;
  if (item.metadata) {
    try {
      const metadata = JSON.parse(item.metadata) as Record<string, unknown>;
      variantId = text(metadata.variantId);
      spec = text(metadata.spec);
      unit = text(metadata.unit);
    } catch { /* malformed metadata is ignored */ }
  }
  return {
    productId: item.productId,
    catalogNumber: item.catalogNumber,
    name: item.name,
    price: item.unitPrice,
    clientPrice: item.clientPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
    leadTime: item.leadTime,
    customerLeadTime: customerLeadTimeFromMetadata(item.metadata),
    variantId,
    spec,
    unit,
    available: item.available,
    ordered: item.ordered,
    pricingSource: item.pricingSource,
  };
}

export function orderItemView(item: OrderItemView) {
  let variantId: string | null = null;
  let spec: string | null = null;
  let unit: string | null = null;
  if (item.metadata) {
    try {
      const metadata = JSON.parse(item.metadata) as Record<string, unknown>;
      variantId = text(metadata.variantId);
      spec = text(metadata.spec);
      unit = text(metadata.unit);
    } catch { /* malformed metadata is ignored */ }
  }
  return {
    id: item.id,
    productId: item.productId,
    catalogNumber: item.catalogNumber,
    name: item.name,
    brand: item.brand,
    price: item.unitPrice,
    clientPrice: item.clientPrice,
    quantity: item.quantity,
    shippedQty: item.shippedQty,
    leadTime: item.leadTime,
    status: item.status,
    pricingSnapshot: item.pricingSnapshot,
    metadata: item.metadata ?? null,
    variantId,
    spec,
    unit,
  };
}
