'use client';

import { useCallback, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import AdaptiveHeader from '@/components/AdaptiveHeader';

export function productSearchHref(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `/products?q=${encodeURIComponent(trimmed)}` : '/products';
}

type AdaptiveHeaderWithProductSearchProps = Omit<ComponentProps<typeof AdaptiveHeader>, 'onSearch'>;

export default function AdaptiveHeaderWithProductSearch(props: AdaptiveHeaderWithProductSearchProps) {
  const router = useRouter();

  const handleSearch = useCallback((query: string) => {
    router.push(productSearchHref(query));
  }, [router]);

  return <AdaptiveHeader {...props} onSearch={handleSearch} />;
}
