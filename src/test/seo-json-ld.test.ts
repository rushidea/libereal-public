import { describe, expect, it } from 'vitest';
import { getProductDisplayPrice } from '@/lib/product-pricing';
import {
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildProductJsonLd,
  buildWebSiteJsonLd,
  serializeJsonLd,
} from '@/lib/seo/json-ld';

describe('serializeJsonLd', () => {
  it('escapes sequences that could break a script element', () => {
    const encoded = serializeJsonLd({ note: '</script><script>alert(1)' });
    expect(encoded).not.toContain('</script>');
    expect(encoded).toContain('\\u003c/script>');
  });
});

describe('site identity JSON-LD', () => {
  it('links the LIBEREAL website to its legal operator', () => {
    const organization = buildOrganizationJsonLd();
    const website = buildWebSiteJsonLd();

    expect(organization).toMatchObject({
      '@type': 'Organization',
      name: '南京天放生物科技有限公司',
      legalName: '南京天放生物科技有限公司',
      alternateName: 'LIBEREAL',
    });
    expect(website).toMatchObject({
      '@type': 'WebSite',
      name: 'LIBEREAL | 南京天放生物科技有限公司',
      alternateName: 'LIBEREAL',
      description: expect.stringContaining('面向生物、医学科研场景，连接实验路径、产品采购与技术支持'),
      publisher: { '@id': organization['@id'] },
    });
  });
});

describe('buildProductJsonLd', () => {
  it('uses anonymous public price and omits Offer for inquiry products', () => {
    const guestDisplayPrice = getProductDisplayPrice(
      { price: 100, originalPrice: 200, brand: 'Abcam' },
      { isFormalMember: false },
    );
    const priced = buildProductJsonLd({
      name: 'AKT Antibody',
      brand: 'Abcam',
      catalogNumber: 'ab123',
      canonicalPath: '/products/ab123?brand=Abcam',
      guestDisplayPrice,
      inStock: true,
      pricingMode: 'fixed',
    }) as { offers?: { price: number } };
    expect(priced.offers?.price).toBe(100);

    const inquiry = buildProductJsonLd({
      name: 'Custom Antibody',
      brand: 'Abcam',
      catalogNumber: 'ab999',
      canonicalPath: '/products/ab999?brand=Abcam',
      guestDisplayPrice,
      inStock: true,
      pricingMode: 'inquiry',
    });
    expect(inquiry).not.toHaveProperty('offers');
  });
});

describe('buildFaqPageJsonLd', () => {
  it('emits Question entries from shared FAQ data', () => {
    const jsonLd = buildFaqPageJsonLd([{ q: '如何下单？', a: '提交询价表单。' }]);
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: '如何下单？',
    });
  });
});
