import { NextRequest } from 'next/server';
import { splitAndValidate } from '@/lib/validate';
import { checkConflicts, writeQuestions, IngestQuestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ImportFile {
  name: string;
  content: string;
}

/**
 * POST /api/import
 * body: {
 *   files: [{ name, content }],   // 每个文件是一份 markdown（单题或整卷，用 ========== 分隔）
 *   dryRun?: boolean,             // true=只校验不写盘
 *   onConflict?: 'skip'|'overwrite'
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const files: ImportFile[] = Array.isArray(body.files) ? body.files : [];
    const dryRun: boolean = body.dryRun !== false; // 默认 dry-run，更安全
    const onConflict: 'skip' | 'overwrite' = body.onConflict === 'overwrite' ? 'overwrite' : 'skip';

    if (files.length === 0) {
      return Response.json({ error: '没有收到任何文件' }, { status: 400 });
    }

    // ===== 逐文件拆分 + 校验 =====
    const items: {
      file: string;
      index: number;
      name: string;
      source: string;
      number: string;
      type: string;
      errors: string[];
      warnings: string[];
      draft: IngestQuestion | null;
    }[] = [];

    for (const f of files) {
      const results = splitAndValidate(f.content || '', f.name || 'file');
      for (const r of results) {
        items.push({
          file: f.name,
          index: r.index,
          name: r.name,
          source: r.draft?.source ?? '',
          number: r.draft?.number ?? '',
          type: r.draft?.type ?? '',
          errors: r.errors,
          warnings: r.warnings,
          draft: r.draft,
        });
      }
    }

    const errorCount = items.filter(i => i.errors.length > 0).length;
    const warningCount = items.filter(i => i.errors.length === 0 && i.warnings.length > 0).length;
    const okItems = items.filter(i => i.errors.length === 0);

    const summary = {
      total: items.length,
      ok: okItems.length,
      withErrors: errorCount,
      withWarnings: warningCount,
    };

    // ===== dry-run：只返回报告 =====
    if (dryRun) {
      return Response.json({ dryRun: true, summary, items });
    }

    // ===== 实际写入 =====
    if (okItems.length === 0) {
      return Response.json({
        dryRun: false,
        summary,
        items,
        error: '没有任何一道题通过校验，未写入',
      }, { status: 200 });
    }

    const drafts: IngestQuestion[] = okItems.map(i => ({
      content: i.draft!.content,
      source: i.draft!.source,
      number: i.draft!.number,
      type: i.draft!.type,
      grade: i.draft!.grade,
      semester: i.draft!.semester,
      exam_type: i.draft!.exam_type,
      difficulty: i.draft!.difficulty,
      chapter: i.draft!.chapter,
      section: i.draft!.section,
      knowledge: i.draft!.knowledge,
      tags: i.draft!.tags,
    }));

    const conflicts = checkConflicts(drafts);
    const results = writeQuestions(drafts, onConflict);

    return Response.json({
      dryRun: false,
      summary,
      items,
      conflicts,
      results,
      written: results.filter(r => !r.skipped && !r.error).length,
      skipped: results.filter(r => r.skipped).length,
    });
  } catch (e: any) {
    return Response.json({ error: e.message || '导入失败' }, { status: 500 });
  }
}
