import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import fsAsync from 'fs/promises';
import { resolveBankDir } from './paths';
import { getConfig } from './config';

/** 当前题库目录（运行期解析，不再写死） */
function bankPath(): string {
  return resolveBankDir(getConfig());
}

// 轻量元数据（不含正文，用于首页表格）
export interface QuestionMetaLight {
  qid: number;
  grade: string;
  source: string;
  number: string;
  type: string;
  exam_type: string;
  semester: string;
  filePath: string;
  difficulty: number;
  /** 一级：章 */
  chapter: string[];
  /** 二级：节 */
  section: string[];
  /** 三级：知识点 */
  knowledge: string[];
  tags: string[];
}

// 完整题目（含正文，用于展开详情和讲义）
export interface QuestionMeta extends QuestionMetaLight {
  content: string;
}

/** 解析题目的 Markdown 正文为各个 section（题目、答案、解析等） */
export function parseSections(raw: string): Record<string, string> {
  raw = raw.replace(/\r\n/g, '\n');
  const result: Record<string, string> = {};
  const parts = raw.split(/\n(?=## )/);
  for (const block of parts) {
    const m = block.match(/^## (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const body = m[2].trim();
    if (title === '备注') {
      const subs = body.split(/\n(?=### )/);
      let noteBody = '';
      for (const sub of subs) {
        const sm = sub.match(/^### (.+?)\n([\s\S]*)$/);
        if (sm) {
          result[sm[1].trim()] = sm[2].trim();
        } else {
          noteBody += sub;
        }
      }
      if (noteBody.trim()) result['备注'] = noteBody.trim();
    } else {
      result[title] = body;
    }
  }
  return result;
}

/** 把 YAML 里的 knowledge / tags 规范化成字符串数组 */
function toStringArray(v: any): string[] {
  return (Array.isArray(v) ? v : [v])
    .filter(Boolean)
    .map((x: any) => (typeof x === 'string' ? x : String(x)));
}

/** 从 gray-matter 解析结果组装 QuestionMetaLight */
function toMeta(data: Record<string, any>, filePath: string): QuestionMetaLight {
  return {
    qid: data.qid,
    grade: data.grade || '',
    source: data.source || '',
    number: data.number || '',
    type: data.type || '',
    exam_type: data.exam_type || '',
    semester: data.semester || '',
    filePath,
    difficulty: data.difficulty ?? 0,
    chapter: toStringArray(data.chapter),
    section: toStringArray(data.section),
    knowledge: toStringArray(data.knowledge),
    tags: toStringArray(data.tags),
  };
}

// 内存缓存：避免每次请求都重读 5000+ 文件
let _metaCache: QuestionMetaLight[] | null = null;
let _metaCacheBank: string | null = null;

/** 清空缓存（新增/修改题目、切换题库目录后调用） */
export function invalidateMetaCache(): void {
  _metaCache = null;
  _metaCacheBank = null;
}

/** 列出题库下所有「来源目录」 */
function listSourceDirs(bank: string): string[] {
  if (!fs.existsSync(bank)) return [];
  return fs
    .readdirSync(bank)
    .filter(name => {
      try {
        return fs.statSync(path.join(bank, name)).isDirectory();
      } catch {
        return false;
      }
    });
}

/** 判断是否为题目文件（兼容 .md / .MD，排除 .bak） */
function isQuestionFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.bak')) return false;
  return lower.endsWith('.md');
}

/** 扫描题库，只返回元数据（不含 content 正文） */
export function scanAllQuestionsMeta(): QuestionMetaLight[] {
  const bank = bankPath();

  // 缓存命中（且题库目录未变）
  if (_metaCache && _metaCacheBank === bank) return _metaCache;

  const results: QuestionMetaLight[] = [];

  for (const dirName of listSourceDirs(bank)) {
    const dirPath = path.join(bank, dirName);
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      const filePath = path.join(dirPath, fileName);

      let data: Record<string, any>;
      try {
        data = matter(fs.readFileSync(filePath, 'utf-8')).data;
      } catch {
        console.warn(`YAML 解析失败，跳过: ${filePath}`);
        continue;
      }
      if (data.qid) results.push(toMeta(data, filePath));
    }
  }

  results.sort((a, b) => b.qid - a.qid);
  _metaCache = results;
  _metaCacheBank = bank;
  return results;
}

/** 扫描题库，返回完整题目（含 content 正文） */
export function scanAllQuestions(): QuestionMeta[] {
  const bank = bankPath();
  const results: QuestionMeta[] = [];

  for (const dirName of listSourceDirs(bank)) {
    const dirPath = path.join(bank, dirName);
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      const filePath = path.join(dirPath, fileName);

      let data: Record<string, any>;
      let body = '';
      try {
        const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
        data = parsed.data;
        body = parsed.content;
      } catch {
        console.warn(`YAML 解析失败，跳过: ${filePath}`);
        continue;
      }
      if (data.qid) results.push({ ...toMeta(data, filePath), content: body.trim() });
    }
  }

  results.sort((a, b) => b.qid - a.qid);
  return results;
}

/** 根据 qid 读取单道题的完整内容 */
export function getQuestionByQid(qid: number): QuestionMeta | null {
  const bank = bankPath();

  for (const dirName of listSourceDirs(bank)) {
    const dirPath = path.join(bank, dirName);
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      const filePath = path.join(dirPath, fileName);

      let data: Record<string, any>;
      let body = '';
      try {
        const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
        data = parsed.data;
        body = parsed.content;
      } catch {
        continue;
      }
      if (data.qid === qid) {
        return { ...toMeta(data, filePath), content: body.trim() };
      }
    }
  }
  return null;
}

/**
 * 根据 qid 读取【完整原始 Markdown 全文】（含 ---YAML + 所有 ## 章节）
 */
export async function getFullQuestionMarkdownByQid(qid: number): Promise<string> {
  const bank = bankPath();

  for (const dirName of await fsAsync.readdir(bank).catch(() => [] as string[])) {
    const dirPath = path.join(bank, dirName);
    const stat = await fsAsync.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    for (const fileName of await fsAsync.readdir(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      const filePath = path.join(dirPath, fileName);
      const rawText = await fsAsync.readFile(filePath, 'utf8');
      if (matter(rawText).data.qid === qid) return rawText;
    }
  }

  return `---\nqid: ${qid}\n---\n## 题目\n【qid:${qid} 题目文件不存在】`;
}

/** 根据 qid 获取轻量元数据（异步版） */
export async function getQuestionMeta(qid: number): Promise<QuestionMetaLight | null> {
  const bank = bankPath();

  for (const dirName of await fsAsync.readdir(bank).catch(() => [] as string[])) {
    const dirPath = path.join(bank, dirName);
    const stat = await fsAsync.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    for (const fileName of await fsAsync.readdir(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      const filePath = path.join(dirPath, fileName);
      const rawText = await fsAsync.readFile(filePath, 'utf8');
      const data = matter(rawText).data;
      if (data.qid === qid) return toMeta(data, filePath);
    }
  }
  return null;
}

/** 根据 qid 拆分所有章节 sections（异步版） */
export async function getQuestionSections(qid: number): Promise<Record<string, string>> {
  const fullMd = await getFullQuestionMarkdownByQid(qid);
  return parseSections(matter(fullMd).content);
}

/** 题库统计（设置页 / 校验接口用） */
export interface BankStats {
  bankDir: string;
  bankDirExists: boolean;
  questionCount: number;
  sourceCount: number;
  sources: string[];
}

export function scanBankStats(): BankStats {
  const bank = bankPath();
  const exists = fs.existsSync(bank) && fs.statSync(bank).isDirectory();
  if (!exists) {
    return { bankDir: bank, bankDirExists: false, questionCount: 0, sourceCount: 0, sources: [] };
  }

  let questionCount = 0;
  const sources = listSourceDirs(bank);
  for (const dirName of sources) {
    const dirPath = path.join(bank, dirName);
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!isQuestionFile(fileName)) continue;
      questionCount++;
    }
  }
  return { bankDir: bank, bankDirExists: true, questionCount, sourceCount: sources.length, sources };
}
