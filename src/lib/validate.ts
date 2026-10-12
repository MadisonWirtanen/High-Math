/**
 * src/lib/validate.ts — 录入前的题目校验
 *
 * 用于批量导入（拖入 .md）时的 dry-run 检查，也可复用于单题粘贴。
 * 校验分两级：error（结构性问题，会阻断入库） / warning（可疑，但允许入库）。
 *
 * 三级知识点（chapter / section / knowledge）按《知识点总表》校验，
 * 并检查「章 → 节 → 知识点」的包含关系是否成立。
 */

import matter from 'gray-matter';
import { parseSections } from './questions';
import { validateTaxonomy } from './knowledge';

const VALID_TYPES = ['单选题', '多选题', '填空题', '解答题'];

export interface QuestionDraft {
  name: string;
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
  /** 三级：知识点 */
  knowledge: string[];
  tags: string[];
  content: string;
  qid?: number;
}

export interface ValidationResult {
  index: number;
  name: string;
  errors: string[];
  warnings: string[];
  draft: QuestionDraft | null;
}

function toStringArray(v: any): string[] {
  return (Array.isArray(v) ? v : [v]).filter(Boolean).map((x: any) => String(x));
}

/** 校验一份「单题 markdown」（含 --- YAML --- 与 ## 章节） */
export function validateQuestionMarkdown(raw: string, name: string, index: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = raw.replace(/\r\n/g, '\n').trim();

  // 1. YAML frontmatter
  if (!text.startsWith('---')) {
    errors.push('缺少 YAML frontmatter（文件需以 --- 开头）');
  }
  let data: Record<string, any> = {};
  let body = text;
  try {
    const parsed = matter(text);
    data = parsed.data || {};
    body = parsed.content || '';
  } catch (e) {
    errors.push(`YAML 解析失败：${(e as Error).message}`);
  }

  // 2. 章节
  const sections = parseSections(body);
  if (!sections['题目']) errors.push('缺少「## 题目」章节');

  // 3. 题型
  const type = String(data.type || '').trim();
  if (!type) errors.push('缺少 type（题型）');
  else if (!VALID_TYPES.includes(type)) errors.push(`type 非法：「${type}」，应为 ${VALID_TYPES.join('/')}`);

  // 4. 题型与标记匹配
  const qText = sections['题目'] || '';
  const hasXuan = /\[选\]/.test(qText);
  const hasTian = /\[填\]/.test(qText);
  if (type === '单选题' || type === '多选题') {
    if (!hasXuan) errors.push('选择题题干缺少 [选] 标记');
    if (hasTian) warnings.push('选择题题干出现 [填] 标记，请确认题型');
  } else if (type === '填空题') {
    if (!hasTian) errors.push('填空题题干缺少 [填] 标记');
    if (hasXuan) warnings.push('填空题题干出现 [选] 标记，请确认题型');
  }

  // [选]/[填] 不应出现在 $...$ 内部
  const mathRegions = qText.match(/\$[^$]*\$/g) || [];
  if (mathRegions.some(r => r.includes('[选]') || r.includes('[填]'))) {
    warnings.push('[选]/[填] 出现在 $...$ 数学环境内部，可能导致渲染异常');
  }

  // 5. 选项
  if ((type === '单选题' || type === '多选题') && !sections['选项']) {
    warnings.push('选择题缺少「## 选项」章节');
  }
  if (type === '填空题' && sections['选项']) {
    warnings.push('填空题不应有「## 选项」章节');
  }

  // 6. 答案 / 解析
  if (!sections['答案']) warnings.push('缺少「## 答案」章节');
  if (!sections['解析']) warnings.push('缺少「## 解析」章节');

  // 7. 三级知识点校验（章 / 节 / 知识点）
  const chapter = toStringArray(data.chapter);
  const section = toStringArray(data.section);
  const knowledge = toStringArray(data.knowledge);

  if (chapter.length === 0) warnings.push('chapter（章）为空');
  if (section.length === 0) warnings.push('section（节）为空');
  if (knowledge.length === 0) warnings.push('knowledge 为空（建议从知识点总表中选择）');

  const tax = validateTaxonomy(chapter, section, knowledge);
  if (tax.skipped) {
    warnings.push('未找到知识点总表，跳过三级知识点校验');
  } else {
    if (tax.unknownChapters.length > 0) {
      warnings.push(`章不在总表中：${tax.unknownChapters.join('、')}`);
    }
    if (tax.unknownSections.length > 0) {
      warnings.push(`节不在总表中：${tax.unknownSections.join('、')}`);
    }
    if (tax.unknownKnowledge.length > 0) {
      warnings.push(`疑似自造知识点（不在总表中）：${tax.unknownKnowledge.join('、')}`);
    }
    if (tax.sectionChapterMismatch.length > 0) {
      warnings.push(`节与章的隶属关系不成立（该节不属于所列任何一章）：${tax.sectionChapterMismatch.join('、')}`);
    }
    if (tax.knowledgeSectionMismatch.length > 0) {
      warnings.push(`知识点与节的隶属关系不成立（该知识点不属于所列任何一节）：${tax.knowledgeSectionMismatch.join('、')}`);
    }
    // 知识点本身都合法时，给出可纠正的推导结果
    if (tax.unknownKnowledge.length === 0 && tax.derivedChapters.length > 0) {
      const missingCh = tax.derivedChapters.filter(c => !chapter.includes(c));
      if (missingCh.length > 0) {
        warnings.push(`按知识点反推，chapter 还应包含：${missingCh.join('、')}`);
      }
      const missingSec = tax.derivedSections.filter(s => !section.includes(s));
      if (missingSec.length > 0) {
        warnings.push(`按知识点反推，section 还应包含：${missingSec.join('、')}`);
      }
    }
  }

  // 8. 其他字段
  const source = String(data.source || '').trim();
  const number = String(data.number || '').trim();
  if (!source) warnings.push('source（来源）为空，将归入「未分类」目录');
  if (!number) warnings.push('number（题号）为空');
  const difficulty = data.difficulty != null && data.difficulty !== '' ? Number(data.difficulty) : null;
  if (difficulty === null) warnings.push('difficulty（难度）为空');
  else if (isNaN(difficulty) || difficulty < 0 || difficulty > 1) {
    warnings.push(`difficulty 取值异常：${data.difficulty}（应在 0~1 之间）`);
  }

  const draft: QuestionDraft = {
    name,
    source,
    number,
    type,
    grade: String(data.grade || '').trim(),
    semester: String(data.semester || '').trim(),
    exam_type: String(data.exam_type || '').trim(),
    difficulty,
    chapter,
    section,
    knowledge,
    tags: toStringArray(data.tags),
    content: body.trim(),
  };

  return { index, name, errors, warnings, draft: errors.length === 0 ? draft : null };
}

/**
 * 把一份「整卷 markdown」（多题用 ========== 分隔）拆成单题并校验。
 */
export function splitAndValidate(fullMarkdown: string, fallbackName = 'question'): ValidationResult[] {
  const text = fullMarkdown.replace(/\r\n/g, '\n');
  const blocks = text.split(/\n?={10,}\n?/).map(b => b.trim()).filter(Boolean);
  return blocks.map((b, i) => validateQuestionMarkdown(b, `${fallbackName}#${i + 1}`, i));
}
