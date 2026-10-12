'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import MathText from '@/components/MathText';
import {
  clearBasket,
  getBasket,
  removeFromBasket,
  removeManyFromBasket,
  starsFromDifficulty,
  stripFrontmatter,
  BASKET_EVENT,
  BENCH_HINT_KEY,
  type BasketItem,
} from '@/lib/basket';
import styles from './page.module.css';

type SortKey = 'added' | 'type' | 'difficulty' | 'source';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'added', label: '加入顺序' },
  { value: 'type', label: '按题型' },
  { value: 'difficulty', label: '按难度' },
  { value: 'source', label: '按来源' },
];

export default function ExamBasketPage() {
  const router = useRouter();
  const [items, setItems] = useState<BasketItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [typeFilter, setTypeFilter] = useState('');
  const [copyHint, setCopyHint] = useState('');

  const reload = useCallback(() => {
    setItems(getBasket());
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(BASKET_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(BASKET_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, [reload]);

  const typeOptions = useMemo(
    () => Array.from(new Set(items.map((x) => x.type).filter(Boolean))),
    [items]
  );

  const view = useMemo(() => {
    let list = [...items];
    if (typeFilter) list = list.filter((x) => x.type === typeFilter);
    switch (sortKey) {
      case 'type':
        list.sort((a, b) => a.type.localeCompare(b.type, 'zh'));
        break;
      case 'difficulty':
        list.sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
        break;
      case 'source':
        list.sort((a, b) => a.source.localeCompare(b.source, 'zh'));
        break;
      default:
        list.sort((a, b) => a.addedAt - b.addedAt);
    }
    return list;
  }, [items, typeFilter, sortKey]);

  /* ---------- 操作 ---------- */
  const toggleExpand = (qid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(qid) ? next.delete(qid) : next.add(qid);
      return next;
    });

  const toggleCheck = (qid: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(qid) ? next.delete(qid) : next.add(qid);
      return next;
    });

  const allChecked = view.length > 0 && view.every((x) => checked.has(x.qid));

  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(view.map((x) => x.qid)));

  const handleRemove = (qid: string) => {
    removeFromBasket(qid);
    setChecked((prev) => {
      const n = new Set(prev);
      n.delete(qid);
      return n;
    });
  };

  const handleRemoveSelected = () => {
    if (checked.size === 0) return;
    if (!confirm(`确认从试题篮移除选中的 ${checked.size} 道题？`)) return;
    removeManyFromBasket([...checked]);
    setChecked(new Set());
  };

  const handleClear = () => {
    if (items.length === 0) return;
    if (!confirm(`确认清空试题篮（共 ${items.length} 道题）？`)) return;
    clearBasket();
    setChecked(new Set());
  };

  const handleCopy = async () => {
    const source = checked.size > 0 ? view.filter((x) => checked.has(x.qid)) : view;
    if (source.length === 0) return;
    const text = source
      .map((x) => x.raw)
      .join('\n\n==========\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyHint(`已复制 ${source.length} 道题`);
      setTimeout(() => setCopyHint(''), 2000);
    } catch {
      setCopyHint('复制失败，请检查浏览器权限');
      setTimeout(() => setCopyHint(''), 2500);
    }
  };

  /** 把（选中的）题目带到「编讲义」页 */
  const goToHandout = () => {
    const qids = checked.size > 0 ? [...checked] : undefined;
    try {
      sessionStorage.setItem(
        BENCH_HINT_KEY,
        JSON.stringify(qids ? { qids } : { all: true })
      );
    } catch {
      /* 忽略 */
    }
    router.push('/handout');
  };

  return (
    <AppShell>
      <div className="hm-page-head">
        <div>
          <h1 className="hm-page-title">试题篮</h1>
          <p className="hm-page-sub">
            共 <strong>{items.length}</strong> 道候选题目
            {checked.size > 0 && <span className="hm-muted"> · 已选 {checked.size}</span>}
          </p>
        </div>

        <div className={styles.headActions}>
          <Link href="/" className="hm-btn">
            ← 去选题
          </Link>
          <button
            type="button"
            className="hm-btn hm-btn-primary"
            onClick={goToHandout}
            disabled={items.length === 0}
            title="把题目带到编讲义页"
          >
            📝 去编讲义{checked.size > 0 ? `（选中 ${checked.size}）` : '（全部）'}
          </button>
        </div>
      </div>

      {copyHint && <div className="hm-alert hm-alert-success">{copyHint}</div>}

      {items.length === 0 ? (
        <div className="hm-card hm-card-pad">
          <div className="hm-empty">
            <div style={{ fontSize: '2.4rem', marginBottom: 'var(--space-3)' }}>🧺</div>
            <div>试题篮还是空的</div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
              到 <Link href="/">选题</Link> 页勾选题目，点「加入试题篮」即可。
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 工具栏 */}
          <div className={styles.toolbar}>
            <label className={styles.checkAll}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              全选
            </label>

            <label className={styles.field}>
              题型
              <select
                className="hm-select"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">全部</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              排序
              <select
                className="hm-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.spacer} />

            <button type="button" className="hm-btn hm-btn-sm" onClick={handleCopy}>
              📋 复制 Markdown
            </button>
            <button
              type="button"
              className="hm-btn hm-btn-sm"
              onClick={handleRemoveSelected}
              disabled={checked.size === 0}
            >
              🗑️ 移除选中
            </button>
            <button type="button" className={`hm-btn hm-btn-sm ${styles.dangerBtn}`} onClick={handleClear}>
              清空
            </button>
          </div>

          {/* 列表 */}
          <div className={styles.list}>
            {view.map((it) => {
              const isOpen = expanded.has(it.qid);
              const isChecked = checked.has(it.qid);
              return (
                <div
                  key={it.qid}
                  className={`${styles.item} ${isChecked ? styles.itemChecked : ''}`}
                >
                  <div className={styles.itemHead}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheck(it.qid)}
                      className={styles.itemCheck}
                    />
                    <div className={styles.itemMain} onClick={() => toggleExpand(it.qid)}>
                      <div className={styles.itemTitle}>
                        <span className={styles.itemSource}>{it.source || '未标来源'}</span>
                        {it.number && <span className={styles.itemNumber}>T{it.number}</span>}
                        {it.type && <span className="hm-badge">{it.type}</span>}
                        <span className={styles.stars} title={`难度 ${it.difficulty ?? '—'}`}>
                          {starsFromDifficulty(it.difficulty)}
                        </span>
                        <span className={styles.itemQid}>#{it.qid}</span>
                      </div>
                      {!isOpen && it.preview && (
                        <div className={styles.itemPreview}>{it.preview}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.expandBtn}
                      onClick={() => toggleExpand(it.qid)}
                      aria-label={isOpen ? '收起' : '展开'}
                    >
                      {isOpen ? '▴' : '▾'}
                    </button>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => handleRemove(it.qid)}
                      title="从试题篮移除"
                      aria-label="移除"
                    >
                      ✕
                    </button>
                  </div>

                  {isOpen && (
                    <div className={styles.itemBody}>
                      {(it.knowledge.length > 0 || it.chapter.length > 0) && (
                        <div className={styles.itemMeta}>
                          {it.chapter.length > 0 && <span>章：{it.chapter.join('、')}</span>}
                          {it.section.length > 0 && <span>节：{it.section.join('、')}</span>}
                          {it.knowledge.length > 0 && <span>知识点：{it.knowledge.join('、')}</span>}
                        </div>
                      )}
                      <MathText text={stripFrontmatter(it.raw)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
