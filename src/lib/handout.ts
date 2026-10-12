/**
 * src/lib/handout.ts — 组卷 / 讲义「文档模型 + 生成核心」
 *
 * 设计要点：
 *  1. 纯 TypeScript：不依赖 Node / DOM / React，客户端与服务端（pandoc 路由）共用同一份逻辑。
 *  2. 唯一生成入口：buildDocumentMarkdown()。所有导出（复制 / zip / Word）都走它，
 *     保证「设置 → markdown」只有一条链路，Word 通过 pandoc 自动继承全部设置。
 *  3. 文档块模型：Block[] 取代过去「一条平的题目列表 + 写死 1. 2. 3.」。
 *     标题 / 大题 / 文本标签 / 参考答案区 / 分页 都是块。
 *  4. 只读题库：本模块不写任何文件、不碰题库目录。
 *
 * 「大题」在模型里 = level 1 的 heading 且 restartNumbering = true（即分段编号的起点）。
 * 为兼容方案文档，group 类型与「level 1 + restartNumbering」等价。
 */

/* ============================ 题目 ============================ */

export interface HandoutQuestion {
  qid: string;
  source: string;
  number: string;
  type: string;
  grade: string;
  semester: string;
  exam_type: string;
  difficulty: number | null;
  /** 一级：章 */
  chapter: string[];
  /** 二级：节 */
  section: string[];
  /** 三级：知识点（可能带【必备知识】等前缀） */
  knowledge: string[];
  tags: string[];
}

/** 把任意值规范化成字符串数组 */
export function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map(x => String(x));
  if (v === null || v === undefined || v === '') return [];
  return [String(v)];
}

/** 把难度系数（0~1，越大越易）换算成星级 */
export function starsFromDifficulty(d: number): string {
  if (!isFinite(d) || d <= 0) return '';
  const n = Math.max(1, Math.min(5, Math.round((1 - d) * 5)));
  return '★'.repeat(n);
}

/* ============================ 文档块模型 ============================ */

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingBlock {
  id: string;
  type: 'heading';
  level: HeadingLevel;
  text: string;
  /** true = 自动编号（一、/（一）/1.）；false = 原样输出 text */
  autoNumber: boolean;
  /** true = 该标题之后题目重新从 1 编号（即「大题」语义） */
  restartNumbering?: boolean;
}

/** 大题：等价于 level 1 且 restartNumbering 的 heading */
export interface GroupBlock {
  id: string;
  type: 'group';
  level: HeadingLevel;
  text: string;
  autoNumber: boolean;
}

export interface QuestionBlock {
  id: string;
  type: 'question';
  /** 对应 HandoutQuestion.qid */
  qid: string;
  /** 分值（只存在于组卷设置 / 文档模型，绝不写回题库） */
  score?: number;
}

export interface TextBlock {
  id: string;
  type: 'text';
  content: string;
}

export interface AnswersBlock {
  id: string;
  type: 'answers';
}

export interface PageBreakBlock {
  id: string;
  type: 'pagebreak';
}

export type Block =
  | HeadingBlock
  | GroupBlock
  | QuestionBlock
  | TextBlock
  | AnswersBlock
  | PageBreakBlock;

let _seq = 0;
/** 生成块 id（仅用于 React key 与拖拽定位，无业务含义） */
export function newBlockId(prefix = 'b'): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

/* ============================ 设置 ============================ */

export type NumberSource = 'auto' | 'origin';
export type KnowledgeMode = 'none' | 'below' | 'inline';
export type AnswerPosition = 'none' | 'afterEach' | 'end';
export type OptionLayout = 'one-per-line' | 'two-in-line' | 'four-in-line';
export type Spacing = 'compact' | 'normal' | 'loose';

/** v2.2 新增：输出模式（学生版 / 教师版 / 两份都要） */
export type OutputMode = 'student' | 'teacher' | 'both';

export interface HandoutSettings {
  /* 卷头 */
  headerEnabled: boolean;
  title: string;
  subtitle: string;
  examTime: string;
  /** 满分；留空则用分值自动合计 */
  fullScore: string;
  headerNote: string;
  /** 密封线（降级为顶部信息栏） */
  sealLine: boolean;

  /* 顺序 */
  reverse: boolean;
  reorderByType: boolean;

  /* 题号 */
  showNumber: boolean;
  numberSource: NumberSource;
  /** 格式模板，用 {n} 占位，如 `{n}.`、`（{n}）`、`第{n}题` */
  numberFormat: string;
  numberStart: number;
  numberStep: number;
  /** 原卷序号去掉字母前缀（T19 → 19） */
  stripAlphaPrefix: boolean;
  /** 分段编号：每个大题内重新从 numberStart 开始 */
  restartPerGroup: boolean;
  /** 多选题追加「(多选)」标记 */
  multiSelectMark: boolean;

  /* 知识点 */
  knowledgeMode: KnowledgeMode;
  /** 知识点模板，支持 {变量|修饰符} */
  knowledgeTemplate: string;

  /* 内容开关 */
  showScore: boolean;
  defaultScore: number | null;
  showSource: boolean;
  showRemark: boolean;

  /* 答案 / 解析 */
  answerPosition: AnswerPosition;
  includeSolution: boolean;

  /* 版面 */
  optionLayout: OptionLayout;
  spacing: Spacing;
  pageBreakBeforeGroup: boolean;

  /* ===== v2.2 新增：PDF 优先版面（全部只存于设置 / 草稿，不写题库） ===== */

  /** 输出模式：学生版隐藏答案解析并留白；教师版完整；both 导两份 */
  outputMode: OutputMode;

  /* 页眉 / 页脚 / 页码 */
  headerText: string;
  footerText: string;
  showPageNumber: boolean;
  /** 页码模板，支持 {page} {pages} */
  pageNumberFormat: string;
  pageNumberStart: number;

  /* 水印 */
  watermarkEnabled: boolean;
  watermarkText: string;
  /** 0~1 */
  watermarkOpacity: number;

  /* 分栏：模块正文列数（选项另有 optionLayout） */
  bodyColumns: 1 | 2;

  /* 答题留白 */
  /** 是否为学生版自动预留答题空间 */
  autoBlankByType: boolean;
  /** 各题型留白高度（mm）：单选 / 多选 / 填空 / 解答 */
  blankHeights: {
    single: number;
    multiple: number;
    fill: number;
    solve: number;
  };
  /** 全局额外留白（mm），叠加在各题型之上 */
  blankExtra: number;

  /* 卡片视觉 */
  cardStyle: boolean;
}

export const DEFAULT_HANDOUT_SETTINGS: HandoutSettings = {
  headerEnabled: false,
  title: '',
  subtitle: '',
  examTime: '',
  fullScore: '',
  headerNote: '',
  sealLine: false,

  reverse: false,
  reorderByType: false,

  showNumber: true,
  numberSource: 'auto',
  numberFormat: '{n}.',
  numberStart: 1,
  numberStep: 1,
  stripAlphaPrefix: true,
  restartPerGroup: false,
  multiSelectMark: true,

  knowledgeMode: 'none',
  knowledgeTemplate: '考查知识点：{knowledge|strip|join:、}',

  showScore: false,
  defaultScore: null,
  showSource: true,
  showRemark: true,

  answerPosition: 'afterEach',
  includeSolution: true,

  optionLayout: 'one-per-line',
  spacing: 'normal',
  pageBreakBeforeGroup: false,

  /* v2.2 默认值 */
  outputMode: 'teacher',

  headerText: '',
  footerText: '',
  showPageNumber: false,
  pageNumberFormat: '第 {page} 页 / 共 {pages} 页',
  pageNumberStart: 1,

  watermarkEnabled: false,
  watermarkText: '',
  watermarkOpacity: 0.08,

  bodyColumns: 1,

  autoBlankByType: true,
  blankHeights: { single: 0, multiple: 0, fill: 22, solve: 60 },
  blankExtra: 0,

  cardStyle: true,
};

/** 合并出完整设置（兼容旧 localStorage 里缺字段的情况） */
export function normalizeSettings(patch: Partial<HandoutSettings> | null | undefined): HandoutSettings {
  const p = patch || {};
  return {
    ...DEFAULT_HANDOUT_SETTINGS,
    ...p,
    // 嵌套对象需单独合并，避免旧草稿缺子字段
    blankHeights: { ...DEFAULT_HANDOUT_SETTINGS.blankHeights, ...(p.blankHeights || {}) },
  };
}

/* ============================ 模板引擎 ============================ */

export type TemplateValue = string | string[] | number | null | undefined;
export type TemplateVars = Record<string, TemplateValue>;

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 阿拉伯数字 → 中文数字（1~99），超出范围原样返回 */
export function cnNumber(n: number): string {
  if (!isFinite(n) || n <= 0) return String(n);
  if (n < 10) return CN_DIGITS[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + CN_DIGITS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return CN_DIGITS[tens] + '十' + (ones ? CN_DIGITS[ones] : '');
  }
  return String(n);
}

/** 去掉【必备知识】这类前缀 */
function stripBracket(s: string): string {
  return s.replace(/^【[^】]*】/, '');
}

/** 对单个值套用修饰符（不含 join / none，这两个在主流程处理） */
function applyScalarMods(value: string, mods: string[]): string {
  let v = value;
  for (const m of mods) {
    const idx = m.indexOf(':');
    const name = idx >= 0 ? m.slice(0, idx) : m;
    const arg = idx >= 0 ? m.slice(idx + 1) : '';
    switch (name) {
      case 'strip':
        v = stripBracket(v);
        break;
      case 'prefix':
        v = arg + v;
        break;
      case 'suffix':
        v = v + arg;
        break;
      case 'stars':
        v = starsFromDifficulty(Number(v));
        break;
      case 'num':
        v = v.replace(/^[A-Za-z]+/, '');
        break;
      case 'upper':
        v = v.toUpperCase();
        break;
      default:
        break;
    }
  }
  return v;
}

/**
 * 模板渲染。
 *   {knowledge}                → 原值
 *   {knowledge|join:、}        → 数组连接
 *   {knowledge|strip|join:、}  → 去【】前缀后连接
 *   {difficulty|stars}         → ★★★
 *   {section|none:未分类}      → 空值替代
 */
export function renderTemplate(tpl: string, ctx: TemplateVars): string {
  if (!tpl) return '';
  return tpl.replace(/\{([a-zA-Z_][\w]*)((?:\|[^{}]*)*)\}/g, (_full, key: string, modStr: string) => {
    const mods: string[] = (modStr || '').split('|').map(s => s.trim()).filter(Boolean);
    const raw = ctx[key];

    let out = '';
    if (Array.isArray(raw)) {
      const joinMod = mods.find(m => m.startsWith('join:'));
      const sep = joinMod ? joinMod.slice(5) : '、';
      const scalarMods = mods.filter(m => m !== joinMod);
      out = raw.map(x => applyScalarMods(String(x), scalarMods)).filter(Boolean).join(sep);
    } else if (raw === null || raw === undefined) {
      out = '';
    } else {
      out = applyScalarMods(String(raw), mods.filter(m => !m.startsWith('none:')));
    }

    if (!out) {
      const noneMod = mods.find(m => m.startsWith('none:'));
      if (noneMod) out = noneMod.slice(5);
    }
    return out;
  });
}

/** 把一道题组装成模板上下文 */
export function questionContext(q: HandoutQuestion, index: number, score?: number | null): TemplateVars {
  return {
    index: String(index),
    qid: q.qid,
    source: q.source || '',
    number: q.number || '',
    type: q.type || '',
    grade: q.grade || '',
    semester: q.semester || '',
    exam_type: q.exam_type || '',
    difficulty: q.difficulty === null || q.difficulty === undefined ? '' : String(q.difficulty),
    chapter: q.chapter || [],
    section: q.section || [],
    knowledge: q.knowledge || [],
    tags: q.tags || [],
    score: score === null || score === undefined ? '' : String(score),
  };
}

/* ============================ 编号器 ============================ */

export class Numberer {
  private headingCounters: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  private questionCounter: number;
  private start: number;
  private step: number;

  constructor(start = 1, step = 1) {
    this.start = start;
    this.step = step;
    this.questionCounter = start - step;
  }

  /** 推进某一级标题计数，并重置更低级 */
  nextHeading(level: HeadingLevel): number {
    this.headingCounters[level] += 1;
    for (let l = level + 1; l <= 3; l++) this.headingCounters[l] = 0;
    return this.headingCounters[level];
  }

  /** 题目计数归零（分段编号） */
  resetQuestions(): void {
    this.questionCounter = this.start - this.step;
  }

  nextQuestion(): number {
    this.questionCounter += this.step;
    return this.questionCounter;
  }
}

/** 标题文本：自动编号 or 原样 */
export function formatHeading(level: HeadingLevel, n: number, text: string, autoNumber: boolean): string {
  if (!autoNumber) return text;
  const prefix = level === 1 ? `${cnNumber(n)}、` : level === 2 ? `（${cnNumber(n)}）` : `${n}.`;
  return text ? `${prefix}${text}` : prefix;
}

/** 题号文本：把 {n} 替换为实际值 */
export function formatNumber(fmt: string, value: string | number): string {
  return (fmt || '{n}.').replace(/\{n\}/g, String(value));
}

/* ============================ 顺序变换 ============================ */

function isQuestionBlock(b: Block): b is QuestionBlock {
  return b.type === 'question';
}

/** 在「题目块槽位」上做整体重排，标题 / 文本块保持原位（Q1：标题不参与倒序） */
function remapQuestions(blocks: Block[], fn: (qs: QuestionBlock[]) => QuestionBlock[]): Block[] {
  const qs = blocks.filter(isQuestionBlock);
  if (qs.length < 2) return blocks;
  const next = fn(qs);
  let i = 0;
  return blocks.map(b => (isQuestionBlock(b) ? next[i++] : b));
}

function typeRank(t: string): number {
  if (t.includes('单选')) return 0;
  if (t.includes('多选')) return 1;
  if (t.includes('判断')) return 2;
  if (t.includes('填空')) return 3;
  if (t.includes('解答') || t.includes('计算') || t.includes('证明')) return 4;
  return 5;
}

export function applyOrder(
  blocks: Block[],
  settings: HandoutSettings,
  typeOf: (qid: string) => string = () => '',
): Block[] {
  let out = blocks;
  if (settings.reorderByType) {
    out = remapQuestions(out, qs => {
      const idx = new Map<string, number>();
      qs.forEach((q, i) => idx.set(q.id, i));
      return [...qs].sort((a, b) => {
        const d = typeRank(typeOf(a.qid)) - typeRank(typeOf(b.qid));
        return d !== 0 ? d : (idx.get(a.id)! - idx.get(b.id)!);
      });
    });
  }
  if (settings.reverse) {
    out = remapQuestions(out, qs => [...qs].reverse());
  }
  return out;
}

/* ============================ 图片 ============================ */

const OBSIDIAN_IMG_RE = /!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g;
const MD_IMG_RE = /!\[[^\]]*\]\(images\/([^)]+)\)/g;

/** 收集文本中引用的题库图片 hash 文件名 */
export function collectImageHashes(text: string, into: Set<string>): void {
  if (!text) return;
  let m: RegExpExecArray | null;
  OBSIDIAN_IMG_RE.lastIndex = 0;
  while ((m = OBSIDIAN_IMG_RE.exec(text)) !== null) into.add(m[1]);
  MD_IMG_RE.lastIndex = 0;
  while ((m = MD_IMG_RE.exec(text)) !== null) into.add(m[1]);
}

/** 把文本里的图片引用重写成 mapImage 给定的新名 */
export function rewriteImages(text: string, mapImage: (hash: string) => string): string {
  if (!text) return '';
  return text
    .replace(OBSIDIAN_IMG_RE, (_f, hash: string) => `![](${mapImage(hash)})`)
    .replace(MD_IMG_RE, (_f, hash: string) => `![](${mapImage(hash)})`);
}

/* ============================ 题目正文渲染 ============================ */

export interface QuestionSource {
  q: HandoutQuestion;
  sections: Record<string, string>;
}

/** 把「A. xxx\nB. yyy」四选项压成一行 */
function mergeOptionLines(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const isOptStart = (l: string) => /^[（(]?[A-Da-d][.、）)]/.test(l);
  const parts: string[] = [];
  let buf = '';
  for (const l of lines) {
    if (isOptStart(l)) {
      if (buf) parts.push(buf);
      buf = l;
    } else {
      buf = buf ? `${buf} ${l}` : l;
    }
  }
  if (buf) parts.push(buf);
  return parts.join('　');
}

/**
 * 防止 pandoc 把行首的 `1.` / `A.` 当成**有序列表**。
 *
 * 背景：markdown 里「数字或字母 + 点 + 空格」在行首会被解析为列表项，
 * pandoc 会改用列表自动编号并加缩进，导致题号格式设置（起始值/步长/模板）失效。
 * 转义成 `1\.` 后 pandoc 输出字面量 `1.`，浏览器端兜底与预览会再还原。
 */
export function escapeListMarkers(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => line.replace(/^(\s{0,3})(\d{1,9}|[A-Za-z])\.(?=\s)/, '$1$2\\.'))
    .join('\n');
}

/**
 * 表格前必须有空行，否则 pandoc 不会把它识别为表格。
 * 题库原文通常已带空行，这里做一层保险。
 */
export function ensureBlankBeforeTable(text: string): string {
  if (!text) return '';
  const ls = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const isTableStart =
      /^\s*\|.*\|\s*$/.test(ls[i]) &&
      /^\s*\|[\s:|-]+\|\s*$/.test(ls[i + 1] ?? '');
    if (isTableStart && out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(ls[i]);
  }
  return out.join('\n');
}

interface RenderQuestionArgs {
  q: HandoutQuestion;
  sections: Record<string, string>;
  label: string;
  score: number | null;
  settings: HandoutSettings;
  ctx: TemplateVars;
  mapImage: (hash: string) => string;
}

/** 渲染单道题为 markdown 行数组 */
export function renderQuestionLines(args: RenderQuestionArgs): string[] {
  const { q, sections, label, score, settings, ctx, mapImage } = args;
  const raw = (sections['题目'] || '').trim();
  if (!raw) return [`${label}（内容加载失败）`];

  const type = q.type || '';
  let questionText = raw;
  const isMulti = type.includes('多选') || questionText.includes('[多选]');
  const isSingle = type.includes('单选') || questionText.includes('[选]');
  const isChoice = isSingle || isMulti;

  questionText = questionText
    .replace(/\[多选\]/g, '')
    .replace(/\[选\]/g, '')
    .replace(/\[填\]/g, '____')
    .trim();

  if (isChoice && !questionText.endsWith('()')) questionText += '()';

  questionText = rewriteImages(ensureBlankBeforeTable(questionText), mapImage);

  const scorePart = settings.showScore && score !== null ? `（${score}分）` : '';
  const multiPart = isMulti && settings.multiSelectMark ? '(多选)' : '';

  const lines: string[] = [];
  // 来源（显示在题目上方）
  if (settings.showSource) lines.push(`【来源】${q.source}${q.number}`);
  // 行首的 `1.` 会被 markdown 当成有序列表，需转义为 `1\.`
  const head = `${label}${multiPart}${scorePart}`.trim().replace(/^(\d{1,9})\./, '$1\\.');
  lines.push(`${head} ${questionText}`.trim());

  // 知识点（inline：题干末尾括注）
  if (settings.knowledgeMode === 'inline') {
    const k = renderTemplate(settings.knowledgeTemplate, ctx);
    if (k) lines[lines.length - 1] += `（${k}）`;
  }

  // 选项
  if (isChoice && sections['选项']) {
    const optRaw = sections['选项'];
    const opt = settings.optionLayout === 'four-in-line'
      ? mergeOptionLines(optRaw)
      : escapeListMarkers(optRaw);
    lines.push(rewriteImages(opt, mapImage));
  }

  // 知识点（below：每题下方独立一行）
  if (settings.knowledgeMode === 'below') {
    const k = renderTemplate(settings.knowledgeTemplate, ctx);
    if (k) lines.push(k);
  }

  // 答案 / 解析
  if (settings.answerPosition === 'afterEach') {
    if (sections['答案']) lines.push(`【答案】${rewriteImages(sections['答案'], mapImage)}`);
    if (settings.includeSolution && sections['解析']) {
      lines.push(`【解析】${rewriteImages(sections['解析'], mapImage)}`);
    }
  }

  // 备注
  if (settings.showRemark) {
    if (sections['我的备注']) lines.push(`【备注】${rewriteImages(sections['我的备注'], mapImage)}`);
    const ai = sections['AI 备注'] || sections['AI备注'];
    if (ai) lines.push(`【AI备注】${rewriteImages(ai, mapImage)}`);
  }

  return lines;
}

/* ============================ 卷头 ============================ */

export function renderHeader(settings: HandoutSettings, totalScore: number | null): string {
  const lines: string[] = [];
  if (settings.title) lines.push(`# ${settings.title}`);
  if (settings.subtitle) lines.push(`## ${settings.subtitle}`);

  const meta: string[] = [];
  if (settings.examTime) meta.push(`考试时间：${settings.examTime}`);
  const score = settings.fullScore || (totalScore !== null && totalScore > 0 ? String(totalScore) : '');
  if (score) meta.push(`满分：${score} 分`);
  if (meta.length) lines.push(meta.join('　　'));

  if (settings.sealLine) {
    lines.push('班级：______________　姓名：______________　考号：______________');
  }
  if (settings.headerNote) lines.push(settings.headerNote);

  return lines.join('\n\n');
}

/* ============================ 分页 ============================ */

/**
 * pandoc 的分页：用 raw openxml 块。
 * 浏览器端 docx 兜底会识别这段 fenced 代码并转成真正的分页符。
 */
export const PAGE_BREAK_MD = '\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n';

/* ============================ 主生成函数 ============================ */

export interface BuildOptions {
  blocks: Block[];
  settings: HandoutSettings;
  getQuestion: (qid: string) => QuestionSource | undefined;
  /** 参考答案区的标题（默认「参考答案」） */
  answersHeading?: string;
}

export interface BuildResult {
  markdown: string;
  /** 题库图片 hash 文件名 → 导出用新文件名（如 1-1.jpg） */
  imageMap: Map<string, string>;
  /** 全卷分值合计 */
  totalScore: number;
  /** 按最终顺序排列的题目（含最终题号与分值），供答案区 / 分析使用 */
  ordered: { qid: string; label: string; score: number | null }[];
}

/**
 * 唯一生成入口：Block[] + HandoutSettings → markdown。
 */
export function buildDocumentMarkdown(opts: BuildOptions): BuildResult {
  const { blocks, settings, getQuestion } = opts;
  const ordered = applyOrder(blocks, settings, (qid) => getQuestion(qid)?.q.type ?? '');
  const numberer = new Numberer(settings.numberStart, settings.numberStep);
  const imageMap = new Map<string, string>();

  const out: string[] = [];
  const collected: { qid: string; label: string; score: number | null }[] = [];
  const endAnswers: string[] = [];

  let qIndex = 0;
  /** 显式「答案区」块在输出中的插入位置（-1 = 未出现） */
  let answersSlot = -1;

  // 卷头（需要先算总分，因此延后拼接，这里先占位）
  const headerSlot = out.length;
  out.push('');

  for (const b of ordered) {
    switch (b.type) {
      case 'heading':
      case 'group': {
        if (settings.pageBreakBeforeGroup && (b.type === 'group' || b.level === 1)) {
          out.push(PAGE_BREAK_MD.trim());
        }
        const level = b.level;
        const n = b.autoNumber ? numberer.nextHeading(level) : 0;
        const title = formatHeading(level, n, b.text, b.autoNumber);
        out.push(`${'#'.repeat(level + 1)} ${title}`);
        if (b.type === 'group' || (settings.restartPerGroup && level === 1)) {
          numberer.resetQuestions();
        }
        out.push('');
        break;
      }
      case 'text': {
        if (b.content.trim()) {
          out.push(b.content.trim());
          out.push('');
        }
        break;
      }
      case 'pagebreak': {
        out.push(PAGE_BREAK_MD.trim());
        break;
      }
      case 'answers': {
        // 记录位置：文末答案区将插到这里（未插入该块时落到文档末尾）
        answersSlot = out.length;
        break;
      }
      case 'question': {
        const src = getQuestion(b.qid);
        qIndex += 1;

        const score = b.score ?? settings.defaultScore ?? null;

        // 始终推进自动计数，保证编号连续
        const autoN = numberer.nextQuestion();
        let numValue: string;
        if (settings.numberSource === 'origin' && src?.q.number) {
          numValue = settings.stripAlphaPrefix
            ? src.q.number.replace(/^[A-Za-z]+/, '')
            : src.q.number;
        } else {
          numValue = String(autoN);
        }
        const label = settings.showNumber ? formatNumber(settings.numberFormat, numValue) : '';

        if (!src) {
          out.push(`${label}（内容加载失败）`);
          out.push('');
          break;
        }

        const counter = new Map<number, number>();
        const mapImage = (hash: string): string => {
          const existed = imageMap.get(hash);
          if (existed) return existed;
          const ext = hash.split('.').pop() || 'jpg';
          const c = (counter.get(qIndex) || 0) + 1;
          counter.set(qIndex, c);
          const newName = `${qIndex}-${c}.${ext}`;
          imageMap.set(hash, newName);
          return newName;
        };

        const ctx = questionContext(src.q, qIndex, score);
        const lines = renderQuestionLines({
          q: src.q,
          sections: src.sections,
          label,
          score,
          settings,
          ctx,
          mapImage,
        });

        out.push(lines.join('\n'));

        collected.push({ qid: b.qid, label: label || String(autoN), score });

        if (settings.answerPosition === 'end') {
          const ans = src.sections['答案'];
          const sol = src.sections['解析'];
          const parts: string[] = [];
          if (ans) parts.push(`【答案】${rewriteImages(ans, mapImage)}`);
          if (settings.includeSolution && sol) parts.push(`【解析】${rewriteImages(sol, mapImage)}`);
          if (parts.length) endAnswers.push(`**${label || autoN}** ${parts.join(' ')}`);
        }

        // 间距
        if (settings.spacing === 'loose') out.push('', '');
        else if (settings.spacing === 'compact') { /* 单换行 */ }
        else out.push('');
        break;
      }
      default:
        break;
    }
  }

  // 文末统一答案区
  if (settings.answerPosition === 'end' && endAnswers.length > 0) {
    const section = ['', `## ${opts.answersHeading || '参考答案'}`, '', ...endAnswers];
    if (answersSlot >= 0 && answersSlot <= out.length) out.splice(answersSlot, 0, ...section);
    else out.push(...section);
  }

  // 总分
  const totalScore = collected.reduce((s, c) => s + (c.score || 0), 0);

  // 卷头回填
  if (settings.headerEnabled) {
    out[headerSlot] = renderHeader(settings, totalScore);
  } else {
    out.splice(headerSlot, 1);
  }

  // 压掉连续空行
  const markdown = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';

  return { markdown, imageMap, totalScore, ordered: collected };
}

/* ============================ 答题留白 ============================ */

/**
 * 按题型计算学生版应预留的答题高度（mm）。
 * 规则：先按题型取 base，再加全局 blankExtra；模块级 blankOverride 优先。
 */
export function blankHeightFor(
  type: string,
  settings: HandoutSettings,
  override?: number | null,
): number {
  if (override != null && override >= 0) return override;
  if (!settings.autoBlankByType) return Math.max(0, settings.blankExtra);
  const t = type || '';
  let base: number;
  if (t.includes('多选')) base = settings.blankHeights.multiple;
  else if (t.includes('单选') || t.includes('选择')) base = settings.blankHeights.single;
  else if (t.includes('填空')) base = settings.blankHeights.fill;
  else if (t.includes('解答') || t.includes('计算') || t.includes('证明')) base = settings.blankHeights.solve;
  else base = settings.blankHeights.fill;
  return Math.max(0, base + settings.blankExtra);
}

/* ============================ 试卷分析 ============================ */

export interface AnalysisBucket {
  label: string;
  count: number;
  score: number;
}

export interface HandoutAnalysis {
  total: number;
  totalScore: number;
  byType: AnalysisBucket[];
  byDifficulty: AnalysisBucket[];
  byKnowledge: AnalysisBucket[];
}

export function analyzeHandout(
  questions: HandoutQuestion[],
  scoreOf: (qid: string) => number | null,
): HandoutAnalysis {
  const byType = new Map<string, AnalysisBucket>();
  const byDifficulty = new Map<string, AnalysisBucket>();
  const byKnowledge = new Map<string, AnalysisBucket>();
  let totalScore = 0;

  const bump = (map: Map<string, AnalysisBucket>, key: string, score: number) => {
    const cur = map.get(key) || { label: key, count: 0, score: 0 };
    cur.count += 1;
    cur.score += score;
    map.set(key, cur);
  };

  for (const q of questions) {
    const score = scoreOf(q.qid) || 0;
    totalScore += score;
    bump(byType, q.type || '未标注', score);

    const d = q.difficulty;
    let dLabel = '未标注';
    if (d !== null && d !== undefined && isFinite(d)) {
      if (d < 0.4) dLabel = '难（<0.4）';
      else if (d < 0.7) dLabel = '中（0.4~0.7）';
      else dLabel = '易（≥0.7）';
    }
    bump(byDifficulty, dLabel, score);

    const ks = q.knowledge.length ? q.knowledge : ['未标注'];
    for (const k of ks) bump(byKnowledge, stripBracket(k), score);
  }

  const sortBuckets = (m: Map<string, AnalysisBucket>) =>
    [...m.values()].sort((a, b) => b.count - a.count);

  return {
    total: questions.length,
    totalScore,
    byType: sortBuckets(byType),
    byDifficulty: sortBuckets(byDifficulty),
    byKnowledge: sortBuckets(byKnowledge).slice(0, 20),
  };
}

/* ============================ 块操作工具 ============================ */

export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map(b => ({ ...b }));
}

/** 新建一个大题（level 1 + 分段编号） */
export function makeGroupBlock(text = ''): GroupBlock {
  return { id: newBlockId('g'), type: 'group', level: 1, text, autoNumber: true };
}

export function makeHeadingBlock(level: HeadingLevel = 2, text = ''): HeadingBlock {
  return { id: newBlockId('h'), type: 'heading', level, text, autoNumber: true };
}

export function makeTextBlock(content = ''): TextBlock {
  return { id: newBlockId('t'), type: 'text', content };
}

export function makePageBreakBlock(): PageBreakBlock {
  return { id: newBlockId('p'), type: 'pagebreak' };
}

export function makeAnswersBlock(): AnswersBlock {
  return { id: newBlockId('a'), type: 'answers' };
}

/**
 * 把「文档块」与「当前题目列表」对齐：
 *  - 题目被删除 → 移除对应 question 块
 *  - 题目新增 → 追加 question 块
 *  - 题目顺序变化 → 在原有槽位上重排 question 块
 * 非题目块（标题 / 文本 / 分页 / 答案区）保持原位。
 */
export function reconcileBlocks(
  prev: Block[],
  qids: string[],
  scoreOf: (qid: string) => number | undefined,
): Block[] {
  const alive = new Set(qids);
  let kept = prev.filter(b => b.type !== 'question' || alive.has(b.qid));

  const have = new Set(kept.filter(isQuestionBlock).map(b => b.qid));
  const missing = qids.filter(k => !have.has(k));
  if (missing.length) {
    kept = [
      ...kept,
      ...missing.map(k => ({ id: newBlockId('q'), type: 'question' as const, qid: k, score: scoreOf(k) })),
    ];
  }

  const slots: number[] = [];
  kept.forEach((b, i) => { if (isQuestionBlock(b)) slots.push(i); });

  const byQid = new Map<string, QuestionBlock>();
  kept.forEach(b => { if (isQuestionBlock(b) && !byQid.has(b.qid)) byQid.set(b.qid, b); });

  const next = [...kept];
  slots.forEach((slot, i) => {
    const q = byQid.get(qids[i]);
    if (q) next[slot] = q;
  });
  return next;
}

/** 移动块（拖拽 / 上移下移共用） */
export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
  const next = [...blocks];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

/* ============================================================
   讲义模块层（HandoutModule）
   ------------------------------------------------------------
   在既有 Block[] 之上包一层「具名模块」外壳，用于「编讲义」页：
   总标题 / 知识点标题 / 知识点讲解 / 例题讲解 / 真题练习 / 自由文本 / 分页。
   模块最终被 **展开（flatten）** 为 Block[] 交给既有 buildDocumentMarkdown，
   因此渲染与导出逻辑完全复用，不改动既有管线。
   ============================================================ */

export type ModuleKind =
  | 'title'
  | 'knowTitle'
  | 'knowExplain'
  | 'example'
  | 'variation'
  | 'practice'
  | 'method'
  | 'callout'
  | 'text'
  | 'pagebreak';

export interface ModuleMeta {
  kind: ModuleKind;
  label: string;
  icon: string;
  /** 该模块是否为「可挂题」的容器（例题 / 真题练习） */
  holdsQuestions: boolean;
  /** 是否含标题输入框 */
  hasTitle: boolean;
  /** 是否含正文编辑区 */
  hasBody: boolean;
  /** 默认是否自动编号 */
  defaultAutoNumber: boolean;
  /** 是否默认在模块前分页 */
  defaultPageBreak: boolean;
}

export const MODULE_META: Record<ModuleKind, ModuleMeta> = {
  title: {
    kind: 'title',
    label: '总标题',
    icon: '🏷️',
    holdsQuestions: false,
    hasTitle: true,
    hasBody: true,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
  knowTitle: {
    kind: 'knowTitle',
    label: '知识点标题',
    icon: '📌',
    holdsQuestions: false,
    hasTitle: true,
    hasBody: false,
    defaultAutoNumber: true,
    defaultPageBreak: false,
  },
  knowExplain: {
    kind: 'knowExplain',
    label: '知识点讲解',
    icon: '📖',
    holdsQuestions: false,
    hasTitle: true,
    hasBody: true,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
  example: {
    kind: 'example',
    label: '例题讲解',
    icon: '💡',
    holdsQuestions: true,
    hasTitle: true,
    hasBody: false,
    defaultAutoNumber: true,
    defaultPageBreak: false,
  },
  practice: {
    kind: 'practice',
    label: '真题练习',
    icon: '✏️',
    holdsQuestions: true,
    hasTitle: true,
    hasBody: false,
    defaultAutoNumber: true,
    defaultPageBreak: false,
  },
  variation: {
    kind: 'variation',
    label: '变式训练',
    icon: '🔀',
    holdsQuestions: true,
    hasTitle: true,
    hasBody: false,
    defaultAutoNumber: true,
    defaultPageBreak: false,
  },
  method: {
    kind: 'method',
    label: '方法总结',
    icon: '🧭',
    holdsQuestions: false,
    hasTitle: true,
    hasBody: true,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
  callout: {
    kind: 'callout',
    label: '提示框',
    icon: '💬',
    holdsQuestions: false,
    hasTitle: true,
    hasBody: true,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
  text: {
    kind: 'text',
    label: '自由文本',
    icon: '📝',
    holdsQuestions: false,
    hasTitle: false,
    hasBody: true,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
  pagebreak: {
    kind: 'pagebreak',
    label: '分页符',
    icon: '⤵',
    holdsQuestions: false,
    hasTitle: false,
    hasBody: false,
    defaultAutoNumber: false,
    defaultPageBreak: false,
  },
};

export interface HandoutModule {
  id: string;
  kind: ModuleKind;
  /** 模块标题（如「一、导数的概念」） */
  title: string;
  /** 正文内容（知识点讲解 / 自由文本 / 总标题副标题） */
  body: string;
  /** 该模块下的题目（有序），仅 holdsQuestions 模块使用 */
  qids: string[];
  /** 每个 qid 的分值（仅存于文档模型，不写回题库） */
  scores: Record<string, number>;
  /** 标题是否自动编号 */
  autoNumber: boolean;
  /** 模块前是否插入分页 */
  pageBreak: boolean;
  /** 折叠状态（仅 UI） */
  collapsed?: boolean;
  /** v2.2：提示框的语气（仅 kind === 'callout' 使用） */
  calloutVariant?: 'tip' | 'warn' | 'note';
  /** v2.2：本模块的学生版答题留白覆写（mm，null/undefined = 用全局规则） */
  blankOverride?: number | null;
}

export function makeModule(kind: ModuleKind): HandoutModule {
  const meta = MODULE_META[kind];
  return {
    id: newBlockId(`m_${kind}`),
    kind,
    title: '',
    body: '',
    qids: [],
    scores: {},
    autoNumber: meta.defaultAutoNumber,
    pageBreak: meta.defaultPageBreak,
    collapsed: false,
  };
}

/** 模块默认标题（新建时给个占位文案，方便识别） */
export function defaultModuleTitle(kind: ModuleKind): string {
  switch (kind) {
    case 'title':
      return '';
    case 'knowTitle':
      return '知识点标题';
    case 'knowExplain':
      return '知识点讲解';
    case 'example':
      return '例题讲解';
    case 'variation':
      return '变式训练';
    case 'practice':
      return '真题练习';
    case 'method':
      return '方法总结';
    case 'callout':
      return '提示';
    default:
      return '';
  }
}

/** 模块 → Block[]（展开）。标题映射到 heading/group，正文映射到 text。 */
export function moduleToBlocks(m: HandoutModule, moduleIndex: number): Block[] {
  const meta = MODULE_META[m.kind];
  const out: Block[] = [];

  if (m.pageBreak) out.push(makePageBreakBlock());

  switch (m.kind) {
    case 'title': {
      // 总标题：用 level 1 heading 作为大标题，正文作为副标题段落
      if (m.title.trim()) {
        out.push({
          ...makeHeadingBlock(1, m.title.trim()),
          autoNumber: false,
        });
      }
      const subtitle = m.body.trim();
      if (subtitle) out.push(makeTextBlock(subtitle));
      break;
    }
    case 'knowTitle': {
      // 知识点标题：level 2
      if (m.title.trim()) {
        out.push({
          ...makeHeadingBlock(2, m.title.trim()),
          autoNumber: m.autoNumber,
        });
      }
      break;
    }
    case 'knowExplain': {
      if (m.title.trim()) {
        out.push({
          ...makeHeadingBlock(3, m.title.trim()),
          autoNumber: false,
        });
      }
      if (m.body.trim()) out.push(makeTextBlock(m.body.trim()));
      break;
    }
    case 'example':
    case 'variation':
    case 'practice': {
      // 可挂题容器：标题映射为「大题」块（level 1 + 分段编号）
      const title = m.title.trim() || meta.label;
      out.push({
        ...makeGroupBlock(title),
        autoNumber: m.autoNumber,
      });
      for (const qid of m.qids) {
        out.push({
          id: newBlockId('q'),
          type: 'question',
          qid,
          score: m.scores[qid],
        });
      }
      break;
    }
    case 'method': {
      if (m.title.trim()) {
        out.push({ ...makeHeadingBlock(3, m.title.trim()), autoNumber: false });
      }
      if (m.body.trim()) out.push(makeTextBlock(m.body.trim()));
      break;
    }
    case 'callout': {
      const kindTag = m.calloutVariant === 'warn' ? '易错' : m.calloutVariant === 'tip' ? '提示' : '注';
      const title = m.title.trim() || kindTag;
      out.push({ ...makeHeadingBlock(3, `【${title}】`), autoNumber: false });
      if (m.body.trim()) out.push(makeTextBlock(m.body.trim()));
      break;
    }
    case 'text': {
      if (m.body.trim()) out.push(makeTextBlock(m.body.trim()));
      break;
    }
    case 'pagebreak': {
      out.push(makePageBreakBlock());
      break;
    }
  }

  void moduleIndex;
  return out;
}

/** 模块数组 → 扁平 Block[] */
export function flattenModules(modules: HandoutModule[]): Block[] {
  const out: Block[] = [];
  modules.forEach((m, i) => {
    out.push(...moduleToBlocks(m, i));
  });
  return out;
}

/** 收集模块中所有题目 qid（按模块顺序） */
export function moduleQids(modules: HandoutModule[]): string[] {
  const out: string[] = [];
  for (const m of modules) {
    if (MODULE_META[m.kind].holdsQuestions) out.push(...m.qids);
  }
  return out;
}

/** 从扁平 Block[] 反推模块（用于兼容旧草稿 / 迁移） */
export function blocksToModules(blocks: Block[]): HandoutModule[] {
  const modules: HandoutModule[] = [];
  let cur: HandoutModule | null = null;

  for (const b of blocks) {
    if (b.type === 'question') {
      if (!cur || !MODULE_META[cur.kind].holdsQuestions) {
        cur = makeModule('practice');
        cur.title = cur.title || '真题练习';
        modules.push(cur);
      }
      cur.qids.push(b.qid);
      if (b.score != null) cur.scores[b.qid] = b.score;
      continue;
    }
    if (b.type === 'heading') {
      if (b.level === 1) {
        cur = makeModule('knowTitle');
      } else if (b.level === 2) {
        cur = makeModule('knowTitle');
      } else {
        cur = makeModule('knowExplain');
      }
      cur.title = b.text;
      cur.autoNumber = b.autoNumber;
      modules.push(cur);
      continue;
    }
    if (b.type === 'group') {
      cur = makeModule('practice');
      cur.title = b.text;
      cur.autoNumber = b.autoNumber;
      modules.push(cur);
      continue;
    }
    if (b.type === 'text') {
      if (cur && MODULE_META[cur.kind].hasBody) {
        cur.body = cur.body ? `${cur.body}\n\n${b.content}` : b.content;
      } else {
        const m = makeModule('text');
        m.body = b.content;
        modules.push(m);
        cur = m;
      }
      continue;
    }
    if (b.type === 'pagebreak') {
      const m = makeModule('pagebreak');
      modules.push(m);
      cur = m;
      continue;
    }
    if (b.type === 'answers') {
      // 旧「答案区」块：转为自由文本提示，避免丢失
      const m = makeModule('text');
      m.body = '（此处为参考答案区）';
      modules.push(m);
      cur = m;
    }
  }
  return modules;
}
