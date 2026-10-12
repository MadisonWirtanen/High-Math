'use client';

/**
 * src/components/PagedPreview.tsx — A4 分页预览（Paged.js）
 *
 * 把 handoutHtml 产出的完整 HTML 注入 iframe，再加载 Paged.js polyfill，
 * 在浏览器里做真实的 W3C Paged Media 分页计算，呈现"纸张视图"。
 *
 * 关键：这里用的 HTML 与导出 PDF 用的是**同一份**（buildDocumentHtml），
 * 因此"预览 = PDF"是结构性保证。
 */

import { useEffect, useRef, useState } from 'react';
import styles from './PagedPreview.module.css';

interface Props {
  /** 完整 HTML 文档字符串（含 <style>） */
  html: string;
  /** 缩放比例 */
  zoom?: number;
}

export default function PagedPreview({ html, zoom = 1 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [pages, setPages] = useState(0);
  const [errMsg, setErrMsg] = useState('');
  const [frameH, setFrameH] = useState(1122); // A4 @96dpi ≈ 1122px

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    setStatus('rendering');
    setPages(0);
    setErrMsg('');

    const doc = frame.contentDocument;
    if (!doc) return;

    // 1. 写入 HTML。Paged.js 需要自己接管 body 再分页，先不加载 polyfill。
    doc.open();
    doc.write(html);
    doc.close();

    // 2. 等资源（字体/图片）就绪后，注入 Paged.js
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      try {
        const script = doc.createElement('script');
        script.src = '/paged.polyfill.js';
        script.onload = () => {
          if (cancelled) return;
          // polyfill 自动运行，探测分页结果
          let tries = 0;
          const timer = window.setInterval(() => {
            tries += 1;
            const pageEls = doc.querySelectorAll('.pagedjs_page');
            if (pageEls.length > 0) {
              setPages(pageEls.length);
              // 量出内容真实高度，让 iframe 自适应
              let h = 0;
              pageEls.forEach((el) => {
                const r = (el as HTMLElement).getBoundingClientRect();
                h = Math.max(h, r.bottom + (el as HTMLElement).offsetTop);
              });
              const contentH = (doc.documentElement.scrollHeight) || h;
              if (contentH > 200) setFrameH(contentH + 40);
              setStatus('done');
              window.clearInterval(timer);
            } else if (tries > 60) {
              setStatus('done');
              window.clearInterval(timer);
            }
          }, 100);
        };
        script.onerror = () => {
          if (!cancelled) {
            setStatus('error');
            setErrMsg('分页脚本加载失败');
          }
        };
        doc.body.appendChild(script);
      } catch (e) {
        setStatus('error');
        setErrMsg((e as Error).message || '渲染失败');
      }
    };

    // 给一个极短延迟，确保 iframe 内 document 已完成初始解析
    const t = window.setTimeout(run, 30);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [html]);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.status}>
          {status === 'rendering' && '⏳ 分页渲染中…'}
          {status === 'done' && pages > 0 && `共 ${pages} 页 · A4`}
          {status === 'done' && pages === 0 && '暂无内容'}
          {status === 'error' && `⚠ ${errMsg}`}
        </span>
        <span className={styles.hint}>导出 PDF 与此预览完全一致</span>
      </div>
      <div className={styles.scroll}>
        <div className={styles.zoomBox} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          <iframe
            ref={iframeRef}
            className={styles.frame}
            style={{ height: `${frameH}px` }}
            title="讲义预览"
          />
        </div>
      </div>
    </div>
  );
}
