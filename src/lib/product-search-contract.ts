export type ProductSearchSort = 'relevance' | 'price-low' | 'price-high' | 'name' | 'newest';

export interface ProductSearchParams {
  keyword?: string;
  brands?: string[];
  category?: string;
  subcategory?: string;
  subBrand?: string;
  target?: string;
  applications?: string[];
  catalogNumbers?: string[];
  hosts?: string[];
  reactivities?: string[];
  speciesReactivities?: string[];
  productType?: string;
  promotion?: boolean;
  sort?: ProductSearchSort;
  page?: number;
  limit?: number;
}

export interface ProductSearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ProductSearchResponse<T> {
  products: T[];
  pagination: ProductSearchPagination;
}

function setList(query: URLSearchParams, key: string, values: string[] | undefined) {
  const normalized = values?.map((value) => value.trim()).filter(Boolean);
  if (normalized?.length) query.set(key, normalized.join(','));
}

export function buildProductSearchQuery(params: ProductSearchParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set('search', params.keyword.trim());
  setList(query, 'brand', params.brands);
  if (params.category?.trim()) query.set('category', params.category.trim());
  if (params.subcategory?.trim()) query.set('sub', params.subcategory.trim());
  if (params.subBrand?.trim()) query.set('subBrand', params.subBrand.trim());
  if (params.target?.trim()) query.set('target', params.target.trim());
  setList(query, 'application', params.applications);
  setList(query, 'catalogNumber', params.catalogNumbers);
  setList(query, 'host', params.hosts);
  setList(query, 'reactivity', params.reactivities);
  setList(query, 'species', params.speciesReactivities);
  if (params.productType?.trim()) query.set('type', params.productType.trim());
  if (params.promotion) query.set('promotion', 'true');
  if (params.sort && params.sort !== 'relevance') query.set('sort', params.sort);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  return query;
}
