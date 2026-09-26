import { describe, expect, it } from 'vitest';
import {
  parsePricingAdjustmentImport,
  importedRowHasFilePrices,
  applyCatalogMatchResults,
  applyImportedReviewDecision,
  confirmNameConflictReviewRows,
  assessImportedProductName,
  getPricingPreviewReadiness,
  groupMissingCatalogProducts,
  importedRowIsMatched,
  importedRowsNeedCatalogRematch,
  summarizeImportedAdjustmentRows,
  toCatalogMatchItem,
  toCatalogPriceItem,
} from '@/lib/pricing-adjustment-import';

const WIDE_HEADERS = [
  '商品名', '货号', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格2', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格3', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格4', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格5', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
];

describe('pricing adjustment import', () => {
  it('reads the wide template into primary and extra specs', () => {
    const parsed = parsePricingAdjustmentImport([
      WIDE_HEADERS,
      ['CST', 'CAT-1', 120, 100, 90, 40, 80, '100ul', 220, 180, '', 70, 150, '', '', '', '', '', ''],
    ], { selectedBrand: 'CST' });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.wide).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      catalogNumber: 'CAT-1',
      name: 'CST',
      spec: '',
      specIndex: 1,
      originalPrice: 120,
      price: 100,
      promotionalPrice: 90,
      costPrice: 40,
      minimumSalePrice: 80,
      status: 'ready',
    });
    expect(parsed.rows[1]).toMatchObject({
      catalogNumber: 'CAT-1',
      spec: '100ul',
      specIndex: 2,
      originalPrice: 220,
      price: 180,
      promotionalPrice: null,
      costPrice: 70,
      minimumSalePrice: 150,
    });
    expect(importedRowHasFilePrices(parsed.rows[0])).toBe(true);
  });

  it('keeps the legacy three-column sheet working', () => {
    const parsed = parsePricingAdjustmentImport([
      ['品牌', '货号', '当前价格'],
      ['CST', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      catalogNumber: 'CAT-1',
      spec: '',
      price: 88,
      originalPrice: null,
      costPrice: null,
      status: 'ready',
    });
  });

  it('skips empty extra spec groups and flags priced groups without a spec', () => {
    const parsed = parsePricingAdjustmentImport([
      WIDE_HEADERS,
      ['CST', 'CAT-1', 100, '', '', '', '', '', 200, '', '', '', ''],
    ], { selectedBrand: 'CST' });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((row) => row.status)).toEqual(['ready', 'invalid']);
    expect(parsed.rows[1].note).toContain('规格2');
  });

  it('rejects a sheet without a catalog column', () => {
    const parsed = parsePricingAdjustmentImport([['品牌', '名称'], ['CST', '抗体']]);
    expect(parsed.ok).toBe(false);
  });

  it('marks unmatched catalogs as missing after the match pass', () => {
    const parsed = parsePricingAdjustmentImport([
      ['品牌', '货号', '市场价格'],
      ['CST', 'CAT-1', 88],
      ['CST', 'MISSING', 99],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.every((row) => row.note === '待核对货号')).toBe(true);

    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: false, name: null },
    ]);
    expect(matched[0]).toMatchObject({ status: 'ready', note: '已匹配：测试抗体' });
    expect(matched[1]).toMatchObject({ status: 'invalid', note: '未找到商品' });
    expect(summarizeImportedAdjustmentRows(matched)).toMatchObject({
      matched: 1,
      unmatched: 1,
      pending: 0,
      usable: 1,
      pricedUsable: 1,
    });
    expect(groupMissingCatalogProducts(matched)).toEqual([
      expect.objectContaining({
        catalogNumber: 'MISSING',
        name: 'MISSING',
        price: 99,
        variants: [],
      }),
    ]);

    const recovered = applyCatalogMatchResults(matched, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: true, name: '新抗体' },
    ]);
    expect(recovered[1]).toMatchObject({ status: 'ready', note: '已匹配：新抗体' });
  });

  it('lets file-mode preview skip adjustment amount and use the table prices', () => {
    const rows = [{
      rowNumber: 2,
      brand: 'CST',
      name: '测试抗体',
      catalogNumber: 'CAT-1',
      spec: '',
      specIndex: 1,
      originalPrice: 120,
      price: 100,
      promotionalPrice: null,
      costPrice: 40,
      minimumSalePrice: 80,
      status: 'ready' as const,
      note: '已匹配：测试抗体',
    }];

    const skippedStepTwo = getPricingPreviewReadiness({
      brand: 'CST',
      scope: 'catalog',
      category: '',
      mode: 'file',
      amount: '',
      reason: '',
      rows,
    });
    expect(skippedStepTwo.ok).toBe(true);
    expect(skippedStepTwo.missing).toEqual([]);
    expect(skippedStepTwo.effectiveReason).toBe('按导入表格更新价格');

    const formulaWithoutAmount = getPricingPreviewReadiness({
      brand: 'CST',
      scope: 'catalog',
      category: '',
      mode: 'percent',
      amount: '',
      reason: '年度调价',
      rows,
    });
    expect(formulaWithoutAmount.ok).toBe(false);
    expect(formulaWithoutAmount.missing).toContain('填写调价数值');
  });

  it('lets file and category previews run without a brand or category', () => {
    const rows = [{
      rowNumber: 2,
      brand: '',
      name: '测试抗体',
      catalogNumber: 'CAT-1',
      spec: '',
      specIndex: 1,
      originalPrice: 120,
      price: 100,
      promotionalPrice: null,
      costPrice: 40,
      minimumSalePrice: 80,
      status: 'ready' as const,
      note: '已匹配：测试抗体',
    }];
    expect(getPricingPreviewReadiness({
      brand: '',
      scope: 'catalog',
      category: '',
      mode: 'file',
      amount: '',
      reason: '',
      rows,
    }).ok).toBe(true);
    expect(getPricingPreviewReadiness({
      brand: '',
      scope: 'category',
      category: '',
      mode: 'percent',
      amount: '5',
      reason: '全站调价',
      rows: [],
    }).ok).toBe(true);
  });

  it('matches by catalog even when the first column is a product name or another brand label', () => {
    const byName = parsePricingAdjustmentImport([
      ['商品名', '货号', '市场价格'],
      ['Phospho-Akt Antibody', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });
    expect(byName.ok).toBe(true);
    if (!byName.ok) return;
    expect(byName.rows[0]).toMatchObject({
      name: 'Phospho-Akt Antibody',
      catalogNumber: 'CAT-1',
      status: 'ready',
      note: '待核对货号',
    });

    const legacyBrandColumn = parsePricingAdjustmentImport([
      ['品牌', '货号', '市场价格'],
      ['Abcam', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });
    expect(legacyBrandColumn.ok).toBe(true);
    if (!legacyBrandColumn.ok) return;
    expect(legacyBrandColumn.rows[0]).toMatchObject({
      name: 'Abcam',
      catalogNumber: 'CAT-1',
      status: 'ready',
    });
    expect(legacyBrandColumn.rows[0].note).not.toContain('品牌');
  });

  it('keeps a matching legacy brand column as brand, not as product name', () => {
    const parsed = parsePricingAdjustmentImport([
      ['品牌', '货号', '市场价格'],
      ['CST', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      brand: 'CST',
      name: '',
      catalogNumber: 'CAT-1',
      status: 'ready',
    });
  });

  it('sends name-conflict rows to review instead of writing them', () => {
    const parsed = parsePricingAdjustmentImport([
      ['商品名', '货号', '市场价格'],
      ['另一商品', 'CAT-1', 88],
      ['测试抗体', 'CAT-2', 99],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: false, name: '测试抗体', nameConflict: true },
      { catalogNumber: 'CAT-2', spec: '', matched: true, name: '测试抗体' },
    ]);
    expect(matched[0]).toMatchObject({
      status: 'review',
      note: '货号重合但商品不一致（站内：测试抗体）',
      siteName: '测试抗体',
    });
    expect(matched[1]).toMatchObject({
      status: 'ready',
      note: '已匹配：测试抗体',
    });
    expect(summarizeImportedAdjustmentRows(matched)).toMatchObject({
      matched: 1,
      review: 1,
      unmatched: 0,
      usable: 1,
    });

    const clientReviewed = applyCatalogMatchResults(parsed.rows.slice(0, 1), [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
    ]);
    expect(clientReviewed[0].status).toBe('review');
  });

  it('lets a reviewer confirm or skip name-conflict rows so they can finish the batch', () => {
    const parsed = parsePricingAdjustmentImport([
      ['商品名', '货号', '市场价格'],
      ['另一商品', 'CAT-1', 88],
      ['第三商品', 'CAT-2', 99],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: false, name: '测试抗体', nameConflict: true },
      {
        catalogNumber: 'CAT-2',
        spec: '',
        matched: false,
        name: 'CST、Abcam',
        productName: 'CST、Abcam',
        ambiguous: true,
        candidateBrands: ['CST', 'Abcam'],
      },
    ]);
    const confirmed = applyImportedReviewDecision(matched, matched[0], { action: 'confirm' });
    expect(confirmed[0]).toMatchObject({
      status: 'ready',
      note: '已匹配（人工确认）：测试抗体',
    });
    expect(importedRowIsMatched(confirmed[0])).toBe(true);

    const skipped = applyImportedReviewDecision(matched, matched[1], { action: 'skip' });
    expect(skipped[1]).toMatchObject({
      status: 'invalid',
      note: '已跳过，不改价',
    });

    const branded = applyImportedReviewDecision(matched, matched[1], { action: 'confirm', brand: 'Abcam' });
    expect(branded[1]).toMatchObject({
      status: 'ready',
      brand: 'Abcam',
    });

    const allNameConflicts = confirmNameConflictReviewRows(matched);
    expect(allNameConflicts[0].status).toBe('ready');
    expect(allNameConflicts[1].status).toBe('review');
  });

  it('keeps a catalog match when names overlap or keywords align', () => {
    const parsed = parsePricingAdjustmentImport([
      ['商品名', '货号', '市场价格'],
      ['Phospho-Akt Antibody', 'CAT-1', 88],
      ['测试抗体 一抗', 'CAT-2', 99],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: 'Phospho-Akt (Rabbit mAb)' },
      { catalogNumber: 'CAT-2', spec: '', matched: true, name: '测试抗体' },
    ]);
    expect(matched[0]).toMatchObject({
      status: 'ready',
      note: '已匹配：Phospho-Akt (Rabbit mAb)',
    });
    expect(matched[1]).toMatchObject({
      status: 'ready',
      note: '已匹配：测试抗体',
    });
  });

  it('matches by catalog when the imported name is empty', () => {
    const parsed = parsePricingAdjustmentImport([
      ['品牌', '货号', '市场价格'],
      ['CST', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
    ]);
    expect(matched[0]).toMatchObject({
      status: 'ready',
      note: '已匹配：测试抗体',
    });
  });

  it('classifies imported names by overlap and keywords', () => {
    expect(assessImportedProductName('另一商品', '测试抗体').identity).toBe('conflict');
    expect(assessImportedProductName('测试抗体 一抗', '测试抗体').identity).toBe('align');
    expect(assessImportedProductName('Phospho-Akt Antibody', 'Phospho-Akt (Rabbit mAb)').identity).toBe('align');
    expect(assessImportedProductName('Beta Catenin', 'Catenin Beta').identity).toBe('keyword');
    expect(assessImportedProductName('', '测试抗体').identity).toBe('skip');
    expect(assessImportedProductName('Abcam p53', 'Abcam GAPDH', { brand: 'Abcam' }).identity).toBe('conflict');
    expect(assessImportedProductName('CST 一抗', 'CST 二抗', { brand: 'CST' }).identity).toBe('conflict');
    expect(assessImportedProductName('CD3抗体', 'CD4抗体').identity).toBe('conflict');
    expect(assessImportedProductName('p53', 'p51').identity).toBe('conflict');
    expect(assessImportedProductName('Mouse / Rat IgG Antibody', 'Mouse / Rat IgG').identity).toBe('align');
  });

  it('uses the full site product name when a spec suffix is present', () => {
    const parsed = parsePricingAdjustmentImport([
      ['商品名', '货号', '市场价格'],
      ['Mouse / Rat IgG Antibody', 'CAT-1', 88],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const withProductName = applyCatalogMatchResults(parsed.rows, [
      {
        catalogNumber: 'CAT-1',
        spec: '',
        matched: true,
        name: 'Mouse / Rat IgG / 100ul',
        productName: 'Mouse / Rat IgG',
      },
    ]);
    expect(withProductName[0]).toMatchObject({
      status: 'ready',
      note: '已匹配：Mouse / Rat IgG / 100ul',
    });

    const specRow = { ...parsed.rows[0], spec: '100ul' };
    const strippedBySpec = applyCatalogMatchResults([specRow], [
      { catalogNumber: 'CAT-1', spec: '100ul', matched: true, name: 'Mouse / Rat IgG / 100ul' },
    ]);
    expect(strippedBySpec[0].status).toBe('ready');
  });

  it('skips catalog rematch after rows are already matched and none are missing', () => {
    const parsed = parsePricingAdjustmentImport([
      ['品牌', '货号', '市场价格'],
      ['CST', 'CAT-1', 88],
      ['CST', 'MISSING', 99],
    ], { selectedBrand: 'CST' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(importedRowsNeedCatalogRematch(parsed.rows)).toBe(true);
    expect(parsed.rows.every((row) => row.note === '待核对货号')).toBe(true);

    const matched = applyCatalogMatchResults(parsed.rows, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: false, name: null },
    ]);
    expect(importedRowsNeedCatalogRematch(matched)).toBe(true);
    expect(matched[1]).toMatchObject({ status: 'invalid', note: '未找到商品' });

    const recovered = applyCatalogMatchResults(matched, [
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: true, name: '新抗体' },
    ]);
    expect(importedRowsNeedCatalogRematch(recovered)).toBe(false);
    expect(recovered.every((row) => row.note.startsWith('已匹配'))).toBe(true);
  });

  it('omits names, empty spec and null prices from match and preview payloads', () => {
    const row = {
      rowNumber: 2,
      brand: 'CST',
      name: '测试抗体',
      catalogNumber: 'CAT-1',
      spec: '',
      specIndex: 1,
      originalPrice: 120,
      price: 100,
      promotionalPrice: null,
      costPrice: 40,
      minimumSalePrice: null,
      status: 'ready' as const,
      note: '已匹配：测试抗体',
    };
    expect(toCatalogMatchItem(row)).toEqual({ catalogNumber: 'CAT-1', brand: 'CST' });
    expect(toCatalogMatchItem({ ...row, spec: '100ul' })).toEqual({
      catalogNumber: 'CAT-1',
      spec: '100ul',
      brand: 'CST',
    });
    expect(toCatalogMatchItem({ ...row, brand: '' })).toEqual({ catalogNumber: 'CAT-1' });
    expect(toCatalogPriceItem(row)).toEqual({
      catalogNumber: 'CAT-1',
      brand: 'CST',
      originalPrice: 120,
      price: 100,
      costPrice: 40,
    });
  });
});
