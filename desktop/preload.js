/**
 * desktop/preload.js — 安全桥
 * 只向页面暴露必要能力，保持 contextIsolation 开启。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('highmath', {
  isDesktop: true,
  platform: process.platform,
  /** 打开系统原生「选择文件夹」对话框，返回绝对路径或 null */
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  /* ---------- 讲义草稿留档（写入 <userData>/drafts/） ---------- */
  /** 保存/覆盖一份草稿，返回 { ok, meta } */
  draftSave: (payload) => ipcRenderer.invoke('draft-save', payload),
  /** 读取草稿全文；id 省略时取「当前草稿」，无则返回 null */
  draftLoad: (id) => ipcRenderer.invoke('draft-load', id),
  /** 草稿索引（元信息列表，已按保留策略清理） */
  draftList: () => ipcRenderer.invoke('draft-list'),
  /** 删除一份草稿 */
  draftDelete: (id) => ipcRenderer.invoke('draft-delete', id),

  /* ---------- 讲义 PDF 导出 ---------- */
  /**
   * 把讲义 HTML 无头打印为 PDF。
   * @param {{ html: string, fileName?: string }} payload
   * @returns {Promise<{ ok: boolean, filePath?: string, canceled?: boolean, error?: string }>}
   */
  exportPdf: (payload) => ipcRenderer.invoke('export-pdf', payload),
});
