'use client';

/**
 * src/components/ConfigProvider.tsx
 *
 * 客户端配置上下文：替代原来的 clientEnv（构建期烘焙的 NEXT_PUBLIC_*）。
 * 改为运行时从 /api/config 拉取，这样桌面端用户切换题库目录后立即生效。
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

export interface ClientConfig {
  vaultPath: string;
  vaultName: string;
  vaultRoot: string;
  bankDir: string;
  imagesDir: string;
  defaultGrade: string;
  gradeList: string[];
  subjectSuffix: string;
  knowledgeTable: string | null;
  knowledgeCount: number;
  chapterCount: number;
  sectionCount: number;
  bankDirExists: boolean;
  questionCount: number;
  sourceCount: number;
  isDesktop: boolean;
}

const FALLBACK: ClientConfig = {
  vaultPath: '',
  vaultName: '高中数学',
  vaultRoot: '',
  bankDir: '',
  imagesDir: '',
  defaultGrade: '高中',
  gradeList: ['初中', '高中'],
  subjectSuffix: '数学',
  knowledgeTable: null,
  knowledgeCount: 0,
  chapterCount: 0,
  sectionCount: 0,
  bankDirExists: false,
  questionCount: 0,
  sourceCount: 0,
  isDesktop: false,
};

interface Ctx {
  config: ClientConfig;
  loading: boolean;
  reload: () => Promise<void>;
}

const ConfigContext = createContext<Ctx>({
  config: FALLBACK,
  loading: true,
  reload: async () => {},
});

/** 是否运行在桌面外壳中 */
export function detectDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).highmath?.isDesktop);
}

/** 调用桌面外壳的原生目录选择（非桌面环境返回 null） */
export async function pickDirectory(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as any).highmath;
  if (!api?.selectDirectory) return null;
  try {
    return await api.selectDirectory();
  } catch {
    return null;
  }
}

/**
 * 生成 Obsidian 跳转链接。
 * filePath 是题目的绝对路径，vaultRoot 是 Vault 根目录，取相对路径作为 file 参数。
 */
export function obsidianLink(vaultName: string, vaultRoot: string, filePath: string): string {
  const norm = (s: string) => (s || '').replace(/\\/g, '/');
  let rel = norm(filePath);
  const root = norm(vaultRoot).replace(/\/+$/, '');
  if (root && rel.startsWith(root + '/')) rel = rel.slice(root.length + 1);
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(rel)}`;
}

export function ConfigProvider({ children }: { children: ReactNode }) {  const [config, setConfig] = useState<ClientConfig>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setConfig({ ...FALLBACK, ...data, isDesktop: detectDesktop() });
    } catch {
      setConfig({ ...FALLBACK, isDesktop: detectDesktop() });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <ConfigContext.Provider value={{ config, loading, reload }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): Ctx {
  return useContext(ConfigContext);
}
