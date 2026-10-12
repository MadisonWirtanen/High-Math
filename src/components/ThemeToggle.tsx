'use client';

import { useState, useEffect } from 'react';

export default function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const isDark = stored === 'dark';
    setDark(isDark);
    setMounted(true);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('theme', next ? 'dark' : '');
  };

  const base: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    cursor: 'pointer',
    fontSize: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    transition:
      'background-color var(--dur-fast) var(--ease-in-out), color var(--dur-fast) var(--ease-in-out), border-color var(--dur-fast) var(--ease-in-out)',
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      style={className ? undefined : base}
      title={dark ? '切换到浅色模式' : '切换到深色模式'}
      aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
    >
      {mounted ? (dark ? '☀️' : '🌙') : '🌓'}
    </button>
  );
}
