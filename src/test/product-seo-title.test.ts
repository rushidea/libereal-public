import { describe, expect, it } from 'vitest';
import { buildProductSeoTitle } from '@/lib/seo/product-title';

describe('buildProductSeoTitle', () => {
  it('leaves a short product title unchanged', () => {
    expect(buildProductSeoTitle('Anti-GAPDH Antibody', 'Abcam', 'SYN-ANT-001'))
      .toBe('Anti-GAPDH Antibody | Abcam Cat#SYN-ANT-001');
  });

  it('keeps a 70-character title and shortens a 71-character title', () => {
    const suffix = ' | Brand Cat#SYN-001';
    const name = 'A'.repeat(70 - Array.from(suffix).length);
    expect(buildProductSeoTitle(name, 'Brand', 'SYN-001')).toBe(name + suffix);
    const shortened = buildProductSeoTitle(name + 'A', 'Brand', 'SYN-001');
    expect(Array.from(shortened)).toHaveLength(70);
    expect(shortened).toContain('…' + suffix);
  });

  it('keeps product identity when the name is empty', () => {
    expect(buildProductSeoTitle('', 'Brand', 'SYN-001')).toBe('| Brand Cat#SYN-001');
  });

  it('normalizes whitespace before composing the title', () => {
    expect(buildProductSeoTitle('  Recombinant   Human Protein  ', ' Proteintech ', ' 123 '))
      .toBe('Recombinant Human Protein | Proteintech Cat#123');
  });

  it('shortens a long Chinese name and preserves the complete identity suffix', () => {
    const title = buildProductSeoTitle('重组人肿瘤坏死因子相关凋亡诱导配体长片段蛋白'.repeat(5), '近岸蛋白', 'ABC-123456');
    expect(title).toContain('… | 近岸蛋白 Cat#ABC-123456');
    expect(Array.from(title).length).toBeLessThanOrEqual(70);
  });

  it('shortens a long English name while keeping its brand and catalog number', () => {
    const title = buildProductSeoTitle('Highly Purified Recombinant Monoclonal Antibody for Human Protein Target With Validated Application Data '.repeat(2), 'Thermo Fisher', 'A-12345');
    expect(title).toContain('… | Thermo Fisher Cat#A-12345');
    expect(Array.from(title).length).toBeLessThanOrEqual(70);
  });

  it('does not split surrogate-pair characters when shortening a name', () => {
    const title = buildProductSeoTitle('🧪😀'.repeat(80), 'Abcam', 'SYN-123');
    expect(title).toContain('… | Abcam Cat#SYN-123');
    expect(title).toContain('🧪😀');
    expect(Array.from(title).length).toBeLessThanOrEqual(70);
  });

  it('preserves the complete identity suffix even when it exceeds the title budget', () => {
    const brand = `LongBrand${'X'.repeat(65)}`;
    const catalogNumber = `CAT-${'9'.repeat(70)}`;
    const title = buildProductSeoTitle('Long product name '.repeat(8), brand, catalogNumber);
    expect(title).toBe(`| ${brand} Cat#${catalogNumber}`);
    expect(title).toContain(brand);
    expect(title).toContain(catalogNumber);
  });
});
