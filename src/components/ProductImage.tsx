'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import type { Product } from '@/types/Product';
import { getFallbackProductImageUrl, getProductImageUrl } from '@/lib/productImage';

type ProductImageProps = {
  product: Pick<Product, 'imageUrl' | 'category' | 'subcategory'>;
  alt: string;
  sizes?: string;
  className?: string;
  fallback?: ReactNode;
};

export default function ProductImage({
  product,
  alt,
  sizes,
  className,
  fallback = null,
}: ProductImageProps) {
  const primarySrc = getProductImageUrl(product);
  const fallbackSrc = getFallbackProductImageUrl(product);
  const [failedSrcs, setFailedSrcs] = useState<string[]>([]);

  const candidates = [primarySrc, fallbackSrc].filter(
    (url, index, list): url is string => Boolean(url) && list.indexOf(url) === index,
  );
  const src = candidates.find((url) => !failedSrcs.includes(url));

  if (!src) {
    return <>{fallback}</>;
  }

  const isExternalUrl = src.startsWith('http://') || src.startsWith('https://');

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized={isExternalUrl}
      className={className}
      onError={() => {
        setFailedSrcs((prev) => (prev.includes(src) ? prev : [...prev, src]));
      }}
    />
  );
}
