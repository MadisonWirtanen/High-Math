/**
 * src/app/api/drafts/route.ts — 讲义草稿留档（Web 版通道）
 * ============================================================
 * 桌面版走 Electron 主进程 IPC（见 desktop/preload.js + main.js）；
 * Web / 浏览器打开时，降级到本接口，把草稿写在用户数据目录下的 drafts/。
 *
 *   GET  /api/drafts            → 取「当前草稿」全文
 *   GET  /api/drafts?id=xxx     → 取指定草稿全文
 *   GET  /api/drafts?list=1     → 取草稿索引（元信息列表）
 *   POST /api/drafts            → 写入/覆盖一份草稿（body = DraftPayload）
 *   DELETE /api/drafts?id=xxx   → 删除一份草稿
 *
 * 硬约束：草稿目录**不在题库内**，只是应用私有数据目录，题库保持只读。
 */

import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

/** 草稿保留策略（与前端 handoutDraft.ts 保持一致） */
const KEEP = 20;
const TTL_DAYS = 30;
const CURRENT_ID = '__current__';

interface DraftMeta {
  id: string;
  name: string;
  modules: number;
  questions: number;
  updatedAt: number;
}

/** 应用私有数据目录（非题库） */
function dataRoot(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'HighMath');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'HighMath');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'highmath');
}

function draftsDir(): string {
  return path.join(dataRoot(), 'drafts');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** id → 磁盘文件名；严格过滤，防止路径穿越 */
function fileFor(id: string): string {
  const safe = String(id || CURRENT_ID).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(draftsDir(), `${safe}.json`);
}

function metaOf(payload: unknown, fallbackId: string): DraftMeta {
  const p = (payload || {}) as { name?: string; modules?: unknown[]; updatedAt?: number };
  const modules = Array.isArray(p.modules) ? p.modules : [];
  let questions = 0;
  for (const m of modules as { qids?: unknown[] }[]) {
    if (m && Array.isArray(m.qids)) questions += m.qids.length;
  }
  return {
    id: fallbackId,
    name: (p.name || '').trim() || '未命名讲义',
    modules: modules.length,
    questions,
    updatedAt: p.updatedAt || Date.now(),
  };
}

/** 读取全部草稿索引并按保留策略做一次清理 */
function readIndex(): DraftMeta[] {
  const dir = draftsDir();
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - TTL_DAYS * 86400_000;
  const list: DraftMeta[] = [];

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      const m = metaOf(JSON.parse(raw), id);
      if (id === CURRENT_ID || m.updatedAt >= cutoff) list.push(m);
      else fs.unlinkSync(path.join(dir, f)); // 过期清除
    } catch {
      /* 损坏文件跳过 */
    }
  }

  list.sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = list.slice(0, KEEP);
  for (const m of list.slice(KEEP)) {
    if (m.id === CURRENT_ID) continue;
    try {
      fs.unlinkSync(fileFor(m.id));
    } catch {
      /* 忽略 */
    }
  }
  return kept;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const wantList = sp.get('list');

  try {
    if (wantList) {
      return Response.json({ drafts: readIndex() });
    }
    const f = fileFor(id || CURRENT_ID);
    if (!fs.existsSync(f)) return Response.json({ payload: null });
    const raw = fs.readFileSync(f, 'utf-8');
    return Response.json({ payload: JSON.parse(raw) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id || CURRENT_ID).replace(/[^A-Za-z0-9_-]/g, '_') || CURRENT_ID;
    const payload = { ...body, id };

    ensureDir(draftsDir());
    fs.writeFileSync(fileFor(id), JSON.stringify(payload), 'utf-8');

    // 顺手做一次保留策略清理
    readIndex();
    return Response.json({ ok: true, meta: metaOf(payload, id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!id) return Response.json({ error: '缺少 id' }, { status: 400 });
    const f = fileFor(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
