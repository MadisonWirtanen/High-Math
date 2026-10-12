/**
 * src/lib/ingest.ts — 题目入库核心逻辑（被 /api/add-questions 与 /api/import 共用）
 */

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { resolveBankDir, sanitizeFileName } from './paths';
import { getConfig } from './config';
import { invalidateMetaCache } from './questions';

export interface IngestQuestion {
  content: string;
  source: string;
  number: string;
  type: string;
  grade?: string;
  semester?: string;
  exam_type?: string;
  difficulty?: number | null;
  /** 一级：章 */
  chapter?: string[];
  /** 二级：节 */
  section?: string[];
  /** 三级：知识点 */
  knowledge?: string[];
  tags?: string[];
}

/**
 * 入库自动标准化图片语法
 * 1. Obsidian ![[images/xxx|宽度]] → ![宽度](images/xxx.jpg)
 * 2. 无宽度Obsidian图 ![[images/xxx]] → 默认400宽 ![400](images/xxx.jpg)
 * 3. 简写图片 ![任意文字](xxx.jpg) → ![400](images/xxx.jpg)
 */
export function normalizeImageSyntax(text: string): string {
  if (!text) return text;
  text = text.replace(/!\[\[images\/([^\]|]+)\|(\d+)\]\]/g, (_, hash, width) => `![${width}](images/${hash})`);
  text = text.replace(/!\[\[images\/([^\]]+)\]\]/g, (_, hash) => `![400](images/${hash})`);
  text = text.replace(/!\[[^\]]*\]\((?!images\/)([^)]+\.(jpg|png|jpeg|webp|gif|svg))\)/g, (_, hash) => `![400](images/${hash})`);
  return text;
}

/** 计算题目文件路径（运行期解析题库目录 + 跨平台文件名净化） */
export function buildFilePath(source: string, number: string, qid?: number): string {
  const bankPath = resolveBankDir(getConfig());
  const safeSource = source ? sanitizeFileName(source) : '';
  const safeNumber = number ? sanitizeFileName(number) : '';
  const dirName = safeSource || '未分类';
  const parts = [safeSource, safeNumber].filter(Boolean);
  const baseName = parts.length > 0 ? parts.join('-') : String(qid);
  return path.join(bankPath, dirName, `${baseName}.md`);
}

export interface ConflictItem {
  index: number;
  number: string;
  source: string;
  fileName: string;
  filePath: string;
}

/** 检查哪些题目文件已存在 */
export function checkConflicts(questions: IngestQuestion[]): ConflictItem[] {
  const dummyQid = Date.now();
  const conflicts: ConflictItem[] = [];
  questions.forEach((q, i) => {
    const filePath = buildFilePath(q.source, q.number, dummyQid);
    if (fs.existsSync(filePath)) {
      conflicts.push({
        index: i,
        number: q.number,
        source: q.source,
        fileName: path.basename(filePath),
        filePath,
      });
    }
  });
  return conflicts;
}

export interface WriteResult {
  qid: number;
  number: string;
  source: string;
  filePath?: string;
  skipped?: boolean;
  error?: string;
}

/** 实际写入题目 */
export function writeQuestions(
  questions: IngestQuestion[],
  onConflict: 'skip' | 'overwrite' = 'skip'
): WriteResult[] {
  const results: WriteResult[] = [];
  let lastQid = Date.now();

  for (const q of questions) {
    try {
      const now = Date.now();
      const qid = now > lastQid ? now : lastQid + 1;
      lastQid = qid;

      const filePath = buildFilePath(q.source, q.number, qid);
      const exists = fs.existsSync(filePath);

      if (exists && onConflict === 'skip') {
        results.push({ qid, number: q.number, source: q.source, skipped: true, filePath });
        continue;
      }

      // 覆盖前备份
      if (exists) {
        try {
          fs.copyFileSync(filePath, `${filePath}.bak`);
        } catch { /* 忽略 */ }
      }

      const yaml: Record<string, any> = {
        qid,
        grade: q.grade || getConfig().defaultGrade,
        source: q.source,
        number: q.number,
        type: q.type,
        difficulty: q.difficulty ?? '',
        semester: q.semester || '',
        exam_type: q.exam_type || '',
        chapter: q.chapter || [],
        section: q.section || [],
        knowledge: q.knowledge || [],
        ai_tags: [],
        tags: q.tags || [],
        status: '待入库',
        selected: false,
      };

      // 剥离残留 YAML
      let cleanContent = (q.content || '').trim();
      if (cleanContent.startsWith('---\n')) {
        const endIdx = cleanContent.indexOf('\n---\n', 4);
        if (endIdx !== -1) cleanContent = cleanContent.slice(endIdx + 5).trim();
      }

      cleanContent = normalizeImageSyntax(cleanContent);

      const frontmatter = matter.stringify(cleanContent, yaml);
      const outDir = path.dirname(filePath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(filePath, frontmatter, 'utf-8');

      results.push({ qid, number: q.number, source: q.source, filePath });
    } catch (err: any) {
      results.push({ qid: 0, number: q.number, source: q.source, error: err.message });
    }
  }

  invalidateMetaCache();
  return results;
}
