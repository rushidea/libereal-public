'use client';

import { useEffect, useRef, useState } from 'react';

const sections = [
  {
    id: 'spatial-locations',
    number: '01',
    label: '不同部位的免疫状态',
    description: '六类常见组织区域',
  },
  {
    id: 'cross-cancer-themes',
    number: '02',
    label: '跨癌症比较',
    description: '共同点与癌症间差异',
  },
  {
    id: 'evidence-route',
    number: '03',
    label: '研究技术',
    description: '原理、流程、质控与解释范围',
  },
  {
    id: 'references',
    number: '04',
    label: '参考文献',
    description: '页面引用的代表性论文',
  },
] as const;

type SectionId = (typeof sections)[number]['id'];

function DirectoryLinks({
  activeId,
  onNavigate,
}: {
  activeId: SectionId;
  onNavigate?: (id: SectionId, targetId?: string) => void;
}) {
  return (
    <ol className="mt-3 space-y-1">
      {sections.map((section) => {
        const active = activeId === section.id;
        return (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active ? 'location' : undefined}
              onClick={() => onNavigate?.(section.id)}
              className={`block border-l-2 py-2 pl-3 transition-colors ${
                active
                  ? 'border-[var(--brand-color-primary)] text-[var(--brand-color-text)]'
                  : 'border-transparent text-[var(--brand-color-text-secondary)] hover:border-[var(--brand-color-border)] hover:text-[var(--brand-color-text)]'
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-[var(--brand-color-text-quaternary)]">{section.number}</span>
                <span className="text-sm font-semibold">{section.label}</span>
              </span>
              <span className="mt-1 block pl-6 text-[11px] leading-5 text-[var(--brand-color-text-quaternary)]">
                {section.description}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export default function TumorSpatialImmunityToc() {
  const [activeId, setActiveId] = useState<SectionId>('spatial-locations');
  const mobileDirectoryRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries.find((entry) => entry.isIntersecting);
        if (visibleEntry) setActiveId(visibleEntry.target.id as SectionId);
      },
      { rootMargin: '-18% 0px -72% 0px', threshold: 0 },
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const handleNavigate = (id: SectionId, targetId?: string) => {
    setActiveId(id);
    if (targetId) {
      const target = document.getElementById(targetId);
      if (target instanceof HTMLDetailsElement) target.open = true;
    }
    if (mobileDirectoryRef.current) mobileDirectoryRef.current.open = false;
  };

  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0];

  return (
    <>
      <aside className="hidden lg:block" aria-label="本页目录">
        <nav className="sticky top-28 py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--brand-color-text-quaternary)]">本页目录</p>
          <DirectoryLinks activeId={activeId} onNavigate={handleNavigate} />
          <a
            href="#page-top"
            className="mt-5 inline-block border-b border-[var(--brand-color-border)] pb-1 text-xs font-semibold text-[var(--brand-color-text-secondary)] hover:text-[var(--brand-color-text)]"
          >
            返回页首
          </a>
        </nav>
      </aside>

      <details
        ref={mobileDirectoryRef}
        className="group sticky top-16 z-30 -mx-4 border-y border-[var(--brand-color-border)] bg-[var(--brand-color-bg-layout)] px-4 lg:hidden sm:-mx-6 sm:px-6"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 marker:hidden">
          <span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">本页目录</span>
            <span className="mt-1 block text-sm font-semibold text-[var(--brand-color-text)]">
              {activeSection.number} · {activeSection.label}
            </span>
          </span>
          <span className="text-xl leading-none text-[var(--brand-color-text-quaternary)]" aria-hidden="true">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
        </summary>
        <nav className="border-t border-[var(--brand-color-border)] pb-4" aria-label="移动端页面目录">
          <DirectoryLinks activeId={activeId} onNavigate={handleNavigate} />
          <a
            href="#page-top"
            onClick={() => {
              if (mobileDirectoryRef.current) mobileDirectoryRef.current.open = false;
            }}
            className="mt-3 inline-block border-b border-[var(--brand-color-border)] pb-1 text-xs font-semibold text-[var(--brand-color-text-secondary)]"
          >
            返回页首
          </a>
        </nav>
      </details>
    </>
  );
}
