/**
 * src/lib/latexMath.ts — 把 LaTeX 公式转成 Word 原生公式（OMML）
 *
 * 用途：当 pandoc 不可用时，浏览器端兜底导出 Word 也能显示**真正的公式**，
 *       而不是把 `$x^{2}$` 当纯文本输出。
 *
 * 思路：
 *   LaTeX ──KaTeX(output:'mathml')──► MathML ──本模块──► docx 的 Math 组件 ──► <m:oMath>
 *   LaTeX 的解析交给 KaTeX（成熟、覆盖全），本模块只做 MathML → docx 数学组件的结构映射。
 *
 * 仅客户端使用。
 */

import katex from 'katex';
import {
  Math as DocxMath,
  MathRun,
  MathFraction,
  MathRadical,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRoundBrackets,
  MathCurlyBrackets,
  MathSquareBrackets,
  MathAngledBrackets,
} from 'docx';

/** docx 内部未导出的 MathComponent 联合类型，用构造参数推导 */
type MathChildren = ConstructorParameters<typeof DocxMath>[0]['children'];
export type MathChild = MathChildren[number];

/* ============================ 极简 XML 解析 ============================ */

interface XmlEl {
  tag: string;
  attrs: Record<string, string>;
  kids: (XmlEl | string)[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/** 只解析本模块用到的子集：标签 / 属性 / 文本 / 自闭合 / 实体 */
function parseXml(src: string): XmlEl | null {
  let i = 0;
  const n = src.length;
  const isNameChar = (c: string) => !/[\s/>=]/.test(c);

  const skipWs = () => { while (i < n && /\s/.test(src[i])) i++; };

  const readName = (): string => {
    const s = i;
    while (i < n && isNameChar(src[i])) i++;
    return src.slice(s, i);
  };

  const parseEl = (): XmlEl => {
    i++; // '<'
    const tag = readName();
    const attrs: Record<string, string> = {};
    skipWs();
    while (i < n && src[i] !== '>' && !(src[i] === '/' && src[i + 1] === '>')) {
      const name = readName();
      if (!name) { i++; continue; }
      skipWs();
      if (src[i] === '=') {
        i++;
        skipWs();
        const quote = src[i];
        if (quote === '"' || quote === "'") {
          i++;
          const s = i;
          while (i < n && src[i] !== quote) i++;
          attrs[name] = decodeEntities(src.slice(s, i));
          i++;
        } else {
          const s = i;
          while (i < n && !/[\s/>]/.test(src[i])) i++;
          attrs[name] = decodeEntities(src.slice(s, i));
        }
      } else {
        attrs[name] = '';
      }
      skipWs();
    }

    const el: XmlEl = { tag, attrs, kids: [] };

    if (src[i] === '/' && src[i + 1] === '>') { i += 2; return el; }
    i++; // '>'

    while (i < n) {
      if (src[i] === '<') {
        if (src[i + 1] === '/') {
          i += 2;
          readName();
          skipWs();
          i++; // '>'
          return el;
        }
        if (src.startsWith('<!--', i)) {
          const e = src.indexOf('-->', i);
          i = e < 0 ? n : e + 3;
          continue;
        }
        el.kids.push(parseEl());
      } else {
        const s = i;
        while (i < n && src[i] !== '<') i++;
        const text = decodeEntities(src.slice(s, i));
        if (text.trim()) el.kids.push(text);
      }
    }
    return el;
  };

  skipWs();
  // 跳过 XML 声明 / DOCTYPE
  while (i < n && (src.startsWith('<?', i) || src.startsWith('<!', i))) {
    const e = src.indexOf('>', i);
    if (e < 0) return null;
    i = e + 1;
    skipWs();
  }
  if (src[i] !== '<') return null;
  return parseEl();
}

/* ============================ MathML → docx Math ============================ */

const OPEN_BRACKETS: Record<string, string> = {
  '(': 'round', '[': 'square', '{': 'curly', '⟨': 'angled', '⌈': 'angled', '|': 'square',
};

function elemKids(el: XmlEl): XmlEl[] {
  return el.kids.filter((k): k is XmlEl => typeof k !== 'string');
}

function textOf(el: XmlEl): string {
  let s = '';
  for (const k of el.kids) {
    if (typeof k === 'string') s += k;
    else s += textOf(k);
  }
  return s;
}

function convertList(kids: (XmlEl | string)[]): MathChild[] {
  const out: MathChild[] = [];
  for (const k of kids) {
    if (typeof k === 'string') {
      const t = k.replace(/\s+/g, ' ');
      if (t) out.push(new MathRun(t));
    } else {
      out.push(...convertEl(k));
    }
  }
  return out;
}

function kidsOf(el: XmlEl): MathChild[] {
  return convertList(el.kids);
}

/** 用括号组件包住内容 */
function bracketize(open: string, close: string, inner: MathChild[]): MathChild[] {
  const kind = OPEN_BRACKETS[open] || (close && OPEN_BRACKETS[close]) || '';
  try {
    switch (kind) {
      case 'round': return [new MathRoundBrackets({ children: inner })];
      case 'square': return [new MathSquareBrackets({ children: inner })];
      case 'curly': return [new MathCurlyBrackets({ children: inner })];
      case 'angled': return [new MathAngledBrackets({ children: inner })];
      default: return [new MathRun(open), ...inner, new MathRun(close)];
    }
  } catch {
    return [new MathRun(open), ...inner, new MathRun(close)];
  }
}

function convertEl(el: XmlEl): MathChild[] {
  switch (el.tag) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom':
    case 'menclose':
    case 'semantics':
    case 'mtd':
      return kidsOf(el);

    // LaTeX 源码注释，跳过
    case 'annotation':
    case 'annotation-xml':
      return [];

    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return [new MathRun(textOf(el) || ' ')];

    case 'mspace':
      return [new MathRun(' ')];

    case 'merror':
      return [new MathRun(textOf(el))];

    case 'msup': {
      const [base, sup] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathSuperScript({
        children: convertEl(base),
        superScript: sup ? convertEl(sup) : [new MathRun('')],
      })];
    }

    case 'msub': {
      const [base, sub] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathSubScript({
        children: convertEl(base),
        subScript: sub ? convertEl(sub) : [new MathRun('')],
      })];
    }

    case 'msubsup': {
      const [base, sub, sup] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathSubSuperScript({
        children: convertEl(base),
        subScript: sub ? convertEl(sub) : [new MathRun('')],
        superScript: sup ? convertEl(sup) : [new MathRun('')],
      })];
    }

    case 'mfrac': {
      const [num, den] = elemKids(el);
      return [new MathFraction({
        numerator: num ? convertEl(num) : [new MathRun('')],
        denominator: den ? convertEl(den) : [new MathRun('')],
      })];
    }

    case 'msqrt': {
      const [base] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathRadical({ children: convertEl(base) })];
    }

    case 'mroot': {
      const [base, deg] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathRadical({
        children: convertEl(base),
        degree: deg ? convertEl(deg) : undefined,
      })];
    }

    // 上下标以外的「上下附加」：近似处理
    case 'mover': {
      const [base, over] = elemKids(el);
      if (!base) return kidsOf(el);
      const acc = over ? textOf(over) : '';
      // 常见重音/箭头：直接跟在后面（比强行做成上标更接近原意）
      if (acc && /^[\^~¯‾˙¨´`→←↔⇀⇁ˆˇ˘˙˚˝¸˛√∑∏]$/.test(acc)) {
        return [...convertEl(base), new MathRun(acc)];
      }
      return [new MathSuperScript({
        children: convertEl(base),
        superScript: over ? convertEl(over) : [new MathRun('')],
      })];
    }

    case 'munder': {
      const [base, under] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathSubScript({
        children: convertEl(base),
        subScript: under ? convertEl(under) : [new MathRun('')],
      })];
    }

    case 'munderover': {
      const [base, under, over] = elemKids(el);
      if (!base) return kidsOf(el);
      return [new MathSubSuperScript({
        children: convertEl(base),
        subScript: under ? convertEl(under) : [new MathRun('')],
        superScript: over ? convertEl(over) : [new MathRun('')],
      })];
    }

    // 表格（\begin{cases} / \begin{matrix} 等）：按行、按列近似展开
    case 'mtable': {
      const rows = elemKids(el).filter(r => r.tag === 'mtr');
      const parts: string[] = [];
      rows.forEach((row, ri) => {
        const cells = elemKids(row).filter(c => c.tag === 'mtd');
        const cellText = cells.map(c => textOf(c).replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (cellText.length) parts.push(cellText.join('，'));
        if (ri < rows.length - 1) parts.push('；');
      });
      return parts.length ? [new MathRun(parts.join(''))] : kidsOf(el);
    }
    case 'mtr':
    case 'mlabeledtr':
      return kidsOf(el);

    case 'mfenced': {
      const open = el.attrs['open'] ?? '(';
      const close = el.attrs['close'] ?? ')';
      return bracketize(open, close, kidsOf(el));
    }

    default:
      // 未知标签：退化为内容
      return kidsOf(el);
  }
}

/* ============================ 对外接口 ============================ */

/**
 * LaTeX → docx 数学组件。
 * 解析失败时返回 null，调用方可回退为纯文本。
 */
export function latexToDocxMath(tex: string, display = false): MathChild[] | null {
  const src = (tex || '').trim();
  if (!src) return null;

  let mathml = '';
  try {
    const html = katex.renderToString(src, {
      throwOnError: false,
      displayMode: display,
      output: 'mathml',
      strict: false,
    });
    const m = html.match(/<math[\s\S]*<\/math>/);
    if (!m) return null;
    mathml = m[0];
  } catch {
    return null;
  }

  try {
    const root = parseXml(mathml);
    if (!root) return null;
    const children = convertEl(root);
    if (!children.length) return null;
    return children;
  } catch {
    return null;
  }
}

/** 方便调用方：直接拿到可放进 Paragraph 的 Math 组件 */
export function makeDocxMath(tex: string, display = false): DocxMath | null {
  const children = latexToDocxMath(tex, display);
  if (!children) return null;
  try {
    return new DocxMath({ children });
  } catch {
    return null;
  }
}
