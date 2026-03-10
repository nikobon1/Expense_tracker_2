'use client';

import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem('expense-theme-mode');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeToggle() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    window.localStorage.setItem('expense-theme-mode', themeMode);
  }, [themeMode]);

  return (
    <button
      type="button"
      className="theme-toggle-global"
      onClick={() => setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
    >
      {themeMode === 'light' ? 'Тёмная тема' : 'Светлая тема'}
    </button>
  );
}

