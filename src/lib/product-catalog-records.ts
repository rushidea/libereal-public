import type { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

function canonicalId(prefix: string, ...parts: Array<string | null | undefined>): string {
  const encoded = parts.map((part) => Buffer.from((part ?? '').trim(), 'utf8').toString('hex').toUpperCase());
  return `${prefix}:${encoded.join(':')}`;
}

export async function ensureProductTaxonomy(
  tx: TransactionClient,
  input: { brand: string; category: string | null; subcategory: string | null },
) {
  const brandId = canonicalId('brand', input.brand);
  await tx.brand.upsert({
    where: { id: brandId },
    update: { name: input.brand },
    create: { id: brandId, name: input.brand },
  });

  let categoryId: string | null = null;
  let subcategoryId: string | null = null;
  if (input.category) {
    categoryId = canonicalId('category', input.category);
    await tx.productCategory.upsert({
      where: { id: categoryId },
      update: { name: input.category },
      create: { id: categoryId, name: input.category },
    });
  }
  if (input.category && input.subcategory && categoryId) {
    subcategoryId = canonicalId('subcategory', input.category, input.subcategory);
    await tx.productCategory.upsert({
      where: { id: subcategoryId },
      update: { name: input.subcategory, parentId: categoryId },
      create: { id: subcategoryId, name: input.subcategory, parentId: categoryId },
    });
  }

  return { brandId, categoryId, subcategoryId };
}

type GeneratedProductRecords = {
  target: string | null;
  host: string | null;
  cloneNumber: string | null;
  purity: string | null;
  concentration: string | null;
  applications: string[];
  reactivity: string[];
  cofaUrl: string | null;
  sdsUrl: string | null;
};

export async function replaceGeneratedProductRecords(
  tx: TransactionClient,
  productId: string,
  input: GeneratedProductRecords,
) {
  await tx.productAttribute.deleteMany({ where: { productId, source: 'product_fields' } });
  await tx.productDocument.deleteMany({ where: { productId, source: 'product_fields' } });

  const attributes = [
    ['target', '靶点', input.target],
    ['host', '宿主', input.host],
    ['cloneNumber', '克隆号', input.cloneNumber],
    ['purity', '纯度', input.purity],
    ['concentration', '浓度', input.concentration],
    ...input.applications.map((value) => ['application', '应用', value]),
    ...input.reactivity.map((value) => ['reactivity', '反应种属', value]),
  ].filter((record): record is string[] => Boolean(record[2]));

  if (attributes.length) {
    await tx.productAttribute.createMany({
      data: attributes.map(([key, label, value], sortOrder) => ({
        productId,
        key,
        label,
        value,
        normalizedValue: value.trim().toLocaleLowerCase(),
        source: 'product_fields',
        sortOrder,
      })),
    });
  }

  const documents = [
    input.cofaUrl ? { type: 'coa', title: '分析证书 CoA', url: input.cofaUrl } : null,
    input.sdsUrl ? { type: 'sds', title: '安全数据表 SDS', url: input.sdsUrl } : null,
  ].filter((document): document is { type: string; title: string; url: string } => Boolean(document));

  if (documents.length) {
    await tx.productDocument.createMany({
      data: documents.map((document, sortOrder) => ({
        productId,
        ...document,
        source: 'product_fields',
        sortOrder,
      })),
    });
  }
}

type PriceSnapshot = {
  price: number;
  originalPrice: number | null;
  promotionalPrice: number | null;
  costPrice: number | null;
  minimumSalePrice: number | null;
};

export async function recordProductPriceChanges(
  tx: TransactionClient,
  productId: string,
  previous: PriceSnapshot,
  next: PriceSnapshot,
  actorId: string | null,
) {
  const kinds: Array<[keyof PriceSnapshot, string]> = [
    ['price', 'list'],
    ['originalPrice', 'original'],
    ['promotionalPrice', 'promotion'],
    ['costPrice', 'cost'],
    ['minimumSalePrice', 'minimum_sale'],
  ];
  const changed = kinds.flatMap(([field, kind]) => {
    const amount = next[field];
    return previous[field] !== amount && amount != null
      ? [{ productId, kind, amount, source: 'admin', createdBy: actorId }]
      : [];
  });
  if (changed.length) await tx.productPrice.createMany({ data: changed });
}
