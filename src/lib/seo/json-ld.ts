import type { ProductDisplayPrice } from '@/lib/product-pricing';
import {
  SITE_BRAND_NAME,
  SITE_DISPLAY_NAME,
  SITE_HOME_DESCRIPTION,
  SITE_LEGAL_NAME,
} from '@/lib/seo/site-identity';
import { canonicalSiteUrl, getCanonicalSiteOrigin, toAbsoluteCanonicalUrl } from '@/lib/site-url';

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildOrganizationJsonLd() {
  const origin = getCanonicalSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: SITE_LEGAL_NAME,
    legalName: SITE_LEGAL_NAME,
    alternateName: SITE_BRAND_NAME,
    url: origin,
    logo: canonicalSiteUrl('/brand-logo-transparent.png'),
    description: SITE_HOME_DESCRIPTION,
  };
}

export function buildWebSiteJsonLd() {
  const origin = getCanonicalSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    url: origin,
    name: SITE_DISPLAY_NAME,
    alternateName: SITE_BRAND_NAME,
    description: SITE_HOME_DESCRIPTION,
    inLanguage: 'zh-CN',
    publisher: {
      '@id': `${origin}/#organization`,
    },
  };
}

export type BreadcrumbJsonLdItem = {
  name: string;
  path?: string;
};

export function buildBreadcrumbListJsonLd(items: BreadcrumbJsonLdItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.path ? { item: canonicalSiteUrl(item.path) } : {}),
    })),
  };
}

export type FaqJsonLdItem = {
  q: string;
  a: string;
};

export function buildFaqPageJsonLd(items: FaqJsonLdItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}

export type ProductJsonLdInput = {
  name: string;
  brand: string;
  catalogNumber: string;
  description?: string | null;
  imageUrl?: string | null;
  canonicalPath: string;
  pricingMode?: string | null;
  guestDisplayPrice: ProductDisplayPrice;
  inStock: boolean;
};

export function buildProductJsonLd(input: ProductJsonLdInput) {
  const canonicalUrl = canonicalSiteUrl(input.canonicalPath);
  const image = input.imageUrl ? toAbsoluteCanonicalUrl(input.imageUrl) : undefined;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    sku: input.catalogNumber,
    mpn: input.catalogNumber,
    brand: {
      '@type': 'Brand',
      name: input.brand,
    },
    url: canonicalUrl,
  };
  if (input.description?.trim()) jsonLd.description = input.description.trim();
  if (image) jsonLd.image = image;

  const canOffer =
    input.pricingMode !== 'inquiry' &&
    input.guestDisplayPrice.hasPrice &&
    Number.isFinite(input.guestDisplayPrice.salePrice) &&
    input.guestDisplayPrice.salePrice > 0;

  if (canOffer) {
    jsonLd.offers = {
      '@type': 'Offer',
      price: input.guestDisplayPrice.salePrice,
      priceCurrency: 'CNY',
      availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonicalUrl,
    };
  }

  return jsonLd;
}
