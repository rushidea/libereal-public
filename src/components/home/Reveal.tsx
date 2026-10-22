'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const DURATION_MS = 700;

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Delay before this block, or before the first child when `stagger` is set. */
  delay?: number;
  /** Extra delay in ms between direct children. The wrapper itself stays still. */
  stagger?: number;
};

function clearMotion(el: HTMLElement) {
  el.style.transition = '';
  el.style.opacity = '';
  el.style.transform = '';
}

/**
 * Homepage scroll reveal. Markup stays visible without JS; the offset is
 * written to the DOM after hydration, and only while the block is still
 * below the viewport. prefers-reduced-motion shows content immediately.
 */
export default function Reveal({ children, className, delay = 0, stagger = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const targets = () => (
      stagger > 0 ? Array.from(node.children) as HTMLElement[] : [node]
    );
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer = 0;

    const finish = () => {
      revealed.current = true;
      node.dataset.homeReveal = 'idle';
      targets().forEach(clearMotion);
    };

    if (media.matches || revealed.current) {
      finish();
      media.addEventListener('change', finish);
      return () => {
        window.clearTimeout(timer);
        media.removeEventListener('change', finish);
      };
    }

    const rect = node.getBoundingClientRect();
    if (rect.height === 0 || rect.top < window.innerHeight * 0.92) {
      finish();
      return;
    }

    node.dataset.homeReveal = 'hidden';
    targets().forEach((el) => {
      el.style.transition = '';
      el.style.opacity = '0';
      el.style.transform = 'translate3d(0, 16px, 0)';
    });

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const els = targets();
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!ref.current) return;
            revealed.current = true;
            node.dataset.homeReveal = 'shown';
            els.forEach((el, index) => {
              const wait = delay + index * stagger;
              el.style.transition = `opacity ${DURATION_MS}ms ${EASE} ${wait}ms, transform ${DURATION_MS}ms ${EASE} ${wait}ms`;
              el.style.opacity = '1';
              el.style.transform = 'translate3d(0, 0, 0)';
            });
            timer = window.setTimeout(
              () => {
                if (ref.current) finish();
              },
              DURATION_MS + delay + Math.max(0, els.length - 1) * stagger + 40,
            );
          });
        });
      },
      { threshold: 0, rootMargin: '0px 0px -48px 0px' },
    );
    observer.observe(node);

    const onPreference = () => {
      if (!media.matches) return;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      window.clearTimeout(timer);
      finish();
    };
    media.addEventListener('change', onPreference);

    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', onPreference);
    };
  }, [children, delay, stagger]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
