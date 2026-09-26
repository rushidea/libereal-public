import type { KnowledgeProductCard } from '@/data/knowledge/trac-engineering';

type Environment = Partial<Record<string, string | undefined>>;

type ProductIdentity = {
  id: string;
  brand: string;
  catalogNumber: string;
  name: string;
  hazardous?: boolean;
};

const FORBIDDEN_KNOWLEDGE_FIELDS = new Set([
  'price',
  'originalprice',
  'promotionalprice',
  'costprice',
  'minimumsaleprice',
  'stockquantity',
  'instock',
  'promotion',
  'cart',
  'order',
  'user',
]);

export function isKnowledgeStagingEnabled(environment: Environment = process.env): boolean {
  return (
    environment.KNOWLEDGE_STAGING_ENABLED === 'true' &&
    environment.KNOWLEDGE_DEPLOYMENT_ENV === 'staging'
  );
}

export function productMatchesKnowledgeCard(
  card: KnowledgeProductCard,
  product: ProductIdentity | null | undefined,
): boolean {
  return Boolean(
    product &&
      !product.hazardous &&
      product.id === card.productId &&
      product.brand === card.brand &&
      product.catalogNumber === card.catalogNumber &&
      product.name === card.productName,
  );
}

export function findForbiddenKnowledgeFields(value: unknown, path = 'root'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKnowledgeFields(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, item]) => {
    const nextPath = `${path}.${key}`;
    const current = FORBIDDEN_KNOWLEDGE_FIELDS.has(key.toLowerCase()) ? [nextPath] : [];
    return current.concat(findForbiddenKnowledgeFields(item, nextPath));
  });
}
