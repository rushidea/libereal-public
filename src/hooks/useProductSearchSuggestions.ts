'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildProductSearchQuery, type ProductSearchResponse } from '@/lib/product-search-contract';

export type SearchSuggestion = {
  id: string;
  name: string;
  catalogNumber: string;
  brand: string;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 8;

export function useProductSearchSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const canSuggest = enabled && trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!canSuggest) {
      abortRef.current?.abort();
      return;
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSuggestions([]);
      setLoading(true);
      setPanelOpen(true);
      setActiveIndex(-1);

      const params = buildProductSearchQuery({ keyword: trimmed, limit: SUGGESTION_LIMIT });

      fetch(`/api/products?${params}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
        .then((data: ProductSearchResponse<SearchSuggestion>) => {
          if (controller.signal.aborted) return;
          setSuggestions(
            (data.products ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              catalogNumber: p.catalogNumber,
              brand: p.brand,
            }))
          );
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError' && !controller.signal.aborted) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [trimmed, canSuggest]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setPanelOpen(false);
    setActiveIndex(-1);
  }, []);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((prev) => {
      if (suggestions.length === 0) return -1;
      if (prev < 0) return delta > 0 ? 0 : suggestions.length - 1;
      const next = prev + delta;
      if (next < 0) return suggestions.length - 1;
      if (next >= suggestions.length) return 0;
      return next;
    });
  }, [suggestions.length]);

  return {
    suggestions: canSuggest ? suggestions : [],
    loading: canSuggest && loading,
    open: canSuggest && panelOpen,
    activeIndex,
    setOpen: setPanelOpen,
    moveActive,
    reset,
    minQueryLength: MIN_QUERY_LENGTH,
  };
}
