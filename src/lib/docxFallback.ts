/**
 * src/lib/docxFallback.ts — 浏览器端 Word 生成（pandoc 不可用时的兜底）
 *
 * 与 handout.ts 保持一致的关键点：**消费同一份 markdown**。
 * 这样 pandoc 路径与兜底路径的输出天然一致，不会出现「两套设置」。
 *
 * 公式处理：`$...$` / `$$...$$` 会被渲染成 **Word 原生公式**（OMML），
 * 而不是把 LaTeX 源码当纯文本输出（见 latexMath.ts）。
 *
 * 仅客户端使用（依赖 docx / katex）。
 */

import {
  Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import { makeDocxMath } from './latexMath';

export interface ImageBinary {
  arrayBuf: ArrayBuffer;
  ext: string;
}

const OPENXML_PAGEBREAK = /^```\{=openxml\}[\s\S]*?```$/;
/** 行内 token：图片 / 行间公式 / 行内公式 / 加粗 */
const TOKEN_RE = /!\[[^\]]*\]\(([^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\*\*([^*]+)\*\*/g;
/** `\$` 转义占位（避免被当成公式定界符） */
const ESC_DOLLAR = '\uE000';

function toHeadingLevel(hashes: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  switch (hashes) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    case 6: return HeadingLevel.HEADING_6;
    default: return undefined;
  }
}

type DocxMathNode = NonNullable<ReturnType<typeof makeDocxMath>>;
type Run = TextRun | ImageRun | DocxMathNode;

/** 还原 markdown 反斜杠转义（`1\.` → `1.`） */
function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
}

/** 把一段普通文本按 **加粗** 拆成 TextRun */
function pushText(runs: Run[], text: string): void {
  if (!text) return;
  const restored = unescapeMd(text.split(ESC_DOLLAR).join('$'));
  let cursor = 0;
  let m: RegExpExecArray | null;
  const re = /\*\*([^*]+)\*\*/g;
  while ((m = re.exec(restored)) !== null) {
    if (m.index > cursor) runs.push(new TextRun({ text: restored.slice(cursor, m.index) }));
    runs.push(new TextRun({ text: m[1], bold: true }));
    cursor = m.index + m[0].length;
  }
  if (cursor < restored.length) runs.push(new TextRun({ text: restored.slice(cursor) }));
}

/** 把一行 markdown 文本拆成 TextRun / ImageRun / 公式 序列 */
function lineToRuns(line: string, imageBin: Map<string, ImageBinary>): Run[] {
  const runs: Run[] = [];
  const src = line.split('\\$').join(ESC_DOLLAR);

  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) pushText(runs, src.slice(last, m.index));

    const [full, imgPath, displayTex, inlineTex, boldText] = m;

    if (imgPath !== undefined) {
      const bin = imageBin.get(imgPath);
      if (bin) {
        const ext = (bin.ext || 'jpg').toLowerCase();
        runs.push(new ImageRun({
          data: bin.arrayBuf,
          transformation: { width: 420, height: 280 },
          type: ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : ext === 'bmp' ? 'bmp' : 'jpg',
        }));
      } else {
        runs.push(new TextRun({ text: `[图片缺失:${imgPath}]` }));
      }
    } else if (displayTex !== undefined || inlineTex !== undefined) {
      const tex = (displayTex ?? inlineTex ?? '').split(ESC_DOLLAR).join('$');
      const math = makeDocxMath(tex, displayTex !== undefined);
      if (math) {
        runs.push(math);
      } else {
        // KaTeX 也解析不了 → 至少去掉定界符，别把 $ 暴露给读者
        runs.push(new TextRun({ text: tex, italics: true }));
      }
    } else if (boldText !== undefined) {
      runs.push(new TextRun({ text: unescapeMd(boldText.split(ESC_DOLLAR).join('$')), bold: true }));
    }

    last = m.index + full.length;
  }

  if (last < src.length) pushText(runs, src.slice(last));
  return runs;
}

/** 该行是否是一整块行间公式 */
function isDisplayMathLine(line: string): string | null {
  const m = line.trim().match(/^\$\$([\s\S]+?)\$\$$/);
  return m ? m[1] : null;
}

/* ---------- Markdown 表格 ---------- */

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;

function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function buildTable(rows: string[][], imageBin: Map<string, ImageBinary>): Table {
  const colCount = Math.max(...rows.map(r => r.length), 1);
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: colCount }, (_, ci) => new TableCell({
        borders,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({
          children: lineToRuns(cells[ci] ?? '', imageBin),
          alignment: AlignmentType.CENTER,
        })],
      })),
    })),
  });
}

/** markdown → (Paragraph | Table)[] */
export function markdownToParagraphs(markdown: string, imageBin: Map<string, ImageBinary>): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let inOpenXml = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 分页：pandoc 的 raw openxml 块
    if (!inOpenXml && line.trim() === '```{=openxml}') { inOpenXml = true; i++; continue; }
    if (inOpenXml) {
      if (line.trim() === '```') {
        inOpenXml = false;
        blocks.push(new Paragraph({ children: [new TextRun('')], pageBreakBefore: true }));
      }
      i++;
      continue;
    }
    if (OPENXML_PAGEBREAK.test(line.trim())) {
      blocks.push(new Paragraph({ children: [new TextRun('')], pageBreakBefore: true }));
      i++;
      continue;
    }

    // 表格：连续以 | 开头的行，且第二行是分隔行
    if (TABLE_ROW_RE.test(line) && TABLE_ROW_RE.test(lines[i + 1] ?? '') && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      const raw: string[][] = [];
      let j = i;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
        if (!TABLE_SEP_RE.test(lines[j])) raw.push(splitRow(lines[j]));
        j++;
      }
      if (raw.length > 0) blocks.push(buildTable(raw, imageBin));
      i = j;
      continue;
    }

    // 空行
    if (line.trim() === '') {
      blocks.push(new Paragraph({ children: [] }));
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push(new Paragraph({
        children: lineToRuns(h[2], imageBin),
        heading: toHeadingLevel(h[1].length),
        alignment: h[1].length === 1 ? AlignmentType.CENTER : undefined,
      }));
      i++;
      continue;
    }

    // 水平线
    if (/^-{3,}$/.test(line.trim())) {
      blocks.push(new Paragraph({ children: [new TextRun('─'.repeat(30))], alignment: AlignmentType.CENTER }));
      i++;
      continue;
    }

    // 整行公式：居中独占一段
    const displayTex = isDisplayMathLine(line);
    if (displayTex !== null) {
      const math = makeDocxMath(displayTex, true);
      blocks.push(new Paragraph({
        children: math ? [math] : [new TextRun({ text: displayTex, italics: true })],
        alignment: AlignmentType.CENTER,
      }));
      i++;
      continue;
    }

    blocks.push(new Paragraph({ children: lineToRuns(line, imageBin) }));
    i++;
  }

  return blocks;
}

/** 生成并触发下载 .docx */
export async function downloadDocxFromMarkdown(
  markdown: string,
  imageBin: Map<string, ImageBinary>,
  fileName: string,
): Promise<void> {
  const doc = new Document({
    sections: [{ properties: {}, children: markdownToParagraphs(markdown, imageBin) }],
  });
  const buffer = await Packer.toBuffer(doc);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
