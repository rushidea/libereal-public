'use client';

import { useEffect } from 'react';

/**
 * Client component that initializes theme class on <html> before React hydration.
 * This runs synchronously in useEffect, which is safe for client-side only.
 */
export default function ThemeInit() {
  useEffect(() => {
    try {
      const html = document.documentElement;
      const theme = localStorage.getItem('theme') || 'system';
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      html.classList.toggle('dark', isDark);
      html.classList.toggle('light', !isDark);
    } catch (e) {
      // localStorage may be blocked
    }
  }, []);

  return null;
}
