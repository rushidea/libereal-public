import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import type { PurchaseSource } from '@/lib/purchase-source';
import { documentSha256, PurchaseError, requiredText } from '@/lib/purchase-terms';
import { positiveQuantity, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

const identityFields = {
  id: true, catalogNumber: true, name: true, brand: true, spec: true, salesUnit: true,
  variants: { select: { id: true, catalogNumber: true, spec: true, salesUnit: true, packageType: true, baseQuantity: true } },
  inventoryAccounts: { select: { id: true, variantId: true } },
} as const;

export async function receiptInventoryOptions(tx: Db, source: PurchaseSource, contractVersion: string) {
  const approved = { productId: source.productId, variantId: source.variantId, brand: source.brand,
    catalogNumber: source.catalogNumber, spec: source.spec, unit: source.unit, contractVersion };
  const products = source.productId || (source.brand && source.catalogNumber && source.spec && source.unit)
    ? await tx.product.findMany({ where: source.productId ? { id: source.productId } : {
      brand: source.brand!, OR: [{ catalogNumber: source.catalogNumber! }, { variants: { some: { catalogNumber: source.catalogNumber! } } }],
    }, select: identityFields, orderBy: { id: 'asc' } }) : [];
  const candidates = products.flatMap(product => {
    const specifications: (typeof product.variants[number] | null)[] = source.productId
      ? source.variantId ? product.variants.filter(variant => variant.id === source.variantId) : [null]
      : product.variants.length ? product.variants : [null];
    return specifications.flatMap(variant => {
      const selection = { productId: product.id, variantId: variant?.id ?? null, name: product.name, brand: product.brand,
        catalogNumber: variant?.catalogNumber ?? product.catalogNumber, spec: variant?.spec ?? product.spec,
        unit: variant?.salesUnit ?? product.salesUnit, packageType: variant?.packageType ?? null, baseQuantity: variant?.baseQuantity ?? null };
      if (!source.productId && (selection.catalogNumber !== source.catalogNumber || selection.spec?.trim() !== source.spec?.trim()
        || selection.unit?.trim() !== source.unit?.trim())) return [];
      const accounts = product.inventoryAccounts.filter(row => row.variantId === selection.variantId).sort((a, b) => a.id.localeCompare(b.id));
      return (accounts.length ? accounts : [{ id: null }]).map(account => ({ ...selection, inventoryAccountId: account.id }));
    });
  }).sort((a, b) => a.productId.localeCompare(b.productId) || (a.variantId ?? '').localeCompare(b.variantId ?? '')
    || (a.inventoryAccountId ?? '').localeCompare(b.inventoryAccountId ?? ''));
  return { approved, candidates, version: pricingContentHash({ approved, candidates }) };
}

export function selectReceiptInventory(options: Awaited<ReturnType<typeof receiptInventoryOptions>>, selected: {
  productId: string | null; variantId: string | null; inventoryAccountId: string | null;
  identityReference: unknown; identitySha256: unknown; identityDocumentRow: unknown;
}, previousAccountId?: string) {
  const matches = options.candidates.filter(row => (!selected.productId || selected.productId === row.productId)
    && (!selected.variantId || selected.variantId === row.variantId)
    && (!selected.inventoryAccountId || selected.inventoryAccountId === row.inventoryAccountId)
    && (!previousAccountId || previousAccountId === row.inventoryAccountId));
  if (matches.length !== 1) throw new PurchaseError('请按已批准的品牌、货号、规格和单位核对实际库存账户');
  const account = matches[0];
  const evidence = options.candidates.length > 1 && !previousAccountId ? {
    reference: requiredText(selected.identityReference, '库存账户与批准商品的核对书证出处'),
    sha256: documentSha256(selected.identitySha256, '库存账户核对书证摘要'),
    row: positiveQuantity(selected.identityDocumentRow, '库存账户核对书证行号'),
  } : null;
  return { ...account, identity: { approved: options.approved, version: options.version, evidence } };
}
