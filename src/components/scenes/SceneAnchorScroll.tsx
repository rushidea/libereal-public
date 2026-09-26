'use client';

import { useEffect } from 'react';

/** Scroll to hash target on direct URL load (e.g. /scenes/elisa#difficulty). */
export default function SceneAnchorScroll() {
  useEffect(() => {
    document.documentElement.classList.add('scroll-smooth');

    const scrollToHash = () => {
      const { hash } = window.location;
      if (!hash) return;
      const target = document.querySelector(hash);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);

    return () => {
      document.documentElement.classList.remove('scroll-smooth');
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, []);

  return null;
}
