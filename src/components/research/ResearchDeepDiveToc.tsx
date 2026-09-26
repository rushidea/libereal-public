'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type DeepDiveTocItem = {
  id: string;
  number: string;
  label: string;
};

function TocLinks({
  items,
  activeId,
  onNavigate,
}: {
  items: DeepDiveTocItem[];
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <ol className="mt-3 space-y-1">
      {items.map((item) => {
        const active = activeId === item.id;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active ? 'location' : undefined}
              onClick={() => onNavigate(item.id)}
              className={`flex gap-2 border-l-2 py-2 pl-3 text-sm transition-colors ${
                active
                  ? 'border-[var(--brand-color-primary)] font-semibold text-[var(--brand-color-text)]'
                  : 'border-transparent text-[var(--brand-color-text-secondary)] hover:border-[var(--brand-color-border)] hover:text-[var(--brand-color-text)]'
              }`}
            >
              <span className="font-mono text-[10px] leading-5 text-[var(--brand-color-text-quaternary)]">{item.number}</span>
              <span className="leading-5">{item.label}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export default function ResearchDeepDiveToc({
  items,
  showMobile = true,
}: {
  items: DeepDiveTocItem[];
  showMobile?: boolean;
}) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? 'page-top');
  const mobileRef = useRef<HTMLDetailsElement>(null);
  const activeItem = useMemo(() => items.find((item) => item.id === activeId) ?? items[0], [activeId, items]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: '-18% 0px -72% 0px', threshold: 0 },
    );
    items.forEach((item) => {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [items]);

  const navigate = (id: string) => {
    setActiveId(id);
    if (mobileRef.current) mobileRef.current.open = false;
  };

  return (
    <>
      <aside className="hidden lg:block" aria-label="本页目录">
        <nav className="sticky top-28 py-12">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--brand-color-text-quaternary)]">本页目录</p>
          <TocLinks items={items} activeId={activeId} onNavigate={navigate} />
          <a href="#page-top" className="mt-5 inline-block border-b border-[var(--brand-color-border)] pb-1 text-xs font-semibold text-[var(--brand-color-text-secondary)] hover:text-[var(--brand-color-text)]">
            返回页首
          </a>
        </nav>
      </aside>

      {showMobile ? (
        <details ref={mobileRef} className="group sticky top-16 z-30 -mx-4 border-y border-[var(--brand-color-border)] bg-[var(--brand-color-bg-layout)] px-4 lg:hidden sm:-mx-6 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 marker:hidden">
            <span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">本页目录</span>
              <span className="mt-1 block text-sm font-semibold text-[var(--brand-color-text)]">{activeItem?.number} · {activeItem?.label}</span>
            </span>
            <span className="text-xl leading-none text-[var(--brand-color-text-quaternary)]" aria-hidden="true">
              <span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span>
            </span>
          </summary>
          <nav className="border-t border-[var(--brand-color-border)] pb-4" aria-label="移动端页面目录">
            <TocLinks items={items} activeId={activeId} onNavigate={navigate} />
          </nav>
        </details>
      ) : null}
    </>
  );
}
