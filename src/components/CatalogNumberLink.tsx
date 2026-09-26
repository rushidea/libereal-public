import Link from 'next/link';
import { getProductDetailHref } from '@/lib/product-href';

type CatalogNumberLinkProps = {
  catalogNumber: string;
  brand: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * 促销货号双选等场景的货号链接：点击进入对应产品详情页。
 */
export default function CatalogNumberLink({
  catalogNumber,
  brand,
  className,
  children,
}: CatalogNumberLinkProps) {
  return (
    <Link
      href={getProductDetailHref(catalogNumber, brand)}
      className={
        className
        ?? 'font-mono text-brand-700 underline decoration-brand-300/70 underline-offset-2 transition hover:text-brand-900 hover:decoration-brand-600'
      }
    >
      {children ?? catalogNumber}
    </Link>
  );
}
