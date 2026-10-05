import { describe, expect, it } from 'vitest';
import {
  getBrandDisplayName,
  getBrandInfo,
  inquiryBrands,
  resolveBrandKey,
  resolveDbBrandName,
} from '@/data/brands';
import { generateMetadata } from '@/app/brands/[brand]/layout';
import { brandCanonicalPath } from '@/lib/seo/public-urls';
import { canonicalSiteUrl } from '@/lib/site-url';

describe('brand SEO profiles', () => {
  it('resolves Proteintech and NovoProtein aliases to distinct inquiry profiles', async () => {
    expect(resolveBrandKey('武汉三鹰')).toBe('Proteintech');
    expect(resolveDbBrandName('武汉三鹰')).toBe('Proteintech');
    expect(getBrandInfo('Proteintech Group')?.catalogStatus).toBe('inquiry');
    expect(resolveBrandKey('NovoProtein')).toBe('近岸蛋白');
    expect(resolveDbBrandName('NovoProtein')).toBe('近岸蛋白');
    expect(resolveDbBrandName('novoprotein')).toBe('近岸蛋白');
    expect(resolveDbBrandName('ptg')).toBe('Proteintech');
    const metadata = await generateMetadata({ params: Promise.resolve({ brand: 'novoprotein' }), children: null });
    expect(metadata.alternates?.canonical).toBe(canonicalSiteUrl(brandCanonicalPath('近岸蛋白')));
    expect(getBrandDisplayName('近岸蛋白')).toContain('NovoProtein');
    expect(getBrandInfo('Proteintech')?.description).not.toBe(getBrandInfo('近岸蛋白')?.description);
    expect(inquiryBrands).toEqual(['Proteintech', '近岸蛋白']);
  });

  it('preserves existing Thermo Fisher and CST database brand names', () => {
    expect(resolveDbBrandName('Thermo Fisher')).toBe('Thermo Fisher');
    expect(resolveDbBrandName('CST')).toBe('CST');
    expect(resolveDbBrandName('Cell Signaling Technology')).toBe('CST');
  });
});
