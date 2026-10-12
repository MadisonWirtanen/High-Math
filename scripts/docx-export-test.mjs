/**
 * scripts/docx-export-test.mjs — Word 导出回归测试
 *
 * 验证两条导出路径都能把 `$...$` 变成 Word 原生公式，且题号不被当成有序列表：
 *   A. 浏览器端兜底（KaTeX → MathML → OMML）
 *   B. pandoc（若本机可用；用环境变量 PANDOC_PATH 指定）
 *
 * 运行：
 *   node --experimental-strip-types scripts/docx-export-test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import JSZip from 'jszip';
import { Document, Packer } from 'docx';

// 让相对 import 能省略 .ts 后缀（与 Next 项目写法一致）
register(new URL('./ts-resolve-hook.mjs', import.meta.url));

const { buildDocumentMarkdown, DEFAULT_HANDOUT_SETTINGS } = await import('../src/lib/handout.ts');
const { markdownToParagraphs } = await import('../src/lib/docxFallback.ts');

/** 工作区根目录下的 .cache（与 cwd 无关） */
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PANDOC = process.env.PANDOC_PATH || 'C:/Users/Madis/Documents/HighMath/.cache/pandoc/pandoc.exe';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

/* ---------- 造一份含各种公式的样卷 ---------- */
const mk = (qid, type, number, 题目, 选项, 答案, 解析) => ({
  q: {
    qid, source: '25海淀一模', number, type, grade: '高中', semester: '高三上',
    exam_type: '一模', difficulty: 0.6, chapter: [], section: [],
    knowledge: ['【必备知识】导数应用之求函数最值'], tags: [],
  },
  sections: { 题目, 选项: 选项 ?? '', 答案, 解析 },
});

const sources = new Map([
  ['101', mk('101', '单选题', 'T1', '$(1 + 5\\mathrm{i})\\mathrm{i}$ 的虚部为 [选]',
    'A. $-1$\nB. $0$\nC. $\\dfrac{3}{2}$\nD. $\\sqrt{x^{2}+1}$', 'C',
    '因为 $(1+5i)i=i+5i^{2}=-5+i$ ，所以其虚部为 1。')],
  ['102', mk('102', '多选题', 'T2', '已知 $C: y^{2} = 6x$，则 [多选]',
    'A. $\\left|AD\\right|=\\left|AF\\right|$\nB. $x \\in [0,1]$\nC. $\\alpha+\\beta \\leq \\pi$\nD. $\\sum_{i=1}^{n} i^{2}$', 'AB', '略')],
  ['103', mk('103', '解答题', '19', '某检测结果如下：\n\n| 组别 | 正常 | 不正常 | 合计 |\n| --- | --- | --- | --- |\n| 患病 | 20 | 180 | 200 |\n| 未患病 | 780 | 20 | 800 |\n\n求二面角 $\\theta$，已知 $\\overrightarrow{AB}\\cdot\\overrightarrow{AC}=0$。',
    null, '60°', '建系，$\\lim_{x\\to 0}\\dfrac{\\sin x}{x}=1$。')],
]);

const blocks = [
  { id: 'q101', type: 'question', qid: '101', score: 5 },
  { id: 'q102', type: 'question', qid: '102', score: 5 },
  { id: 'q103', type: 'question', qid: '103', score: 12 },
];

const { markdown } = buildDocumentMarkdown({
  blocks,
  settings: { ...DEFAULT_HANDOUT_SETTINGS, headerEnabled: true, title: '数学讲义', answerPosition: 'afterEach' },
  getQuestion: (qid) => sources.get(qid),
});

console.log('\n[0] 生成的 markdown');
check('题号已转义为 1\\.', markdown.includes('1\\. '));
check('无未转义的行首数字点', !/^\d+\.\s/m.test(markdown));
check('公式保留 $ 定界符', markdown.includes('$(1 + 5\\mathrm{i})\\mathrm{i}$'));

const expectFormulas = (markdown.match(/\$/g) || []).length / 2;

/* ---------- 工具：检查 docx ---------- */
async function inspectDocx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('word/document.xml').async('string');
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
  return {
    oMath: (xml.match(/oMath/g) || []).length,
    numPr: (xml.match(/numPr/g) || []).length,
    tables: (xml.match(/<w:tbl>/g) || []).length,
    dollar: (text.match(/\$/g) || []).length,
    backslashDot: (text.match(/\\\./g) || []).length,
    text: text.slice(0, 200),
  };
}

/* ---------- A. 浏览器端兜底 ---------- */
console.log('\n[A] 浏览器端兜底（KaTeX → OMML）');
{
  const paras = markdownToParagraphs(markdown, new Map());
  const doc = new Document({ sections: [{ properties: {}, children: paras }] });
  const buf = await Packer.toBuffer(doc);
  const f = path.join(OUT_DIR, 'export-fallback.docx');
  fs.writeFileSync(f, buf);

  const info = await inspectDocx(f);
  check(`公式数 ≥ ${expectFormulas}（实际 ${info.oMath / 2}）`, info.oMath / 2 >= expectFormulas);
  check('正文无残留 $ 定界符', info.dollar === 0, '实际 ' + info.dollar);
  check('反斜杠转义已还原（无 1\\.）', info.backslashDot === 0, '实际 ' + info.backslashDot);
  check('题号 1. 以字面量出现', info.text.includes('1.'));
  check('表格已渲染为 Word 表格', info.tables === 1, '实际 ' + info.tables);
}

/* ---------- B. pandoc ---------- */
console.log('\n[B] pandoc');
if (!fs.existsSync(PANDOC)) {
  console.log('  (跳过：未找到 pandoc →', PANDOC, ')');
} else {
  const mdFile = path.join(OUT_DIR, 'export-pandoc.md');
  const docxFile = path.join(OUT_DIR, 'export-pandoc.docx');
  fs.writeFileSync(mdFile, markdown, 'utf-8');
  try {
    execFileSync(PANDOC, [
      mdFile, '--resource-path', OUT_DIR, '-o', docxFile,
      '-f', 'markdown+tex_math_dollars+raw_attribute', '-t', 'docx',
    ], { stdio: 'pipe' });

    const info = await inspectDocx(docxFile);
    check(`公式数 ≥ ${expectFormulas}（实际 ${info.oMath / 2}）`, info.oMath / 2 >= expectFormulas);
    check('题号未被转成有序列表（numPr = 0）', info.numPr === 0, '实际 ' + info.numPr);
    check('正文无残留 $ 定界符', info.dollar === 0, '实际 ' + info.dollar);
    check('题号 1. 以字面量出现', info.text.includes('1.'));
    check('表格已渲染为 Word 表格', info.tables === 1, '实际 ' + info.tables);
  } catch (e) {
    console.log('  (跳过：无法调用 pandoc —', (e && e.message) || e, ')');
    console.log('   markdown 已写出：', mdFile);
  }
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
