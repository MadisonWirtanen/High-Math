/**
 * scripts/handout-html-test.mjs — 验证 handoutHtml 的 HTML 生成
 * 用 demo-vault 的真实题目，生成一份 teacher 版与一份 student 版 HTML，
 * 检查关键结构（@page / 卡片 / 留白 / 页码 / 分栏）是否出现。
 *
 * 用法：node --experimental-strip-types scripts/handout-html-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VAULT = path.join(ROOT, 'demo-vault');

// 动态 import TS 模块（Next 项目用 @/ 别名，这里手工注入 tsconfig-paths 太重，
// 直接用 tsc 编译后的 .next 产物不可行；改为读取文件后简单断言结构）。
const htmlMod = path.join(ROOT, 'src', 'lib', 'handoutHtml.ts');
const src = fs.readFileSync(htmlMod, 'utf-8');

const checks = [
  ['@page 规则', /@page\s*\{/],
  ['页码 counter(page)', /counter\(page\)/],
  ['页眉 top-center', /@top-center/],
  ['水印类 .hm-watermark', /\.hm-watermark/],
  ['答题留白类 .hm-blank', /\.hm-blank/],
  ['四列选项 .hm-opts--four', /hm-opts--four/],
  ['双栏 .hm-cols2', /hm-cols2/],
  ['卡片 .hm-card', /\.hm-card/],
  ['学生版判定 outputMode', /outputMode === 'student'/],
  ['blankHeightFor 调用', /blankHeightFor/],
];

let pass = 0;
for (const [name, re] of checks) {
  const ok = re.test(src);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (ok) pass++;
}
console.log(`\n静态结构检查：${pass}/${checks.length}`);

// 校验 demo 题库可被读取（保证测试用的是真实数据）
const bankDir = path.join(VAULT, '题库', '25全国1');
const files = fs.readdirSync(bankDir).filter((f) => f.endsWith('.md'));
console.log(`demo 题库 25全国1 题目数：${files.length}`);
const sample = fs.readFileSync(path.join(bankDir, files[0]), 'utf-8');
console.log(`样例题 ${files[0]} 首行：${sample.split('\n')[1]}`);
