'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent,
} from 'react';

import {
  RESEARCH_LIFE_AUTO_ROTATE_MS,
  RESEARCH_LIFE_SLIDES,
} from '@/components/home/ResearchLifeCarousel';

const DESKTOP_SLOTS = [
  { left: '50%', top: '48%', width: '58%', rotate: 0, zIndex: 20 },
  { left: '12%', top: '18%', width: '21%', rotate: -4, zIndex: 9 },
  { left: '88%', top: '18%', width: '21%', rotate: 4, zIndex: 8 },
  { left: '11%', top: '50%', width: '20%', rotate: 2, zIndex: 7 },
  { left: '89%', top: '50%', width: '20%', rotate: -2, zIndex: 6 },
  { left: '12%', top: '82%', width: '21%', rotate: 4, zIndex: 5 },
  { left: '88%', top: '82%', width: '21%', rotate: -4, zIndex: 4 },
] as const;

const MOBILE_SLOTS = [
  { left: '50%', top: '31%', width: '88%', rotate: 0, zIndex: 20 },
  { left: '17%', top: '70%', width: '29%', rotate: -3, zIndex: 9 },
  { left: '50%', top: '70%', width: '29%', rotate: 1, zIndex: 8 },
  { left: '83%', top: '70%', width: '29%', rotate: 3, zIndex: 7 },
  { left: '17%', top: '89%', width: '29%', rotate: 2, zIndex: 6 },
  { left: '50%', top: '89%', width: '29%', rotate: -1, zIndex: 5 },
  { left: '83%', top: '89%', width: '29%', rotate: -3, zIndex: 4 },
] as const;

function getRelativeSlot(index: number, activeIndex: number) {
  return (index - activeIndex + RESEARCH_LIFE_SLIDES.length) % RESEARCH_LIFE_SLIDES.length;
}

function getDesktopStyle(index: number, activeIndex: number): CSSProperties {
  const slot = DESKTOP_SLOTS[getRelativeSlot(index, activeIndex)];
  return {
    left: slot.left,
    top: slot.top,
    width: slot.width,
    zIndex: slot.zIndex,
    transform: `translate3d(-50%, -50%, 0) rotate(${slot.rotate}deg)`,
  };
}

function getMobileStyle(index: number, activeIndex: number): CSSProperties {
  const slot = MOBILE_SLOTS[getRelativeSlot(index, activeIndex)];

  return {
    left: slot.left,
    top: slot.top,
    width: slot.width,
    zIndex: slot.zIndex,
    transform: `translate3d(-50%, -50%, 0) rotate(${slot.rotate}deg)`,
  };
}

export default function ResearchLifeMosaic() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const activeSlide = RESEARCH_LIFE_SLIDES[activeIndex];

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      if (mediaQuery.matches) setAutoRotate(false);
    };
    updateMotionPreference();
    mediaQuery.addEventListener('change', updateMotionPreference);
    return () => mediaQuery.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (!autoRotate || interactionPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % RESEARCH_LIFE_SLIDES.length);
    }, RESEARCH_LIFE_AUTO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [activeIndex, autoRotate, interactionPaused]);

  const selectPrevious = () => {
    setActiveIndex((current) => (
      current - 1 + RESEARCH_LIFE_SLIDES.length
    ) % RESEARCH_LIFE_SLIDES.length);
  };

  const selectNext = () => {
    setActiveIndex((current) => (current + 1) % RESEARCH_LIFE_SLIDES.length);
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    setInteractionPaused(false);
    if (startX === null) return;
    const distance = startX - event.changedTouches[0].clientX;
    if (Math.abs(distance) < 40) return;
    if (distance > 0) selectNext();
    else selectPrevious();
  };

  return (
    <section
      className="overflow-hidden rounded-xl bg-[#ffffff] text-[#0f172a] ring-1 ring-slate-200/70 dark:bg-[var(--brand-color-bg-container)] dark:text-[var(--brand-color-text)] dark:ring-1 dark:ring-[var(--brand-color-border)]"
      aria-label="中央大图与四周小图科研生活轮播"
    >
      <div className="relative px-3 pb-5 pt-7 sm:px-8 sm:pb-7 sm:pt-9">
        <h2 className="text-center text-2xl font-semibold leading-tight text-[#0f172a] dark:text-[var(--brand-color-text)] sm:text-3xl">
          科研生活，<span className="text-[var(--brand-color-text-interactive)]">全搞定。</span>
        </h2>

        <button
          type="button"
          onClick={() => setAutoRotate((enabled) => !enabled)}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e2e8f0] bg-white/90 text-slate-800 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/80 sm:right-5 sm:top-5"
          aria-label={autoRotate ? '暂停照片轮换' : '继续照片轮换'}
          title={autoRotate ? '暂停照片轮换' : '继续照片轮换'}
        >
          {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <div
          className="relative mt-4 h-[35rem] touch-pan-y sm:hidden"
          onTouchStart={(event) => {
            touchStartX.current = event.touches[0].clientX;
            setInteractionPaused(true);
          }}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => {
            touchStartX.current = null;
            setInteractionPaused(false);
          }}
        >
          {RESEARCH_LIFE_SLIDES.map((slide, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={slide.title}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`absolute aspect-[3/2] overflow-hidden rounded-lg border-4 border-[#e2e8f0] bg-slate-100 shadow-[0_18px_42px_rgba(15,23,42,0.16)] transition-[left,top,width,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white dark:shadow-[0_18px_42px_rgba(2,6,23,0.28)] ${active ? 'cursor-default' : 'cursor-pointer'}`}
                style={getMobileStyle(index, activeIndex)}
                aria-label={active ? slide.title : `将${slide.title}移到中央`}
                aria-current={active ? 'true' : undefined}
              >
                <Image
                  src={slide.image}
                  alt={slide.alt}
                  fill
                  loading="eager"
                  sizes={active ? '88vw' : '29vw'}
                  className="object-cover"
                />
                {active ? <PromotionCaption slide={slide} compact /> : null}
              </button>
            );
          })}
        </div>

        <div
          className="relative mt-4 hidden h-[30rem] sm:block"
          onMouseEnter={() => setInteractionPaused(true)}
          onMouseLeave={() => setInteractionPaused(false)}
          onFocusCapture={() => setInteractionPaused(true)}
          onBlurCapture={() => setInteractionPaused(false)}
        >
          {RESEARCH_LIFE_SLIDES.map((slide, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={slide.title}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`absolute aspect-[3/2] overflow-hidden rounded-lg border-[5px] border-[#e2e8f0] bg-slate-100 shadow-[0_22px_55px_rgba(15,23,42,0.18)] transition-[left,top,width,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white dark:shadow-[0_22px_55px_rgba(2,6,23,0.3)] ${active ? 'cursor-default' : 'cursor-pointer hover:brightness-105'}`}
                style={getDesktopStyle(index, activeIndex)}
                aria-label={active ? slide.title : `将${slide.title}移到中央`}
                aria-current={active ? 'true' : undefined}
              >
                <Image
                  src={slide.image}
                  alt={slide.alt}
                  fill
                  loading="eager"
                  sizes={active ? '58vw' : '21vw'}
                  className="object-cover"
                />
                {active ? <PromotionCaption slide={slide} /> : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={selectPrevious}
            className="absolute left-1 top-1/2 z-30 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#e2e8f0] bg-white/92 text-slate-800 shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/80 sm:left-3"
            aria-label="上一张照片"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={selectNext}
            className="absolute right-1 top-1/2 z-30 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#e2e8f0] bg-white/92 text-slate-800 shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/80 sm:right-3"
            aria-label="下一张照片"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex min-h-11 items-center justify-center">
          {activeSlide.href ? (
            <Link
              href={activeSlide.href}
              className="inline-flex items-center gap-1.5 rounded-[var(--brand-border-radius)] bg-brand-700 px-4 py-2 text-sm font-semibold text-[var(--brand-color-primary-text)] shadow-sm transition hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {activeSlide.ctaLabel}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="rounded-[var(--brand-border-radius)] bg-brand-700 px-4 py-2 text-sm font-semibold text-[var(--brand-color-primary-text)] shadow-sm">
              {activeSlide.title}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          {RESEARCH_LIFE_SLIDES.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`h-2 rounded-full transition-[width,background-color] ${index === activeIndex ? 'w-7 bg-brand-700 dark:bg-brand-400' : 'w-2 bg-slate-300 hover:bg-slate-400 dark:bg-slate-500'}`}
              aria-label={`切换到${slide.title}`}
              aria-pressed={index === activeIndex}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PromotionCaption({
  compact = false,
  slide,
}: {
  compact?: boolean;
  slide: (typeof RESEARCH_LIFE_SLIDES)[number];
}) {
  return (
    <span data-research-promotion-caption className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-12 text-left text-white sm:px-5 sm:pb-5 sm:pt-16">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200 sm:text-xs">
        {slide.eyebrow}
      </span>
      <span className="mt-1 block text-sm font-semibold leading-snug text-white sm:text-lg">
        {slide.title}
      </span>
      {!compact ? (
        <span className="mt-1.5 block line-clamp-2 text-xs leading-relaxed text-white/82 sm:text-sm">
          {slide.description}
        </span>
      ) : null}
    </span>
  );
}
