/**
 * desktop/main.js — HighMath 桌面外壳（Electron 主进程）
 *
 * 职责：
 *   1. 选一个空闲端口，把 Next.js standalone 服务作为子进程拉起
 *   2. 等服务就绪后，用 BrowserWindow 加载 http://127.0.0.1:<port>
 *   3. 通过 IPC 暴露「原生选择文件夹」能力给页面
 *   4. 单实例锁 / 退出时清理子进程
 *
 * 业务代码完全不感知本文件的存在 —— 桌面版与服务器版共用同一份 Next 应用。
 *
 * 日志：写入 <userData>/desktop.log，便于排查启动问题。
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');

// 单实例：避免重复启动导致端口与数据竞争
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// 本应用是文档型界面（题目 / 公式 / 表格），不依赖 GPU 加速。
// 关闭后可兼容虚拟机 / 远程桌面 / 无独显 / 受限环境，
// 避免出现「GPU process isn't usable」这类启动即崩溃的问题。
// 如需恢复硬件加速，设置环境变量 MATHATLAS_ENABLE_GPU=1 即可。
if (process.env.MATHATLAS_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

let mainWindow = null;
let serverProc = null;
let serverPort = 0;
let logFile = '';

function log(...args) {
  const text = args
    .map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
    .join(' ');
  const line = `[${new Date().toISOString()}] ${text}`;
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'desktop.log');
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* 忽略 */ }
  try { console.log(line); } catch { /* GUI 下无 stdout */ }
}

/** Next standalone 应用所在目录 */
function appDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app');
  return path.join(__dirname, 'resources', 'app');
}

/** 找一个空闲端口 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** 轮询等待服务就绪 */
function waitForServer(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/config', timeout: 2000 },
        res => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve(res.statusCode);
          else retry();
        }
      );
      req.on('error', () => retry());
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('服务启动超时'));
      setTimeout(tick, 400);
    };
    tick();
  });
}

/** 拉起 Next standalone 服务 */
function startServer(port) {
  const dir = appDir();
  const serverEntry = path.join(dir, 'server.js');

  log('appDir =', dir);
  log('serverEntry =', serverEntry, '存在 =', fs.existsSync(serverEntry));

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`未找到服务入口：${serverEntry}\n请先执行 npm run desktop:prepare 生成桌面资源。`);
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',   // 关键：让 Electron 以纯 Node 模式运行
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  };

  try {
    serverProc = fork(serverEntry, [], {
      cwd: dir,
      execPath: process.execPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  } catch (e) {
    log('fork 失败，改用 spawn：', String(e && e.message));
    serverProc = spawn(process.execPath, [serverEntry], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  log('已启动服务子进程 pid =', serverProc.pid);

  serverProc.stdout?.on('data', d => log('[server]', String(d).trim()));
  serverProc.stderr?.on('data', d => log('[server:err]', String(d).trim()));
  serverProc.on('error', e => log('[server:error]', String(e && e.message)));
  serverProc.on('exit', (code, signal) => log(`[server] 退出 code=${code} signal=${signal}`));

  return serverProc;
}

/**
 * 窗口 / 任务栏图标。
 * 打包后由 extraResources 放到 resources/ 下；开发时用 build/ 里的源文件。
 * Windows 用 .ico（多尺寸，任务栏最清晰），其他平台用 .png。
 */
function appIconPath() {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, 'build', name);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: `HighMath ${app.getVersion()}`,
    backgroundColor: '#ffffff',
    icon: appIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  log('窗口已加载', `http://127.0.0.1:${port}`);

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log('页面加载失败', code, desc);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/** 读取配置文件里的题库路径（与 src/lib/config.ts 保持同一位置约定） */
function readVaultPath() {
  try {
    const home = os.homedir();
    let cfgFile;
    if (process.platform === 'win32') {
      cfgFile = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'HighMath', 'config.json');
    } else if (process.platform === 'darwin') {
      cfgFile = path.join(home, 'Library', 'Application Support', 'HighMath', 'config.json');
    } else {
      cfgFile = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'highmath', 'config.json');
    }
    if (!fs.existsSync(cfgFile)) return '';
    return JSON.parse(fs.readFileSync(cfgFile, 'utf-8')).vaultPath || '';
  } catch {
    return '';
  }
}

/* ============================================================
   讲义草稿留档（IPC）
   ------------------------------------------------------------
   写向 <userData>/drafts/*.json —— 属于应用私有数据，
   与题库目录无关，题库始终保持只读。
   ============================================================ */

const DRAFT_KEEP = 20;
const DRAFT_TTL_DAYS = 30;
const DRAFT_CURRENT_ID = '__current__';

function draftsDir() {
  return path.join(app.getPath('userData'), 'drafts');
}

function draftFileFor(id) {
  const safe = String(id || DRAFT_CURRENT_ID).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(draftsDir(), `${safe}.json`);
}

function draftMetaOf(payload, fallbackId) {
  const p = payload || {};
  const modules = Array.isArray(p.modules) ? p.modules : [];
  let questions = 0;
  for (const m of modules) {
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

/** 读取索引并按保留策略清理过期/超额草稿 */
function draftReadIndex() {
  const dir = draftsDir();
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - DRAFT_TTL_DAYS * 86400000;
  const list = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    try {
      const m = draftMetaOf(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')), id);
      if (id === DRAFT_CURRENT_ID || m.updatedAt >= cutoff) list.push(m);
      else fs.unlinkSync(path.join(dir, f));
    } catch { /* 损坏文件跳过 */ }
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const m of list.slice(DRAFT_KEEP)) {
    if (m.id === DRAFT_CURRENT_ID) continue;
    try { fs.unlinkSync(draftFileFor(m.id)); } catch { /* 忽略 */ }
  }
  return list.slice(0, DRAFT_KEEP);
}

/** 注册草稿相关 IPC */
function registerDraftIpc() {
  ipcMain.handle('draft-save', async (_e, payload) => {
    try {
      const p = payload || {};
      const id = String(p.id || DRAFT_CURRENT_ID).replace(/[^A-Za-z0-9_-]/g, '_') || DRAFT_CURRENT_ID;
      const dir = draftsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(draftFileFor(id), JSON.stringify({ ...p, id }), 'utf-8');
      draftReadIndex();
      return { ok: true, meta: draftMetaOf(p, id) };
    } catch (e) {
      log('[draft-save] 失败', String(e && e.message));
      return { ok: false, error: String(e && e.message) };
    }
  });

  ipcMain.handle('draft-load', async (_e, id) => {
    try {
      const f = draftFileFor(id || DRAFT_CURRENT_ID);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch (e) {
      log('[draft-load] 失败', String(e && e.message));
      return null;
    }
  });

  ipcMain.handle('draft-list', async () => {
    try { return draftReadIndex(); } catch { return []; }
  });

  ipcMain.handle('draft-delete', async (_e, id) => {
    try {
      const f = draftFileFor(id);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  });
}

/**
 * 注册「导出 PDF」IPC。
 *
 * 原理：用一个隐藏的 BrowserWindow 渲染**与预览完全相同**的 HTML，
 * 再注入同一份 Paged.js 做 W3C Paged Media 分页，最后调用
 * webContents.printToPDF —— Chromium 无头打印，不弹对话框，
 * 直接返回 Buffer 写文件。因此导出的 PDF 与 A4 预览逐页一致。
 *
 * 两个必须点：
 *  1. printBackground:true 必须开，否则卡片底色与水印会丢失。
 *  2. HTML 通过 <base> 锚定到本机服务——否则 /katex/*、/api/images/*、
 *     /paged.polyfill.js 这些相对路径在 data: URL 下无法解析。
 */
function registerPdfIpc() {
  ipcMain.handle('export-pdf', async (_e, payload) => {
    const p = payload || {};
    const html = String(p.html || '');
    const rawName = String(p.fileName || 'HighMath_讲义').replace(/[\\/:*?"<>|]/g, '_');
    if (!html.trim()) return { ok: false, error: '内容为空' };

    let win = null;
    try {
      // 1. 让用户先选保存位置
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '导出 PDF',
        defaultPath: `${rawName}.pdf`,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };

      // 2. 隐藏窗口渲染同一份 HTML
      //    关键：必须挂在本机服务上渲染，否则 HTML 里的相对路径
      //    （/katex/katex.min.css、/api/images/xxx、/paged.polyfill.js）
      //    在 data: URL 下无法解析，公式字体与图片会全部丢失。
      //    这里以服务根为 base，把 HTML 通过 <base> 锚定到本机端口。
      win = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: {
          offscreen: true,
          sandbox: false,
          javascript: true,
          // 允许隐藏窗口访问本机服务（同源，无跨域问题）
          webSecurity: false,
        },
      });

      const origin = serverPort ? `http://127.0.0.1:${serverPort}` : '';
      const htmlWithBase = origin
        ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/" />`)
        : html;
      const dataUrl = 'data:text/html;charset=utf-8;base64,' +
        Buffer.from(htmlWithBase, 'utf-8').toString('base64');
      await win.loadURL(dataUrl);

      // 3. 注入 Paged.js，让 PDF 分页与预览**完全一致**（同一套 @page 规则）
      try {
        await win.webContents.executeJavaScript(
          `(function(){
             if (window.__hmPagedInjected) return true;
             window.__hmPagedInjected = true;
             return new Promise(function(resolve){
               var s = document.createElement('script');
               s.src = ((${JSON.stringify(origin)} || '') + '/paged.polyfill.js');
               s.onload = function(){ resolve(true); };
               s.onerror = function(){ resolve(false); };
               document.body.appendChild(s);
             });
           })()`,
          true,
        );
        // 等分页器产出 .pagedjs_page（最多约 6s）
        await win.webContents.executeJavaScript(
          `new Promise(function(resolve){
             var n = 0;
             var t = setInterval(function(){
               n++;
               if (document.querySelectorAll('.pagedjs_page').length > 0 || n > 60) {
                 clearInterval(t); resolve(document.querySelectorAll('.pagedjs_page').length);
               }
             }, 100);
           })`,
          true,
        );
      } catch { /* Paged.js 不可用则退回浏览器原生分页 */ }

      // 4. 等字体与图片解析完成
      try {
        await win.webContents.executeJavaScript(
          'document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : true',
          true,
        );
      } catch { /* 忽略 */ }
      await new Promise((r) => setTimeout(r, 400));

      // 5. 打印为 PDF
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
        margins: { marginType: 'default' },
      });

      fs.writeFileSync(filePath, pdf);
      log('[export-pdf] 成功', filePath, `${pdf.length} bytes`);
      return { ok: true, filePath };
    } catch (e) {
      log('[export-pdf] 失败', String(e && e.message));
      return { ok: false, error: String(e && e.message) };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  });
}

/** 应用菜单 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开题库文件夹',
          click: () => {
            const p = readVaultPath();
            if (p && fs.existsSync(p)) shell.openPath(p);
            else dialog.showMessageBox(mainWindow, {
              type: 'info',
              message: '尚未设置题库文件夹',
              detail: '请在应用内的「设置」页选择题库目录。',
            });
          },
        },
        { label: '打开日志文件', click: () => { try { shell.showItemInFolder(logFile); } catch { /* 忽略 */ } } },
        {
          label: '打开草稿文件夹',
          click: () => {
            const dir = draftsDir();
            try {
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              shell.openPath(dir);
            } catch { /* 忽略 */ }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  log('=== HighMath 启动 ===', 'packaged =', app.isPackaged, 'platform =', process.platform);

  // 原生选择文件夹
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择题库文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 讲义草稿留档
  registerDraftIpc();

  // 讲义 PDF 导出（无头打印）
  registerPdfIpc();

  try {
    serverPort = await findFreePort();
    log('选中端口 =', serverPort);
    startServer(serverPort);
    const status = await waitForServer(serverPort);
    log('服务就绪，状态码 =', status);
    createWindow(serverPort);
    buildMenu();
  } catch (err) {
    log('启动失败：', String(err && err.message));
    dialog.showErrorBox(
      'HighMath 启动失败',
      `${err && err.message ? err.message : err}\n\n日志：${logFile}`
    );
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* 忽略 */ }
    serverProc = null;
  }
});
