'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { useProductSearchSuggestions } from '@/hooks/useProductSearchSuggestions';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface HeaderSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEscape?: () => void;
  enableSuggestions?: boolean;
  wrapperClassName?: string;
  inputClassName?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  showSearchIcon?: boolean;
  autoFocus?: boolean;
}

export default function HeaderSearchField({
  value,
  onChange,
  onSubmit,
  onEscape,
  enableSuggestions = true,
  wrapperClassName = 'relative w-full',
  inputClassName = uiSurfaces.input,
  inputRef,
  placeholder = '搜索产品名称、货号、CD号、CAS号...',
  showSearchIcon = false,
  autoFocus = false,
}: HeaderSearchFieldProps) {
  const router = useRouter();
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    suggestions,
    loading,
    open,
    activeIndex,
    setOpen,
    moveActive,
    reset,
    minQueryLength,
  } = useProductSearchSuggestions(value, enableSuggestions);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setOpen]);

  const goToSuggestion = (item: { catalogNumber: string; brand: string }) => {
    reset();
    router.push(`/products/${encodeURIComponent(item.catalogNumber)}?brand=${encodeURIComponent(item.brand)}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (open && suggestions.length > 0) {
        e.preventDefault();
        moveActive(1);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (open && suggestions.length > 0) {
        e.preventDefault();
        moveActive(-1);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        goToSuggestion(suggestions[activeIndex]);
        return;
      }
      reset();
      onSubmit();
      return;
    }
    if (e.key === 'Escape') {
      reset();
      onEscape?.();
    }
  };

  const showPanel = enableSuggestions && open;
  const activeOptionId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;

  return (
    <div ref={wrapperRef} className={wrapperClassName}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listId : undefined}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        className={inputClassName}
        onChange={(e) => {
          onChange(e.target.value);
          if (enableSuggestions && e.target.value.trim().length >= minQueryLength) {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (enableSuggestions && value.trim().length >= minQueryLength) {
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {showSearchIcon && (
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-color-text-quaternary)]" />
      )}

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          data-header-popup
          className={`absolute left-0 right-0 top-full z-[250] mt-1 overflow-hidden rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panelStrong}`}
        >
          {loading && (
            <div data-header-popup-body className={`flex items-center gap-2 px-4 py-3 text-sm ${uiSurfaces.textSecondary}`}>
              <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-color-primary-hover)]" />
              正在匹配产品…
            </div>
          )}
          {!loading && suggestions.length === 0 && (
            <div data-header-popup-body className={`px-4 py-3 text-sm ${uiSurfaces.textQuaternary}`}>未找到匹配产品</div>
          )}
          {!loading && suggestions.length > 0 && (
            <ul data-header-popup-body className="max-h-72 overflow-y-auto py-1">
              {suggestions.map((item, index) => (
                <li key={item.id} role="presentation">
                  <Link
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    href={`/products/${encodeURIComponent(item.catalogNumber)}?brand=${encodeURIComponent(item.brand)}`}
                    onClick={() => reset()}
                    className={`block px-4 py-2.5 transition-colors ${
                      index === activeIndex ? 'bg-[var(--brand-color-primary-bg)]' : 'hover:bg-[var(--brand-color-bg-hover)]'
                    }`}
                  >
                    <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{item.name}</p>
                    <p className={`mt-0.5 truncate text-xs ${uiSurfaces.textSecondary}`}>
                      {item.catalogNumber} · {item.brand}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
