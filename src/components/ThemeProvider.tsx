'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  toggleTheme: () => {},
  setTheme: () => {},
  mounted: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyBackground(theme: Theme) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
  const isDark = effectiveTheme === 'dark';
  document.body.style.removeProperty('background-color');
  html.classList.toggle('dark', isDark);
  html.classList.toggle('light', !isDark);
  // 同步 Safari 状态栏/地址栏区域颜色 = 页面背景色（视觉铺满全屏）
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#243851' : '#ecfdf5');
}

const VALID_THEMES: Theme[] = ['light', 'dark', 'system'];

function resolveStoredTheme(stored: string | null): Theme {
  if (stored && VALID_THEMES.includes(stored as Theme)) {
    return stored as Theme;
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const initial = resolveStoredTheme(stored);
    if (!stored) {
      localStorage.setItem('theme', 'system');
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(initial);
    applyBackground(initial);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyBackground('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    try {
      const current = localStorage.getItem('theme') as Theme | null;
      const currentTheme = current ?? 'system';
      const nextTheme = currentTheme === 'light' ? 'dark' : currentTheme === 'dark' ? 'system' : 'light';
      setThemeState(nextTheme);
      localStorage.setItem('theme', nextTheme);
      applyBackground(nextTheme);
    } catch (e) {
      console.error('toggleTheme error:', e);
    }
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    try {
      setThemeState(newTheme);
      localStorage.setItem('theme', newTheme);
      applyBackground(newTheme);
    } catch (e) {
      console.error('setTheme error:', e);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}
