/**
 * src/lib/handoutHtml.ts — 讲义「HTML 渲染源」（v2.2，PDF 优先架构）
 *
 * 设计要点：
 *  1. 这是 PDF 优先架构的唯一渲染源：预览（Paged.js）与 PDF（printToPDF）
 *     共用同一份 HTML + 同一套 @page CSS，因此「预览 = PDF」是结构性保证。
 *  2. 复用 handout.ts 的全部业务逻辑（编号器 / 模板引擎 / 顺序变换 / 图片映射），
 *     本模块只负责「已排好的内容 → HTML + 样式」这一段，不改生成核心。
 *  3. 纯函数：不依赖 Node / DOM，可在客户端与 Electron 主进程共用。
 *  4. 只读题库：本模块不写任何文件、不碰题库目录。
 */

import katex from 'katex';
import { marked } from 'marked';
import {
  MODULE_META,
  applyOrder,
  blankHeightFor,
  cnNumber,
  formatHeading,
  formatNumber,
  makeGroupBlock,
  moduleToBlocks,
  questionContext,
  renderTemplate,
  rewriteImages,
  toStrArray,
  type Block,
  type HandoutModule,
  type HandoutQuestion,
  type HandoutSettings,
  type HeadingLevel,
  type QuestionSource,
  type TemplateVars,
} from './handout';

/* ============================ 颜色主题 ============================ */

/** 模块卡片配色（浅底 + 主色条 + 深色文字），与 UI 深/浅色模式无关，导出恒定 */
const CARD_COLORS: Record<string, { bg: string; bar: string; text: string }> = {
  title: { bg: 'transparent', bar: 'transparent', text: '#111827' },
  knowTitle: { bg: '#F5F3FF', bar: '#7F77DD', text: '#3C3489' },
  knowExplain: { bg: '#EFF6FF', bar: '#378ADD', text: '#0C447C' },
  example: { bg: '#FFFBEB', bar: '#EF9F27', text: '#633806' },
  variation: { bg: '#F0FDFA', bar: '#1D9E75', text: '#085041' },
  practice: { bg: '#F8FAFC', bar: '#888780', text: '#2C2C2A' },
  method: { bg: '#EEFDF4', bar: '#639922', text: '#27500A' },
  callout: { bg: '#FEF2F2', bar: '#E24B4A', text: '#791F1F' },
  text: { bg: 'transparent', bar: 'transparent', text: '#111827' },
  pagebreak: { bg: 'transparent', bar: 'transparent', text: '#111827' },
};

/* ============================ 文件级样式 ============================ */

/** 生成 @page + 全局样式。页眉/页脚/页码/水印都在这里，预览与 PDF 共用。 */
function buildPageCss(s: HandoutSettings): string {
  const margin = 16; // mm
  const footParts: string[] = [];
  if (s.footerText.trim()) footParts.push(`"${esc(s.footerText.trim())}"`);
  if (s.showPageNumber) footParts.push(`"${pageNumberCss(s.pageNumberFormat)}"`);
  const footerContent = footParts.length ? footParts.join('  ') : 'none';

  const headContent = s.headerText.trim() ? `"${esc(s.headerText.trim())}"` : 'none';

  return `
:root { --hm-font: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }

@page {
  size: A4;
  margin: ${margin}mm ${margin}mm ${margin + 6}mm ${margin}mm;
  ${headContent !== 'none' ? `@top-center { content: ${headContent}; font-family: var(--hm-font); font-size: 9pt; color: #6b7280; }` : ''}
  ${footerContent !== 'none' ? `@bottom-center { content: ${footerContent}; font-family: var(--hm-font); font-size: 9pt; color: #6b7280; }` : ''}
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--hm-font);
  font-size: 10.5pt;
  line-height: 1.85;
  color: #111827;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.hm-doc { padding: 0; }

/* 卡片 */
.hm-card {
  border-left: 3px solid transparent;
  border-radius: 4px;
  padding: 6pt 10pt;
  margin: 6pt 0;
  page-break-inside: auto;
}
.hm-card--plain { border-left: none; padding: 0; background: transparent !important; }

.hm-card-head {
  font-weight: 600;
  font-size: 11pt;
  margin-bottom: 3pt;
  display: flex;
  align-items: baseline;
  gap: 6pt;
}
.hm-card-icon { font-size: 11pt; }

/* 总标题 */
.hm-title { text-align: center; margin: 6pt 0 2pt; font-size: 19pt; font-weight: 700; letter-spacing: 1pt; }
.hm-subtitle { text-align: center; margin: 0 0 8pt; font-size: 11pt; color: #4b5563; }
.hm-hr { border: none; border-top: 1.2pt solid #111827; margin: 6pt 0 10pt; }

/* 三级标题 */
.hm-h2 { font-size: 13pt; font-weight: 600; margin: 12pt 0 6pt; }
.hm-h3 { font-size: 11.5pt; font-weight: 600; margin: 9pt 0 4pt; }

/* 题目 */
.hm-q { margin: 0 0 6pt; page-break-inside: auto; }
.hm-q-num { font-weight: 600; }
.hm-q-body { display: block; }
.hm-q-body > p:first-child { display: inline; }
.hm-q-body p { margin: 2pt 0; }
.hm-opts { margin: 3pt 0 3pt 1.2em; }
.hm-ans { color: #0f5132; font-size: 10pt; margin-top: 2pt; }
.hm-sol { color: #374151; font-size: 10pt; margin-top: 2pt; }
.hm-src { color: #9ca3af; font-size: 9pt; margin: 0 0 2pt; }
.hm-know { color: #2563eb; font-size: 9.5pt; margin-top: 1pt; }

/* 选项分栏 */
.hm-opts--two { column-count: 2; column-gap: 18pt; }
.hm-opts--four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2pt 10pt; }
.hm-opts--four .hm-opt { white-space: nowrap; }

/* 答题留白 */
.hm-blank { border-bottom: 0; page-break-inside: avoid; }

/* 分页 */
.hm-pagebreak { page-break-after: always; height: 0; margin: 0; }

/* 正文分栏 */
.hm-cols2 { column-count: 2; column-gap: 22pt; }

/* 水印 */
.hm-watermark {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: rotate(-28deg);
  font-size: 46pt;
  font-weight: 700;
  color: #000;
  pointer-events: none;
  z-index: 0;
  white-space: nowrap;
}

/* markdown 元素微调 */
.hm-doc table { border-collapse: collapse; width: 100%; margin: 4pt 0; font-size: 10pt; }
.hm-doc th, .hm-doc td { border: 0.5pt solid #9ca3af; padding: 2pt 6pt; }
.hm-doc img { max-width: 100%; }
.hm-doc blockquote { margin: 4pt 0; padding: 2pt 10pt; border-left: 3px solid #d1d5db; color: #4b5563; }
.hm-doc p { margin: 3pt 0; }
`.trim();
}

/** 把 {page}/{pages} 转成 CSS counter */
function pageNumberCss(fmt: string): string {
  return esc(fmt || '第 {page} 页 / 共 {pages} 页')
    .replace(/\{page\}/g, '" counter(page) "')
    .replace(/\{pages\}/g, '" counter(pages) "');
}

/** HTML 属性 / 内容转义 */
function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================ Markdown + 公式 ============================ */

const DOLLAR_ESC = '\x00DOLLAR\x00';
const MATH_PH = '\x00MATH\x00';

interface MathSlot { formula: string; displayMode: boolean; }

/** markdown（含 $公式$、图片引用）→ HTML */
function mdToHtml(text: string, imgSrc: (hash: string) => string): string {
  if (!text) return '';
  let t = (text || '').replace(/!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g, (_m, h: string) => `![](${imgSrc(h)})`);
  t = t.replace(/!\[([^\]]*)\]\((?:images\/)?([^)]+)\)/g, (_m, alt: string, f: string) => {
    const w = parseInt(alt, 10);
    const style = !isNaN(w) && w > 0 ? `width:${w}px;` : 'max-width:100%;';
    return `<img src="${imgSrc(f)}" alt="${esc(alt)}" style="${style}" />`;
  });

  t = t.replace(/\\\$/g, DOLLAR_ESC);

  const slots: MathSlot[] = [];
  const re = /(\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$)/;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const isDisplay = !!m[1]?.startsWith('$$');
    slots.push({ formula: isDisplay ? m[2] : m[3], displayMode: isDisplay });
    t = t.slice(0, m.index) + `${MATH_PH}${idx}__` + t.slice(m.index + m[0].length);
    idx++;
  }

  t = marked.parse(t, { breaks: true }) as string;
  t = t.replace(new RegExp(DOLLAR_ESC, 'g'), '$');

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    let html: string;
    try {
      html = katex.renderToString(s.formula, { displayMode: s.displayMode, throwOnError: false, output: 'html' });
    } catch {
      html = esc(s.formula);
    }
    t = t.replace(`${MATH_PH}${i}__`, html);
  }
  return t;
}

/* ============================ 生成主函数 ============================ */

export interface HtmlBuildOptions {
  blocks: Block[];
  /** 以模块为单位（用于卡片皮肤）；与 blocks 二选一 */
  modules?: HandoutModule[];
  settings: HandoutSettings;
  getQuestion: (qid: string) => QuestionSource | undefined;
  /** 图片 hash → 在 HTML 里使用的 src（默认走 /api/images/） */
  imgSrc?: (hash: string) => string;
  answersHeading?: string;
}

export interface HtmlBuildResult {
  /** 完整 HTML 文档（含 <style>），可直接交给 Paged.js / iframe / printToPDF */
  html: string;
  /** 只含样式，供外部注入 */
  css: string;
  totalScore: number;
  ordered: { qid: string; label: string; score: number | null }[];
}

const DEFAULT_IMG_SRC = (h: string) => `/api/images/${encodeURIComponent(h)}`;

/**
 * 唯一 HTML 生成入口。
 * 若传 modules，则按模块渲染卡片皮肤；否则回退按 blocks 渲染（无皮肤）。
 */
export function buildDocumentHtml(opts: HtmlBuildOptions): HtmlBuildResult {
  const { settings: s, getQuestion } = opts;
  const imgSrc = opts.imgSrc || DEFAULT_IMG_SRC;
  const isStudent = s.outputMode === 'student';

  // 学生版：强制隐藏答案与解析
  const eff: HandoutSettings = isStudent
    ? { ...s, answerPosition: 'none', includeSolution: false }
    : s;

  const css = buildPageCss(s);

  const ordered = applyOrder(opts.blocks, eff, (qid) => getQuestion(qid)?.q.type ?? '');
  const numberer = new NumbererLite(eff.numberStart, eff.numberStep);

  const body: string[] = [];
  const collected: { qid: string; label: string; score: number | null }[] = [];
  const endAnswers: string[] = [];
  let answersSlot = -1;
  let qIndex = 0;

  const pushQ = (qid: string, score0: number | null | undefined, blankOverride?: number | null) => {
    const src = getQuestion(qid);
    qIndex += 1;
    const score = score0 ?? eff.defaultScore ?? null;
    const autoN = numberer.nextQuestion();

    let numValue: string;
    if (eff.numberSource === 'origin' && src?.q.number) {
      numValue = eff.stripAlphaPrefix ? src.q.number.replace(/^[A-Za-z]+/, '') : src.q.number;
    } else {
      numValue = String(autoN);
    }
    const label = eff.showNumber ? formatNumber(eff.numberFormat, numValue) : '';

    if (!src) {
      body.push(`<div class="hm-q">${esc(label)}（内容加载失败）</div>`);
      return;
    }

    const ctx = questionContext(src.q, qIndex, score);
    const type = src.q.type || '';
    const rawQ = (src.sections['题目'] || '').trim();

    let qText = rawQ
      .replace(/\[多选\]/g, '')
      .replace(/\[选\]/g, '')
      .replace(/\[填\]/g, '____')
      .trim();
    const isMulti = type.includes('多选') || rawQ.includes('[多选]');
    const isSingle = type.includes('单选') || rawQ.includes('[选]');
    const isChoice = isMulti || isSingle;
    if (isChoice && !qText.endsWith('()')) qText += '()';

    const scorePart = eff.showScore && score !== null ? `（${score}分）` : '';
    const multiPart = isMulti && eff.multiSelectMark ? '(多选)' : '';
    const headRaw = `${label}${multiPart}${scorePart}`.trim();

    const parts: string[] = [];
    const bodyHtml = mdToHtml(qText, imgSrc);
    // 题目来源显示在题目上方（紧跟题号，位于题干之前）
    if (eff.showSource) {
      parts.push(`<div class="hm-src">【来源】${esc(src.q.source)}${esc(src.q.number)}</div>`);
    }
    parts.push(
      `<div class="hm-q">` +
      `<span class="hm-q-num">${esc(headRaw)}</span>` +
      `<span class="hm-q-body"> ${bodyHtml}</span>` +
      `</div>`
    );

    if (eff.knowledgeMode === 'inline') {
      const k = renderTemplate(eff.knowledgeTemplate, ctx);
      if (k) parts.push(`<div class="hm-know">（${esc(k)}）</div>`);
    }

    if (isChoice && src.sections['选项']) {
      const optRaw = src.sections['选项'];
      const optHtml = mdToHtml(optRaw, imgSrc);
      if (eff.optionLayout === 'four-in-line' || eff.optionLayout === 'two-in-line') {
        // 把 <p> 拆成独立选项块，用 grid/column 排列
        const items = optHtml
          .replace(/<\/?p>/g, '\n')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => `<div class="hm-opt">${x}</div>`)
          .join('');
        const cls = eff.optionLayout === 'four-in-line' ? 'hm-opts--four' : 'hm-opts--two';
        parts.push(`<div class="hm-opts ${cls}">${items}</div>`);
      } else {
        parts.push(`<div class="hm-opts">${optHtml}</div>`);
      }
    }

    if (eff.knowledgeMode === 'below') {
      const k = renderTemplate(eff.knowledgeTemplate, ctx);
      if (k) parts.push(`<div class="hm-know">${esc(k)}</div>`);
    }

    if (eff.answerPosition === 'afterEach') {
      if (src.sections['答案']) parts.push(`<div class="hm-ans"><b>【答案】</b>${mdToHtml(src.sections['答案'], imgSrc)}</div>`);
      if (eff.includeSolution && src.sections['解析']) {
        parts.push(`<div class="hm-sol"><b>【解析】</b>${mdToHtml(src.sections['解析'], imgSrc)}</div>`);
      }
    }

    if (eff.showRemark) {
      if (src.sections['我的备注']) parts.push(`<div class="hm-sol"><b>【备注】</b>${mdToHtml(src.sections['我的备注'], imgSrc)}</div>`);
      const ai = src.sections['AI 备注'] || src.sections['AI备注'];
      if (ai) parts.push(`<div class="hm-sol"><b>【AI备注】</b>${mdToHtml(ai, imgSrc)}</div>`);
    }

    // 学生版答题留白
    if (isStudent) {
      const h = blankHeightFor(type, s, blankOverride);
      if (h > 0) parts.push(`<div class="hm-blank" style="height:${h}mm"></div>`);
    }

    body.push(parts.join(''));

    collected.push({ qid, label: label || String(autoN), score });

    if (eff.answerPosition === 'end') {
      const ans = src.sections['答案'];
      const sol = src.sections['解析'];
      const ap: string[] = [];
      if (ans) ap.push(`【答案】${ans}`);
      if (eff.includeSolution && sol) ap.push(`【解析】${sol}`);
      if (ap.length) endAnswers.push(`<div class="hm-ans"><b>${esc(label || String(autoN))}</b> ${mdToHtml(ap.join(' '), imgSrc)}</div>`);
    }
  };

  if (opts.modules) {
    /* ---- 按模块渲染：带卡片皮肤 ---- */
    for (const m of opts.modules) {
      const meta = MODULE_META[m.kind];
      const color = CARD_COLORS[m.kind] || CARD_COLORS.text;
      const useCard = s.cardStyle && meta.holdsQuestions === false && m.kind !== 'title' && m.kind !== 'pagebreak';

      if (m.pageBreak) body.push(`<div class="hm-pagebreak"></div>`);

      const blocksOfM = moduleToBlocks(m, 0);
      for (const b of blocksOfM) {
        if (b.type === 'heading' || b.type === 'group') {
          const level = b.level;
          const n = b.autoNumber ? numberer.nextHeading(level) : 0;
          const titleRaw = formatHeading(level, n, b.text, b.autoNumber);
          if (level === 1 && (m.kind === 'example' || m.kind === 'variation' || m.kind === 'practice')) {
            body.push(`<h2 class="hm-h2">${esc(titleRaw)}</h2>`);
            numberer.resetQuestions();
          } else if (level === 1) {
            body.push(`<h2 class="hm-h2">${esc(titleRaw)}</h2>`);
            if (eff.restartPerGroup) numberer.resetQuestions();
          } else if (level === 2) {
            body.push(cardWrap(useCard, color, meta.icon, esc(titleRaw), ''));
          } else {
            body.push(`<h3 class="hm-h3">${esc(titleRaw)}</h3>`);
          }
        } else if (b.type === 'text') {
          if (b.content.trim()) {
            const inner = mdToHtml(b.content.trim(), imgSrc);
            body.push(useCard ? cardWrapRaw(useCard, color, '', inner) : inner);
          }
        } else if (b.type === 'pagebreak') {
          body.push(`<div class="hm-pagebreak"></div>`);
        } else if (b.type === 'question') {
          pushQ(b.qid, b.score, m.blankOverride);
        }
      }
    }
  } else {
    /* ---- 回退：按扁平块渲染（无皮肤） ---- */
    for (const b of ordered) {
      switch (b.type) {
        case 'heading':
        case 'group': {
          if (eff.pageBreakBeforeGroup && (b.type === 'group' || b.level === 1)) body.push(`<div class="hm-pagebreak"></div>`);
          const level = b.level;
          const n = b.autoNumber ? numberer.nextHeading(level) : 0;
          const title = formatHeading(level, n, b.text, b.autoNumber);
          const tag = level === 1 ? 'h2' : level === 2 ? 'h2' : 'h3';
          const cls = level === 1 ? 'hm-h2' : level === 2 ? 'hm-h2' : 'hm-h3';
          body.push(`<${tag} class="${cls}">${esc(title)}</${tag}>`);
          if (b.type === 'group' || (eff.restartPerGroup && level === 1)) numberer.resetQuestions();
          break;
        }
        case 'text': {
          if (b.content.trim()) body.push(mdToHtml(b.content.trim(), imgSrc));
          break;
        }
        case 'pagebreak': body.push(`<div class="hm-pagebreak"></div>`); break;
        case 'answers': answersSlot = body.length; break;
        case 'question': pushQ(b.qid, b.score); break;
        default: break;
      }
    }
  }

  /* 文末答案区 */
  if (eff.answerPosition === 'end' && endAnswers.length > 0) {
    const sec = [`<h2 class="hm-h2">${esc(opts.answersHeading || '参考答案')}</h2>`, ...endAnswers];
    if (answersSlot >= 0 && answersSlot <= body.length) body.splice(answersSlot, 0, ...sec);
    else body.push(...sec);
  }

  /* 卷头 */
  let header = '';
  if (s.headerEnabled) {
    const total = collected.reduce((a, c) => a + (c.score || 0), 0);
    const hs: string[] = [];
    if (s.title) hs.push(`<div class="hm-title">${esc(s.title)}</div>`);
    if (s.subtitle) hs.push(`<div class="hm-subtitle">${esc(s.subtitle)}</div>`);
    const meta: string[] = [];
    if (s.examTime) meta.push(`考试时间：${esc(s.examTime)}`);
    const sc = s.fullScore || (total > 0 ? String(total) : '');
    if (sc) meta.push(`满分：${sc} 分`);
    if (meta.length) hs.push(`<div class="hm-subtitle">${esc(meta.join('　　'))}</div>`);
    if (s.sealLine) hs.push(`<div class="hm-subtitle">班级：______________　姓名：______________　考号：______________</div>`);
    if (s.headerNote) hs.push(`<div class="hm-subtitle">${esc(s.headerNote)}</div>`);
    hs.push(`<hr class="hm-hr" />`);
    header = hs.join('');
  }

  const totalScore = collected.reduce((a, c) => a + (c.score || 0), 0);

  const wm = s.watermarkEnabled && s.watermarkText.trim()
    ? `<div class="hm-watermark" style="opacity:${Math.max(0, Math.min(1, s.watermarkOpacity))}">${esc(s.watermarkText.trim())}</div>`
    : '';

  const docClass = s.bodyColumns === 2 ? 'hm-doc hm-cols2' : 'hm-doc';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(s.title || 'HighMath 讲义')}</title>
<style>${css}</style>
<link rel="stylesheet" href="/katex/katex.min.css" />
<style>
/* 公式在分页环境下的微调 */
.katex-display { margin: 4pt 0; text-align: center; break-inside: avoid; }
.katex { font-size: 1.05em; }
</style>
</head>
<body>
${wm}
<div class="${docClass}">
${header}
${body.join('\n')}
</div>
</body>
</html>`;

  return { html, css, totalScore, ordered: collected };
}

/** 浅封装：把「卡片」套一层 */
function cardWrap(use: boolean, color: { bg: string; bar: string; text: string }, icon: string, headHtml: string, bodyHtml: string): string {
  if (!use) return `<h3 class="hm-h3">${headHtml}</h3>${bodyHtml}`;
  return `<div class="hm-card" style="background:${color.bg};border-left-color:${color.bar};color:${color.text}">` +
    (headHtml ? `<div class="hm-card-head"><span class="hm-card-icon">${icon}</span><span>${headHtml}</span></div>` : '') +
    (bodyHtml ? `<div class="hm-card-body">${bodyHtml}</div>` : '') +
    `</div>`;
}

function cardWrapRaw(use: boolean, color: { bg: string; bar: string; text: string }, icon: string, bodyHtml: string): string {
  if (!use) return bodyHtml;
  return `<div class="hm-card" style="background:${color.bg};border-left-color:${color.bar};color:${color.text}">` +
    (icon ? `<div class="hm-card-head"><span class="hm-card-icon">${icon}</span></div>` : '') +
    `<div class="hm-card-body">${bodyHtml}</div>` +
    `</div>`;
}

/* ============================ 轻量编号器 ============================ */

class NumbererLite {
  private headingCounters: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  private questionCounter: number;
  private start: number;
  private step: number;
  constructor(start = 1, step = 1) {
    this.start = start;
    this.step = step;
    this.questionCounter = start - step;
  }
  nextHeading(level: HeadingLevel): number {
    this.headingCounters[level] += 1;
    for (let l = level + 1; l <= 3; l++) this.headingCounters[l] = 0;
    return this.headingCounters[level];
  }
  resetQuestions(): void { this.questionCounter = this.start - this.step; }
  nextQuestion(): number { this.questionCounter += this.step; return this.questionCounter; }
}

/** 供 UI 复用的中文数字（避免重复实现） */
export { cnNumber, toStrArray, rewriteImages, makeGroupBlock };
export type { TemplateVars, HandoutQuestion };
