/**
 * 试题篮（候选题目清单）—— 结构化本地存储
 * ============================================================
 * 设计要点
 * - 存 localStorage，key = `highmath.basket.v1`
 * - 有序数组 = 用户勾选顺序；重复加入同一 qid 时保留原位置（不重排）
 * - 只读题库：本模块**不写入题库目录**，仅操作浏览器本地存储
 * - 兼容旧数据：首次读取时若发现历史的 `questionBarData`（纯文本拼接），
 *   自动解析并升级为新结构，随后删除旧 key
 */

export interface BasketItem {
  /** 题号（题库 qid，字符串化） */
  qid: string;
  grade: string;
  source: string;
  number: string;
  type: string;
  difficulty: number | null;
  semester: string;
  exam_type: string;
  chapter: string[];
  section: string[];
  knowledge: string[];
  tags: string[];
  /** 题目全文（含 YAML frontmatter + 各 section），供编讲义直接使用 */
  raw: string;
  /** 题干纯文本摘要，用于列表速览 */
  preview: string;
  /** 加入时间戳 */
  addedAt: number;
}

export const BASKET_KEY = 'highmath.basket.v1';
const LEGACY_KEY = 'questionBarData';
const LEGACY_SEP = '\n\n==========\n\n';

/** 事件名：试题篮发生变化时派发，供导航徽标等订阅 */
export const BASKET_EVENT = 'highmath:basket';

/** 会话级：从试题篮跳转到编讲义时携带的导入意图 key（sessionStorage） */
export const BENCH_HINT_KEY = 'highmath.handout.import';
/** 会话级：从试题篮跳转到组卷时携带的导入意图 key（sessionStorage，预留） */
export const BENCH_HINT_EXAM_KEY = 'highmath.exam.import';

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** 从题目全文里抽出题干摘要 */
function extractPreview(raw: string): string {
  const m = raw.match(/##\s*题目\s*\n([\s\S]*?)(?:\n##\s|\n*$)/);
  const body = (m ? m[1] : raw).trim();
  // 去掉 markdown 标记与多余空行，截断
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图]')
    .replace(/[$\\{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * 把「题目全文文本」解析为 BasketItem。
 * 文本格式 = FilterableTable 组装的 YAML frontmatter + `## 题目/选项/答案/解析` 分节。
 */
export function makeBasketItem(raw: string, fallbackQid?: string): BasketItem | null {
  const text = (raw || '').trim();
  if (!text) return null;

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data: Record<string, string> = {};
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      v = v.replace(/^\[/, '').replace(/\]$/, '').trim();
      data[k] = v;
    }
  }

  const qid = String(data.qid || fallbackQid || '').trim();
  if (!qid) return null;

  const diff = Number(data.difficulty);
  return {
    qid,
    grade: data.grade || '',
    source: data.source || '',
    number: data.number || '',
    type: data.type || '',
    difficulty: Number.isFinite(diff) && data.difficulty !== '' ? diff : null,
    semester: data.semester || '',
    exam_type: data.exam_type || '',
    chapter: toArray(data.chapter),
    section: toArray(data.section),
    knowledge: toArray(data.knowledge),
    tags: toArray(data.tags),
    raw: text,
    preview: extractPreview(text),
    addedAt: Date.now(),
  };
}

/* ============================ 读写 ============================ */

export function getBasket(): BasketItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const rawStr = localStorage.getItem(BASKET_KEY);
    if (rawStr) {
      const parsed = JSON.parse(rawStr);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => x && typeof x === 'object' && x.qid) as BasketItem[];
      }
    }
  } catch {
    /* 损坏数据当作空篮 */
  }
  return migrateLegacy();
}

function saveBasket(items: BasketItem[], silent = false): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(items));
  } catch {
    /* 容量超限：静默失败，调用方可提示 */
  }
  if (!silent) {
    dispatchBasketEvent();
  }
}

/** 派发变更事件（供导航徽标、编讲义页实时同步） */
export function dispatchBasketEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BASKET_EVENT));
}

/** 追加若干题目；已存在的 qid 跳过（保序、去重） */
export function addToBasket(items: BasketItem[]): { added: number; skipped: number } {
  const cur = getBasket();
  const seen = new Set(cur.map((x) => x.qid));
  let added = 0;
  let skipped = 0;
  const next = [...cur];
  for (const it of items) {
    if (seen.has(it.qid)) {
      skipped += 1;
      continue;
    }
    seen.add(it.qid);
    next.push({ ...it, addedAt: it.addedAt || Date.now() });
    added += 1;
  }
  if (added > 0) saveBasket(next);
  return { added, skipped };
}

export function removeFromBasket(qid: string): void {
  const next = getBasket().filter((x) => x.qid !== qid);
  saveBasket(next);
}

export function removeManyFromBasket(qids: string[]): void {
  const set = new Set(qids);
  saveBasket(getBasket().filter((x) => !set.has(x.qid)));
}

export function clearBasket(): void {
  saveBasket([]);
}

/** 覆盖式写入（编讲义里回写排序等场景） */
export function setBasket(items: BasketItem[]): void {
  saveBasket(items);
}

/* ============================ 旧数据迁移 ============================ */

/** 把旧 questionBarData（纯文本拼接）迁移为结构化数组；成功后删除旧 key */
function migrateLegacy(): BasketItem[] {
  if (typeof window === 'undefined') return [];
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return [];
  }
  if (!legacy) return [];

  const items: BasketItem[] = [];
  const seen = new Set<string>();
  for (const chunk of legacy.split(LEGACY_SEP)) {
    const it = makeBasketItem(chunk);
    if (it && !seen.has(it.qid)) {
      seen.add(it.qid);
      items.push(it);
    }
  }

  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(items));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 忽略 */
  }
  return items;
}

/* ============================ 工具 ============================ */

/** 生成试题篮 → 编讲义可用的拼接文本（兼容既有 parseQuestions 解析器） */
export function basketToRawText(items: BasketItem[]): string {
  return items.map((x) => x.raw).join(LEGACY_SEP);
}

/** 难度星级 */
export function starsFromDifficulty(d: number | null): string {
  if (d == null || !Number.isFinite(d)) return '—';
  const n = Math.max(1, Math.min(5, Math.round(d)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** 去掉 YAML frontmatter，只留正文（供渲染用） */
export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}
