'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import MathText from '@/components/MathText';
import PagedPreview from '@/components/PagedPreview';
import {
  MODULE_META,
  DEFAULT_HANDOUT_SETTINGS,
  normalizeSettings,
  makeModule,
  defaultModuleTitle,
  flattenModules,
  moduleQids,
  buildDocumentMarkdown,
  analyzeHandout,
  PAGE_BREAK_MD,
  type Block,
  type HandoutModule,
  type HandoutSettings,
  type ModuleKind,
  type QuestionSource,
  type HeadingLevel,
  type AnalysisBucket,
} from '@/lib/handout';
import { buildDocumentHtml } from '@/lib/handoutHtml';
import { downloadMarkdownZip, exportWord } from '@/lib/handoutExport';
import { exportPdf, isDesktop } from '@/lib/pdfExport';
import {
  parseQuestions,
  toHandoutQuestion,
  QUESTION_SEP,
} from '@/lib/questionText';
import {
  getBasket,
  stripFrontmatter,
  removeFromBasket,
  BENCH_HINT_KEY,
} from '@/lib/basket';
import {
  loadDraftAsync,
  saveDraftDebounced,
  flushDraft,
  listDraftsAsync,
  deleteDraft,
  draftDisplayName,
  type DraftMeta,
} from '@/lib/handoutDraft';
import styles from './page.module.css';

/* ============================ 常量 ============================ */

const MODULE_ADD_ORDER: ModuleKind[] = [
  'title',
  'knowTitle',
  'knowExplain',
  'example',
  'variation',
  'practice',
  'method',
  'callout',
  'text',
  'pagebreak',
];

const PRESET_MODULES: { name: string; kinds: ModuleKind[] }[] = [
  { name: '知识点+例题+变式+练习', kinds: ['title', 'knowTitle', 'knowExplain', 'example', 'variation', 'practice'] },
  { name: '纯练习卷', kinds: ['title', 'practice'] },
  { name: '例题精讲', kinds: ['title', 'knowTitle', 'example', 'method'] },
  { name: '错题集', kinds: ['title', 'knowExplain', 'callout', 'variation'] },
];

/** 预览用：把 pandoc 分页块换成可见标记 */
function forPreview(md: string): string {
  return md.split(PAGE_BREAK_MD.trim()).join('\n\n——— 分页 ———\n\n');
}

/* ============================ 页面 ============================ */

export default function HandoutPage() {
  const [modules, setModules] = useState<HandoutModule[]>([]);
  const [settings, setSettings] = useState<HandoutSettings>(DEFAULT_HANDOUT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  /** 题目池（来自试题篮导入 + 手动粘贴） */
  const [extraText, setExtraText] = useState('');

  // UI 状态
  const [basketOpen, setBasketOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [draftName, setDraftName] = useState('');
  const [savedHint, setSavedHint] = useState('');
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  /** 预览缩放 */
  const [zoom, setZoom] = useState(1);
  /** 目标模块：从试题篮插入时的落点 */
  const [insertTarget, setInsertTarget] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ list: 'module' | 'basket'; index: number } | null>(null);
  const [dragOverModule, setDragOverModule] = useState<string | null>(null);

  const dragModuleIndex = useRef<number | null>(null);

  /** 题目池快照：qid → 题目全文。随草稿留档，刷新后不丢 */
  const [poolMap, setPoolMap] = useState<Record<string, string>>({});

  /* ---------- 初始化：草稿 + 试题篮导入 ---------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 草稿：优先桌面 IPC / Web API，失败降级 localStorage
      const draft = await loadDraftAsync();
      if (cancelled) return;

      // 快照打底：草稿里存过的题目正文
      const nextPool: Record<string, string> = { ...(draft?.pool || {}) };

      if (draft) {
        setModules((draft.modules || []) as HandoutModule[]);
        setSettings(normalizeSettings(draft.settings as Partial<HandoutSettings>));
        if (draft.name) setDraftName(draft.name);
        if (draft.extraText) setExtraText(draft.extraText);
      } else {
        // 新讲义：给一个「总标题」模块打底
        setModules([makeModule('title')]);
      }

      // 试题篮导入：既用于「去编讲义」带来的选中题，也用于补齐草稿快照
      try {
        const raw = sessionStorage.getItem(BENCH_HINT_KEY);
        const payload = raw ? (JSON.parse(raw) as { qids?: string[]; all?: boolean }) : null;
        if (raw) sessionStorage.removeItem(BENCH_HINT_KEY);

        let items = getBasket();
        if (payload?.qids && payload.qids.length > 0) {
          const set = new Set(payload.qids);
          items = items.filter((x) => set.has(x.qid));
        }
        for (const it of items) {
          nextPool[it.qid] = it.raw;
        }
      } catch {
        /* 忽略 */
      }

      // 兜底：草稿里引用到的题若快照缺失，再从试题篮补一次
      const referenced = new Set<string>();
      for (const m of ((draft?.modules || []) as HandoutModule[])) {
        if (Array.isArray(m.qids)) m.qids.forEach((q) => referenced.add(q));
      }
      if (referenced.size > 0) {
        for (const it of getBasket()) {
          if (referenced.has(it.qid) && !nextPool[it.qid]) nextPool[it.qid] = it.raw;
        }
      }

      if (cancelled) return;
      setPoolMap(nextPool);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- 题目池解析 ---------- */
  /** 池文本 = 快照正文 + 手动粘贴的补充文本 */
  const poolRaw = useMemo(() => Object.values(poolMap).join(QUESTION_SEP), [poolMap]);

  const poolText = useMemo(
    () => [poolRaw, extraText].filter(Boolean).join(QUESTION_SEP),
    [poolRaw, extraText]
  );
  const parsed = useMemo(() => (poolText.trim() ? parseQuestions(poolText) : []), [poolText]);
  const handoutQuestions = useMemo(() => parsed.map(toHandoutQuestion), [parsed]);

  const sourceMap = useMemo(() => {
    const m = new Map<string, QuestionSource>();
    parsed.forEach((p, i) => m.set(p.key, { q: handoutQuestions[i], sections: p.sections }));
    return m;
  }, [parsed, handoutQuestions]);

  const getSource = useCallback((qid: string) => sourceMap.get(qid), [sourceMap]);

  /** 已被放入模块的 qid 集合 */
  const usedQids = useMemo(() => new Set(moduleQids(modules)), [modules]);

  /** 分值查询 */
  const scoreOf = useCallback(
    (qid: string): number => {
      for (const m of modules) {
        if (m.scores[qid] != null) return m.scores[qid];
      }
      return settings.defaultScore ?? 0;
    },
    [modules, settings.defaultScore]
  );

  /** 扁平块（用于渲染 / 导出 / 分析） */
  const blocks = useMemo<Block[]>(() => flattenModules(modules), [modules]);

  const buildResult = useMemo(
    () => buildDocumentMarkdown({ blocks, settings, getQuestion: getSource }),
    [blocks, settings, getSource]
  );

  const analysis = useMemo(
    () => analyzeHandout(handoutQuestions, (qid) => scoreOf(qid) || null),
    [handoutQuestions, scoreOf]
  );

  /* ---------- 草稿自动保存 ---------- */
  /** 只留档「讲义实际引用到」的题目，避免池里无关的题撑大草稿 */
  const snapshotPool = useMemo(() => {
    const need = new Set(moduleQids(modules));
    const out: Record<string, string> = {};
    for (const qid of need) {
      const raw = poolMap[qid];
      if (raw) out[qid] = raw;
    }
    return out;
  }, [modules, poolMap]);

  const draftPayload = useMemo(
    () => ({
      name: draftName,
      modules,
      settings,
      pool: snapshotPool,
      extraText,
      updatedAt: Date.now(),
    }),
    [draftName, modules, settings, snapshotPool, extraText]
  );

  useEffect(() => {
    if (!hydrated) return;
    saveDraftDebounced(draftPayload, (ok) => {
      if (ok) {
        setSavedHint('已自动保存');
        setTimeout(() => setSavedHint(''), 1500);
      }
    });
  }, [draftPayload, hydrated]);

  /** 离开页面前强制落盘，杜绝「写到一半关掉就丢」 */
  useEffect(() => {
    const onLeave = () => flushDraft();
    window.addEventListener('beforeunload', onLeave);
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('pagehide', onLeave);
      flushDraft();
    };
  }, []);

  /* ---------- 模块操作 ---------- */
  const addModule = (kind: ModuleKind, atIndex?: number) => {
    const m = makeModule(kind);
    if (!m.title && MODULE_META[kind].hasTitle) m.title = defaultModuleTitle(kind);
    setModules((prev) => {
      const next = [...prev];
      const idx = atIndex == null ? next.length : atIndex;
      next.splice(idx, 0, m);
      return next;
    });
  };

  const updateModule = (id: string, patch: Partial<HandoutModule>) => {
    setModules((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const removeModule = (id: string) => {
    setModules((prev) => prev.filter((m) => m.id !== id));
  };

  const duplicateModule = (id: string) => {
    setModules((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      if (i < 0) return prev;
      const copy: HandoutModule = {
        ...prev[i],
        id: makeModule(prev[i].kind).id,
        qids: [...prev[i].qids],
        scores: { ...prev[i].scores },
      };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  const moveModule = (from: number, to: number) => {
    setModules((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      return next;
    });
  };

  /** 把题目加入模块 */
  const insertQidsToModule = (moduleId: string, qids: string[], atIndex?: number) => {
    // 先把这些题的正文登记进快照，保证刷新后仍能还原
    const fromBasket = new Map(getBasket().map((x) => [x.qid, x.raw]));
    setPoolMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const qid of qids) {
        if (!next[qid] && fromBasket.has(qid)) {
          next[qid] = fromBasket.get(qid)!;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== moduleId) return m;
        const next = [...m.qids];
        const idx = atIndex == null ? next.length : atIndex;
        next.splice(idx, 0, ...qids.filter((q) => !next.includes(q)));
        return { ...m, qids: next };
      })
    );
  };

  /**
   * 登记手动粘贴的题目文本。
   * 能解析出 qid 的题目进快照（随草稿留档，且不重复进补充文本）；
   * 解析不出的片段才留在 extraText，避免同一道题被拼进池两次。
   */
  const registerPastedText = (text: string) => {
    const t = (text || '').trim();
    if (!t) return;
    const parsedPaste = parseQuestions(t);
    const found: Record<string, string> = {};
    for (const p of parsedPaste) {
      if (p.qid) found[p.qid] = p.raw;
    }

    const recognized = Object.keys(found).length > 0;
    if (recognized) {
      setPoolMap((prev) => ({ ...prev, ...found }));
    }

    // 没有任何题能识别出 qid（例如粘贴的是零散段落）→ 原样留作补充文本
    const allRecognized =
      parsedPaste.length > 0 && parsedPaste.every((p) => !!p.qid);
    if (!allRecognized) {
      setExtraText((prev) => (prev ? `${prev}\n${QUESTION_SEP}\n${t}` : t));
    }
  };

  const removeQidFromModule = (moduleId: string, qid: string) => {
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, qids: m.qids.filter((x) => x !== qid) } : m))
    );
  };

  const moveQidInModule = (moduleId: string, from: number, to: number) => {
    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== moduleId) return m;
        if (from === to || to < 0 || from < 0 || from >= m.qids.length || to >= m.qids.length) return m;
        const next = [...m.qids];
        const [x] = next.splice(from, 1);
        next.splice(to, 0, x);
        return { ...m, qids: next };
      })
    );
  };

  /* ---------- 打开/关闭侧边篮 ---------- */
  const openBasket = (targetModuleId?: string) => {
    setInsertTarget(targetModuleId ?? null);
    setBasketOpen(true);
  };

  /* ---------- 草稿列表 ---------- */
  const openDrafts = async () => {
    setDrafts(await listDraftsAsync());
    setShowDrafts(true);
  };

  const restoreDraft = async (id: string) => {
    const d = await loadDraftAsync(id);
    if (!d) return;
    if (!confirm('载入该草稿将覆盖当前内容，继续？')) return;
    setModules((d.modules || []) as HandoutModule[]);
    setSettings(normalizeSettings(d.settings as Partial<HandoutSettings>));
    setDraftName(d.name || '');
    setShowDrafts(false);
  };

  const removeDraft = (id: string) => {
    if (!confirm('确认删除该草稿？')) return;
    deleteDraft(id);
    void listDraftsAsync().then(setDrafts);
  };

  const startNew = () => {
    if (!confirm('新建讲义将清空当前内容（草稿已自动保存），继续？')) return;
    setModules([makeModule('title')]);
    setSettings(DEFAULT_HANDOUT_SETTINGS);
    setDraftName('');
  };

  /* ---------- 导出 ---------- */
  const downloadZip = async () => {
    if (blocks.length === 0) {
      alert('讲义还是空的');
      return;
    }
    await downloadMarkdownZip(draftName || 'HighMath_讲义', buildResult.markdown, buildResult.imageMap);
  };

  const downloadWord = async () => {
    if (blocks.length === 0) {
      alert('讲义还是空的');
      return;
    }
    setExportingWord(true);
    try {
      const result = await exportWord(buildResult.markdown, buildResult.imageMap, draftName || 'HighMath_讲义');
      if (result.channel === 'browser' && result.failedImages > 0) {
        alert(`Word 已生成（浏览器端兜底），但有 ${result.failedImages} 张图片缺失`);
      }
    } catch (e) {
      alert('Word 导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      setExportingWord(false);
    }
  };

  /** 导出 PDF（主交付物）。桌面版无头打印；网页版走系统打印对话框 */
  const downloadPdf = async () => {
    if (blocks.length === 0) {
      alert('讲义还是空的');
      return;
    }
    setExportingPdf(true);
    try {
      const res = await exportPdf(htmlResult.html, draftName || 'HighMath_讲义');
      if (res.error) alert('PDF 导出失败：' + res.error);
      else if (res.channel === 'browser') {
        alert('已调起系统打印窗口 —— 在「目标打印机」里选「另存为 PDF」即可。');
      }
    } catch (e) {
      alert('PDF 导出失败：' + ((e as Error).message || '未知错误'));
    } finally {
      setExportingPdf(false);
    }
  };

  /* ---------- 拖拽：模块排序 ---------- */
  const onModuleDrop = (toIndex: number) => {
    const from = dragModuleIndex.current;
    if (from != null && from !== toIndex) moveModule(from, toIndex);
    dragModuleIndex.current = null;
    setDragOverModule(null);
  };

  const previewMarkdown = useMemo(
    () => (previewMode ? forPreview(buildResult.markdown) : ''),
    [previewMode, buildResult.markdown]
  );

  /** A4 分页预览 / PDF 导出的同一份 HTML（PDF 优先架构的核心） */
  const htmlResult = useMemo(
    () =>
      buildDocumentHtml({
        blocks,
        modules,
        settings,
        getQuestion: getSource,
      }),
    [blocks, modules, settings, getSource]
  );

  const questionCount = moduleQids(modules).length;

  return (
    <AppShell title="编讲义">
      <div className={styles.container}>
        {/* ===== 工具栏 ===== */}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>编讲义</h1>
          <span className={styles.savedHint}>{savedHint}</span>

          <div className={styles.toolbar}>
            <button className={styles.btn} onClick={startNew}>🆕 新建</button>
            <button className={styles.btn} onClick={openDrafts}>📂 草稿</button>
            <button
              className={`${styles.btn} ${basketOpen ? styles.btnActive : ''}`}
              onClick={() => (basketOpen ? setBasketOpen(false) : openBasket())}
            >
              🧺 试题篮
            </button>
            <button
              className={`${styles.btn} ${showSettings ? styles.btnActive : ''}`}
              onClick={() => setShowSettings((v) => !v)}
            >
              📐 排版
            </button>
            <button
              className={`${styles.btn} ${showAnalysis ? styles.btnActive : ''}`}
              onClick={() => setShowAnalysis((v) => !v)}
            >
              📊 分析
            </button>
            <button
              className={`${styles.btn} ${previewMode ? styles.btnActive : ''}`}
              onClick={() => setPreviewMode((v) => !v)}
            >
              👁 {previewMode ? '退出预览' : '预览'}
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={downloadPdf} disabled={exportingPdf}>
              {exportingPdf ? '⏳ 导出中…' : '📕 导出 PDF'}
            </button>
            <button className={styles.btn} onClick={downloadZip}>📦 .zip</button>
            <button className={styles.btn} onClick={downloadWord} disabled={exportingWord} title="可编辑补充版，复杂版面请用 PDF">
              {exportingWord ? '⏳ 导出中…' : '📄 Word'}
            </button>
          </div>
        </div>

        {/* ===== 讲义名 ===== */}
        <div className={styles.metaBar}>
          <label className={styles.metaLabel}>
            讲义名（用于草稿与导出文件名）
            <input
              className={styles.metaInput}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="未命名讲义"
            />
          </label>
          <span className={styles.metaStat}>
            共 {modules.length} 个模块 · {questionCount} 道题
          </span>
        </div>

        {/* ===== 排版设置面板 ===== */}
        {showSettings && (
          <div className={styles.panel}>
            <div className={styles.panelHead}>排版设置</div>
            <div className={styles.settingGrid}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showNumber}
                  onChange={(e) => setSettings({ ...settings, showNumber: e.target.checked })}
                />
                显示题号
              </label>
              <label className={styles.settingField}>
                题号格式
                <input
                  className={styles.settingInput}
                  value={settings.numberFormat}
                  onChange={(e) => setSettings({ ...settings, numberFormat: e.target.value })}
                  placeholder="{n}."
                />
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.restartPerGroup}
                  onChange={(e) => setSettings({ ...settings, restartPerGroup: e.target.checked })}
                />
                每个模块内题号重排
              </label>
              <label className={styles.settingField}>
                答案位置
                <select
                  className={styles.settingInput}
                  value={settings.answerPosition}
                  onChange={(e) =>
                    setSettings({ ...settings, answerPosition: e.target.value as HandoutSettings['answerPosition'] })
                  }
                >
                  <option value="none">不显示</option>
                  <option value="afterEach">每题之后</option>
                  <option value="end">文末集中</option>
                </select>
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.includeSolution}
                  onChange={(e) => setSettings({ ...settings, includeSolution: e.target.checked })}
                />
                包含解析
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showSource}
                  onChange={(e) => setSettings({ ...settings, showSource: e.target.checked })}
                />
                显示来源
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showScore}
                  onChange={(e) => setSettings({ ...settings, showScore: e.target.checked })}
                />
                显示分值
              </label>
              <label className={styles.settingField}>
                知识点展示
                <select
                  className={styles.settingInput}
                  value={settings.knowledgeMode}
                  onChange={(e) =>
                    setSettings({ ...settings, knowledgeMode: e.target.value as HandoutSettings['knowledgeMode'] })
                  }
                >
                  <option value="none">不显示</option>
                  <option value="below">题目下方</option>
                  <option value="inline">并入正文</option>
                </select>
              </label>
            </div>

            {/* ===== v2.2 新增：PDF 优先版面 ===== */}
            <div className={styles.panelSubHead}>版面（PDF 优先）</div>
            <div className={styles.settingGrid}>
              <label className={styles.settingField}>
                输出模式
                <select
                  className={styles.settingInput}
                  value={settings.outputMode}
                  onChange={(e) =>
                    setSettings({ ...settings, outputMode: e.target.value as HandoutSettings['outputMode'] })
                  }
                >
                  <option value="teacher">教师版（含答案解析）</option>
                  <option value="student">学生版（隐藏答案解析·留白）</option>
                </select>
              </label>
              <label className={styles.settingField}>
                选项排列
                <select
                  className={styles.settingInput}
                  value={settings.optionLayout}
                  onChange={(e) =>
                    setSettings({ ...settings, optionLayout: e.target.value as HandoutSettings['optionLayout'] })
                  }
                >
                  <option value="one-per-line">每行一个</option>
                  <option value="two-in-line">两列</option>
                  <option value="four-in-line">四列</option>
                </select>
              </label>
              <label className={styles.settingField}>
                正文分栏
                <select
                  className={styles.settingInput}
                  value={String(settings.bodyColumns)}
                  onChange={(e) =>
                    setSettings({ ...settings, bodyColumns: Number(e.target.value) === 2 ? 2 : 1 })
                  }
                >
                  <option value="1">单栏</option>
                  <option value="2">双栏</option>
                </select>
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.showPageNumber}
                  onChange={(e) => setSettings({ ...settings, showPageNumber: e.target.checked })}
                />
                显示页码
              </label>
              <label className={styles.settingField}>
                页码格式
                <input
                  className={styles.settingInput}
                  value={settings.pageNumberFormat}
                  onChange={(e) => setSettings({ ...settings, pageNumberFormat: e.target.value })}
                  placeholder="第 {page} 页 / 共 {pages} 页"
                />
              </label>
              <label className={styles.settingField}>
                页眉
                <input
                  className={styles.settingInput}
                  value={settings.headerText}
                  onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
                  placeholder="留空则不显示"
                />
              </label>
              <label className={styles.settingField}>
                页脚
                <input
                  className={styles.settingInput}
                  value={settings.footerText}
                  onChange={(e) => setSettings({ ...settings, footerText: e.target.value })}
                  placeholder="留空则不显示"
                />
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.cardStyle}
                  onChange={(e) => setSettings({ ...settings, cardStyle: e.target.checked })}
                />
                卡片配色
              </label>
            </div>

            <div className={styles.panelSubHead}>水印</div>
            <div className={styles.settingGrid}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.watermarkEnabled}
                  onChange={(e) => setSettings({ ...settings, watermarkEnabled: e.target.checked })}
                />
                启用水印
              </label>
              <label className={styles.settingField}>
                水印文字
                <input
                  className={styles.settingInput}
                  value={settings.watermarkText}
                  onChange={(e) => setSettings({ ...settings, watermarkText: e.target.value })}
                  placeholder="如：内部资料"
                  disabled={!settings.watermarkEnabled}
                />
              </label>
            </div>

            <div className={styles.panelSubHead}>学生版答题留白</div>
            <div className={styles.settingGrid}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={settings.autoBlankByType}
                  onChange={(e) => setSettings({ ...settings, autoBlankByType: e.target.checked })}
                />
                按题型自动留白
              </label>
              {([
                ['单选', 'single'],
                ['多选', 'multiple'],
                ['填空', 'fill'],
                ['解答', 'solve'],
              ] as const).map(([label, key]) => (
                <label key={key} className={styles.settingField}>
                  {label}留白 (mm)
                  <input
                    type="number"
                    min={0}
                    className={styles.settingInput}
                    value={settings.blankHeights[key]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        blankHeights: { ...settings.blankHeights, [key]: Math.max(0, Number(e.target.value) || 0) },
                      })
                    }
                  />
                </label>
              ))}
              <label className={styles.settingField}>
                全局额外留白 (mm)
                <input
                  type="number"
                  min={0}
                  className={styles.settingInput}
                  value={settings.blankExtra}
                  onChange={(e) => setSettings({ ...settings, blankExtra: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
          </div>
        )}

        {/* ===== 分析面板 ===== */}
        {showAnalysis && (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              试卷分析 · 共 {analysis.total ?? questionCount} 题
            </div>
            <div className={styles.analysisGrid}>
              <AnalysisCard title="按题型" buckets={analysis.byType} />
              <AnalysisCard title="按难度" buckets={analysis.byDifficulty} />
              <AnalysisCard title="按知识点" buckets={analysis.byKnowledge} />
            </div>
          </div>
        )}

        {/* ===== 主体：编辑区 + 侧边篮 ===== */}
        <div className={`${styles.workspace} ${basketOpen ? styles.workspaceWithBasket : ''}`}>
          {/* ---- 编辑区 ---- */}
          <div className={styles.editorCol}>
            {previewMode ? (
              <div className={styles.previewWrap}>
                <div className={styles.previewToolbar}>
                  <span className={styles.previewLabel}>A4 分页预览</span>
                  <div className={styles.zoomGroup}>
                    <button className={styles.zoomBtn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="缩小">－</button>
                    <span className={styles.zoomVal}>{Math.round(zoom * 100)}%</span>
                    <button className={styles.zoomBtn} onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.25).toFixed(2)))} title="放大">＋</button>
                    <button className={styles.zoomReset} onClick={() => setZoom(1)}>100%</button>
                  </div>
                </div>
                <div className={styles.previewPane}>
                  <PagedPreview html={htmlResult.html} zoom={zoom} />
                </div>
              </div>
            ) : (
              <div className={styles.moduleList}>
                {modules.map((m, i) => (
                  <ModuleCard
                    key={m.id}
                    module={m}
                    index={i}
                    total={modules.length}
                    sourceMap={sourceMap}
                    settings={settings}
                    dragOver={dragOverModule === m.id}
                    onUpdate={(patch) => updateModule(m.id, patch)}
                    onRemove={() => removeModule(m.id)}
                    onDuplicate={() => duplicateModule(m.id)}
                    onMoveUp={() => moveModule(i, i - 1)}
                    onMoveDown={() => moveModule(i, i + 1)}
                    onDragStart={() => {
                      dragModuleIndex.current = i;
                      setDragInfo({ list: 'module', index: i });
                    }}
                    onDragOver={() => setDragOverModule(m.id)}
                    onDrop={() => onModuleDrop(i)}
                    onOpenBasket={() => openBasket(m.id)}
                    onRemoveQid={(qid) => removeQidFromModule(m.id, qid)}
                    onMoveQid={(from, to) => moveQidInModule(m.id, from, to)}
                    onAddAt={(kind) => addModule(kind, i + 1)}
                  />
                ))}

                {modules.length === 0 && (
                  <div className={styles.emptyBox}>
                    还没有模块。用下方按钮或「快速模板」开始。
                  </div>
                )}
              </div>
            )}

            {/* ---- 底部：添加模块 ---- */}
            {!previewMode && (
              <div className={styles.addBar}>
                <span className={styles.addLabel}>添加模块：</span>
                {MODULE_ADD_ORDER.map((kind) => (
                  <button
                    key={kind}
                    className={styles.addBtn}
                    onClick={() => addModule(kind)}
                    title={MODULE_META[kind].label}
                  >
                    {MODULE_META[kind].icon} {MODULE_META[kind].label}
                  </button>
                ))}
                <span className={styles.addLabel} style={{ marginLeft: 'auto' }}>
                  快速模板：
                </span>
                {PRESET_MODULES.map((p) => (
                  <button
                    key={p.name}
                    className={styles.presetBtn}
                    onClick={() => setModules(p.kinds.map((k) => {
                      const m = makeModule(k);
                      if (MODULE_META[k].hasTitle) m.title = defaultModuleTitle(k);
                      return m;
                    }))}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- 侧边试题篮 ---- */}
          {basketOpen && (
            <BasketDrawer
              usedQids={usedQids}
              insertTargetName={
                insertTarget
                  ? modules.find((m) => m.id === insertTarget)?.title ||
                    MODULE_META[modules.find((m) => m.id === insertTarget)?.kind ?? 'practice'].label
                  : ''
              }
              onClose={() => setBasketOpen(false)}
              onInsert={(qids) => {
                // 决定落点：指定模块 → 第一个可挂题模块 → 新建一个「真题练习」
                let target = insertTarget;
                if (!target || !MODULE_META[modules.find((m) => m.id === target)?.kind ?? 'practice'].holdsQuestions) {
                  const firstHolding = modules.find((m) => MODULE_META[m.kind].holdsQuestions);
                  if (firstHolding) {
                    target = firstHolding.id;
                  } else {
                    const nm = makeModule('practice');
                    nm.title = defaultModuleTitle('practice');
                    setModules((prev) => [...prev, nm]);
                    target = nm.id;
                  }
                }
                insertQidsToModule(target, qids);
                setInsertTarget(null);
              }}
              onPaste={registerPastedText}
            />
          )}
        </div>

        {/* ===== 草稿弹窗 ===== */}
        {showDrafts && (
          <div className={styles.overlay} onClick={() => setShowDrafts(false)}>
            <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
              <div className={styles.dialogTitle}>草稿列表</div>
              {drafts.length === 0 ? (
                <div className={styles.dialogEmpty}>暂无草稿</div>
              ) : (
                <ul className={styles.draftList}>
                  {drafts.map((d) => (
                    <li key={d.id} className={styles.draftItem}>
                      <div className={styles.draftInfo}>
                        <div className={styles.draftName}>{draftDisplayName(d)}</div>
                        <div className={styles.draftMeta}>
                          {d.modules} 模块 · {d.questions} 题 · {new Date(d.updatedAt).toLocaleString('zh-CN')}
                        </div>
                      </div>
                      <div className={styles.draftActions}>
                        <button className="hm-btn hm-btn-sm hm-btn-primary" onClick={() => restoreDraft(d.id)}>
                          载入
                        </button>
                        <button className={`hm-btn hm-btn-sm ${styles.dangerBtn}`} onClick={() => removeDraft(d.id)}>
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.dialogActions}>
                <button className="hm-btn" onClick={() => setShowDrafts(false)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ============================ 模块卡片 ============================ */

function ModuleCard({
  module: m,
  index,
  total,
  sourceMap,
  settings,
  dragOver,
  onUpdate,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onOpenBasket,
  onRemoveQid,
  onMoveQid,
  onAddAt,
}: {
  module: HandoutModule;
  index: number;
  total: number;
  sourceMap: Map<string, QuestionSource>;
  settings: HandoutSettings;
  dragOver: boolean;
  onUpdate: (patch: Partial<HandoutModule>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onOpenBasket: () => void;
  onRemoveQid: (qid: string) => void;
  onMoveQid: (from: number, to: number) => void;
  onAddAt: (kind: ModuleKind) => void;
}) {
  const meta = MODULE_META[m.kind];
  const collapsed = !!m.collapsed;

  return (
    <div
      className={`${styles.module} ${dragOver ? styles.moduleDragOver : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className={styles.moduleHead}>
        <span
          className={styles.dragHandle}
          draggable
          onDragStart={onDragStart}
          title="拖拽调整模块顺序"
        >
          ⠿
        </span>
        <button
          className={styles.collapseBtn}
          onClick={() => onUpdate({ collapsed: !collapsed })}
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className={styles.moduleKind}>
          {meta.icon} {meta.label}
        </span>
        <span className={styles.moduleIdx}>#{index + 1}</span>

        <div className={styles.moduleActions}>
          <button className={styles.miniBtn} onClick={onMoveUp} disabled={index === 0} title="上移">↑</button>
          <button className={styles.miniBtn} onClick={onMoveDown} disabled={index === total - 1} title="下移">↓</button>
          <button className={styles.miniBtn} onClick={onDuplicate} title="复制模块">⧉</button>
          <button className={`${styles.miniBtn} ${styles.miniDanger}`} onClick={onRemove} title="删除模块">✕</button>
        </div>
      </div>

      {!collapsed && (
        <div className={styles.moduleBody}>
          {meta.hasTitle && (
            <div className={styles.moduleRow}>
              <input
                className={styles.titleInput}
                value={m.title}
                placeholder={m.kind === 'title' ? '讲义总标题' : '模块标题'}
                onChange={(e) => onUpdate({ title: e.target.value })}
              />
              {m.kind === 'knowTitle' && (
                <label className={styles.miniCheck}>
                  <input
                    type="checkbox"
                    checked={m.autoNumber}
                    onChange={(e) => onUpdate({ autoNumber: e.target.checked })}
                  />
                  自动编号
                </label>
              )}
            </div>
          )}

          {meta.hasBody && (
            <textarea
              className={styles.bodyArea}
              value={m.body}
              placeholder={
                m.kind === 'title'
                  ? '副标题 / 适用年级 / 说明（可留空）'
                  : m.kind === 'callout'
                    ? '提示内容，支持 Markdown 与 $数学公式$'
                    : '支持 Markdown 与 $数学公式$，例：\n导数的几何意义：$f\'(x_0)$ 表示曲线在 $x_0$ 处切线的斜率。'
              }
              onChange={(e) => onUpdate({ body: e.target.value })}
            />
          )}

          {m.kind === 'callout' && (
            <div className={styles.moduleRow}>
              <span className={styles.miniLabel}>语气</span>
              {(['tip', 'note', 'warn'] as const).map((v) => (
                <label key={v} className={styles.miniCheck}>
                  <input
                    type="radio"
                    name={`callout-${m.id}`}
                    checked={(m.calloutVariant || 'note') === v}
                    onChange={() => onUpdate({ calloutVariant: v })}
                  />
                  {v === 'tip' ? '提示' : v === 'warn' ? '易错' : '注解'}
                </label>
              ))}
            </div>
          )}

          {meta.holdsQuestions && settings.outputMode === 'student' && (
            <div className={styles.moduleRow}>
              <label className={styles.miniCheck} title="留空则用全局按题型规则">
                <input
                  type="checkbox"
                  checked={m.blankOverride != null}
                  onChange={(e) => onUpdate({ blankOverride: e.target.checked ? 40 : null })}
                />
                本模块答题留白(mm)
              </label>
              {m.blankOverride != null && (
                <input
                  type="number"
                  min={0}
                  className={styles.miniNum}
                  value={m.blankOverride}
                  onChange={(e) => onUpdate({ blankOverride: Math.max(0, Number(e.target.value) || 0) })}
                />
              )}
            </div>
          )}

          {meta.holdsQuestions && (
            <div className={styles.qlist}>
              {m.qids.length === 0 && (
                <div className={styles.qEmpty}>该模块还没有题目，点下方「从试题篮加题」。</div>
              )}
              {m.qids.map((qid, qi) => {
                const src = sourceMap.get(qid);
                const q = src?.q;
                return (
                  <div key={qid} className={styles.qItem}>
                    <span className={styles.qDrag}>⠿</span>
                    <span className={styles.qOrder}>{qi + 1}</span>
                    <span className={styles.qInfo}>
                      <span className={styles.qSource}>{q?.source || '—'}</span>
                      {q?.number && <span className={styles.qNumber}>T{q.number}</span>}
                      {q?.type && <span className="hm-badge">{q.type}</span>}
                    </span>
                    <div className={styles.qActions}>
                      <button
                        className={styles.miniBtn}
                        onClick={() => onMoveQid(qi, qi - 1)}
                        disabled={qi === 0}
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        className={styles.miniBtn}
                        onClick={() => onMoveQid(qi, qi + 1)}
                        disabled={qi === m.qids.length - 1}
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        className={`${styles.miniBtn} ${styles.miniDanger}`}
                        onClick={() => onRemoveQid(qid)}
                        title="移出本模块"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              <button className={styles.insertBtn} onClick={onOpenBasket}>
                ＋ 从试题篮加题
              </button>
            </div>
          )}

          {!meta.holdsQuestions && (
            <div className={styles.addAfter}>
              {MODULE_ADD_ORDER.slice(0, 8).map((k) => (
                <button key={k} className={styles.addAfterBtn} onClick={() => onAddAt(k)} title={`在此下方插入「${MODULE_META[k].label}」`}>
                  ＋{MODULE_META[k].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ 分析卡片 ============================ */

function AnalysisCard({
  title,
  buckets,
}: {
  title: string;
  buckets: AnalysisBucket[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className={styles.analysisCard}>
      <div className={styles.analysisTitle}>{title}</div>
      {buckets.length === 0 && <div className={styles.analysisEmpty}>暂无数据</div>}
      {buckets.map((b) => (
        <div key={b.label} className={styles.barRow}>
          <span className={styles.barLabel} title={b.label}>{b.label}</span>
          <span className={styles.barTrack}>
            <span className={styles.barFill} style={{ width: `${(b.count / max) * 100}%` }} />
          </span>
          <span className={styles.barValue}>{b.count} 题</span>
        </div>
      ))}
    </div>
  );
}

/* ============================ 侧边试题篮抽屉 ============================ */

function BasketDrawer({
  usedQids,
  insertTargetName,
  onClose,
  onInsert,
  onPaste,
}: {
  usedQids: Set<string>;
  insertTargetName: string;
  onClose: () => void;
  onInsert: (qids: string[]) => void;
  onPaste: (text: string) => void;
}) {
  const [items, setItems] = useState(() => getBasket());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const refresh = useCallback(() => setItems(getBasket()), []);
  useEffect(() => {
    window.addEventListener('highmath:basket', refresh);
    return () => window.removeEventListener('highmath:basket', refresh);
  }, [refresh]);

  const toggle = (qid: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(qid) ? next.delete(qid) : next.add(qid);
      return next;
    });

  const insert = (qids: string[]) => {
    if (qids.length === 0) return;
    onInsert(qids);
  };

  return (
    <aside className={styles.drawer}>
      <div className={styles.drawerHead}>
        <span>🧺 试题篮（{items.length}）</span>
        <button className={styles.drawerClose} onClick={onClose} aria-label="关闭">✕</button>
      </div>

      {insertTargetName && (
        <div className={styles.drawerTarget}>将插入到：<strong>{insertTargetName}</strong></div>
      )}

      <div className={styles.drawerBody}>
        {items.length === 0 && (
          <div className={styles.drawerEmpty}>
            试题篮是空的。先到「选题」页勾选题目加入试题篮，
            或点下方「粘贴题目」直接贴入。
          </div>
        )}
        {items.map((it) => {
          const used = usedQids.has(it.qid);
          const on = checked.has(it.qid);
          return (
            <label key={it.qid} className={`${styles.drawerItem} ${on ? styles.drawerItemOn : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(it.qid)}
                disabled={used}
                className={styles.drawerCheck}
              />
              <span className={styles.drawerInfo}>
                <span className={styles.drawerLine1}>
                  <span className={styles.drawerSource}>{it.source || '未标来源'}</span>
                  {it.number && <span className={styles.qNumber}>T{it.number}</span>}
                  {it.type && <span className="hm-badge">{it.type}</span>}
                  {used && <span className="hm-badge hm-badge-success">已在讲义</span>}
                </span>
                <span className={styles.drawerPreview}>{it.preview}</span>
              </span>
            </label>
          );
        })}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            placeholder="粘贴题目 Markdown（含 YAML frontmatter 与 ## 题目 等分节）"
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className={styles.pasteActions}>
            <button className="hm-btn hm-btn-sm" onClick={() => setPasteOpen(false)}>取消</button>
            <button
              className="hm-btn hm-btn-sm hm-btn-primary"
              onClick={() => {
                if (pasteText.trim()) {
                  onPaste(pasteText.trim());
                  setPasteText('');
                  setPasteOpen(false);
                }
              }}
            >
              加入题目池
            </button>
          </div>
        </div>
      )}

      <div className={styles.drawerFoot}>
        <button className="hm-btn hm-btn-sm" onClick={() => setPasteOpen((v) => !v)}>
          📋 粘贴题目
        </button>
        <button
          className="hm-btn hm-btn-sm"
          onClick={() => insert([...checked])}
          disabled={checked.size === 0}
        >
          插入选中（{checked.size}）
        </button>
        <button
          className="hm-btn hm-btn-sm hm-btn-primary"
          onClick={() => {
            const fresh = items.filter((x) => !usedQids.has(x.qid)).map((x) => x.qid);
            insert(fresh);
          }}
          disabled={items.length === 0}
        >
          全部插入
        </button>
      </div>
    </aside>
  );
}

// 说明：BENCH_HINT_KEY 为会话级导入意图标识，统一从 basket 模块取用，避免散落字符串
