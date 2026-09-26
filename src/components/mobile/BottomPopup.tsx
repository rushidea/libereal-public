'use client';

import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface BottomPopupProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom' | 'top-left';
}

const DISMISS_THRESHOLD = 100;
const ACTIVE_POPUP_COUNT_ATTR = 'data-mobile-bottom-popup-count';
const ACTIVE_POPUP_OPEN_ATTR = 'data-mobile-bottom-popup-open';
const SCROLL_LOCK_Y_ATTR = 'data-mobile-bottom-popup-scroll-y';

function isScrollableOverflow(overflowY: string) {
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/** Allow touchmove only inside a scrollable sheet region that still has room to scroll. */
function touchMoveAllowed(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  let el: Element | null = target;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement) {
      const style = window.getComputedStyle(el);
      if (isScrollableOverflow(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function lockBodyScroll() {
  if (document.body.hasAttribute(SCROLL_LOCK_Y_ATTR)) return;

  const scrollY = window.scrollY;
  document.body.setAttribute(SCROLL_LOCK_Y_ATTR, String(scrollY));
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.documentElement.style.overscrollBehavior = 'none';
}

function unlockBodyScroll() {
  const raw = document.body.getAttribute(SCROLL_LOCK_Y_ATTR);
  if (raw === null) return;

  const scrollY = Number(raw) || 0;
  document.body.removeAttribute(SCROLL_LOCK_Y_ATTR);
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.documentElement.style.overscrollBehavior = '';
  window.scrollTo(0, scrollY);
}

export default function BottomPopup({ isOpen, onClose, children, placement = 'bottom' }: BottomPopupProps) {
  const [translateY, setTranslateY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const isTopLeft = placement === 'top-left';
  const pointerStartY = useRef(0);
  const currentTranslateY = useRef(0);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setTranslateY(0);
      onClose();
    }, 200);
  }, [onClose]);

  const handlePointerStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartY.current = e.clientY;
    currentTranslateY.current = translateY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [translateY]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const deltaY = e.clientY - pointerStartY.current;
    if (deltaY > 0) {
      setTranslateY(currentTranslateY.current + deltaY);
    }
  }, []);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (currentTranslateY.current + Math.max(e.clientY - pointerStartY.current, 0) > DISMISS_THRESHOLD) {
      handleClose();
    } else {
      setTranslateY(0);
    }
  }, [handleClose]);

  useEffect(() => {
    if (!isOpen && !isClosing) {
      return;
    }

    const currentCount = Number(document.body.getAttribute(ACTIVE_POPUP_COUNT_ATTR) || '0');
    document.body.setAttribute(ACTIVE_POPUP_COUNT_ATTR, String(currentCount + 1));
    document.body.setAttribute(ACTIVE_POPUP_OPEN_ATTR, 'true');
    if (currentCount === 0) {
      lockBodyScroll();
    }

    const onTouchMove = (event: TouchEvent) => {
      if (touchMoveAllowed(event.target)) return;
      event.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      document.removeEventListener('touchmove', onTouchMove);

      const nextCount = Math.max(
        Number(document.body.getAttribute(ACTIVE_POPUP_COUNT_ATTR) || '1') - 1,
        0,
      );

      if (nextCount === 0) {
        document.body.removeAttribute(ACTIVE_POPUP_COUNT_ATTR);
        document.body.removeAttribute(ACTIVE_POPUP_OPEN_ATTR);
        unlockBodyScroll();
      } else {
        document.body.setAttribute(ACTIVE_POPUP_COUNT_ATTR, String(nextCount));
      }
    };
  }, [isOpen, isClosing]);

  if (!isOpen && !isClosing) return null;

  const popupContent = (
    <div
      className={`fixed inset-0 z-site-overlay transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
    >
      <div
        className={`absolute inset-0 touch-none ${uiSurfaces.modalBackdrop}`}
        onClick={handleClose}
        aria-hidden
      />
      <div
        data-mobile-popup-placement={placement}
        className={`absolute overscroll-contain ${isTopLeft ? 'libereal-mobile-top-popup transition-[opacity,transform] duration-200 ease-out' : 'left-0 right-0 rounded-t-[var(--brand-border-radius-lg)] transition-transform duration-200 ease-out libereal-mobile-bottom-sheet'} ${uiSurfaces.modal} ${isClosing ? (isTopLeft ? '-translate-y-2 scale-[.98] opacity-0' : 'translate-y-full') : ''}`}
        style={isTopLeft ? undefined : { transform: `translateY(${translateY}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {!isTopLeft && (
          <div
            className="flex touch-none cursor-grab justify-center pt-3 pb-2 active:cursor-grabbing"
            onPointerDown={handlePointerStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            aria-label="拖动关闭"
          >
            <div className="h-1.5 w-12 rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-primary)]" />
          </div>
        )}
        {children}
      </div>
    </div>
  );

  return createPortal(popupContent, document.body);
}
