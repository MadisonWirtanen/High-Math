import { NextRequest } from 'next/server';
import { checkConflicts, writeQuestions, IngestQuestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/add-questions
 *
 *   action = "check"  → 只检查哪些文件已存在，不写入
 *   action = "write"  → 实际写入（配合 onConflict: "skip" | "overwrite"）
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    questions,
    action,
    onConflict,
  } = body as {
    questions: IngestQuestion[];
    action?: string;
    onConflict?: 'skip' | 'overwrite';
  };

  if (!Array.isArray(questions) || questions.length === 0) {
    return Response.json({ error: '缺少题目数据' }, { status: 400 });
  }

  if (action === 'check') {
    return Response.json({ conflicts: checkConflicts(questions) });
  }

  const results = writeQuestions(questions, onConflict === 'overwrite' ? 'overwrite' : 'skip');
  return Response.json({ results });
}
