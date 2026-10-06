import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import {
  getCstBaseCatalogNumber,
  isCstCatalogSizeSibling,
  usesCatalogPrefixVariantFallback,
} from '@/lib/product-variant-lookup';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import { attachDisplayPrice, attachDisplayPrices, attachVariantsDisplayPrice, resolveIsFormalMember } from '@/lib/product-display';
import { getProductDisplayPrice } from '@/lib/product-pricing';
import { getProductImageUrl } from '@/lib/productImage';
import JsonLd from '@/components/JsonLd';
import { buildBreadcrumbListJsonLd, buildProductJsonLd } from '@/lib/seo/json-ld';
import { productCanonicalPath } from '@/lib/seo/public-urls';
import { noindexFollowRobots } from '@/lib/seo/robots';
import { canonicalSiteUrl } from '@/lib/site-url';
import ProductDetailClient from './ProductDetailClient';
import { Product } from '@/types/Product';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { productCategories } from '@/data/categories';

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ brand?: string }>;
}

const productDetailSelect = {
  id: true,
  catalogNumber: true,
  name: true,
  brand: true,
  subBrand: true,
  price: true,
  originalPrice: true,
  promotionalPrice: true,
  promotion: true,
  category: true,
  subcategory: true,
  type: true,
  spec: true,
  salesUnit: true,
  target: true,
  host: true,
  applications: true,
  reactivity: true,
  description: true,
  specificity: true,
  productUsage: true,
  speciesReactivity: true,
  speciesPredicted: true,
  inStock: true,
  stockQuantity: true,
  leadTime: true,
  imageUrl: true,
  casNumber: true,
  pricingMode: true,
  hazardous: true,
  cloneNumber: true,
  purity: true,
  molecularWeight: true,
  isoelectricPoint: true,
  concentration: true,
  cofaUrl: true,
  sdsUrl: true,
  pmids: true,
  storageTemp: true,
  storageBuffer: true,
  expiryDate: true,
  lotNumber: true,
  // costPrice: false — admin only
} satisfies Prisma.ProductSelect;

type ProductDetailRecord = Prisma.ProductGetPayload<{ select: typeof productDetailSelect }>;
type ProductChoice = Pick<ProductDetailRecord, 'id' | 'brand' | 'catalogNumber' | 'name'>;

async function findProductForDetail(id: string, brand?: string): Promise<{
  product: ProductDetailRecord | null;
  choices: ProductChoice[];
}> {
  const productById = await prisma.product.findUnique({
    where: { id },
    select: productDetailSelect,
  });

  if (productById && !productById.hazardous && (!brand || productById.brand === brand)) {
    return { product: productById, choices: [] };
  }

  const products = await prisma.product.findMany({
    where: {
      hazardous: false,
      ...(brand ? { brand } : {}),
      catalogNumber: id,
    },
    orderBy: { createdAt: 'asc' },
    ...(brand ? { take: 1 } : {}),
    select: productDetailSelect,
  });

  if (!brand && products.length > 1) {
    return {
      product: null,
      choices: products.map((product) => ({
        id: product.id,
        brand: product.brand,
        catalogNumber: product.catalogNumber,
        name: product.name,
      })),
    };
  }

  return { product: products[0] ?? null, choices: [] };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { brand } = await searchParams;
  const { product, choices } = await findProductForDetail(id, brand);

  if (choices.length > 0) {
    return {
      title: { absolute: `${id} | 选择品牌` },
      description: `货号 ${id} 对应多个品牌，请选择品牌后查看产品详情。`,
      robots: noindexFollowRobots,
    };
  }

  if (!product) notFound();

  const title = `${product.name} | ${product.brand} Cat#${product.catalogNumber}`;
  const description =
    product.description?.trim() ||
    `${product.brand} ${product.name}（货号 ${product.catalogNumber}）${product.category ? `，${product.category}` : ''}${product.target ? `，靶点 ${product.target}` : ''}。LIBEREAL 生物试剂采购平台。`;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalSiteUrl(productCanonicalPath(product.catalogNumber, product.brand)),
    },
  };
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { brand } = await searchParams;

  const { product, choices } = await findProductForDetail(id, brand);

  if (choices.length > 0) {
    return (
      <div className="min-h-screen libereal-service-page flex flex-col">
        <AdaptiveHeader showNav={false} showProductNav productCategories={productCategories} />
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/80 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">请选择品牌</h2>
            <p className="text-sm text-gray-500 mb-5">货号 {id} 对应多个品牌。</p>
            <div className="space-y-2">
              {choices.map((choice) => (
                <Link
                  key={choice.id}
                  href={`/products/${encodeURIComponent(choice.catalogNumber)}?brand=${encodeURIComponent(choice.brand)}`}
                  className="block rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm transition-colors hover:border-brand-200 hover:bg-brand-50"
                >
                  <span className="block font-medium text-gray-800">{choice.brand}</span>
                  <span className="mt-1 block text-xs text-gray-500">{choice.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) notFound();

  // Extract base SKU and find all variants
  // CST: T/S/L suffix via catalog prefix fallback; Biosharp etc.: ProductVariant table only.
  // Labselect must not use startsWith(catalogNumber) — it merges unrelated SKUs
  // (FT-10 → FT-100/FT-1000, FT-1000 → FT-1000W).
  const baseSku = usesCatalogPrefixVariantFallback(product.brand)
    ? getCstBaseCatalogNumber(product.catalogNumber)
    : product.catalogNumber;

  // 1) Try ProductVariant table (Biosharp merged variants)
  const productVariants = await prisma.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { catalogNumber: 'asc' },
    select: {
      id: true,
      catalogNumber: true,
      spec: true,
      price: true,
      originalPrice: true,
      promotionalPrice: true,
      salesUnit: true,
      inventoryAccounts: {
        select: { availableQuantity: true },
        take: 1,
      },
    },
  });

  let variants: Array<{
    id: string;
    variantId?: string;
    name: string;
    catalogNumber: string;
    brand: string;
    price: number;
    category: string | null;
    subcategory: string | null;
    type: string | null;
    spec: string | null;
    target: string | null;
    host: string | null;
    applications: string;
    reactivity: string;
    description: string | null;
    inStock: boolean;
    originalPrice: number | null;
    promotionalPrice: number | null;
    promotion: boolean;
    subBrand: string | null;
    hazardous: boolean;
    salesUnit: string | null;
    stockQuantity: number;
    leadTime: string | null;
  }> = [];

  if (productVariants.length > 0) {
    // ProductVariant rows: build Product-like records sharing main product fields
    variants = productVariants.map((v) => {
      const stockQuantity = v.inventoryAccounts[0]?.availableQuantity ?? product.stockQuantity;
      return {
      id: v.id,
      variantId: v.id,
      name: product.name,
      catalogNumber: v.catalogNumber,
      brand: product.brand,
      price: v.price,
      category: product.category,
      subcategory: product.subcategory,
      type: product.type,
      spec: v.spec || product.spec,
      target: product.target,
      host: product.host,
      applications: product.applications,
      reactivity: product.reactivity,
      description: product.description,
      inStock: product.inStock && stockQuantity !== 0,
      originalPrice: v.originalPrice,
      promotionalPrice: v.promotionalPrice ?? product.promotionalPrice,
      promotion: product.promotion,
      subBrand: product.subBrand,
      hazardous: product.hazardous,
      salesUnit: v.salesUnit ?? product.salesUnit,
      stockQuantity,
      leadTime: product.leadTime,
    };
    });
  } else if (usesCatalogPrefixVariantFallback(product.brand)) {
    // 2) CST only: startsWith base SKU, then keep T/S/L size siblings
    const rows = await prisma.product.findMany({
      where: {
        catalogNumber: { startsWith: baseSku },
        brand: product.brand,
        ...STOREFRONT_HIDDEN_HAZARDOUS,
      },
      orderBy: { catalogNumber: 'asc' },
    });
    variants = rows.filter((row) =>
      isCstCatalogSizeSibling(product.catalogNumber, row.catalogNumber),
    );
  }

  const parsedProduct: Product = {
    id: product.id,
    name: product.name,
    catalogNumber: product.catalogNumber,
    brand: product.brand,
    price: product.price,
    category: product.category ?? undefined,
    subcategory: product.subcategory ?? undefined,
    type: product.type ?? undefined,
    spec: product.spec ?? undefined,
    target: product.target ?? undefined,
    host: product.host ?? undefined,
    applications: JSON.parse(product.applications),
    reactivity: JSON.parse(product.reactivity),
    description: product.description ?? undefined,
    specificity: product.specificity ?? undefined,
    productUsage: product.productUsage ?? undefined,
    speciesReactivity: product.speciesReactivity ?? undefined,
    speciesPredicted: product.speciesPredicted ?? undefined,
    storageTemp: product.storageTemp ?? undefined,
    storageBuffer: product.storageBuffer ?? undefined,
    cofaUrl: product.cofaUrl ?? undefined,
    sdsUrl: product.sdsUrl ?? undefined,
    pmids: JSON.parse(product.pmids),
    inStock: product.inStock,
    originalPrice: product.originalPrice ?? undefined,
    promotionalPrice: product.promotionalPrice ?? undefined,
    promotion: product.promotion,
    subBrand: product.subBrand ?? undefined,
    hazardous: !!product.hazardous,
    salesUnit: product.salesUnit ?? undefined,
    stockQuantity: product.stockQuantity,
  };

  // Parse all variants (including current product)
  const parsedVariants: Product[] = variants.map(p => ({
    id: p.id,
    variantId: p.variantId,
    name: p.name,
    catalogNumber: p.catalogNumber,
    brand: p.brand,
    price: p.price,
    category: p.category ?? undefined,
    subcategory: p.subcategory ?? undefined,
    type: p.type ?? undefined,
    spec: p.spec ?? undefined,
    target: p.target ?? undefined,
    host: p.host ?? undefined,
    applications: JSON.parse(p.applications),
    reactivity: JSON.parse(p.reactivity),
    description: p.description ?? undefined,
    inStock: p.inStock,
    originalPrice: p.originalPrice ?? undefined,
    promotionalPrice: p.promotionalPrice ?? undefined,
    promotion: p.promotion,
    subBrand: p.subBrand ?? undefined,
    hazardous: !!p.hazardous,
    salesUnit: p.salesUnit ?? undefined,
    stockQuantity: p.stockQuantity,
    leadTime: p.leadTime ?? undefined,
  }));

  // Filter out current product from related variants
  const relatedVariants = parsedVariants.filter(v => v.id !== parsedProduct.id);

  const relatedProducts = await prisma.product.findMany({
    where: {
      category: product.category,
      catalogNumber: { not: product.catalogNumber },
      ...STOREFRONT_HIDDEN_HAZARDOUS,
    },
    take: 4,
  });

  const parsedRelated: Product[] = relatedProducts.map(p => ({
    id: p.id,
    name: p.name,
    catalogNumber: p.catalogNumber,
    brand: p.brand,
    price: p.price,
    category: p.category ?? undefined,
    subcategory: p.subcategory ?? undefined,
    type: p.type ?? undefined,
    spec: p.spec ?? undefined,
    target: p.target ?? undefined,
    host: p.host ?? undefined,
    applications: JSON.parse(p.applications),
    reactivity: JSON.parse(p.reactivity),
    description: p.description ?? undefined,
    inStock: p.inStock,
    originalPrice: p.originalPrice ?? undefined,
    promotionalPrice: p.promotionalPrice ?? undefined,
    promotion: p.promotion,
    subBrand: p.subBrand ?? undefined,
  }));

  // 方案③：服务端按请求者状态计算展示价，剥离 price/originalPrice/promotionalPrice 原始价。
  // 变体走 attachVariantsDisplayPrice：非正式会员的变体不携带任何价格（变体无 originalPrice，计算访客价会退化为会员价）。
  const isFormalMember = await resolveIsFormalMember();
  const displayProduct = attachDisplayPrice(parsedProduct, isFormalMember);
  const displayVariants = attachVariantsDisplayPrice(relatedVariants, isFormalMember);
  const displayRelated = attachDisplayPrices(parsedRelated, isFormalMember);
  const guestDisplayPrice = getProductDisplayPrice(parsedProduct, { isFormalMember: false });
  const canonicalPath = productCanonicalPath(product.catalogNumber, product.brand);
  const productImage = getProductImageUrl({
    imageUrl: product.imageUrl ?? undefined,
    category: product.category ?? undefined,
    subcategory: product.subcategory ?? undefined,
  });

  return (
    <>
      <JsonLd
        data={buildProductJsonLd({
          name: product.name,
          brand: product.brand,
          catalogNumber: product.catalogNumber,
          description: product.description,
          imageUrl: productImage,
          canonicalPath,
          pricingMode: product.pricingMode,
          guestDisplayPrice,
          inStock: product.inStock,
        })}
      />
      <JsonLd
        data={buildBreadcrumbListJsonLd([
          { name: '首页', path: '/' },
          { name: '产品中心', path: '/products' },
          { name: product.name },
        ])}
      />
      <ProductDetailClient
        key={canonicalPath}
        product={displayProduct}
        variants={displayVariants as Product[]}
        related={displayRelated as Product[]}
      />
    </>
  );
}
