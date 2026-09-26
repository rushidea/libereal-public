'use client';

import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Wrench,
  FlaskConical,
  Calculator,
  Dna,
  Sparkles,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import HomeSectionHeader from '@/components/home/HomeSectionHeader';
import { protocolSummaries, type ProtocolSummary } from '@/data/protocols-summary';
import {
  difficultyBadgeClass,
  getIcon,
} from '@/data/home-resources';
import { scenes, type SceneResource } from '@/data/scenes';
import { getToolFaviconSrc } from '@/lib/tool-favicon';
import { uiSurfaces } from '@/lib/ui-surfaces';

const t = {
  title: uiSurfaces.titleText,
  body: uiSurfaces.text,
  muted: uiSurfaces.mutedText,
  label: uiSurfaces.textSecondary,
};

const interactiveText = `${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive}`;

const SUPPORT_ITEMS: {
  label: string;
  desc?: string;
  icon: LucideIcon;
  color: string;
  href: string;
}[] = [
  {
    label: '计算工具',
    icon: Calculator,
    color: 'bg-amber-100/80 text-amber-600',
    href: '/support?tab=calculators',
  },
  {
    label: '荧光光谱',
    icon: Sparkles,
    color: 'bg-orange-100/80 text-orange-600',
    href: '/support?tab=spectra',
  },
  {
    label: '缓冲液配制',
    icon: FlaskConical,
    color: 'bg-emerald-100/80 text-emerald-600',
    href: '/support?tab=buffers',
  },
  {
    label: 'CD 分子【人类白细胞分化抗原（HLDA）】查询',
    icon: Dna,
    color: 'bg-sky-100/80 text-sky-600',
    href: '/support?tab=cd-markers',
  },
];

/** Row height must match SupportListItem (icon + vertical padding exceed 3.25rem at 18px root). */
const SUPPORT_ROW_HEIGHT = '3.75rem';
/** 技术支持一栏展示全部条目，不再分页轮播 */
const SUPPORT_ROWS_VISIBLE = 4;
const SUPPORT_LIST_VIEWPORT_HEIGHT = `calc(${SUPPORT_ROWS_VISIBLE} * ${SUPPORT_ROW_HEIGHT} + ${SUPPORT_ROWS_VISIBLE - 1} * 0.5rem)`;
const PROTOCOL_ROW_HEIGHT = '3.75rem';
const PROTOCOL_ROWS_VISIBLE = 3;
const PROTOCOL_LIST_VIEWPORT_HEIGHT = `calc(${PROTOCOL_ROWS_VISIBLE} * ${PROTOCOL_ROW_HEIGHT} + ${PROTOCOL_ROWS_VISIBLE - 1} * 0.5rem)`;
const TOOL_ROW_HEIGHT = '4.25rem';
const TOOL_ROWS_VISIBLE = 3;
const TOOL_COLUMNS_VISIBLE = 2;
const WIDE_MOBILE_MEDIA_QUERY = '(min-width: 740px) and (max-width: 1023px)';
const TOOL_LIST_VIEWPORT_HEIGHT = `calc(${TOOL_ROWS_VISIBLE} * ${TOOL_ROW_HEIGHT} + ${TOOL_ROWS_VISIBLE - 1} * 0.5rem)`;
/** Space below list so page controls clear the last row edge */
const LIST_INDICATOR_SPACING = 'mt-8';
/** 自动轮播间隔 */
const SUPPORT_ADVANCE_MS = 4500;
const PROTOCOL_ADVANCE_MS = 5600;
const TOOL_ADVANCE_MS = 5200;
/** 切换动画时长 */
const SUPPORT_TRANSITION_MS = 500;
const PROTOCOL_TRANSITION_MS = 520;
const TOOL_TRANSITION_MS = 520;
/** 触屏 swipe 调参：水平滑动方向 */
const SWIPE_MIN_DELTA_PX = 40;
const SWIPE_MAX_DURATION_MS = 400;
/** 触屏 touch 后暂停多久才恢复 */
const TOUCH_RESUME_DELAY_MS = 8000;
/** 鼠标 hover 后暂停多久才恢复 */
const HOVER_RESUME_DELAY_MS = 1500;

function ColumnShell({
  eyebrow,
  title,
  subtitle,
  count,
  imageSrc,
  titlePillClass,
  viewAllHref,
  viewAllLabel,
  accentLinkClass,
  className,
  preventSnippet,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  count?: string;
  imageSrc: string;
  titlePillClass: string;
  viewAllHref: string;
  viewAllLabel: string;
  accentLinkClass: string;
  className?: string;
  preventSnippet?: boolean;
  children: React.ReactNode;
}) {
  return (
    // 外层托盘（Double-Bezel 外壳）：柔和漫射阴影 + 发丝级描边，营造悬浮硬件质感
    <div
      className={`group/card h-full rounded-brand-lg p-1.5 transition-[transform,box-shadow] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 sm:p-2 ${uiSurfaces.panelStrong} ${className ?? ''}`}
      data-nosnippet={preventSnippet ? '' : undefined}
    >
      {/* 内层核心（玻璃面板）：同心较小圆角 + 顶部内高光 */}
      <div className={`flex h-full flex-col overflow-hidden rounded-brand ${uiSurfaces.panel}`}>
        <div
          className="relative min-h-[5.75rem] overflow-hidden p-3.5 sm:p-5"
          style={{
            backgroundImage: `linear-gradient(110deg, rgba(15,23,42,0.22), rgba(15,23,42,0.04) 52%, rgba(255,255,255,0.24)), url("${imageSrc}")`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        >
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white/42 to-transparent dark:from-slate-100" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow ? (
                <span className={`mb-2 inline-block rounded-full border border-[var(--surface-border)] bg-[var(--surface-badge)] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.18em] shadow-sm backdrop-blur ${uiSurfaces.textSecondary}`}>
                  {eyebrow}
                </span>
              ) : null}
              <h3 className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold shadow-sm backdrop-blur-md ${titlePillClass}`}>
                {title}
              </h3>
            </div>
            {count ? (
              <span className={`flex-shrink-0 rounded-full border border-[var(--surface-border)] bg-[var(--surface-badge)] px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur ${uiSurfaces.textSecondary}`}>
                {count}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
          {subtitle ? <p className={`mb-4 text-xs leading-relaxed ${t.muted}`}>{subtitle}</p> : null}
          <div className="min-h-0 flex-1">{children}</div>
          <Link
            href={viewAllHref}
            className={`group/cta mt-4 inline-flex w-full items-center justify-between gap-3 rounded-full px-4 py-2.5 text-sm font-semibold shadow-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px hover:shadow-md active:translate-y-0 ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
          >
            <span className={accentLinkClass}>{viewAllLabel}</span>
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-black/5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-px dark:bg-white/10">
              <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProtocolListItem({
  protocol,
}: {
  protocol: ProtocolSummary;
}) {
  const Icon = getIcon(protocol.icon);
  return (
    <Link
      href={`/protocols/${protocol.id}`}
      className={`group flex h-[3.75rem] items-center gap-3 rounded-brand border px-2.5 py-2.5 backdrop-blur-sm transition-all hover:shadow-md active:shadow-sm sm:px-3 ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-105 ${protocol.bgColor}`}
      >
        {createElement(Icon, { size: 19, className: protocol.iconColor })}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <h4 className={`truncate text-sm font-bold leading-tight ${t.title}`}>{protocol.title}</h4>
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${difficultyBadgeClass[protocol.difficulty]}`}
          >
            {protocol.difficulty}
          </span>
        </div>
        <p className={`truncate text-xs leading-snug ${t.muted}`}>
          {protocol.category} · {protocol.duration}
        </p>
      </div>
      <ChevronRight
        size={16}
        aria-hidden
        className={`flex-shrink-0 transition-all group-hover:translate-x-0.5 ${interactiveText}`}
      />
    </Link>
  );
}

function chunkProtocols(items: ProtocolSummary[]) {
  const pages: ProtocolSummary[][] = [];
  for (let i = 0; i < items.length; i += PROTOCOL_ROWS_VISIBLE) {
    pages.push(items.slice(i, i + PROTOCOL_ROWS_VISIBLE));
  }
  return pages;
}

function ProtocolLibraryList() {
  const pages = chunkProtocols(protocolSummaries);
  const totalPages = pages.length;
  const [currentPage, setCurrentPage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number>(0);
  const resumeTimerRef = useRef<number | null>(null);

  const reducedMotion = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  useEffect(() => {
    if (reducedMotion || isPaused || totalPages <= 1) return;
    const id = window.setInterval(() => {
      setCurrentPage((page) => (page + 1) % totalPages);
    }, PROTOCOL_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, isPaused, totalPages]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  const scheduleResume = useCallback((delayMs: number) => {
    setIsPaused(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setIsPaused(false);
      resumeTimerRef.current = null;
    }, delayMs);
  }, []);

  const goToPage = useCallback((page: number) => {
    setCurrentPage((page + totalPages) % totalPages);
  }, [totalPages]);

  const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!next || !event.currentTarget.contains(next as Node)) {
      setIsPaused(false);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0].clientX;
    touchStartTimeRef.current = Date.now();
    scheduleResume(TOUCH_RESUME_DELAY_MS);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null || totalPages <= 1) return;
    const endX = event.changedTouches[0].clientX;
    const deltaX = startX - endX;
    const elapsed = Date.now() - touchStartTimeRef.current;
    if (Math.abs(deltaX) >= SWIPE_MIN_DELTA_PX && elapsed <= SWIPE_MAX_DURATION_MS) {
      goToPage(currentPage + (deltaX > 0 ? 1 : -1));
    }
  };

  const handleMouseEnter = () => scheduleResume(HOVER_RESUME_DELAY_MS);
  const handleMouseLeave = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setIsPaused(false);
  };

  const pageIndicator = (
    <div className={`${LIST_INDICATOR_SPACING} flex items-center justify-center gap-2`}>
      <button
        type="button"
        aria-label="上一组实验方法"
        onClick={() => {
          goToPage(currentPage - 1);
          scheduleResume(HOVER_RESUME_DELAY_MS);
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-input)] shadow-sm transition ${interactiveText} ${uiSurfaces.focusRing}`}
      >
        <ChevronLeft size={14} />
      </button>
      {pages.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`跳到第 ${i + 1} 组实验方法`}
          aria-current={i === currentPage ? 'true' : undefined}
          onClick={() => {
            goToPage(i);
            scheduleResume(HOVER_RESUME_DELAY_MS);
          }}
          className={`h-2 rounded-full transition-all ${uiSurfaces.focusRing} ${
            i === currentPage
              ? 'w-4 bg-brand-500'
              : 'w-2 bg-[var(--brand-color-border-secondary)] hover:bg-[var(--brand-color-neutral-border)] active:bg-[var(--brand-color-neutral)]'
          }`}
        />
      ))}
      <button
        type="button"
        aria-label="下一组实验方法"
        onClick={() => {
          goToPage(currentPage + 1);
          scheduleResume(HOVER_RESUME_DELAY_MS);
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-input)] shadow-sm transition ${interactiveText} ${uiSurfaces.focusRing}`}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );

  if (reducedMotion) {
    return (
      <div
        className="-mr-1 overflow-x-auto overscroll-contain pr-1 [scrollbar-width:thin]"
        aria-label="实验方法列表"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={handleBlurCapture}
      >
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {protocolSummaries.map((protocol) => (
            <div key={protocol.id} className="w-[18rem] flex-shrink-0">
              <ProtocolListItem protocol={protocol} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="实验方法列表"
      className="touch-pan-y"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={handleBlurCapture}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="-mr-1 overflow-hidden pr-1" style={{ height: PROTOCOL_LIST_VIEWPORT_HEIGHT }}>
        <div
          className="flex h-full will-change-transform"
          style={{
            width: `${totalPages * 100}%`,
            transform: `translateX(-${(100 / totalPages) * currentPage}%)`,
            transition: `transform ${PROTOCOL_TRANSITION_MS}ms ease-in-out`,
          }}
        >
          {pages.map((pageItems, pageIndex) => (
            <div
              key={pageIndex}
              className="flex h-full flex-shrink-0 flex-col gap-2"
              style={{ width: `${100 / totalPages}%` }}
            >
              {pageItems.map((protocol) => (
                <ProtocolListItem key={protocol.id} protocol={protocol} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 ? pageIndicator : null}
    </div>
  );
}

type PublicToolItem = SceneResource & {
  category: string;
  sceneTitle: string;
};

function isExternalHref(href: string) {
  return href.startsWith('http://') || href.startsWith('https://');
}

function getToolIconSrc(tool: SceneResource) {
  return getToolFaviconSrc(tool.href, tool.iconUrl);
}

function getPublicTools(): PublicToolItem[] {
  const seen = new Set<string>();
  const tools: PublicToolItem[] = [];

  scenes.forEach((scene) => {
    (scene.analysisSoftware ?? []).forEach((tool) => {
      const key = `${tool.label}-${tool.href}`;
      if (seen.has(key)) return;
      seen.add(key);
      tools.push({
        ...tool,
        category: tool.category ?? '公共资源',
        sceneTitle: tool.contextLabel ?? scene.title,
      });
    });
  });

  return tools;
}

function PublicToolIcon({ tool }: { tool: PublicToolItem }) {
  const iconSrc = getToolIconSrc(tool);
  if (!iconSrc) {
    return <Wrench className="h-5 w-5 text-blue-600" />;
  }

  return (
    <span
      aria-hidden
      className="block h-6 w-6 rounded-md bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${iconSrc}")` }}
    />
  );
}

function PublicToolListItem({ tool }: { tool: PublicToolItem }) {
  const external = isExternalHref(tool.href);
  const content = (
    <>
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-sm transition-transform group-hover:scale-105 dark:bg-blue-100/70">
        <PublicToolIcon tool={tool} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className={`truncate text-sm font-bold leading-tight ${t.title}`}>{tool.label}</h4>
          <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-100/70">
            {tool.category}
          </span>
        </div>
        <p className={`truncate text-[11px] leading-snug ${t.muted}`}>{tool.sceneTitle}</p>
        <p className={`truncate text-[11px] leading-snug dark:text-slate-600 text-slate-500`} title={tool.description}>
          {tool.description}
        </p>
      </div>
      {external ? (
        <ExternalLink
          size={15}
          aria-hidden
          className={`flex-shrink-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${interactiveText}`}
        />
      ) : (
        <ChevronRight
          size={16}
          aria-hidden
          className={`flex-shrink-0 transition-all group-hover:translate-x-0.5 ${interactiveText}`}
        />
      )}
    </>
  );

  const className = `group flex h-[4.25rem] items-center gap-3 rounded-brand border px-2.5 py-2 backdrop-blur-sm transition-all hover:shadow-md active:shadow-sm sm:px-3 ${uiSurfaces.panel} ${uiSurfaces.focusRing}`;

  if (external) {
    return (
      <a href={tool.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={tool.href} className={className}>
      {content}
    </Link>
  );
}

function chunkTools(items: PublicToolItem[], itemsPerPage: number) {
  const pages: PublicToolItem[][] = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages;
}

function PublicToolLibraryList() {
  const tools = getPublicTools();
  const wideMobile = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(WIDE_MOBILE_MEDIA_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(WIDE_MOBILE_MEDIA_QUERY).matches,
    () => false,
  );
  const [currentPage, setCurrentPage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const pages = chunkTools(tools, wideMobile ? TOOL_ROWS_VISIBLE * TOOL_COLUMNS_VISIBLE : TOOL_ROWS_VISIBLE);
  const totalPages = pages.length;
  const activePage = totalPages > 0 ? currentPage % totalPages : 0;

  const touchStartXRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number>(0);
  const resumeTimerRef = useRef<number | null>(null);

  const reducedMotion = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  useEffect(() => {
    if (reducedMotion || isPaused || totalPages <= 1) return;
    const id = window.setInterval(() => {
      setCurrentPage((page) => (page + 1) % totalPages);
    }, TOOL_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, isPaused, totalPages]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  const scheduleResume = useCallback((delayMs: number) => {
    setIsPaused(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setIsPaused(false);
      resumeTimerRef.current = null;
    }, delayMs);
  }, []);

  const goToPage = useCallback((page: number) => {
    setCurrentPage((page + totalPages) % totalPages);
  }, [totalPages]);

  const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!next || !event.currentTarget.contains(next as Node)) {
      setIsPaused(false);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0].clientX;
    touchStartTimeRef.current = Date.now();
    scheduleResume(TOUCH_RESUME_DELAY_MS);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null || totalPages <= 1) return;
    const endX = event.changedTouches[0].clientX;
    const deltaX = startX - endX;
    const elapsed = Date.now() - touchStartTimeRef.current;
    if (Math.abs(deltaX) >= SWIPE_MIN_DELTA_PX && elapsed <= SWIPE_MAX_DURATION_MS) {
      goToPage(currentPage + (deltaX > 0 ? 1 : -1));
    }
  };

  const handleMouseEnter = () => scheduleResume(HOVER_RESUME_DELAY_MS);
  const handleMouseLeave = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setIsPaused(false);
  };

  if (tools.length === 0) return null;

  const pageIndicator = (
    <div className={`${LIST_INDICATOR_SPACING} flex items-center justify-center gap-2`}>
      <button
        type="button"
        aria-label="上一组公共工具"
        onClick={() => {
          goToPage(currentPage - 1);
          scheduleResume(HOVER_RESUME_DELAY_MS);
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-input)] shadow-sm transition ${interactiveText} ${uiSurfaces.focusRing}`}
      >
        <ChevronLeft size={14} />
      </button>
      {pages.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`跳到第 ${i + 1} 组公共工具`}
          aria-current={i === activePage ? 'true' : undefined}
          onClick={() => {
            goToPage(i);
            scheduleResume(HOVER_RESUME_DELAY_MS);
          }}
          className={`h-2 rounded-full transition-all ${uiSurfaces.focusRing} ${
            i === activePage
              ? 'w-4 bg-blue-500'
              : 'w-2 bg-[var(--brand-color-border-secondary)] hover:bg-[var(--brand-color-neutral-border)] active:bg-[var(--brand-color-neutral)]'
          }`}
        />
      ))}
      <button
        type="button"
        aria-label="下一组公共工具"
        onClick={() => {
          goToPage(currentPage + 1);
          scheduleResume(HOVER_RESUME_DELAY_MS);
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-input)] shadow-sm transition ${interactiveText} ${uiSurfaces.focusRing}`}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );

  if (reducedMotion) {
    return (
      <div
        className="-mr-1 overflow-x-auto overscroll-contain pr-1 [scrollbar-width:thin]"
        aria-label="公共工具列表"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={handleBlurCapture}
      >
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {tools.map((tool) => (
            <div key={`${tool.label}-${tool.href}`} className="w-[18rem] flex-shrink-0">
              <PublicToolListItem tool={tool} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="公共工具列表"
      className="touch-pan-y"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={handleBlurCapture}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="-mr-1 overflow-hidden pr-1" style={{ height: TOOL_LIST_VIEWPORT_HEIGHT }}>
        <div
          className="flex h-full will-change-transform"
          style={{
            width: `${totalPages * 100}%`,
            transform: `translateX(-${(100 / totalPages) * activePage}%)`,
            transition: `transform ${TOOL_TRANSITION_MS}ms ease-in-out`,
          }}
        >
          {pages.map((pageItems, pageIndex) => (
            <div
              key={pageIndex}
              className="flex h-full flex-shrink-0 flex-col gap-2 min-[740px]:grid min-[740px]:grid-cols-2 lg:flex lg:flex-col"
              style={{ width: `${100 / totalPages}%` }}
            >
              {pageItems.map((tool) => (
                <PublicToolListItem key={`${tool.label}-${tool.href}`} tool={tool} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 ? pageIndicator : null}
    </div>
  );
}

function SupportListItem({ item }: { item: (typeof SUPPORT_ITEMS)[number] }) {
  const Icon = item.icon;
  // Row 布局：icon 在左 + label/desc 在右，与实验方案/品牌卡片字号一致
  return (
    <Link
      href={item.href}
      // touch manipulation 移除移动端 tap 的 300ms 双击延迟
      className={`group flex h-[3.75rem] touch-manipulation items-center gap-3 rounded-brand border px-2.5 py-2.5 backdrop-blur-sm transition-all hover:shadow-md active:shadow-sm sm:px-3 ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-105 ${item.color}`}
      >
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className={`line-clamp-2 text-sm font-bold leading-tight ${t.title}`}>{item.label}</h4>
        {item.desc ? <p className={`line-clamp-1 text-xs leading-snug ${t.muted}`}>{item.desc}</p> : null}
      </div>
      <ChevronRight
        size={16}
        aria-hidden
        className="flex-shrink-0 text-amber-500/50 transition-all group-hover:translate-x-0.5 group-hover:text-amber-600"
      />
    </Link>
  );
}

function SupportList() {
  // 每页固定三项；末页不足时从首项循环补齐，避免轮播产生大块空白。
  const pages: (typeof SUPPORT_ITEMS)[] = [];
  for (let i = 0; i < SUPPORT_ITEMS.length; i += SUPPORT_ROWS_VISIBLE) {
    const page = SUPPORT_ITEMS.slice(i, i + SUPPORT_ROWS_VISIBLE);
    for (let fillIndex = 0; page.length < SUPPORT_ROWS_VISIBLE; fillIndex += 1) {
      page.push(SUPPORT_ITEMS[fillIndex % SUPPORT_ITEMS.length]);
    }
    pages.push(page);
  }
  const totalPages = pages.length;
  const [currentPage, setCurrentPage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number>(0);
  const resumeTimerRef = useRef<number | null>(null);

  // 同步订阅 prefers-reduced-motion：避免 effect 里 setState 触发 lint，
  // 也避免 SSR/CSR hydration mismatch（SSR snapshot 固定 false）。
  const reducedMotion = useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  useEffect(() => {
    if (reducedMotion || isPaused || totalPages <= 1) return;
    const id = window.setInterval(() => {
      setCurrentPage((page) => (page + 1) % totalPages);
    }, SUPPORT_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, isPaused, totalPages]);

  // 组件卸载时清理恢复 timer，避免 setState on unmounted
  useEffect(() => {
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  const scheduleResume = useCallback((delayMs: number) => {
    setIsPaused(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setIsPaused(false);
      resumeTimerRef.current = null;
    }, delayMs);
  }, []);

  const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!next || !event.currentTarget.contains(next as Node)) {
      setIsPaused(false);
    }
  };

  // 触屏：暂停 + 水平 swipe 翻页（左滑看下一页 / 右滑看上一页）
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0].clientX;
    touchStartTimeRef.current = Date.now();
    scheduleResume(TOUCH_RESUME_DELAY_MS);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null || totalPages <= 1) return;
    const endX = event.changedTouches[0].clientX;
    const deltaX = startX - endX;
    const elapsed = Date.now() - touchStartTimeRef.current;
    // 快速 + 大幅的 swipe 才翻页，慢拖动视为 page scroll
    if (Math.abs(deltaX) >= SWIPE_MIN_DELTA_PX && elapsed <= SWIPE_MAX_DURATION_MS) {
      if (deltaX > 0) {
        // 左滑 → 下一页
        setCurrentPage((p) => (p + 1) % totalPages);
      } else {
        // 右滑 → 上一页
        setCurrentPage((p) => (p - 1 + totalPages) % totalPages);
      }
    }
  };

  // 鼠标 hover 暂停 + 离开后短暂延迟再恢复
  const handleMouseEnter = () => scheduleResume(HOVER_RESUME_DELAY_MS);
  const handleMouseLeave = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setIsPaused(false);
  };

  const pageIndicator = (
    <div className={`${LIST_INDICATOR_SPACING} flex items-center justify-center gap-1.5 sm:gap-2`}>
      {pages.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`跳到第 ${i + 1} 页`}
          aria-current={i === currentPage ? 'true' : undefined}
          onClick={() => {
            setCurrentPage(i);
            scheduleResume(HOVER_RESUME_DELAY_MS);
          }}
          className={`h-2 rounded-full transition-all ${uiSurfaces.focusRing} ${
            i === currentPage
              ? 'w-4 bg-amber-500'
              : 'w-2 bg-[var(--brand-color-border-secondary)] hover:bg-[var(--brand-color-neutral-border)] active:bg-[var(--brand-color-neutral)]'
          }`}
        />
      ))}
    </div>
  );

  // reduced-motion 用户：静态水平 scroll bar 替代自动切换
  if (reducedMotion) {
    return (
      <div
        className="-mr-1 overflow-x-auto overscroll-contain pr-1 [scrollbar-width:thin]"
        aria-label="技术支持资源列表"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={handleBlurCapture}
      >
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {SUPPORT_ITEMS.map((item) => (
            <SupportListItem key={item.label} item={item} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="技术支持资源列表"
      // touch-pan-y 让浏览器继续接管 vertical page scroll
      // touch-action 不能是 pan-x（会阻止竖向滚动）
      className="touch-pan-y"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={handleBlurCapture}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="-mr-1 overflow-hidden pr-1"
        // 固定高度：4 行 row 卡片纵向堆叠（3.75rem × 4 + gap × 3）
        style={{ height: SUPPORT_LIST_VIEWPORT_HEIGHT }}
      >
        <div
          className="flex h-full will-change-transform"
          style={{
            width: `${totalPages * 100}%`,
            transform: `translateX(-${(100 / totalPages) * currentPage}%)`,
            transition: `transform ${SUPPORT_TRANSITION_MS}ms ease-in-out`,
          }}
        >
          {pages.map((pageItems, pageIndex) => (
            <div
              key={pageIndex}
              className="flex h-full flex-shrink-0 flex-col gap-2"
              style={{ width: `${100 / totalPages}%` }}
            >
              {pageItems.map((item) => (
                <SupportListItem key={`${pageIndex}-${item.label}`} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {totalPages > 1 ? pageIndicator : null}
    </div>
  );
}

export default function HomeResourceServices() {
  return (
    <section className="px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <HomeSectionHeader
          title="资源与服务"
          className="mb-6 sm:mb-8"
        />
        <div className="grid grid-cols-1 gap-4 sm:gap-8 min-[740px]:grid-cols-2 min-[740px]:gap-4 lg:grid-cols-3 lg:gap-10 lg:[&>*:last-child]:col-span-1">
          <ColumnShell
            title="实验方法"
            subtitle="从基础入手，熟悉流程，助您轻松科研起步。"
            imageSrc="/images/home/resource-methods.webp"
            titlePillClass={`border-[var(--surface-border)] bg-[var(--surface-badge)] ${uiSurfaces.titleText}`}
            viewAllHref="/support?tab=protocols"
            viewAllLabel="浏览全部方案"
            accentLinkClass={interactiveText}
          >
            <ProtocolLibraryList />
          </ColumnShell>

          <ColumnShell
            title="公共分析工具"
            subtitle="开源和免费的公共分析工具助您减少商业分析开支。"
            imageSrc="/images/home/resource-tools.webp"
            className="min-[740px]:order-3 min-[740px]:col-span-2 lg:order-none lg:col-span-1"
            preventSnippet
            titlePillClass={`border-[var(--surface-border)] bg-[var(--surface-badge)] ${uiSurfaces.titleText}`}
            viewAllHref="/scenes#public-tools"
            viewAllLabel="查看全部工具"
            accentLinkClass={interactiveText}
          >
            <PublicToolLibraryList />
          </ColumnShell>

          <ColumnShell
            title="技术支持"
            imageSrc="/images/home/resource-support.webp"
            className="min-[740px]:order-2 lg:order-none"
            titlePillClass={`border-[var(--surface-border)] bg-[var(--surface-badge)] ${uiSurfaces.titleText}`}
            viewAllHref="/support"
            viewAllLabel="进入支持中心"
            accentLinkClass={interactiveText}
          >
            <SupportList />
          </ColumnShell>
        </div>
      </div>
    </section>
  );
}
