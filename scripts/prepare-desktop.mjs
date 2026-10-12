/**
 * scripts/prepare-desktop.mjs
 *
 * 把 Next.js 的 standalone 产物装配成 Electron 可直接加载的目录：
 *   .next/standalone  →  desktop/resources/app
 *
 * 注意：Next 的 standalone 产物【不会】自动包含 .next/static 与 public，
 *      必须手动拷贝，否则页面样式与静态资源会 404。
 *
 * 用法：
 *   node scripts/prepare-desktop.mjs           # 装配
 *   node scripts/prepare-desktop.mjs --clean   # 只清理（在 next build 之前执行）
 *
 * ⚠️ 为什么需要 --clean：
 *   desktop/resources/app 是一份完整的应用副本（含 node_modules）。
 *   如果它在 next build 期间存在，Next 会把它当作项目文件一起扫描，
 *   构建会从几十秒劣化到数分钟甚至卡死。所以每次构建前必须先清掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const STANDALONE = path.join(ROOT, '.next', 'standalone');
const STATIC_SRC = path.join(ROOT, '.next', 'static');
const PUBLIC_SRC = path.join(ROOT, 'public');
const DEMO_SRC = path.join(ROOT, 'demo-vault');
const OUT_APP = path.join(ROOT, 'desktop', 'resources', 'app');

function log(msg) {
  console.log(`[prepare-desktop] ${msg}`);
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// ---- --clean：只清理，供 next build 之前调用 ----
if (process.argv.includes('--clean')) {
  rmrf(OUT_APP);
  // 连空的 resources 目录一起移除，避免残留干扰
  const resourcesDir = path.join(ROOT, 'desktop', 'resources');
  if (fs.existsSync(resourcesDir) && fs.readdirSync(resourcesDir).length === 0) {
    rmrf(resourcesDir);
  }
  log('已清理 desktop/resources（构建前）');
  process.exit(0);
}

function copyDir(from, to, label) {
  if (!fs.existsSync(from)) {
    log(`跳过（不存在）：${label} ← ${from}`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  log(`已拷贝：${label}`);
}

// 1. 检查构建产物
if (!fs.existsSync(STANDALONE)) {
  console.error('[prepare-desktop] 未找到 .next/standalone，请先执行：npm run build');
  process.exit(1);
}

// 2. 清空目标
rmrf(OUT_APP);

// 3. 拷贝 standalone 主体
copyDir(STANDALONE, OUT_APP, '.next/standalone → desktop/resources/app');

// 4. 补上 static / public（关键，否则样式丢失）
copyDir(STATIC_SRC, path.join(OUT_APP, '.next', 'static'), '.next/static');
copyDir(PUBLIC_SRC, path.join(OUT_APP, 'public'), 'public');

// 5. 带上示例题库，首次启动即可看到内容
copyDir(DEMO_SRC, path.join(OUT_APP, 'demo-vault'), 'demo-vault（示例题库）');

// 6. 自检
const entry = path.join(OUT_APP, 'server.js');
if (!fs.existsSync(entry)) {
  console.error('[prepare-desktop] 装配失败：缺少 server.js');
  process.exit(1);
}

log('完成 ✅');
log(`应用目录：${OUT_APP}`);
log('下一步：cd desktop && npm install && npm start（或 npm run dist:win 打包）');
