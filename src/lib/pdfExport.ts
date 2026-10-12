'use client';

/**
 * src/lib/pdfExport.ts — 讲义 PDF 导出（PDF 优先架构的主交付物）
 *
 * 两条通道：
 *  1. 桌面版：调用 Electron preload 暴露的 window.highmath.exportPdf(html)
 *     → 主进程用隐藏窗口 printToPDF，无对话框、像素级一致。
 *  2. 网页版：退化为在隐藏 iframe 里渲染 HTML + Paged.js，再 window.print()
 *     → 用户在系统对话框里「另存为 PDF」，用同一份 CSS，效果一致。
 */

import { downloadBlob } from './handoutExport';

export interface PdfExportResult {
  channel: 'desktop' | 'browser';
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

/** Electron preload 注入的类型（与服务端无关，仅前端读取） */
interface HighMathBridge {
  isDesktop?: boolean;
  exportPdf?: (payload: { html: string; fileName?: string }) => Promise<{
    ok: boolean; filePath?: string; canceled?: boolean; error?: string;
  }>;
}

function bridge(): HighMathBridge | undefined {
  return (window as unknown as { highmath?: HighMathBridge }).highmath;
}

export function isDesktop(): boolean {
  return !!bridge()?.isDesktop;
}

/**
 * 导出 PDF。优先桌面无头打印；否则用浏览器打印对话框。
 */
export async function exportPdf(html: string, fileName: string): Promise<PdfExportResult> {
  const b = bridge();
  if (b?.exportPdf) {
    const res = await b.exportPdf({ html, fileName });
    if (res.ok) return { channel: 'desktop', filePath: res.filePath };
    if (res.canceled) return { channel: 'desktop', canceled: true };
    return { channel: 'desktop', error: res.error || '导出失败' };
  }

  // 网页端兜底：隐藏 iframe + Paged.js + window.print()
  await browserPrint(html);
  return { channel: 'browser' };
}

/** 在隐藏 iframe 中渲染并调起打印 */
function browserPrint(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.setTimeout(() => {
        try { document.body.removeChild(iframe); } catch { /* 忽略 */ }
      }, 1500);
    };

    const doc = iframe.contentDocument;
    if (!doc) { cleanup(); resolve(); return; }

    doc.open();
    doc.write(html);
    doc.close();

    const doPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch { /* 忽略 */ }
      cleanup();
      resolve();
    };

    // 注入 Paged.js，让打印时也走同一套分页
    const script = doc.createElement('script');
    script.src = '/paged.polyfill.js';
    script.onload = () => {
      // 等分页器产出
      let tries = 0;
      const t = window.setInterval(() => {
        tries += 1;
        if (doc.querySelectorAll('.pagedjs_page').length > 0 || tries > 40) {
          window.clearInterval(t);
          window.setTimeout(doPrint, 250);
        }
      }, 100);
    };
    script.onerror = () => { window.setTimeout(doPrint, 200); };
    doc.body.appendChild(script);
  });
}

export { downloadBlob };
