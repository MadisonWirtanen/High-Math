'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import ThemeToggle from './ThemeToggle';
import { useConfig } from './ConfigProvider';
import { getBasket } from '@/lib/basket';
import styles from './AppShell.module.css';

/** 一级菜单（高频） */
const PRIMARY_NAV = [
  { href: '/', label: '选题', icon: '📋' },
  { href: '/examBasket', label: '试题篮', icon: '🧺' },
  { href: '/handout', label: '编讲义', icon: '📝' },
];

/** 二级菜单（低频） */
const SECONDARY_NAV = [
  { href: '/add', label: '添加题目', icon: '➕' },
  { href: '/settings', label: '设置', icon: '⚙️' },
];

export default function AppShell({
  children,
  variant = 'default',
  actions,
  title,
}: {
  children: React.ReactNode;
  /** default: 居中带内边距容器；full: 全高双栏工作区（添加题目 / 试题篮 / 编讲义） */
  variant?: 'default' | 'full';
  /** 页面级操作按钮，渲染在头部右侧 */
  actions?: React.ReactNode;
  /** 顶部副标题（可选） */
  title?: string;
}) {
  const pathname = usePathname();
  const { reload } = useConfig();
  const [refreshing, setRefreshing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [basketCount, setBasketCount] = useState(0);
  const moreRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const moreActive = SECONDARY_NAV.some((i) => isActive(i.href));

  // 试题篮数量徽标
  useEffect(() => {
    const sync = () => {
      try {
        setBasketCount(getBasket().length);
      } catch {
        setBasketCount(0);
      }
    };
    sync();
    window.addEventListener('highmath:basket', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('highmath:basket', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // 点击外部关闭二级菜单
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  // 路由变化时收起二级菜单
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/questions/meta?refresh=1', { cache: 'no-store' });
      await reload();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('highmath:refresh'));
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              {/* 品牌标识：与桌面应用 / favicon 同一套图标（深靛紫底 + 正弦曲线） */}
              <svg viewBox="0 0 256 256" width="32" height="32" focusable="false">
                <defs>
                  <linearGradient
                    id="hmLogoBase"
                    gradientUnits="userSpaceOnUse"
                    x1="26"
                    y1="250"
                    x2="230"
                    y2="16"
                  >
                    <stop offset="0" stopColor="#16357F" />
                    <stop offset="0.26" stopColor="#22358F" />
                    <stop offset="0.52" stopColor="#332FA1" />
                    <stop offset="0.76" stopColor="#4527AC" />
                    <stop offset="1" stopColor="#5A21B6" />
                  </linearGradient>
                  <radialGradient
                    id="hmLogoWarm"
                    gradientUnits="userSpaceOnUse"
                    cx="204"
                    cy="28"
                    r="158"
                  >
                    <stop offset="0" stopColor="#FFCF63" stopOpacity="0.44" />
                    <stop offset="0.2" stopColor="#F9B449" stopOpacity="0.31" />
                    <stop offset="0.42" stopColor="#E29A4B" stopOpacity="0.18" />
                    <stop offset="0.64" stopColor="#BC7C63" stopOpacity="0.088" />
                    <stop offset="0.83" stopColor="#996573" stopOpacity="0.03" />
                    <stop offset="1" stopColor="#8B5A78" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient
                    id="hmLogoGloss"
                    gradientUnits="userSpaceOnUse"
                    x1="128"
                    y1="8"
                    x2="128"
                    y2="150"
                  >
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.13" />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                  </linearGradient>
                  <clipPath id="hmLogoClip">
                    <rect x="8" y="8" width="240" height="240" rx="56" />
                  </clipPath>
                </defs>
                <g clipPath="url(#hmLogoClip)">
                  <rect x="8" y="8" width="240" height="240" fill="url(#hmLogoBase)" />
                  <rect x="8" y="8" width="240" height="240" fill="url(#hmLogoWarm)" />
                  <rect x="8" y="8" width="240" height="240" fill="url(#hmLogoGloss)" />
                </g>
                <rect
                  x="8"
                  y="8"
                  width="240"
                  height="240"
                  rx="56"
                  fill="none"
                  stroke="#8E7BE0"
                  strokeOpacity="0.38"
                  strokeWidth="1.5"
                />
                <path
                  d="M44 128C62.667 66.667 81.333 66.667 100 128C118.667 189.333 137.333 189.333 156 128C174.667 66.667 193.333 66.667 212 128"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className={styles.brandText}>
              <span className={styles.brandName}>HighMath</span>
              <span className={styles.brandTag}>{title || '高中数学题库工作台'}</span>
            </span>
          </Link>

          <nav className={styles.nav}>
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${
                  isActive(item.href) ? styles.navLinkActive : ''
                }`}
                title={item.label}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                {item.href === '/examBasket' && basketCount > 0 && (
                  <span className={styles.navBadge}>{basketCount}</span>
                )}
              </Link>
            ))}

            {/* 二级菜单：更多 */}
            <div className={styles.moreWrap} ref={moreRef}>
              <button
                type="button"
                className={`${styles.navLink} ${styles.moreBtn} ${
                  moreActive || moreOpen ? styles.navLinkActive : ''
                }`}
                onClick={() => setMoreOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                title="更多"
              >
                <span className={styles.navIcon}>☰</span>
                <span>更多</span>
                <span className={`${styles.caret} ${moreOpen ? styles.caretUp : ''}`}>
                  ▾
                </span>
              </button>

              {moreOpen && (
                <div className={styles.dropdown} role="menu">
                  {SECONDARY_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={`${styles.dropdownItem} ${
                        isActive(item.href) ? styles.dropdownItemActive : ''
                      }`}
                      onClick={() => setMoreOpen(false)}
                    >
                      <span className={styles.dropdownIcon}>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className={styles.actions}>
            {actions}
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleRefresh}
              disabled={refreshing}
              title="重新扫描题库目录"
              aria-label="刷新题库"
            >
              <span className={refreshing ? styles.spin : ''}>🔄</span>
            </button>
            <ThemeToggle className={styles.iconButton} />
          </div>
        </div>
      </header>

      <main className={variant === 'full' ? styles.mainFull : styles.main}>
        {variant === 'full' ? (
          children
        ) : (
          <div className={styles.container}>{children}</div>
        )}
      </main>
    </>
  );
}
