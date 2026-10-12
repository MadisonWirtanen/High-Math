'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import FilterableTable from '@/components/FilterableTable';
import AppShell from '@/components/AppShell';
import { useConfig } from '@/components/ConfigProvider';

export default function Home() {
  const { config, loading: configLoading, reload } = useConfig();
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/questions/meta${force ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      setQuestions(await res.json());
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 顶部「刷新题库」按钮触发时同步本页数据
  useEffect(() => {
    const onRefresh = () => fetchData(true);
    window.addEventListener('highmath:refresh', onRefresh);
    return () => window.removeEventListener('highmath:refresh', onRefresh);
  }, [fetchData]);

  const bankMissing = !configLoading && !!config.vaultPath && !config.bankDirExists;

  return (
    <AppShell>
      <div className="hm-page-head">
        <div>
          <h1 className="hm-page-title">题目总览</h1>
          <p className="hm-page-sub">
            共 <strong>{questions.length}</strong> 道题目
            {config.sourceCount > 0 && (
              <span className="hm-muted"> · {config.sourceCount} 个来源</span>
            )}
            {config.knowledgeCount > 0 && (
              <span className="hm-muted">
                {' '}
                · 知识点库 {config.chapterCount} 章 / {config.sectionCount} 节 /{' '}
                {config.knowledgeCount} 知识点
              </span>
            )}
          </p>
        </div>
        <Link href="/add" className="hm-btn hm-btn-primary">
          <span>＋</span> 添加题目
        </Link>
      </div>

      {bankMissing && (
        <div className="hm-alert hm-alert-warn">
          <span className="hm-alert-icon">⚠️</span>
          <div>
            未找到题库目录 <code>{config.bankDir}</code>，请到{' '}
            <Link href="/settings">设置</Link> 中指定正确的题库文件夹。
          </div>
        </div>
      )}

      {loading ? (
        <div className="hm-card hm-card-pad">
          <div className="hm-skeleton" style={{ height: 38, marginBottom: 12 }} />
          <div className="hm-skeleton" style={{ height: 240 }} />
        </div>
      ) : (
        <FilterableTable questions={questions} />
      )}
    </AppShell>
  );
}
