/**
 * 讲义草稿自动留档
 * ============================================================
 * 目标：编讲义写到一半停止（关页 / 断电 / 切页）不丢数据。
 *
 * 存储分层（由强到弱，自动降级）：
 *   1) 桌面版：Electron 主进程写入
 *      %APPDATA%\HighMath\drafts\  （Windows）
 *      ~/Library/Application Support/HighMath/drafts/ （macOS）
 *      ~/.config/highmath/drafts/ （Linux）
 *      通过 window.highmath.draft* 暴露的 IPC 调用。
 *   2) 浏览器 / Web 版：请求 /api/drafts（Node 侧写 os.tmpdir()/highmath-drafts）
 *   3) 兜底：localStorage（容量有限，只保留 2 份，防爆）
 *
 * 约束：以上均**不写入题库目录**，与「题库零影响」硬约束一致。
 */

export interface DraftMeta {
  id: string;
  name: string;
  /** 模块数量 */
  modules: number;
  /** 题目数量 */
  questions: number;
  /** 最近更新时间戳 */
  updatedAt: number;
}

export interface DraftPayload {
  id?: string;
  name: string;
  modules: unknown[];
  settings: unknown;
  /**
   * 题目池快照（qid → 题目全文）。
   * 模块只存 qid，正文要靠题目池现查；把池一起留档后，
   * 刷新 / 重开应用仍能还原讲义，不必再依赖试题篮。
   */
  pool?: Record<string, string>;
  /** 手动粘贴进来的补充文本（同池一并留档） */
  extraText?: string;
  updatedAt: number;
}

/** 自动留档：最多保留份数 */
export const DRAFT_KEEP = 20;
/** 自动留档：超过该天数的草稿清理 */
export const DRAFT_TTL_DAYS = 30;
/** 当前草稿的固定 id（「继续上次编辑」用） */
export const CURRENT_DRAFT_ID = '__current__';

const LS_INDEX = 'highmath.drafts.index';
const LS_BODY = (id: string) => `highmath.drafts.body.${id}`;

/* ============================ 环境探测 ============================ */

interface HighMathBridge {
  draftSave?: (payload: unknown) => Promise<unknown>;
  draftLoad?: (id: string) => Promise<unknown>;
  draftList?: () => Promise<unknown>;
  draftDelete?: (id: string) => Promise<unknown>;
}

function bridge(): HighMathBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { highmath?: HighMathBridge };
  return w.highmath && (w.highmath.draftSave || w.highmath.draftList) ? w.highmath : null;
}

function hasApi(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

/* ============================ localStorage 兜底 ============================ */

function lsReadIndex(): DraftMeta[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_INDEX);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as DraftMeta[]) : [];
  } catch {
    return [];
  }
}

function lsWriteIndex(list: DraftMeta[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
}

function lsSave(payload: DraftPayload): DraftMeta {
  const id = payload.id || CURRENT_DRAFT_ID;
  const meta = toMeta({ ...payload, id });
  try {
    localStorage.setItem(LS_BODY(id), JSON.stringify({ ...payload, id }));
  } catch {
    /* 忽略 */
  }
  const list = lsReadIndex().filter((x) => x.id !== id);
  list.unshift(meta);
  // localStorage 兜底只保留 2 份，防容量爆掉
  const keep = list.slice(0, 2);
  keep.forEach((m) => {
    if (!localStorage.getItem(LS_BODY(m.id))) localStorage.removeItem(LS_BODY(m.id));
  });
  for (const m of list.slice(2)) {
    try {
      localStorage.removeItem(LS_BODY(m.id));
    } catch {
      /* 忽略 */
    }
  }
  lsWriteIndex(keep);
  return meta;
}

function lsLoad(id?: string): DraftPayload | null {
  if (typeof window === 'undefined') return null;
  const target = id || CURRENT_DRAFT_ID;
  try {
    const raw = localStorage.getItem(LS_BODY(target));
    return raw ? (JSON.parse(raw) as DraftPayload) : null;
  } catch {
    return null;
  }
}

function lsList(): DraftMeta[] {
  return prune(lsReadIndex());
}

function lsDelete(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LS_BODY(id));
  } catch {
    /* 忽略 */
  }
  lsWriteIndex(lsReadIndex().filter((x) => x.id !== id));
}

/* ============================ 公共工具 ============================ */

function newId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function toMeta(p: DraftPayload): DraftMeta {
  const modules = Array.isArray(p.modules) ? p.modules : [];
  let questions = 0;
  for (const m of modules as { qids?: unknown[] }[]) {
    if (m && Array.isArray(m.qids)) questions += m.qids.length;
  }
  return {
    id: p.id || CURRENT_DRAFT_ID,
    name: (p.name || '').trim() || '未命名讲义',
    modules: modules.length,
    questions,
    updatedAt: p.updatedAt || Date.now(),
  };
}

/** 清理过期 / 超额草稿（保留最近 DRAFT_KEEP 份 且 不超过 DRAFT_TTL_DAYS 天） */
function prune(list: DraftMeta[]): DraftMeta[] {
  const cutoff = Date.now() - DRAFT_TTL_DAYS * 86400_000;
  return list
    .filter((m) => m.id === CURRENT_DRAFT_ID || m.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, DRAFT_KEEP);
}

export function draftDisplayName(m: DraftMeta): string {
  const t = new Date(m.updatedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return `${m.name} · ${stamp}`;
}

/* ============================ 对外 API ============================ */

/**
 * 载入草稿。
 * - 不传 id：载入「当前草稿」（用于进页面时恢复未完成内容）
 * - 传 id：载入该历史草稿
 * 返回 null 表示没有可用草稿。
 */
export function loadDraft(id?: string): DraftPayload | null {
  const local = lsLoad(id);
  if (local) return local;

  // 异步源（桌面 IPC / Web API）无法同步返回 → 由 loadDraftAsync 负责
  return null;
}

/** 异步版本：桌面 IP ／ Web API 优先，localStorage 兜底 */
export async function loadDraftAsync(id?: string): Promise<DraftPayload | null> {
  const b = bridge();
  if (b?.draftLoad) {
    try {
      const r = await b.draftLoad(id || CURRENT_DRAFT_ID);
      if (r && typeof r === 'object') return r as DraftPayload;
    } catch {
      /* 降级 */
    }
  }
  if (hasApi()) {
    try {
      const url = id ? `/api/drafts?id=${encodeURIComponent(id)}` : '/api/drafts';
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          const payload = (j.payload ?? j) as DraftPayload;
          if (payload && payload.modules) return payload;
        }
      }
    } catch {
      /* 降级 */
    }
  }
  return lsLoad(id);
}

/** 列出全部草稿（同步 = localStorage 兜底；异步源见 listDraftsAsync） */
export function listDrafts(): DraftMeta[] {
  return lsList();
}

export async function listDraftsAsync(): Promise<DraftMeta[]> {
  const b = bridge();
  if (b?.draftList) {
    try {
      const r = await b.draftList();
      if (Array.isArray(r)) return prune(r as DraftMeta[]);
    } catch {
      /* 降级 */
    }
  }
  if (hasApi()) {
    try {
      const res = await fetch('/api/drafts?list=1', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        const list = (Array.isArray(j) ? j : j?.drafts) as DraftMeta[] | undefined;
        if (Array.isArray(list)) return prune(list);
      }
    } catch {
      /* 降级 */
    }
  }
  return lsList();
}

function deleteDraftSync(id: string): void {
  lsDelete(id);
}

export function deleteDraft(id: string): void {
  // 先本地删（立即生效），异步源后台清理
  deleteDraftSync(id);
  const b = bridge();
  if (b?.draftDelete) {
    void b.draftDelete(id).catch(() => undefined);
    return;
  }
  if (hasApi()) {
    void fetch(`/api/drafts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

export async function deleteDraftAsync(id: string): Promise<void> {
  deleteDraftSync(id);
  const b = bridge();
  if (b?.draftDelete) {
    try {
      await b.draftDelete(id);
    } catch {
      /* 忽略 */
    }
    return;
  }
  if (hasApi()) {
    try {
      await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      /* 忽略 */
    }
  }
}

/** 立即保存（同步，写 localStorage 兜底；异步源 fire-and-forget） */
export function saveDraft(payload: DraftPayload): DraftMeta {
  const meta = lsSave(payload);
  const full = { ...payload, id: payload.id || CURRENT_DRAFT_ID };
  const b = bridge();
  if (b?.draftSave) {
    void b.draftSave(full).catch(() => undefined);
  } else if (hasApi()) {
    void fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }).catch(() => undefined);
  }
  return meta;
}

/* ---------- 防抖保存 ---------- */

let _timer: ReturnType<typeof setTimeout> | null = null;
let _inflight = false;
let _pending: DraftPayload | null = null;

/**
 * 防抖保存（默认 800ms）。
 * onDone(true) 表示已落盘至少到 localStorage；桌面/Web 通道异步补写。
 */
export function saveDraftDebounced(
  payload: DraftPayload,
  onDone?: (ok: boolean) => void,
  delay = 800
): void {
  _pending = payload;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    const p = _pending;
    _pending = null;
    if (!p || _inflight) return;
    _inflight = true;
    try {
      saveDraft(p);
      onDone?.(true);
    } catch {
      onDone?.(false);
    } finally {
      _inflight = false;
    }
  }, delay);
}

/** 强制立即落盘（切页 / beforeunload 前调用） */
export function flushDraft(onDone?: (ok: boolean) => void): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  const p = _pending;
  _pending = null;
  if (!p) return;
  try {
    saveDraft(p);
    onDone?.(true);
  } catch {
    onDone?.(false);
  }
}
