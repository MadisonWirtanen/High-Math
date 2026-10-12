/**
 * 题目文本解析（共享）
 * ============================================================
 * 把「YAML frontmatter + `## 题目/选项/备注/答案/解析` 分节」的题目文本，
 * 解析为结构化对象。试题篮、编讲义、添加题目三处共用。
 *
 * ⚠️ 只读：本模块不写题库，只做文本解析。
 */

import { toStrArray, type HandoutQuestion } from './handout';

export type YamlValue = string | string[];
export type Yaml = Record<string, YamlValue>;

/** 题目块分隔符（历史格式兼容） */
export const QUESTION_SEP = '\n\n==========\n\n';
const SEP_RE = /\n?==========\n?/g;

export interface ParsedQuestion {
  key: string;
  qid: string;
  sections: Record<string, string>;
  yaml: Yaml;
  raw: string;
  startIndex: number;
  endIndex: number;
}

/** 把 YAML 值安全地转成字符串 */
export function yamlStr(v: YamlValue | undefined): string {
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join('、') : String(v);
}

/** 解析单道题（不含分隔符切分） */
export function parseOneQuestion(rawInput: string): {
  yaml: Yaml;
  body: string;
  sections: Record<string, string>;
} {
  const trimmed = rawInput.replace(/\r\n?/g, '\n');
  const yaml: Yaml = {};
  let body = trimmed;

  try {
    const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---\n/);
    if (fmMatch) {
      body = trimmed.slice(fmMatch[0].length);
      fmMatch[1].split('\n').forEach((line) => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const raw = line.slice(colonIdx + 1).trim();
          yaml[key] =
            raw.startsWith('[') && raw.endsWith(']')
              ? raw
                  .slice(1, -1)
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : raw;
        }
      });
    }
  } catch {
    /* 解析失败忽略 */
  }

  const sections: Record<string, string> = {};
  const parts = body.split(/\n(?=## )/);
  for (const part of parts) {
    const m = part.match(/^## (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const content = m[2].trim();
    if (title === '备注') {
      const subs = content.split(/\n(?=### )/);
      for (const sub of subs) {
        const sm = sub.match(/^### (.+?)\n([\s\S]*)$/);
        if (sm) sections[sm[1].trim()] = sm[2].trim();
      }
    } else {
      sections[title] = content;
    }
  }

  return { yaml, body, sections };
}

/** 按分隔符切分并解析多道题 */
export function parseQuestions(text: string): ParsedQuestion[] {
  const results: ParsedQuestion[] = [];
  const usedKeys = new Set<string>();
  let blockStart = 0;
  let match: RegExpExecArray | null;

  const push = (block: string, start: number, end: number) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    const parsed = parseOneQuestion(trimmed);
    const qid = yamlStr(parsed.yaml.qid);
    let key = qid || `i${results.length}`;
    while (usedKeys.has(key)) key = `${key}_${results.length}`;
    usedKeys.add(key);
    results.push({ ...parsed, key, qid, raw: trimmed, startIndex: start, endIndex: end });
  };

  SEP_RE.lastIndex = 0;
  while ((match = SEP_RE.exec(text)) !== null) {
    push(text.slice(blockStart, match.index), blockStart, match.index);
    blockStart = match.index + match[0].length;
  }
  push(text.slice(blockStart), blockStart, text.length);
  return results;
}

export function questionsToText(questions: ParsedQuestion[]): string {
  return questions.map((q) => q.raw).join(QUESTION_SEP);
}

/** 映射为讲义生成器需要的题目结构 */
export function toHandoutQuestion(p: ParsedQuestion): HandoutQuestion {
  const y = p.yaml;
  const diffRaw = yamlStr(y.difficulty);
  const diff = diffRaw !== '' ? Number(diffRaw) : NaN;
  return {
    qid: p.key,
    source: yamlStr(y.source),
    number: yamlStr(y.number),
    type: yamlStr(y.type),
    grade: yamlStr(y.grade),
    semester: yamlStr(y.semester),
    exam_type: yamlStr(y.exam_type),
    difficulty: isFinite(diff) ? diff : null,
    chapter: toStrArray(y.chapter),
    section: toStrArray(y.section),
    knowledge: toStrArray(y.knowledge),
    tags: toStrArray(y.tags),
  };
}
