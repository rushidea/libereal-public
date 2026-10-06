import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetailPage, { generateMetadata } from '@/app/products/[id]/page';
import ProductDetailClient from '@/app/products/[id]/ProductDetailClient';
import JsonLd from '@/components/JsonLd';

const db = vi.hoisted(() => ({
  product: { findUnique: vi.fn(), findMany: vi.fn() },
  productVariant: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/auth', () => ({ auth: session.auth }));
vi.mock('@/app/products/[id]/ProductDetailClient', () => ({ default: () => null }));
vi.mock('@/components/AdaptiveHeader', () => ({ default: () => null }));

const record = {
  id: 'synthetic-trial', catalogNumber: 'SAMPLE/T', brand: 'Sample Brand',
  name: 'Sample trial reagent', spec: '20 mL', price: 18, originalPrice: 25,
  promotion: false, hazardous: false, inStock: true, stockQuantity: 5,
  applications: '[]', reactivity: '[]', pmids: '[]', pricingMode: 'priced',
};
const route = () => ({
  params: Promise.resolve({ id: record.catalogNumber }),
  searchParams: Promise.resolve({ brand: record.brand }),
});

describe('standalone product route identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.product.findUnique.mockResolvedValue(null);
    db.product.findMany.mockImplementation(async ({ where }) => (
      where.catalogNumber === record.catalogNumber ? [record] : []
    ));
    db.productVariant.findMany.mockResolvedValue([]);
    session.auth.mockResolvedValue(null);
  });

  it.each([false, true])('aligns direct SKU metadata, JSON-LD and keyed client for member=%s', async (member) => {
    if (member) {
      session.auth.mockResolvedValue({ user: { id: 'synthetic-member' } });
      db.user.findUnique.mockResolvedValue({ approvalStatus: 'approved', isNewUser: false, isFrozen: false, isBlacklisted: false });
    }
    const metadata = await generateMetadata(route());
    const tree = await ProductDetailPage(route());
    const children = tree.props.children as ReactElement<{ data?: Record<string, unknown>; product?: { catalogNumber: string; displayPrice?: { salePrice: number } } }>[];
    const client = children.find((child) => child.type === ProductDetailClient)!;
    const productLd = children.find((child) => child.type === JsonLd && child.props.data?.['@type'] === 'Product')!.props.data!;
    const path = '/products/SAMPLE%2FT?brand=Sample%20Brand';
    expect(metadata.title).toEqual({ absolute: expect.stringContaining('SAMPLE/T') });
    expect(metadata.alternates?.canonical).toEqual(expect.stringContaining(path));
    expect(productLd).toMatchObject({ sku: record.catalogNumber, name: record.name, url: expect.stringContaining(path) });
    expect(client.key).toBe(path); // new route identity remounts local selectedVariant state
    expect(client.props.product?.catalogNumber).toBe(record.catalogNumber);
    expect(client.props.product?.displayPrice?.salePrice).toBe(18);
    expect(productLd.offers).toMatchObject({ price: 18, url: expect.stringContaining(path) });
  });

  it('keeps an unknown-price route free of fabricated offers', async () => {
    db.product.findMany.mockImplementation(async ({ where }) => (
      where.catalogNumber === record.catalogNumber ? [{ ...record, price: 0, originalPrice: null, pricingMode: 'inquiry' }] : []
    ));
    const tree = await ProductDetailPage(route());
    const children = tree.props.children as ReactElement<{ data?: Record<string, unknown>; product?: { displayPrice?: { hasPrice: boolean } } }>[];
    const productLd = children.find((child) => child.type === JsonLd && child.props.data?.['@type'] === 'Product')!.props.data!;
    const client = children.find((child) => child.type === ProductDetailClient)!;
    expect(productLd).not.toHaveProperty('offers');
    expect(client.props.product?.displayPrice?.hasPrice).toBe(false);
  });
});
