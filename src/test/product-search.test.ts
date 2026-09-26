import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import { ProductSearchService, buildProductSearchWhere, productSearchParamsFromUrl } from '@/lib/product-search';

function insertProduct(input: { id: string; catalogNumber: string; name: string; brand: string; category: string; target?: string; applications?: string[]; hazardous?: boolean }) {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, category, target, applications, reactivity, price, hazardous, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 100, ?, datetime('now'), datetime('now'))
  `).run(input.id, input.catalogNumber, input.name, input.brand, input.category, input.target || null, JSON.stringify(input.applications || []), input.hazardous ? 1 : 0);
}

describe('ProductSearchService', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    insertProduct({ id: 'p1', catalogNumber: 'AB-100', name: '磷酸化 AKT 抗体', brand: 'Abcam', category: '抗体', target: 'AKT1', applications: ['WB', 'IHC'] });
    insertProduct({ id: 'p2', catalogNumber: 'CST-200', name: 'ERK Antibody', brand: 'CST', category: '抗体', target: 'MAPK1', applications: ['WB'] });
    insertProduct({ id: 'p3', catalogNumber: 'HZ-1', name: '受限化学品', brand: 'Lab', category: '化学试剂', applications: ['Cell culture'], hazardous: true });
  });

  it('searches keywords across names, targets, applications, and catalog numbers', async () => {
    await expect(ProductSearchService.search({ keyword: 'AKT1' })).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(ProductSearchService.search({ keyword: 'IHC' })).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(ProductSearchService.search({ catalogNumbers: ['AB-100'] })).resolves.toMatchObject({ pagination: { total: 1 } });
  });

  it('combines brand, category, target, and application filters', async () => {
    const result = await ProductSearchService.search({ brands: ['Abcam'], category: '抗体', target: 'AKT', applications: ['WB'] });
    expect(result.products.map((product) => product.catalogNumber)).toEqual(['AB-100']);
    expect(result.products[0].applications).toEqual(['WB', 'IHC']);
  });

  it('hides hazardous products from storefront searches and includes them for administrators', async () => {
    expect((await ProductSearchService.search({ keyword: '受限' })).pagination.total).toBe(0);
    expect((await ProductSearchService.search({ keyword: '受限' }, { scope: 'admin' })).pagination.total).toBe(1);
  });

  it('normalizes fixed URL parameters and bounds pagination', async () => {
    const params = productSearchParamsFromUrl(new URLSearchParams('search=AKT&brand=Abcam,CST&target=AKT1&application=WB,IHC&catalogNumber=AB-100&page=-2&limit=5000'));
    expect(params).toMatchObject({ keyword: 'AKT', brands: ['Abcam', 'CST'], target: 'AKT1', applications: ['WB', 'IHC'], catalogNumbers: ['AB-100'] });
    expect((await ProductSearchService.search(params)).pagination).toMatchObject({ page: 1, limit: 100 });
  });

  it('builds a database query without external search dependencies', () => {
    expect(buildProductSearchWhere({ keyword: 'AKT', category: '抗体' })).toMatchObject({ category: '抗体', hazardous: false });
  });
});
