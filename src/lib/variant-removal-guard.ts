import type { Prisma } from '@prisma/client';

export const VARIANT_REMOVAL_BLOCKED = 'VARIANT_REMOVAL_BLOCKED';

export const VARIANT_REMOVAL_REASONS = ['inventory', 'order', 'inquiry', 'quote', 'cart'] as const;

export type VariantRemovalReason = (typeof VARIANT_REMOVAL_REASONS)[number];

const REASON_LABEL: Record<VariantRemovalReason, string> = {
  inventory: '库存记录',
  order: '订单',
  inquiry: '询价',
  quote: '报价',
  cart: '购物车',
};

export type VariantRemovalCandidate = {
  id: string;
  catalogNumber: string;
  spec: string;
};

export type BlockedVariantRemoval = {
  id: string;
  catalogNumber: string;
  spec: string;
  reasons: VariantRemovalReason[];
};

export type VariantRemovalEvidence = {
  inventoryVariantIds: Iterable<string | null | undefined>;
  orderMetadata: Iterable<string | null | undefined>;
  inquiryMetadata: Iterable<string | null | undefined>;
  quoteMetadata: Iterable<string | null | undefined>;
  cartItems: Iterable<string | null | undefined>;
};

export class VariantRemovalBlockedError extends Error {
  readonly code = VARIANT_REMOVAL_BLOCKED;

  constructor(readonly blocked: BlockedVariantRemoval[]) {
    super(formatVariantRemovalBlockedMessage(blocked));
    this.name = 'VariantRemovalBlockedError';
  }
}

function describeReasons(reasons: VariantRemovalReason[]): string {
  const hasInventory = reasons.includes('inventory');
  const references = reasons
    .filter((reason) => reason !== 'inventory')
    .map((reason) => REASON_LABEL[reason]);
  const parts: string[] = [];
  if (hasInventory) parts.push('已有库存记录');
  if (references.length > 0) parts.push(`被${references.join('、')}引用`);
  return parts.join('，');
}

export function formatVariantRemovalBlockedMessage(blocked: BlockedVariantRemoval[]): string {
  const details = blocked.map((item) => {
    const name = item.spec ? `${item.catalogNumber}（${item.spec}）` : item.catalogNumber;
    return `规格 ${name}${describeReasons(item.reasons)}`;
  }).join('；');
  const pronoun = blocked.length > 1 ? '这些规格' : '该规格';
  return `无法保存，本次修改已全部取消。${details}。${pronoun}不能删除，请重新打开商品并保留${pronoun}后再保存。`;
}

export function variantIdFromItemMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { variantId?: unknown };
    return typeof parsed.variantId === 'string' && parsed.variantId.trim() ? parsed.variantId.trim() : null;
  } catch {
    return null;
  }
}

function addId(ids: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) ids.add(value.trim());
}

/** 购物车 JSON 里指向某个规格的 id。包含当前 variantId、旧数据里写在 product.id 上的规格 id，以及只带一个包装时的那条规格。 */
export function variantIdsReferencedByCart(itemsJson: string | null | undefined): string[] {
  if (!itemsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const product = (raw as { product?: unknown }).product;
    if (!product || typeof product !== 'object') continue;
    const record = product as { variantId?: unknown; id?: unknown; variants?: unknown };
    addId(ids, record.variantId);
    addId(ids, record.id);
    if (!record.variantId && Array.isArray(record.variants) && record.variants.length === 1) {
      const only = record.variants[0];
      if (only && typeof only === 'object') addId(ids, (only as { id?: unknown }).id);
    }
  }
  return [...ids];
}

function noteReason(
  reasonsById: Map<string, Set<VariantRemovalReason>>,
  removedIds: Set<string>,
  variantId: string | null,
  reason: VariantRemovalReason,
) {
  if (!variantId || !removedIds.has(variantId)) return;
  const reasons = reasonsById.get(variantId) ?? new Set<VariantRemovalReason>();
  reasons.add(reason);
  reasonsById.set(variantId, reasons);
}

export function findBlockedVariantRemovals(
  removed: VariantRemovalCandidate[],
  evidence: VariantRemovalEvidence,
): BlockedVariantRemoval[] {
  const removedIds = new Set(removed.map((item) => item.id));
  const reasonsById = new Map<string, Set<VariantRemovalReason>>();

  for (const variantId of evidence.inventoryVariantIds) {
    noteReason(reasonsById, removedIds, variantId ?? null, 'inventory');
  }
  for (const metadata of evidence.orderMetadata) {
    noteReason(reasonsById, removedIds, variantIdFromItemMetadata(metadata), 'order');
  }
  for (const metadata of evidence.inquiryMetadata) {
    noteReason(reasonsById, removedIds, variantIdFromItemMetadata(metadata), 'inquiry');
  }
  for (const metadata of evidence.quoteMetadata) {
    noteReason(reasonsById, removedIds, variantIdFromItemMetadata(metadata), 'quote');
  }
  for (const items of evidence.cartItems) {
    for (const variantId of variantIdsReferencedByCart(items)) {
      noteReason(reasonsById, removedIds, variantId, 'cart');
    }
  }

  return removed.flatMap((item) => {
    const reasons = reasonsById.get(item.id);
    if (!reasons || reasons.size === 0) return [];
    return [{
      ...item,
      reasons: VARIANT_REMOVAL_REASONS.filter((reason) => reasons.has(reason)),
    }];
  });
}

function containsAny(ids: string[], field: 'metadata' | 'items') {
  return ids.map((id) => ({ [field]: { contains: id } }));
}

export async function assertVariantsCanBeRemoved(
  tx: Prisma.TransactionClient,
  removed: VariantRemovalCandidate[],
): Promise<void> {
  if (removed.length === 0) return;
  const ids = removed.map((item) => item.id);
  // 管理端保存走 SQLite 单连接事务，引用检查必须串行，不能并发查询。
  const accounts = await tx.inventoryAccount.findMany({
    where: { variantId: { in: ids } },
    select: { variantId: true },
  });
  const orderItems = await tx.orderItem.findMany({
    where: { OR: containsAny(ids, 'metadata') },
    select: { metadata: true },
  });
  const inquiryItems = await tx.inquiryItem.findMany({
    where: { OR: containsAny(ids, 'metadata') },
    select: { metadata: true },
  });
  const quoteItems = await tx.quoteItem.findMany({
    where: { OR: containsAny(ids, 'metadata') },
    select: { metadata: true },
  });
  const carts = await tx.cart.findMany({
    where: { OR: containsAny(ids, 'items') },
    select: { items: true },
  });

  const blocked = findBlockedVariantRemovals(removed, {
    inventoryVariantIds: accounts.map((account) => account.variantId),
    orderMetadata: orderItems.map((item) => item.metadata),
    inquiryMetadata: inquiryItems.map((item) => item.metadata),
    quoteMetadata: quoteItems.map((item) => item.metadata),
    cartItems: carts.map((cart) => cart.items),
  });
  if (blocked.length > 0) throw new VariantRemovalBlockedError(blocked);
}
