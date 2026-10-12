/**
 * src/lib/paths.ts — 统一路径解析（跨平台）
 *
 * 所有与「题库目录 / 图片目录 / 知识点总表」相关的路径，都必须经过这里，
 * 避免在业务代码里散落 path.join(vault, '题库') 这类硬编码。
 *
 * 支持两种题库模式：
 *   A. Obsidian Vault 模式：vaultPath = Vault 根目录，题目在 <vault>/题库，图片在 <vault>/images
 *   B. 直接题库模式     ：vaultPath = 题库目录本身（bankDirName = '.'），图片在其 images/ 或上一级 images/
 */

import fs from 'fs';
import path from 'path';
import { getConfig, AppConfig } from './config';

/** 题目根目录（绝对路径） */
export function resolveVaultRoot(cfg: AppConfig = getConfig()): string {
  return path.resolve(cfg.vaultPath || './demo-vault');
}

/** 题库目录（绝对路径）—— 题目的 .md 就放在它的子目录里 */
export function resolveBankDir(cfg: AppConfig = getConfig()): string {
  const root = resolveVaultRoot(cfg);
  const name = (cfg.bankDirName || '题库').trim();
  if (!name || name === '.' || name === './') return root;
  return path.join(root, name);
}

export interface ImagesDirInfo {
  /** 实际使用的图片目录 */
  dir: string;
  /** 是否已存在 */
  exists: boolean;
  /** 命中来源，便于设置页展示 */
  from: 'bank' | 'vault' | 'parent' | 'default';
}

/**
 * 解析图片目录。按优先级探测，取第一个真实存在的：
 *   1) <题库目录>/images
 *   2) <Vault 根目录>/images
 *   3) <Vault 根目录>/../images
 * 都不存在时，返回 1) 作为默认（上传时自动创建）。
 */
export function resolveImagesDirInfo(cfg: AppConfig = getConfig()): ImagesDirInfo {
  const root = resolveVaultRoot(cfg);
  const bank = resolveBankDir(cfg);
  const name = (cfg.imagesDirName || 'images').trim() || 'images';

  // 允许配置为绝对路径
  if (path.isAbsolute(name)) {
    const exists = fs.existsSync(name);
    return { dir: name, exists, from: 'default' };
  }

  const candidates: { dir: string; from: ImagesDirInfo['from'] }[] = [
    { dir: path.join(bank, name), from: 'bank' },
    { dir: path.join(root, name), from: 'vault' },
    { dir: path.join(root, '..', name), from: 'parent' },
  ];

  for (const c of candidates) {
    if (fs.existsSync(c.dir) && fs.statSync(c.dir).isDirectory()) {
      return { dir: c.dir, exists: true, from: c.from };
    }
  }
  return { dir: candidates[0].dir, exists: false, from: 'default' };
}

export function resolveImagesDir(cfg: AppConfig = getConfig()): string {
  return resolveImagesDirInfo(cfg).dir;
}

/** 知识点总表候选文件名 */
const KNOWLEDGE_TABLE_NAMES = [
  '高中数学知识点总表.md',
  '高中数学知识点总表（AI查表）.md',
  '知识点总表.md',
];

/**
 * 定位知识点总表。
 * 优先级：显式配置 > 题库目录 > Vault 根目录 > 题库录入规范目录
 * 找不到返回 null（不阻塞主流程，只是校验时给出提示）。
 */
export function resolveKnowledgeTable(cfg: AppConfig = getConfig()): string | null {
  if (cfg.knowledgeTablePath) {
    const p = path.resolve(cfg.knowledgeTablePath);
    if (fs.existsSync(p)) return p;
  }
  const root = resolveVaultRoot(cfg);
  const bank = resolveBankDir(cfg);
  const dirs = [bank, root, path.join(root, '题库录入规范')];

  for (const d of dirs) {
    for (const n of KNOWLEDGE_TABLE_NAMES) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** 确保目录存在 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 文件名净化：把跨平台非法字符替换为下划线。
 * Windows 禁用 <>:"/\|?* 及控制字符，且不能以点/空格结尾；Linux 仅禁 / 与 NUL。
 * 这里统一按「最严格」处理，保证产物在三平台都能落盘。
 */
export function sanitizeFileName(name: string): string {
  let s = (name || '').trim();
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  s = s.replace(/\.+$/, '');       // 结尾的点
  s = s.replace(/[ .]+$/, '');     // 结尾的空格/点
  return s || 'untitled';
}

/** Obsidian Vault 名称（用于 obsidian:// 链接） */
export function vaultName(cfg: AppConfig = getConfig()): string {
  const root = resolveVaultRoot(cfg);
  return path.basename(root) || cfg.defaultGrade + cfg.subjectSuffix;
}

export interface ResolvedPaths {
  vaultRoot: string;
  bankDir: string;
  imagesDir: string;
  imagesDirExists: boolean;
  imagesDirFrom: ImagesDirInfo['from'];
  bankDirExists: boolean;
  knowledgeTable: string | null;
  vaultName: string;
}

/** 一次性解析全部路径（设置页 / 校验接口用） */
export function resolveAll(cfg: AppConfig = getConfig()): ResolvedPaths {
  const vaultRoot = resolveVaultRoot(cfg);
  const bankDir = resolveBankDir(cfg);
  const img = resolveImagesDirInfo(cfg);
  return {
    vaultRoot,
    bankDir,
    imagesDir: img.dir,
    imagesDirExists: img.exists,
    imagesDirFrom: img.from,
    bankDirExists: fs.existsSync(bankDir) && fs.statSync(bankDir).isDirectory(),
    knowledgeTable: resolveKnowledgeTable(cfg),
    vaultName: vaultName(cfg),
  };
}
