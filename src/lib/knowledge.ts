/**
 * src/lib/knowledge.ts — 知识点总表解析与校验（三级结构）
 *
 * 总表按「一级（章）→ 二级（节）→ 三级（知识点）」组织，对应题库 YAML 的
 * chapter / section / knowledge 三个字段。
 *
 * 本模块负责：
 *   1. 解析总表，构建三级索引（章节树 + 各类名称集合 + 隶属关系）
 *   2. 录入题目时校验 chapter / section / knowledge 是否都在总表内
 *   3. 为前端筛选提供章 / 节 / 知识点选项
 *
 * 总表定位见 paths.resolveKnowledgeTable()。
 */

import fs from 'fs';
import { resolveKnowledgeTable } from './paths';
import { getConfig } from './config';

const PREFIX_RE = /^【(?:必备知识|情境问题|能力素养|思想方法)】.+/;

/** 按「未转义的 |」切分表格行 */
function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export interface KnowledgePoint {
  name: string;        // 三级：知识点（含【】前缀）
  chapter: string;     // 一级：章
  section: string;     // 二级：节
  difficulty: string;  // 星级，如 ★★
}

export interface SectionNode {
  name: string;
  knowledge: KnowledgePoint[];
}

export interface ChapterNode {
  name: string;
  sections: SectionNode[];
}

export interface KnowledgeIndex {
  available: boolean;
  path: string | null;
  chapters: ChapterNode[];
  points: KnowledgePoint[];
  chapterNames: string[];
  sectionNames: string[];
  knowledgeNames: string[];
  /** 节 → 所属章 */
  sectionToChapter: Map<string, string>;
  /** 知识点 → 所属 {章, 节} */
  knowledgeToPath: Map<string, { chapter: string; section: string }>;
}

function emptyIndex(): KnowledgeIndex {
  return {
    available: false,
    path: null,
    chapters: [],
    points: [],
    chapterNames: [],
    sectionNames: [],
    knowledgeNames: [],
    sectionToChapter: new Map(),
    knowledgeToPath: new Map(),
  };
}

/**
 * 解析总表 markdown → 三级索引。
 *
 * 优先从表格列取值（「一级（章）」「二级（节）」「知识点」三列）；
 * 若表格没有章/节列（旧版 4 列格式），则退化为按 `## 第X章` / `### 节名` 标题层级推导。
 */
export function parseKnowledgeIndex(markdown: string): KnowledgeIndex {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let chapterIdx = -1;
  let sectionIdx = -1;
  let knowledgeIdx = -1;
  let diffIdx = -1;

  // 标题层级兜底用
  let curChapter = '';
  let curSection = '';

  const points: KnowledgePoint[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // ---- 标题（兜底路径）----
    if (trimmed.startsWith('## ')) {
      const t = trimmed.slice(3).trim();
      // 「## 第一章　初高衔接」→ 取章名（去「第X章」前缀）
      const m = t.match(/^第[一二三四五六七八九十百零\d]+章[\s　]*(.+)$/);
      if (m) curChapter = m[1].trim();
      continue;
    }
    if (trimmed.startsWith('### ')) {
      const t = trimmed.slice(4).trim();
      // 文档自身的编号小节（如 2.1 xxx）不算节名
      if (!/^\d+(\.\d+)+/.test(t)) curSection = t;
      continue;
    }

    if (!trimmed.startsWith('|')) continue;

    // ---- 判断是否为「真正的表头」：下一行必须是 markdown 表格分隔行 ----
    // （文档正文里也有含「知识点」三字的说明行，不能用关键字直接判定表头）
    const nextLine = (lines[i + 1] || '').trim();
    const isHeader = /^\|[\s:|-]+\|$/.test(nextLine) && nextLine.includes('-');
    if (isHeader) {
      const cells = splitRow(trimmed);
      const ki = cells.findIndex(c => c.includes('知识点'));
      if (ki !== -1) {
        knowledgeIdx = ki;
        chapterIdx = cells.findIndex(c => c.includes('一级') || c === '章');
        sectionIdx = cells.findIndex(c => c.includes('二级') || c === '节');
        diffIdx = cells.findIndex(c => c.includes('难度'));
      }
      continue;
    }

    if (knowledgeIdx === -1) continue;

    // ---- 数据行 ----
    const cells = splitRow(trimmed);
    const kName = cells[knowledgeIdx];
    if (!kName || !PREFIX_RE.test(kName)) continue;
    if (seen.has(kName)) continue;

    const chapter = chapterIdx !== -1 ? (cells[chapterIdx] || curChapter) : curChapter;
    const section = sectionIdx !== -1 ? (cells[sectionIdx] || curSection) : curSection;

    seen.add(kName);
    points.push({
      name: kName,
      chapter: chapter || '',
      section: section || '',
      difficulty: diffIdx !== -1 ? (cells[diffIdx] || '') : '',
    });
  }

  // ---- 构建章节树 ----
  const chapterMap = new Map<string, Map<string, KnowledgePoint[]>>();
  const chapterOrder: string[] = [];
  const sectionOrder: string[] = [];

  for (const p of points) {
    if (!p.chapter) continue;
    if (!chapterMap.has(p.chapter)) {
      chapterMap.set(p.chapter, new Map());
      chapterOrder.push(p.chapter);
    }
    const secMap = chapterMap.get(p.chapter)!;
    if (p.section && !secMap.has(p.section)) {
      secMap.set(p.section, []);
      if (!sectionOrder.includes(p.section)) sectionOrder.push(p.section);
    }
    if (p.section) secMap.get(p.section)!.push(p);
  }

  const chapters: ChapterNode[] = chapterOrder.map(ch => ({
    name: ch,
    sections: Array.from(chapterMap.get(ch)!.entries()).map(([name, knowledge]) => ({ name, knowledge })),
  }));

  const sectionToChapter = new Map<string, string>();
  const knowledgeToPath = new Map<string, { chapter: string; section: string }>();
  for (const p of points) {
    if (p.section && !sectionToChapter.has(p.section)) sectionToChapter.set(p.section, p.chapter);
    knowledgeToPath.set(p.name, { chapter: p.chapter, section: p.section });
  }

  return {
    available: points.length > 0,
    path: null,
    chapters,
    points,
    chapterNames: chapterOrder,
    sectionNames: sectionOrder,
    knowledgeNames: points.map(p => p.name),
    sectionToChapter,
    knowledgeToPath,
  };
}

// ---------------- 缓存 ----------------

interface Cache {
  path: string;
  mtimeMs: number;
  index: KnowledgeIndex;
}

let _cache: Cache | null = null;

/** 读取并缓存三级索引（按文件 mtime 失效） */
export function loadKnowledgeIndex(): KnowledgeIndex {
  const p = resolveKnowledgeTable(getConfig());
  if (!p) {
    _cache = null;
    return emptyIndex();
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    return { ...emptyIndex(), path: p };
  }

  if (_cache && _cache.path === p && _cache.mtimeMs === mtimeMs) return _cache.index;

  let index: KnowledgeIndex;
  try {
    index = parseKnowledgeIndex(fs.readFileSync(p, 'utf-8'));
    index.path = p;
  } catch (e) {
    console.warn('[knowledge] 解析总表失败:', (e as Error).message);
    index = { ...emptyIndex(), path: p };
  }

  _cache = { path: p, mtimeMs, index };
  return index;
}

/** 清空缓存 */
export function invalidateKnowledgeCache(): void {
  _cache = null;
}

// ---------------- 对外便捷接口 ----------------

export interface KnowledgeInfo {
  path: string | null;
  count: number;
  chapterCount: number;
  sectionCount: number;
  available: boolean;
}

export function loadKnowledge(): KnowledgeInfo {
  const idx = loadKnowledgeIndex();
  return {
    path: idx.path,
    count: idx.points.length,
    chapterCount: idx.chapterNames.length,
    sectionCount: idx.sectionNames.length,
    available: idx.available,
  };
}

/** 全部知识点名称（旧接口兼容） */
export function parseKnowledgeTable(markdown: string): string[] {
  return parseKnowledgeIndex(markdown).knowledgeNames;
}

/** 模糊搜索知识点 */
export function searchKnowledge(keyword: string, limit = 30): string[] {
  const idx = loadKnowledgeIndex();
  if (!keyword.trim()) return idx.knowledgeNames.slice(0, limit);
  const k = keyword.trim();
  return idx.knowledgeNames.filter(n => n.includes(k)).slice(0, limit);
}

export function isKnownKnowledge(name: string): boolean {
  const idx = loadKnowledgeIndex();
  if (!idx.available) return true;
  return idx.knowledgeToPath.has(name);
}

// ---------------- 校验 ----------------

export interface KnowledgeValidation {
  available: boolean;
  skipped: boolean;
  ok: string[];
  unknown: string[];
}

/** 批量校验知识点（三级） */
export function validateKnowledge(names: string[]): KnowledgeValidation {
  const idx = loadKnowledgeIndex();
  if (!idx.available) return { available: false, skipped: true, ok: [], unknown: [] };
  const ok: string[] = [];
  const unknown: string[] = [];
  for (const n of names) (idx.knowledgeToPath.has(n) ? ok : unknown).push(n);
  return { available: true, skipped: false, ok, unknown };
}

/** 批量校验章（一级） */
export function validateChapters(names: string[]): KnowledgeValidation {
  const idx = loadKnowledgeIndex();
  if (!idx.available) return { available: false, skipped: true, ok: [], unknown: [] };
  const set = new Set(idx.chapterNames);
  const ok: string[] = [];
  const unknown: string[] = [];
  for (const n of names) (set.has(n) ? ok : unknown).push(n);
  return { available: true, skipped: false, ok, unknown };
}

/** 批量校验节（二级） */
export function validateSections(names: string[]): KnowledgeValidation {
  const idx = loadKnowledgeIndex();
  if (!idx.available) return { available: false, skipped: true, ok: [], unknown: [] };
  const set = new Set(idx.sectionNames);
  const ok: string[] = [];
  const unknown: string[] = [];
  for (const n of names) (set.has(n) ? ok : unknown).push(n);
  return { available: true, skipped: false, ok, unknown };
}

export interface TaxonomyValidation {
  available: boolean;
  skipped: boolean;
  unknownChapters: string[];
  unknownSections: string[];
  unknownKnowledge: string[];
  /** 节与章的隶属关系不成立 */
  sectionChapterMismatch: string[];
  /** 知识点与节的隶属关系不成立 */
  knowledgeSectionMismatch: string[];
  /** 由 knowledge 反推出的应填章（用于提示纠正） */
  derivedChapters: string[];
  /** 由 knowledge 反推出的应填节 */
  derivedSections: string[];
}

/**
 * 三级联动校验：检查 chapter / section / knowledge 是否都在总表内，
 * 并检查包含关系（section ⊆ chapter、knowledge ⊆ section）是否成立。
 */
export function validateTaxonomy(
  chapter: string[] = [],
  section: string[] = [],
  knowledge: string[] = []
): TaxonomyValidation {
  const idx = loadKnowledgeIndex();
  if (!idx.available) {
    return {
      available: false, skipped: true,
      unknownChapters: [], unknownSections: [], unknownKnowledge: [],
      sectionChapterMismatch: [], knowledgeSectionMismatch: [],
      derivedChapters: [], derivedSections: [],
    };
  }

  const chSet = new Set(idx.chapterNames);
  const secSet = new Set(idx.sectionNames);

  const unknownChapters = chapter.filter(c => !chSet.has(c));
  const unknownSections = section.filter(s => !secSet.has(s));
  const unknownKnowledge = knowledge.filter(k => !idx.knowledgeToPath.has(k));

  // 由 knowledge 反推应有的章 / 节
  const derivedChapters: string[] = [];
  const derivedSections: string[] = [];
  for (const k of knowledge) {
    const path = idx.knowledgeToPath.get(k);
    if (!path) continue;
    if (path.chapter && !derivedChapters.includes(path.chapter)) derivedChapters.push(path.chapter);
    if (path.section && !derivedSections.includes(path.section)) derivedSections.push(path.section);
  }

  // 包含关系：每个 section 的所属章应出现在 chapter 列表中
  const sectionChapterMismatch: string[] = [];
  for (const s of section) {
    if (!secSet.has(s)) continue;
    const owner = idx.sectionToChapter.get(s);
    if (owner && !chapter.includes(owner)) sectionChapterMismatch.push(s);
  }

  const knowledgeSectionMismatch: string[] = [];
  for (const k of knowledge) {
    const path = idx.knowledgeToPath.get(k);
    if (!path) continue;
    if (path.section && !section.includes(path.section)) knowledgeSectionMismatch.push(k);
  }

  return {
    available: true,
    skipped: false,
    unknownChapters,
    unknownSections,
    unknownKnowledge,
    sectionChapterMismatch,
    knowledgeSectionMismatch,
    derivedChapters,
    derivedSections,
  };
}

// ---------------- 供前端筛选使用 ----------------

export interface TaxonomySection {
  name: string;
  knowledge: string[];
}

export interface TaxonomyChapter {
  chapter: string;
  sections: TaxonomySection[];
}

/**
 * 完整三级树（章 → 节 → 知识点），顺序即总表顺序。
 * 前端用它做级联下拉，保证选项顺序与教材一致。
 */
export function getTaxonomyTree(): TaxonomyChapter[] {
  const idx = loadKnowledgeIndex();
  return idx.chapters.map(c => ({
    chapter: c.name,
    sections: c.sections.map(s => ({
      name: s.name,
      knowledge: s.knowledge.map(k => k.name),
    })),
  }));
}
