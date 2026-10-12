/**
 * src/lib/config.ts — 运行时配置中心
 *
 * 设计目标：把「题库路径」等配置从构建期环境变量，改为运行期可读写。
 *
 * 配置优先级（后者覆盖前者）：
 *   内置默认值  <  config.json  <  环境变量
 *
 * 配置文件位置（跨平台）：
 *   Windows : %APPDATA%\HighMath\config.json
 *   macOS   : ~/Library/Application Support/HighMath/config.json
 *   Linux   : ~/.config/highmath/config.json  （可用 XDG_CONFIG_HOME 覆盖）
 *
 * 注意：本模块仅可在服务端（API 路由 / Server 组件）使用。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** 应用版本号（读取 package.json，单一事实来源） */
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    ) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface AppConfig {
  /** 题库根目录（用户选定）。Obsidian Vault 模式填 Vault 根目录；直接题库模式填题库目录本身 */
  vaultPath: string;
  /** 题目所在子目录名。'.' 表示 vaultPath 本身就是题库目录 */
  bankDirName: string;
  /** 图片子目录名 */
  imagesDirName: string;
  /** 默认学段年级 */
  defaultGrade: string;
  /** 学段下拉列表 */
  gradeList: string[];
  /** 学科后缀（用于拼「高中数学」等默认分类名） */
  subjectSuffix: string;
  /** Pandoc 可执行文件路径（留空则自动探测） */
  pandocPath: string;
  /** 知识点总表路径（留空则自动探测） */
  knowledgeTablePath: string;
  /** 桌面端使用的端口（0 = 自动选择空闲端口） */
  port: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  vaultPath: './demo-vault',
  bankDirName: '题库',
  imagesDirName: 'images',
  defaultGrade: '高中',
  gradeList: ['初中', '高中'],
  subjectSuffix: '数学',
  pandocPath: '',
  knowledgeTablePath: '',
  port: 3000,
};

/** 配置文件路径（跨平台） */
export function getConfigPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'HighMath', 'config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'HighMath', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'highmath', 'config.json');
}

function readJsonSafe(file: string): Partial<AppConfig> {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    console.warn('[config] 读取配置失败，使用默认值:', (e as Error).message);
    return {};
  }
}

/** 环境变量覆盖层（服务器部署时使用，无需配置文件） */
function envOverride(): Partial<AppConfig> {
  const out: Partial<AppConfig> = {};
  const E = process.env;

  if (E.VAULT_PATH) out.vaultPath = E.VAULT_PATH;
  if (E.BANK_DIR_NAME) out.bankDirName = E.BANK_DIR_NAME;
  if (E.IMAGES_DIR_NAME) out.imagesDirName = E.IMAGES_DIR_NAME;

  const grade = E.DEFAULT_GRADE || E.NEXT_PUBLIC_DEFAULT_GRADE;
  if (grade) out.defaultGrade = grade;

  const gradeList = E.GRADE_LIST || E.NEXT_PUBLIC_GRADE_LIST;
  if (gradeList) out.gradeList = gradeList.split(',').map(s => s.trim()).filter(Boolean);

  const suffix = E.SUBJECT_SUFFIX || E.NEXT_PUBLIC_DEFAULT_SUBJECT_SUFFIX;
  if (suffix) out.subjectSuffix = suffix;

  if (E.PANDOC_PATH) out.pandocPath = E.PANDOC_PATH;
  if (E.KNOWLEDGE_TABLE_PATH) out.knowledgeTablePath = E.KNOWLEDGE_TABLE_PATH;
  if (E.PORT && !isNaN(Number(E.PORT))) out.port = Number(E.PORT);

  return out;
}

let _cache: AppConfig | null = null;

/** 读取当前生效配置（带内存缓存） */
export function getConfig(): AppConfig {
  if (_cache) return _cache;
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...readJsonSafe(getConfigPath()),
    ...envOverride(),
  };
  // 防御：字段类型校正
  if (!Array.isArray(merged.gradeList) || merged.gradeList.length === 0) {
    merged.gradeList = DEFAULT_CONFIG.gradeList;
  }
  merged.port = Number(merged.port) || 0;
  _cache = merged;
  return merged;
}

/** 写入配置（合并式），并清空缓存 */
export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const current = { ...getConfig(), ...patch };
  const file = getConfigPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8');
  _cache = null;
  return getConfig();
}

/** 清空缓存（切换目录等操作后调用） */
export function invalidateConfig(): void {
  _cache = null;
}

/** 返回配置来源诊断信息，供设置页展示 */
export function getConfigDiagnostics() {
  const file = getConfigPath();
  return {
    version: APP_VERSION,
    configFile: file,
    configFileExists: fs.existsSync(file),
    envKeys: Object.keys(envOverride()),
  };
}
