'use client';
import { useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import MathText from '@/components/MathText';
import AppShell from '@/components/AppShell';
import styles from './page.module.css';
import { useConfig, pickDirectory } from '@/components/ConfigProvider';

/**
 * 解析后的题目结构
 */
interface ParsedQuestion {
  sections: Record<string, string>;
  yaml: Record<string, any>;
  raw: string;
  body: string;
  startIndex: number;
  endIndex: number;
}

/** 导入文件 */
interface ImportFile {
  name: string;
  content: string;
}

/** 导入校验报告项 */
interface ImportItem {
  file: string;
  index: number;
  name: string;
  source: string;
  number: string;
  type: string;
  errors: string[];
  warnings: string[];
}

/** 解析单道题的 YAML 和 sections */
function parseOneQuestion(trimmed: string): { yaml: Record<string, any>; body: string; sections: Record<string, string> } {
  let yaml: Record<string, any> = {};
  let body = trimmed;

  try {
    const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---\n/);
    if (fmMatch) {
      body = trimmed.slice(fmMatch[0].length);
      fmMatch[1].split('\n').forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          let val: any = line.slice(colonIdx + 1).trim();
          if (val.startsWith('[') && val.endsWith(']')) {
            val = val.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
          }
          yaml[key] = val;
        }
      });
    }
  } catch { /* 解析失败就忽略 */ }

  const sections: Record<string, string> = {};
  const parts = body.split(/\n(?=## )/);
  for (const part of parts) {
    const m = part.match(/^## (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const content = m[2].trim();
    if (title === '备注') {
      const subs = content.split(/\n(?=### )/);
      for (const sub of subs) {
        const sm = sub.match(/^### (.+?)\n([\s\S]*)$/);
        if (sm) sections[sm[1].trim()] = sm[2].trim();
      }
    } else {
      sections[title] = content;
    }
  }
  return { yaml, body, sections };
}

/** 拆分所有题目，同时记录每道题在原文中的起止位置 */
function parseQuestions(text: string): ParsedQuestion[] {
  const results: ParsedQuestion[] = [];
  const sepRe = /\n?==========\n?/g;
  let blockStart = 0;
  let match: RegExpExecArray | null;

  while ((match = sepRe.exec(text)) !== null) {
    const blockEnd = match.index;
    const block = text.slice(blockStart, blockEnd).trim();
    if (block) {
      const parsed = parseOneQuestion(block);
      results.push({ ...parsed, raw: block, startIndex: blockStart, endIndex: blockEnd });
    }
    blockStart = match.index + match[0].length;
  }

  const lastBlock = text.slice(blockStart).trim();
  if (lastBlock) {
    const parsed = parseOneQuestion(lastBlock);
    results.push({ ...parsed, raw: lastBlock, startIndex: blockStart, endIndex: text.length });
  }

  return results;
}

/** 读取文件列表（支持 .md/.txt 与 .zip 解包） */
async function readFiles(fileList: File[]): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  for (const f of fileList) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        const entries = Object.values(zip.files).filter(
          e => !e.dir && /\.(md|txt|markdown)$/i.test(e.name)
        );
        for (const e of entries) {
          out.push({ name: e.name, content: await e.async('string') });
        }
      } catch {
        out.push({ name: f.name, content: '' });
      }
    } else if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.markdown')) {
      out.push({ name: f.name, content: await f.text() });
    }
  }
  return out;
}

export default function AddPage() {
  const { config } = useConfig();

  // ===== 状态管理 =====
  const [input, setInput] = useState('');
  const [source, setSource] = useState('');
  const [examType, setExamType] = useState('');
  const [defaultType, setDefaultType] = useState('');
  const router = useRouter();

  // 默认年级跟随运行期配置（用户手动改过之后不再覆盖）
  const [gradeTouched, setGradeTouched] = useState(false);
  const [defaultGrade, setDefaultGrade] = useState('');

  const [defaultSemester, setDefaultSemester] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [conflictList, setConflictList] = useState<{ index: number; number: string; source: string; fileName: string }[] | null>(null);
  const pendingListRef = useRef<Record<string, any>[]>([]);

  // ===== 导入相关状态 =====
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFiles, setImportFiles] = useState<ImportFile[]>([]);
  const [importReport, setImportReport] = useState<{ summary: any; items: ImportItem[] } | null>(null);

  // ===== DOM 引用 =====
  const fileRef = useRef<HTMLInputElement>(null);
  const mdFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!gradeTouched && config.defaultGrade) setDefaultGrade(config.defaultGrade);
  }, [config.defaultGrade, gradeTouched]);

  // ====================== 年级联动配置 ======================
  const semesterOptionsMap: Record<string, { value: string; label: string }[]> = {
    "初中": [
      { value: "七上", label: "七上" }, { value: "七下", label: "七下" },
      { value: "八上", label: "八上" }, { value: "八下", label: "八下" },
      { value: "九上", label: "九上" }, { value: "九下", label: "九下" },
    ],
    "高中": [
      { value: "高一上", label: "高一上" }, { value: "高一下", label: "高一下" },
      { value: "高二上", label: "高二上" }, { value: "高二下", label: "高二下" },
      { value: "高三上", label: "高三上" }, { value: "高三下", label: "高三下" },
    ]
  };
  const examTypeOptionsMap: Record<string, { value: string; label: string }[]> = {
    "初中": [
      { value: "中考真题", label: "中考真题" }, { value: "月考", label: "月考" },
      { value: "期中考试", label: "期中考试" }, { value: "期末考试", label: "期末考试" },
      { value: "模拟题", label: "模拟题" },
    ],
    "高中": [
      { value: "高考真题", label: "高考真题" }, { value: "月考", label: "月考" },
      { value: "期中考试", label: "期中考试" }, { value: "期末考试", label: "期末考试" },
      { value: "模拟题", label: "模拟题" },
    ]
  };

  const currentSemesterOptions = useMemo(() => semesterOptionsMap[defaultGrade] ?? [], [defaultGrade]);
  const currentExamTypeOptions = useMemo(() => examTypeOptionsMap[defaultGrade] ?? [], [defaultGrade]);

  const handleGradeChange = (val: string) => {
    setGradeTouched(true);
    setDefaultGrade(val);
    setDefaultSemester("");
    setExamType("");
  };

  // ===== 图片上传 =====
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/images/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const imgLine = `\n![${file.name.split('.')[0] || 'img'}](images/${data.filename})\n`;
        setInput(prev => prev.slice(0, start) + imgLine + prev.slice(end));
        setTimeout(() => {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = start + imgLine.length;
        }, 50);
      }
    } catch {
      setMessage('❌ 图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  // ===== 题目解析 =====
  const questions = useMemo(() => {
    if (!input.trim()) return [];
    return parseQuestions(input);
  }, [input]);

  // ===== 光标位置变化 → 高亮对应卡片 =====
  const handleCursorMove = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || questions.length === 0) return;
    const pos = ta.selectionStart;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (pos >= q.startIndex && pos <= q.endIndex) {
        setHighlightedIndex(i);
        cardRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
    }
    setHighlightedIndex(null);
  }, [questions]);

  // ===== 点击预览卡片 → 跳转到原文 =====
  const handleCardClick = (index: number) => {
    const ta = textareaRef.current;
    if (!ta || index >= questions.length) return;
    const q = questions[index];

    ta.focus();
    ta.setSelectionRange(q.startIndex, q.endIndex);

    const textBefore = input.slice(0, q.startIndex);
    const lineCount = textBefore.split('\n').length;
    const totalLines = (input.match(/\n/g) || []).length + 1;
    const realLineHeight = ta.scrollHeight / totalLines;
    ta.scrollTop = Math.max(0, (lineCount - 3) * realLineHeight);

    const cardEl = cardRefs.current[index];
    cardEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlightedIndex(index);
  };

  // ===== 组装待入库列表 =====
  const buildQuestionList = (): Record<string, any>[] | null => {
    const list: Record<string, any>[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const y = q.yaml;

      const finalType = y.type || defaultType;
      if (!finalType) {
        setMessage(`❌ 第 ${i + 1} 道题缺少题型（YAML 没写，页面也没选默认值）`);
        return null;
      }

      list.push({
        source: y.source || source.trim(),
        number: y.number || '',
        type: finalType,
        grade: y.grade || defaultGrade,
        semester: y.semester || defaultSemester,
        exam_type: y.exam_type || examType,
        difficulty: y.difficulty != null && y.difficulty !== '' ? Number(y.difficulty) : null,
        chapter: Array.isArray(y.chapter) ? y.chapter : [],
        section: Array.isArray(y.section) ? y.section : [],
        knowledge: Array.isArray(y.knowledge) ? y.knowledge : [],
        tags: Array.isArray(y.tags) ? y.tags : [],
        content: q.body,
      });
    }
    return list;
  };

  // ===== 实际执行写入 =====
  const doSave = async (list: Record<string, any>[], onConflict: string) => {
    setSaving(true);
    setConflictList(null);
    setMessage('');
    try {
      const res = await fetch('/api/add-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: list, action: 'write', onConflict }),
      });
      const data = await res.json();
      if (res.ok) {
        const written = data.results.filter((r: any) => !r.skipped).length;
        const skipped = data.results.filter((r: any) => r.skipped).length;
        let msg = `✅ 成功入库 ${written} 道题`;
        if (skipped > 0) msg += `，跳过 ${skipped} 道（文件已存在）`;
        setMessage(msg);
        setInput('');
        setHighlightedIndex(null);
      } else {
        setMessage(`❌ ${data.error || '入库失败'}`);
      }
    } catch {
      setMessage('❌ 网络错误');
    } finally {
      setSaving(false);
    }
  };

  // ===== 入库入口 =====
  const handleSave = async () => {
    if (questions.length === 0) { setMessage('未识别到题目'); return; }

    const list = buildQuestionList();
    if (!list) { setSaving(false); return; }

    setSaving(true);
    setMessage('');

    try {
      const checkRes = await fetch('/api/add-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: list, action: 'check' }),
      });
      const checkData = await checkRes.json();
      const conflicts: { index: number; number: string; source: string; fileName: string }[] = checkData.conflicts || [];

      if (conflicts.length === 0) {
        await doSave(list, 'overwrite');
      } else {
        pendingListRef.current = list;
        setConflictList(conflicts);
        setSaving(false);
      }
    } catch {
      setMessage('❌ 网络错误');
      setSaving(false);
    }
  };

  // ===== 批量导入：校验（dry-run） =====
  const handleImport = async (files: ImportFile[]) => {
    if (files.length === 0) { setMessage('❌ 没有读取到任何 .md / .txt / .zip 文件'); return; }
    setImporting(true);
    setMessage('');
    setImportFiles(files);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`❌ ${data.error || '校验失败'}`); return; }
      setImportReport({ summary: data.summary, items: data.items });
    } catch {
      setMessage('❌ 网络错误');
    } finally {
      setImporting(false);
    }
  };

  // ===== 批量导入：确认写入 =====
  const confirmImport = async (onConflict: 'skip' | 'overwrite') => {
    setImporting(true);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: importFiles, dryRun: false, onConflict }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`❌ ${data.error || '导入失败'}`); return; }
      let msg = `✅ 成功导入 ${data.written} 道题`;
      if (data.skipped > 0) msg += `，跳过 ${data.skipped} 道（文件已存在）`;
      if (data.summary?.withErrors > 0) msg += `，${data.summary.withErrors} 道因格式错误被忽略`;
      setMessage(msg);
      setImportReport(null);
      setImportFiles([]);
    } catch {
      setMessage('❌ 网络错误');
    } finally {
      setImporting(false);
    }
  };

  // ===== 拖拽处理 =====
  const onDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const read = await readFiles(files);
    handleImport(read);
  };

  // ===== 选择文件 =====
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const read = await readFiles(files);
    handleImport(read);
  };

  const errorItems = importReport?.items.filter(i => i.errors.length > 0) ?? [];
  const warnItems = importReport?.items.filter(i => i.errors.length === 0 && i.warnings.length > 0) ?? [];

  // ===== 界面 =====
  return (
    <AppShell variant="full" title="添加题目">
      <div className={styles.container}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>添加题目</h1>
        </div>

      {/* 顶部元数据设置栏 */}
      <div className={styles.metaBar}>
        <label className={styles.metaLabel}>
          来源
          <input
            className={styles.metaInput}
            placeholder="留空则取 YAML 中的来源"
            value={source}
            onChange={e => setSource(e.target.value)}
          />
        </label>

        <label className={styles.metaLabel}>
          年级
          <select className={styles.metaSelect} value={defaultGrade} onChange={e => handleGradeChange(e.target.value)}>
            {(config.gradeList || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        <label className={styles.metaLabel}>
          学期
          <select className={styles.metaSelect} value={defaultSemester} onChange={e => setDefaultSemester(e.target.value)}>
            <option value="">（不设默认）</option>
            {currentSemesterOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className={styles.metaLabel}>
          类别
          <select className={styles.metaSelect} value={examType} onChange={e => setExamType(e.target.value)}>
            <option value="练习题">练习题</option>
            {currentExamTypeOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className={styles.metaLabel}>
          题型
          <select className={styles.metaSelect} value={defaultType} onChange={e => setDefaultType(e.target.value)}>
            <option value="">（不设默认）</option>
            <option value="单选题">单选题</option>
            <option value="多选题">多选题</option>
            <option value="填空题">填空题</option>
            <option value="解答题">解答题</option>
          </select>
        </label>

        <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? '入库中...' : `确认入库 (${questions.length} 题)`}
        </button>
        <button
          onClick={() => router.push('/')}
          style={{
            padding: '0.65rem 1.4rem', border: '1px solid #999', borderRadius: '8px',
            backgroundColor: 'transparent', fontSize: '0.92rem', cursor: 'pointer',
            transition: '0.2s all', display: 'inline-flex', alignItems: 'center', gap: '6px'
          }}
        >
          ← 返回首页
        </button>
      </div>

      {/* 提示消息 */}
      {message && (
        <div className={message.startsWith('✅') || message.startsWith('⚠') ? styles.msgOk : styles.msgErr}>
          {message}
        </div>
      )}

      {/* 冲突弹窗 */}
      {conflictList && conflictList.length > 0 && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>⚠️ 文件冲突</div>
            <div className={styles.dialogBody}>
              以下 {conflictList.length} 道题的文件已存在：
              <ul className={styles.conflictList}>
                {conflictList.map((c, i) => (<li key={i}>{c.fileName}</li>))}
              </ul>
              请选择处理方式：
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.dialogBtnSecondary} onClick={() => setConflictList(null)}>取消</button>
              <button className={styles.dialogBtnSecondary} onClick={() => doSave(pendingListRef.current, 'skip')}>跳过已存在的</button>
              <button className={styles.dialogBtnPrimary} onClick={() => doSave(pendingListRef.current, 'overwrite')}>覆盖全部</button>
            </div>
          </div>
        </div>
      )}

      {/* 导入校验报告弹窗 */}
      {importReport && (
        <div className={styles.overlay}>
          <div className={styles.dialogWide}>
            <div className={styles.dialogTitle}>📋 导入校验报告</div>
            <div className={styles.dialogBody}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryOk}>通过 {importReport.summary.ok} 题</span>
                <span className={styles.summaryErr}>错误 {importReport.summary.withErrors} 题</span>
                <span className={styles.summaryWarn}>警告 {importReport.summary.withWarnings} 题</span>
                <span className={styles.summaryTotal}>共 {importReport.summary.total} 题</span>
              </div>

              {errorItems.length > 0 && (
                <div className={styles.reportBlock}>
                  <div className={styles.reportTitle}>❌ 有错误（不会入库）</div>
                  <ul className={styles.reportList}>
                    {errorItems.slice(0, 50).map((it, i) => (
                      <li key={i}>
                        <strong>{it.file}{it.number ? ` · ${it.number}` : ''}</strong>：{it.errors.join('；')}
                      </li>
                    ))}
                  </ul>
                  {errorItems.length > 50 && <div className={styles.more}>…还有 {errorItems.length - 50} 条</div>}
                </div>
              )}

              {warnItems.length > 0 && (
                <div className={styles.reportBlock}>
                  <div className={styles.reportTitle}>⚠️ 有警告（仍会入库，建议核对）</div>
                  <ul className={styles.reportList}>
                    {warnItems.slice(0, 50).map((it, i) => (
                      <li key={i}>
                        <strong>{it.file}{it.number ? ` · ${it.number}` : ''}</strong>：{it.warnings.join('；')}
                      </li>
                    ))}
                  </ul>
                  {warnItems.length > 50 && <div className={styles.more}>…还有 {warnItems.length - 50} 条</div>}
                </div>
              )}

              {importReport.summary.total === 0 && (
                <div className={styles.more}>未从文件中解析出任何题目（请确认文件为规范的题库 markdown）</div>
              )}
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.dialogBtnSecondary} onClick={() => { setImportReport(null); setImportFiles([]); }}>取消</button>
              <button
                className={styles.dialogBtnSecondary}
                disabled={importing || importReport.summary.ok === 0}
                onClick={() => confirmImport('skip')}
              >
                仅导入通过的（跳过重复）
              </button>
              <button
                className={styles.dialogBtnPrimary}
                disabled={importing || importReport.summary.ok === 0}
                onClick={() => confirmImport('overwrite')}
              >
                导入并覆盖重复
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 双栏：左输入，右预览 */}
      <div className={styles.columns}>
        {/* 左侧：输入区 */}
        <div
          className={`${styles.leftPanel} ${dragOver ? styles.leftPanelDrag : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={onDropFiles}
        >
          <div className={styles.panelHeader}>
            粘贴区
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <label className={styles.uploadBtn}>
                {importing ? '校验中...' : '📥 导入 .md / .zip'}
                <input
                  ref={mdFileRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.txt,.zip"
                  style={{ display: 'none' }}
                  onChange={onPickFiles}
                />
              </label>
              <label className={styles.uploadBtn}>
                {uploading ? '上传中...' : '📷 上传图片'}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </span>
          </div>

          {dragOver && (
            <div className={styles.dropHint}>松开鼠标，导入 .md / .zip 文件</div>
          )}

          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={`粘贴 AI 格式化好的题目，或直接把 .md 文件拖进来…

格式示例：
---
type: 单选题
source: 25海淀一模
number: T1
chapter: [集合与常用逻辑用语]
section: [集合的概念, 集合的基本运算]
knowledge: [【必备知识】补集及其常用结论]
---
## 题目
已知集合 $A = \\{x \\mid -1 < x < 3\\}$，则补集为 [选]

## 选项
A．...
B．...

## 答案
C

## 解析
…

==========

（多道题用 ========== 分隔）

💡 拖入 .md / .zip 会先校验再入库
💡 截图后 Ctrl+V 可直接粘贴图片`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onMouseUp={handleCursorMove}
            onKeyUp={handleCursorMove}
            onPaste={e => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of items) {
                if (item.type.startsWith('image/')) {
                  e.preventDefault();
                  const file = item.getAsFile();
                  if (file) handleUpload(file);
                  return;
                }
              }
            }}
          />
        </div>

        {/* 右侧：预览区 */}
        <div className={styles.rightPanel}>
          <div className={styles.panelHeader}>
            预览 ({questions.length} 题)
          </div>
          <div className={styles.previewList}>
            {questions.length === 0 ? (
              <div className={styles.empty}>粘贴题目后在此预览</div>
            ) : (
              questions.map((q, i) => (
                <div
                  key={i}
                  ref={el => { cardRefs.current[i] = el; }}
                  className={`${styles.card} ${highlightedIndex === i ? styles.cardHighlighted : ''}`}
                  onClick={() => handleCardClick(i)}
                >
                  <div className={styles.cardMeta}>
                    <span className={styles.cardIdx}>{q.yaml.number || `T${i + 1}`}</span>
                    {(() => {
                      const src = q.yaml.source || source.trim();
                      if (src) return <span className={styles.yamlTag}>{src}</span>;
                      return null;
                    })()}
                    <span className={styles.cardType}>{q.yaml.type || defaultType || '?'}</span>
                    {(() => {
                      const y = q.yaml;
                      const vals: string[] = [];
                      vals.push(y.grade || defaultGrade);
                      const sem = y.semester || defaultSemester;
                      if (sem) vals.push(sem);
                      const et = y.exam_type || examType;
                      if (et) vals.push(et);
                      const diff = y.difficulty;
                      if (diff != null && diff !== '') vals.push(String(diff));
                      return vals.map((v, j) => (<span key={j} className={styles.yamlTag}>{v}</span>));
                    })()}
                    {Array.isArray(q.yaml.chapter) && q.yaml.chapter.map((c: string, j: number) => (
                      <span key={`ch${j}`} className={styles.yamlTag}>{c}</span>
                    ))}
                    {Array.isArray(q.yaml.section) && q.yaml.section.map((s: string, j: number) => (
                      <span key={`se${j}`} className={styles.yamlTag}>{s}</span>
                    ))}
                  </div>

                  {q.sections['题目'] && (
                    <div className={styles.cardSection}><MathText text={q.sections['题目']} /></div>
                  )}
                  {q.sections['选项'] && (
                    <div className={styles.cardOption}><MathText text={q.sections['选项']} /></div>
                  )}
                  {q.sections['答案'] && (
                    <div className={styles.cardAnswer}>
                      <strong>答案：</strong><MathText text={q.sections['答案']} />
                    </div>
                  )}
                  {q.sections['解析'] && (
                    <details className={styles.cardDetail}>
                      <summary>解析</summary>
                      <MathText text={q.sections['解析']} />
                    </details>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      </div>
    </AppShell>
  );
}
