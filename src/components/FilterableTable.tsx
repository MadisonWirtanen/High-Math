'use client';
import { useRouter } from 'next/navigation';
import { useState, useMemo, useEffect, Fragment } from 'react';
import type { QuestionMetaLight } from '@/lib/questions';
import {
  buildDocumentMarkdown,
  DEFAULT_HANDOUT_SETTINGS,
  toStrArray,
  type Block,
  type HandoutQuestion,
  type QuestionSource,
} from '@/lib/handout';
import { downloadMarkdownZip, exportWord } from '@/lib/handoutExport';
import { makeBasketItem, addToBasket, type BasketItem } from '@/lib/basket';
import { useConfig, obsidianLink } from '@/components/ConfigProvider';
import MathText from '@/components/MathText';
import BrowseView from '@/components/BrowseView';
import styles from './FilterableTable.module.css';

const PAGE_SIZE = 25;
const BROWSE_PAGE_SIZE = 10;

/** 三级分类树（来自 /api/knowledge?tree=1） */
interface TaxonomySection {
  name: string;
  knowledge: string[];
}
interface TaxonomyChapter {
  chapter: string;
  sections: TaxonomySection[];
}

export default function FilterableTable({ questions }: { questions: QuestionMetaLight[] }) {
  const { config } = useConfig();
  const [grade, setGrade] = useState('');
  const [showSourceTips, setShowSourceTips] = useState(false);
  const [source, setSource] = useState('');
  const [numberMin, setNumberMin] = useState('');
  const [numberMax, setNumberMax] = useState('');
  const [examType, setExamType] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  // 三级筛选：章 → 节 → 知识点
  const [chapter, setChapter] = useState('');
  const [section, setSection] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [tag, setTag] = useState('');
  const [qidInput, setQidInput] = useState('');
  const [page, setPage] = useState(1);
  const [expandedQid, setExpandedQid] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [selectedQids, setSelectedQids] = useState<Set<number>>(new Set());
  // 新增：记录用户勾选的先后顺序
  const [selectOrder, setSelectOrder] = useState<number[]>([]);
  const [loadedContents, setLoadedContents] = useState<Record<number, Record<string, string>>>({});
  const [loadingQid, setLoadingQid] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'browse'>('table');
  const [sortBy, setSortBy] = useState<'source' | 'number' | 'difficulty' | 'type'>('source');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const router = useRouter();
  const grades = useMemo(() => [...new Set(questions.map(q => q.grade).filter(Boolean))].sort(), [questions]);
  const sources = useMemo(() => [...new Set(questions.map(q => q.source).filter(Boolean))].sort(), [questions]);
  const examTypes = useMemo(() => [...new Set(questions.map(q => q.exam_type).filter(Boolean))].sort(), [questions]);

  // ===== 三级分类（章 → 节 → 知识点）=====
  // 从知识点总表拉取完整三级树，保证选项顺序与教材一致；
  // 再与题库实际数据求交，避免下拉里出现「选了没结果」的空选项。
  const [taxonomy, setTaxonomy] = useState<TaxonomyChapter[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/knowledge?tree=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setTaxonomy(Array.isArray(d.tree) ? d.tree : []); })
      .catch(() => { if (!cancelled) setTaxonomy([]); });
    return () => { cancelled = true; };
  }, []);

  /** 题库中实际出现的章 */
  const chapterOptions = useMemo(() => {
    const present = new Set(questions.flatMap(q => q.chapter || []).filter(Boolean));
    const ordered = taxonomy.map(t => t.chapter).filter(c => present.has(c));
    const extra = [...present].filter(c => !ordered.includes(c)).sort();
    return [...ordered, ...extra];
  }, [questions, taxonomy]);

  /** 当前章下的节（未选章则为全部） */
  const sectionOptions = useMemo(() => {
    const inScope = chapter
      ? questions.filter(q => (q.chapter || []).includes(chapter))
      : questions;
    const present = new Set(inScope.flatMap(q => q.section || []).filter(Boolean));
    const ordered = (chapter
      ? (taxonomy.find(t => t.chapter === chapter)?.sections ?? [])
      : taxonomy.flatMap(t => t.sections)
    ).map(s => s.name).filter(s => present.has(s));
    const extra = [...present].filter(s => !ordered.includes(s)).sort();
    return [...ordered, ...extra];
  }, [questions, taxonomy, chapter]);

  /** 当前节下的知识点（未选节则按当前章） */
  const knowledgeOptions = useMemo(() => {
    const inScope = questions.filter(q =>
      (!chapter || (q.chapter || []).includes(chapter)) &&
      (!section || (q.section || []).includes(section))
    );
    const present = new Set(inScope.flatMap(q => q.knowledge || []).filter(Boolean));
    const ordered = (section
      ? (taxonomy.flatMap(t => t.sections).find(s => s.name === section)?.knowledge ?? [])
      : (chapter
        ? (taxonomy.find(t => t.chapter === chapter)?.sections ?? []).flatMap(s => s.knowledge)
        : taxonomy.flatMap(t => t.sections).flatMap(s => s.knowledge))
    ).filter(k => present.has(k));
    const extra = [...present].filter(k => !ordered.includes(k)).sort();
    return [...ordered, ...extra];
  }, [questions, taxonomy, chapter, section]);

  const tags = useMemo(() => [...new Set(questions.flatMap(q => q.tags).filter(Boolean))].sort(), [questions]);

  const qidOrder = useMemo(() => {
    return qidInput
      .split(/[\n, ]+/)
      .filter(s => s.trim() !== '')
      .map(s => Number(s.trim()))
      .filter(n => !isNaN(n));
  }, [qidInput]);

  const qidSet = useMemo(() => new Set(qidOrder), [qidOrder]);

  const toNum = (numStr: string) => parseInt(numStr.replace(/^[A-Za-z]+/, ''), 10);

  const filtered = (() => {
    const base = questions.filter(q => {
      if (qidSet.size > 0 && !qidSet.has(q.qid)) return false;
      if (grade && q.grade !== grade) return false;
      if (source && q.source !== source) return false;
      if (examType && q.exam_type !== examType) return false;
      const num = toNum(q.number);
      if (numberMin && num < Number(numberMin)) return false;
      if (numberMax && num > Number(numberMax)) return false;
      if (difficultyMin && q.difficulty < Number(difficultyMin)) return false;
      if (difficultyMax && q.difficulty > Number(difficultyMax)) return false;
      if (chapter && !(q.chapter || []).includes(chapter)) return false;
      if (section && !(q.section || []).includes(section)) return false;
      if (knowledge && !q.knowledge.includes(knowledge)) return false;
      if (tag && !q.tags.includes(tag)) return false;
      return true;
    });
    // 按输入框的 qid 顺序排列（优先级最高）
    if (qidOrder.length > 0) {
      const idx = new Map(qidOrder.map((id, i) => [id, i]));
      base.sort((a, b) => {
        const ai = idx.get(a.qid) ?? Infinity;
        const bi = idx.get(b.qid) ?? Infinity;
        return ai - bi;
      });
    } else {
      // 用户选择的排序
      const dir = sortOrder === 'asc' ? 1 : -1;
      base.sort((a, b) => {
        let va: string | number, vb: string | number;
        switch (sortBy) {
          case 'number':
            va = toNum(a.number); vb = toNum(b.number); break;
          case 'difficulty':
            va = a.difficulty ?? 0; vb = b.difficulty ?? 0; break;
          case 'type':
            va = a.type || ''; vb = b.type || ''; break;
          case 'source':
          default:
            va = a.source; vb = b.source; break;
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return base;
  })();

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [grade, source, numberMin, numberMax, examType, difficultyMin, difficultyMax, chapter, section, knowledge, tag, qidInput, viewMode]);

  const pageSize = viewMode === 'browse' ? BROWSE_PAGE_SIZE : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const clearAll = () => {
    setGrade(''); setSource(''); setNumberMin(''); setNumberMax('');
    setExamType(''); setDifficultyMin(''); setDifficultyMax('');
    setChapter(''); setSection(''); setKnowledge(''); setTag(''); setQidInput('');
    setSelectedQids(new Set());
    setSelectOrder([]); // 清空勾选顺序
  };

  // ========== 修复：重写 handoutQuestions 排序逻辑 ==========
  const handoutQuestions = useMemo(() => {
    // 优先级1：手动输入qid列表，最高优先
    if (qidOrder.length > 0) {
      const idxMap = new Map(qidOrder.map((id, i) => [id, i]));
      return questions
        .filter(q => idxMap.has(q.qid))
        .sort((a, b) => idxMap.get(a.qid)! - idxMap.get(b.qid)!);
    }
    // 优先级2：手动勾选题目，严格按照勾选先后顺序
    if (selectedQids.size > 0) {
      const selectedList = questions.filter(q => selectedQids.has(q.qid));
      return [...selectedList].sort((a, b) => {
        const indexA = selectOrder.indexOf(a.qid);
        const indexB = selectOrder.indexOf(b.qid);
        return indexA - indexB;
      });
    }
    // 优先级3：无输入无勾选，使用筛选后的默认列表
    return filtered;
  }, [qidOrder, selectedQids, selectOrder, questions, filtered]);

  /** 加载缺失的正文内容，取回后合并到缓存 */
  const fetchMissing = async (qids: number[]): Promise<Record<number, Record<string, string>>> => {
    const needed = [...new Set(qids.filter(qid => !loadedContents[qid]))];
    if (needed.length === 0) return loadedContents;

    const results = await Promise.all(needed.map(async (qid) => {
      try {
        const res = await fetch(`/api/questions/${qid}`);
        if (res.ok) {
          return { qid, sections: (await res.json()).sections as Record<string, string> };
        }
      } catch { /* ignore */ }
      return { qid, sections: null as null | Record<string, string> };
    }));

    const fresh: Record<number, Record<string, string>> = {};
    for (const r of results) {
      if (r.sections) fresh[r.qid] = r.sections;
    }

    setLoadedContents(prev => ({ ...prev, ...fresh }));
    return { ...loadedContents, ...fresh };
  };

  /** 把当前勾选/筛选结果映射成生成器需要的题目结构 */
  const buildSourceMap = (contents: Record<number, Record<string, string>>) => {
    const map = new Map<string, QuestionSource>();
    for (const q of handoutQuestions) {
      const key = String(q.qid);
      const hq: HandoutQuestion = {
        qid: key,
        source: q.source || '',
        number: q.number || '',
        type: q.type || '',
        grade: q.grade || '',
        semester: q.semester || '',
        exam_type: q.exam_type || '',
        difficulty: q.difficulty ?? null,
        chapter: toStrArray(q.chapter),
        section: toStrArray(q.section),
        knowledge: toStrArray(q.knowledge),
        tags: toStrArray(q.tags),
      };
      map.set(key, { q: hq, sections: contents[q.qid] || {} });
    }
    return map;
  };

  /** 生成讲义 markdown（首页导出使用默认排版设置） */
  const buildMarkdown = async () => {
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const sources = buildSourceMap(allContents);
    const blocks: Block[] = handoutQuestions.map(q => ({
      id: `q_${q.qid}`,
      type: 'question',
      qid: String(q.qid),
    }));
    return buildDocumentMarkdown({
      blocks,
      settings: DEFAULT_HANDOUT_SETTINGS,
      getQuestion: (qid) => sources.get(qid),
    });
  };

  /** 复制为 Markdown */
  const copyAsMarkdown = async () => {
    if (handoutQuestions.length === 0) { alert('请先勾选题目'); return; }
    const { markdown } = await buildMarkdown();
    await navigator.clipboard.writeText(markdown);
    alert(`已复制 ${handoutQuestions.length} 道题目（含完整题干）到剪贴板`);
  };

  /** 打包下载 zip（讲义 .md + 图片） */
  const downloadZip = async () => {
    if (handoutQuestions.length === 0) { alert('请先勾选题目'); return; }
    const { markdown, imageMap } = await buildMarkdown();
    await downloadMarkdownZip('讲义', markdown, imageMap);
  };

  /** 导出勾选题目为 Word .docx（优先 Pandoc，失败走浏览器端兜底） */
  const downloadWord = async () => {
    if (handoutQuestions.length === 0) { alert('请先勾选题目'); return; }
    const { markdown, imageMap } = await buildMarkdown();
    try {
      const result = await exportWord(markdown, imageMap, 'HighMath_讲义');
      if (result.channel === 'browser' && result.failedImages > 0) {
        alert(`Word 已生成（浏览器端兜底），但有 ${result.failedImages} 张图片缺失`);
      }
    } catch (e) {
      alert('Word 导出失败：' + ((e as Error).message || '未知错误'));
    }
  };

  /** 将勾选的题目加入试题栏 */
  const addToQuestionBar = async () => {
    // 改为检查 selectedQids 是否有值
    if (selectedQids.size === 0) {
      alert('请先勾选题目');
      return;
    }

    // 获取所有勾选题目的完整内容
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));

    // 组装成 AddPage 能识别的格式（与粘贴板格式一致）
    const blocks: string[] = [];

    for (const q of handoutQuestions) {
      const s = allContents[q.qid];
      if (!s) continue;

      // 构建 YAML frontmatter
      const yamlLines = [
        '---',
        `qid: ${q.qid}`,
        `grade: ${q.grade || ''}`,
        `source: ${q.source || ''}`,
        `number: ${q.number || ''}`,
        `type: ${q.type || ''}`,
        `difficulty: ${q.difficulty ?? ''}`,
        `semester: ${q.semester || ''}`,
        `exam_type: ${q.exam_type || ''}`,
        `chapter: [${(q.chapter || []).join(', ')}]`,
        `section: [${(q.section || []).join(', ')}]`,
        `knowledge: [${(q.knowledge || []).join(', ')}]`,
        `ai_tags: []`,
        `tags: [${(q.tags || []).join(', ')}]`,
        `status: 待入库`,
        `selected: false`,
        '---',
      ].join('\n');

      // 构建题目内容
      const sections = [
        `## 题目`,
        (s['题目'] || '').trim(),
        '',
        s['选项'] ? `## 选项\n${s['选项'].trim()}` : '',
        '',
        `## 备注`,
        `### 我的备注`,
        s['我的备注'] || '',
        `### AI备注`,
        s['AI备注'] || s['AI 备注'] || '',
        '',
        `## 答案`,
        s['答案'] || '',
        '',
        s['解析'] ? `## 解析\n${s['解析'].trim()}` : '',
      ].join('\n');

      blocks.push(`${yamlLines}\n${sections}`);
    }

    // 结构化写入试题篮（去重保序，本地持久）
    const items = blocks
      .map((b) => makeBasketItem(b))
      .filter((x): x is BasketItem => !!x);
    const { added, skipped } = addToBasket(items);

    // 跳转到试题篮页面
    router.push('/examBasket');

    if (added === 0 && skipped > 0) {
      setTimeout(() => alert(`这 ${skipped} 道题已在试题篮中，未重复添加`), 60);
    }
  };
  // ========== 修复：同步维护勾选顺序数组 ==========
  const toggleSelect = (qid: number) => {
    setSelectedQids(prev => {
      const next = new Set(prev);
      if (next.has(qid)) {
        // 取消勾选，从顺序数组移除
        next.delete(qid);
        setSelectOrder(order => order.filter(id => id !== qid));
      } else {
        // 新增勾选，追加到顺序末尾
        next.add(qid);
        setSelectOrder(order => [...order, qid]);
      }
      return next;
    });
  };

  // ========== 修复：全选同步写入顺序 ==========
  const toggleSelectAll = () => {
    if (selectedQids.size === filtered.length) {
      setSelectedQids(new Set());
      setSelectOrder([]);
    } else {
      const allQids = filtered.map(q => q.qid);
      setSelectedQids(new Set(allQids));
      setSelectOrder(allQids);
    }
  };

  const handleRowClick = async (qid: number) => {
    if (expandedQid === qid) {
      setExpandedQid(null);
    } else {
      setExpandedQid(qid);
      setShowAnswer(false);
      setShowSolution(false);
      if (!loadedContents[qid]) {
        setLoadingQid(qid);
        await fetchMissing([qid]);
        setLoadingQid(null);
      }
    }
  };

  // 生成页码列表（带省略号）
  const pageNumbers = useMemo(() => {
    const pages: (number | '...')[] = [];
    const delta = 2; // 当前页两侧各显示几个页码
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= safePage - delta && i <= safePage + delta)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  }, [totalPages, safePage]);

  return (
    <div className={styles.container}>
      {/* 手动输入 qid */}
      <div className={styles.qidArea}>
        <label className={styles.qidLabel}>
          手动输入 qid
          <br />
          <textarea
            rows={3}
            className={styles.qidTextarea}
            placeholder="粘贴 qid，每行一个，或空格/逗号分隔&#10;例如：&#10;1780921807044&#10;1780921807045&#10;1780921807046"
            value={qidInput}
            onChange={e => setQidInput(e.target.value)}
          />
        </label>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filterBar}>
        <label className={styles.filterLabel}>
          年级
          <select className={styles.filterSelect} value={grade} onChange={e => setGrade(e.target.value)}>
            <option value="">全部</option>
            {grades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <label className={styles.filterLabel}>
          类别
          <select className={styles.filterSelect} value={examType} onChange={e => setExamType(e.target.value)}>
            <option value="">全部</option>
            {examTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        {/* 改造后的“来源”标签 (从 select 改成 联想输入) */}
        <label
          className={styles.filterLabel}
          style={{ position: "relative", flex: '1 1 150px' }}

        >
          来源
          <input
            className={styles.filterSelect}
            type='search'
            placeholder="输入来源搜索"
            value={source}
            onChange={(e) => {
              const val = e.target.value;
              setSource(val);
            }}
            onFocus={() => setShowSourceTips(true)}
            onBlur={() => setTimeout(() => setShowSourceTips(false), 180)}
          />

          {/* 联想弹窗 */}
          {showSourceTips && (
            <div className={styles.suggestBox}>
              <div
                className={styles.suggestItem}
                onClick={() => setSource("")}
              >
                全部
              </div>
              {sources
                .filter((s) => s.includes(source))
                .map((s) => (
                  <div
                    key={s}
                    className={styles.suggestItem}
                    onClick={() => setSource(s)}
                  >
                    {s}
                  </div>
                ))}
            </div>
          )}
        </label>


        <label className={styles.filterLabel}>
          题号范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={numberMin} onChange={e => setNumberMin(e.target.value)} min={1} step={1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={numberMax} onChange={e => setNumberMax(e.target.value)} min={1} step={1} />
          </span>
        </label>

        <label className={styles.filterLabel}>
          难度范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={difficultyMin} onChange={e => setDifficultyMin(e.target.value)} min={0} max={1} step={0.1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={difficultyMax} onChange={e => setDifficultyMax(e.target.value)} min={0} max={1} step={0.1} />
          </span>
        </label>

        {/* 强制换行：三级分类独占一行 */}
        <div style={{ flexBasis: '100%', width: 0, height: 0 }} />

        <label className={styles.filterLabel} style={{ flex: '1 1 190px' }}>
          章
          <select
            className={styles.filterSelect}
            value={chapter}
            onChange={e => { setChapter(e.target.value); setSection(''); setKnowledge(''); }}
          >
            <option value="">全部章</option>
            {chapterOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className={styles.filterLabel} style={{ flex: '1 1 190px' }}>
          节
          <select
            className={styles.filterSelect}
            value={section}
            onChange={e => { setSection(e.target.value); setKnowledge(''); }}
          >
            <option value="">全部节</option>
            {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className={styles.filterLabel} style={{ flex: '2 1 260px' }}>
          知识点
          <select
            className={styles.filterSelect}
            value={knowledge}
            onChange={e => setKnowledge(e.target.value)}
          >
            <option value="">全部知识点</option>
            {knowledgeOptions.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className={styles.filterLabel}>
          标签
          <select className={styles.filterSelect} value={tag} onChange={e => setTag(e.target.value)}>
            <option value="">全部</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className={styles.filterLabel}>
          排序
          <span className={styles.rangeGroup}>
            <select className={styles.filterSelect} value={sortBy} onChange={e => { setSortBy(e.target.value as any); setPage(1); }}>
              <option value="source">来源</option>
              <option value="number">题号</option>
              <option value="difficulty">难度</option>
              <option value="type">题型</option>
            </select>
            <button
              className={styles.sortToggle}
              onClick={() => { setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); setPage(1); }}
              title={sortOrder === 'asc' ? '升序 → 降序' : '降序 → 升序'}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        </label>

        <button className={styles.btnClear} onClick={clearAll}>清除筛选</button>
      </div>

      {/* 视图切换 */}
      <div className={styles.viewTabs}>
        <button
          className={`${styles.viewTab} ${viewMode === 'table' ? styles.viewTabActive : ''}`}
          onClick={() => setViewMode('table')}
        >
          📋 表格
        </button>
        <button
          className={`${styles.viewTab} ${viewMode === 'browse' ? styles.viewTabActive : ''}`}
          onClick={() => setViewMode('browse')}
        >
          📖 浏览
        </button>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.resultCount}>
          筛选结果：{filtered.length} 道题目
          {selectedQids.size > 0 && ` · 已勾选 ${selectedQids.size} 道`}
        </span>
        {filtered.length > 0 && (
          <>
            <button className={styles.btnAction} onClick={copyAsMarkdown}>复制为 Markdown</button>
            <button className={styles.btnAction} onClick={downloadZip}>打包下载 Markdown (.zip)</button>

            <button className={styles.btnAction} onClick={addToQuestionBar}>
              📋 加入试题栏
            </button>

          </>
        )}
      </div>

      {viewMode === 'browse' ? (
        <BrowseView
          questions={paginated}
          loadedContents={loadedContents}
          selectedQids={selectedQids}
          loadingQid={loadingQid}
          onToggleSelect={toggleSelect}
          onLoadContent={(qid) => {
            if (!loadedContents[qid]) {
              setLoadingQid(qid);
              fetchMissing([qid]).then(() => setLoadingQid(null));
            }
          }}
          onRefresh={(qid) => {
            setLoadedContents(prev => {
              const next = { ...prev };
              delete next[qid];
              return next;
            });
            setLoadingQid(qid);
            fetchMissing([qid]).then(() => setLoadingQid(null));
          }}
        />
      ) : (
        <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedQids.size === filtered.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>qid</th>
              <th>来源</th>
              <th>题号</th>
              <th>题型</th>
              <th>年级</th>
              <th>类别</th>
              <th>难度</th>
              <th>章</th>
              <th>节</th>
              <th>知识点</th>
              <th>标签</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(q => {
              const isExpanded = expandedQid === q.qid;
              const s = loadedContents[q.qid];
              const isLoading = loadingQid === q.qid;
              return (
                <Fragment key={q.qid}>
                  <tr
                    className={isExpanded ? styles.expandedRow : undefined}
                    onClick={() => handleRowClick(q.qid)}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedQids.has(q.qid)}
                        onChange={() => toggleSelect(q.qid)}
                      />
                    </td>
                    <td>{q.qid}</td>
                    <td>{q.source}</td>
                    <td>{q.number}</td>
                    <td>{q.type}</td>
                    <td>{q.grade}</td>
                    <td>{q.exam_type}</td>
                    <td>{q.difficulty}</td>
                    <td>{(q.chapter || []).join('、')}</td>
                    <td>{(q.section || []).join('、')}</td>
                    <td>{q.knowledge.join('、')}</td>
                    <td>{q.tags.join('、')}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${q.qid}-detail`}>
                      <td colSpan={14} style={{ padding: '1.5rem', border: 'none' }}>
                        <div className={styles.detail} style={{ marginTop: 0 }}>
                          <div className={styles.detailMeta}>
                            <strong>{q.source}</strong> · {q.number} · {q.type} · {q.grade} · {q.exam_type} · 难度 {q.difficulty}
                            {' · '}

                            <a
                              className={styles.obsidianLink}
                              href={obsidianLink(config.vaultName, config.vaultRoot, q.filePath)}
                              title="在 Obsidian 中打开"
                              onClick={e => e.stopPropagation()}
                            >
                              Obsidian
                            </a>
                          </div>

                          {isLoading && (
                            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                              加载中...
                            </div>
                          )}

                          {s && (
                            <>
                              {s['题目'] && (
                                <div className={styles.detailSection}>
                                  <h3>题目</h3>
                                  <MathText text={s['题目']} />
                                </div>
                              )}

                              {s['选项'] && (
                                <div className={styles.detailSection}>
                                  <h3>选项</h3>
                                  <MathText text={s['选项']} />
                                </div>
                              )}

                              {s['我的备注'] && (
                                <div className={`${styles.detailNote} ${styles.detailNoteMine}`}>
                                  <h3>我的备注</h3>
                                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: 'var(--text)' }}>{s['我的备注']}</pre>
                                </div>
                              )}

                              {(s['AI 备注'] || s['AI备注']) && (
                                <div className={`${styles.detailNote} ${styles.detailNoteAI}`}>
                                  <h3>AI 备注</h3>
                                  <MathText text={s['AI 备注'] || s['AI备注']} />
                                </div>
                              )}

                              {s['答案'] && (
                                <div className={styles.detailSection}>
                                  <h3 className={styles.detailFold} onClick={() => setShowAnswer(!showAnswer)}>
                                    {showAnswer ? '▼' : '▶'} 答案
                                  </h3>
                                  {showAnswer && <MathText text={s['答案']} />}
                                </div>
                              )}

                              {s['解析'] && (
                                <div className={styles.detailSection}>
                                  <h3 className={styles.detailFold} onClick={() => setShowSolution(!showSolution)}>
                                    {showSolution ? '▼' : '▶'} 解析
                                  </h3>
                                  {showSolution && <MathText text={s['解析']} />}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            上一页
          </button>

          {pageNumbers.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className={styles.pageEllipsis}>…</span>
            ) : (
              <button
                key={p}
                className={`${styles.pageBtn} ${p === safePage ? styles.pageActive : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className={styles.pageBtn}
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>

          <span className={styles.pageInfo}>
            第 {safePage}/{totalPages} 页
          </span>
        </div>
      )}
    </div>
  );
}