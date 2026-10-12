'use client';

/**
 * src/lib/handoutExport.ts — 导出相关的前端公共逻辑
 *
 * 复制 / 打包 zip / 导出 Word 三条路径都消费同一份 markdown，
 * 保证与 handout.ts 的生成结果完全一致。
 */

import JSZip from 'jszip';
import { downloadDocxFromMarkdown, type ImageBinary } from './docxFallback';

/** 生成时间戳（精确到秒） */
export function timestamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 按「新文件名」为 key 拉取图片二进制（供浏览器端 docx 使用） */
export async function fetchImageBinaries(
  imageMap: Map<string, string>,
): Promise<{ bin: Map<string, ImageBinary>; failed: string[] }> {
  const bin = new Map<string, ImageBinary>();
  const failed: string[] = [];
  const tasks: Promise<void>[] = [];

  imageMap.forEach((newName, hash) => {
    tasks.push((async () => {
      try {
        const res = await fetch(`/api/images/${encodeURIComponent(hash)}`);
        if (!res.ok) { failed.push(hash); return; }
        const arrayBuf = await (await res.blob()).arrayBuffer();
        const ext = hash.split('.').pop() || 'jpg';
        bin.set(newName, { arrayBuf, ext });
      } catch {
        failed.push(hash);
      }
    })());
  });

  await Promise.all(tasks);
  return { bin, failed };
}

/** 打包下载：讲义 .md + 图片 */
export async function downloadMarkdownZip(
  baseName: string,
  markdown: string,
  imageMap: Map<string, string>,
): Promise<void> {
  const zip = new JSZip();
  zip.file(`${baseName}.md`, markdown);

  const tasks: Promise<void>[] = [];
  imageMap.forEach((newName, hash) => {
    tasks.push(
      fetch(`/api/images/${encodeURIComponent(hash)}`)
        .then(async (res) => {
          if (res.ok) zip.file(newName, await res.blob());
        })
        .catch(() => { /* 忽略单张图片失败 */ }),
    );
  });
  await Promise.all(tasks);

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${baseName}_${timestamp()}.zip`);
}

export type WordExportChannel = 'pandoc' | 'browser';

export interface WordExportResult {
  channel: WordExportChannel;
  failedImages: number;
  /** 走浏览器端兜底时的原因（pandoc 不可用 / 报错），便于用户排查 */
  fallbackReason?: string;
}

/**
 * 导出 Word：
 *  1. 优先把 markdown 交给服务端 pandoc（自动继承全部设置）
 *  2. pandoc 不可用时，用浏览器端 docx 兜底渲染同一份 markdown
 *     （公式会被转成 Word 原生公式，不会以 LaTeX 源码形式出现）
 */
export async function exportWord(
  markdown: string,
  imageMap: Map<string, string>,
  fileBaseName: string,
): Promise<WordExportResult> {
  const imageMapObj: Record<string, string> = {};
  imageMap.forEach((v, k) => { imageMapObj[k] = v; });

  let fallbackReason: string | undefined;

  try {
    const res = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, imageMap: imageMapObj, fileName: fileBaseName }),
    });

    if (res.ok) {
      downloadBlob(await res.blob(), `${fileBaseName}_${timestamp()}.docx`);
      return { channel: 'pandoc', failedImages: 0 };
    }

    const data = await res.json().catch(() => ({} as { error?: string; hint?: string }));
    fallbackReason = [data.error, data.hint].filter(Boolean).join(' — ') || `服务端返回 ${res.status}`;
  } catch (e) {
    fallbackReason = (e as Error).message || '无法连接导出服务';
  }

  const { bin, failed } = await fetchImageBinaries(imageMap);
  await downloadDocxFromMarkdown(markdown, bin, `${fileBaseName}_${timestamp()}.docx`);
  return { channel: 'browser', failedImages: failed.length, fallbackReason };
}
