/**
 * src/lib/pandoc.ts — Pandoc 定位与执行（跨平台）
 *
 * 检测顺序：
 *   1. 运行期配置 pandocPath（设置页可填）
 *   2. 环境变量 PANDOC_PATH
 *   3. 项目内置（tool/pandoc-3.10/…）
 *   4. 各平台常见安装路径
 *   5. 系统 PATH 中的 pandoc（兜底）
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getConfig } from './config';

/** 当前平台的 pandoc 可执行文件名 */
export function pandocBinName(): string {
  return process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
}

/** 把「可能是目录」的路径规范成可执行文件路径 */
function normalizePandocPath(p: string): string | null {
  if (!p) return null;
  let candidate = p;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      candidate = path.join(candidate, pandocBinName());
    } else if (!candidate.endsWith(pandocBinName()) && !candidate.endsWith('pandoc')) {
      candidate = path.join(candidate, pandocBinName());
    }
  } catch {
    return null;
  }
  return fs.existsSync(candidate) ? candidate : null;
}

/** 项目内置 / 常见安装路径候选 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  const bin = pandocBinName();
  const list: string[] = [
    // 项目内置（开发态 / 打包后 extraResources）
    path.join(cwd, 'src', 'tool', 'pandoc-3.10', bin),
    path.join(cwd, 'tool', 'pandoc-3.10', bin),
    path.join(cwd, 'tools', 'pandoc', bin),
    path.join((process as any).resourcesPath || '', 'pandoc', bin),
  ];

  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\Pandoc\\pandoc.exe',
      'C:\\Program Files (x86)\\Pandoc\\pandoc.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Pandoc', 'pandoc.exe'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'pandoc.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push('/usr/local/bin/pandoc', '/opt/homebrew/bin/pandoc', '/usr/bin/pandoc');
  } else {
    list.push('/usr/bin/pandoc', '/usr/local/bin/pandoc', '/snap/bin/pandoc');
  }
  return list.filter(Boolean);
}

/** 定位 pandoc 可执行文件（找不到时返回 'pandoc'，交给系统 PATH 兜底） */
export function findPandoc(): string {
  const cfg = getConfig();

  const fromConfig = normalizePandocPath(cfg.pandocPath);
  if (fromConfig) return fromConfig;

  const fromEnv = normalizePandocPath(process.env.PANDOC_PATH || '');
  if (fromEnv) return fromEnv;

  for (const p of candidatePaths()) {
    if (fs.existsSync(p)) return p;
  }

  return 'pandoc';
}

/** 异步执行命令 */
export function execPandoc(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

export interface PandocStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

/** 探测 pandoc 是否可用（设置页 / 导出前置检查） */
export async function checkPandoc(): Promise<PandocStatus> {
  const bin = findPandoc();
  try {
    const out = await execPandoc(bin, ['--version'], process.cwd());
    const version = out.split('\n')[0]?.trim();
    return { available: true, path: bin, version };
  } catch (e) {
    return { available: false, path: bin, error: (e as Error).message };
  }
}
