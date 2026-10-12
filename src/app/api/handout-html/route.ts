import { NextRequest } from 'next/server';
import { getQuestionByQid, parseSections } from '@/lib/questions';
import {
  buildDocumentHtml,
  type HtmlBuildOptions,
} from '@/lib/handoutHtml';
import {
  DEFAULT_HANDOUT_SETTINGS,
  normalizeSettings,
  makeModule,
  defaultModuleTitle,
  flattenModules,
  toStrArray,
  MODULE_META,
  type HandoutModule,
  type HandoutQuestion,
  type QuestionSource,
} from '@/lib/handout';

export const dynamic = 'force-dynamic';

/**
 * POST /api/handout-html
 *
 * 服务端渲染讲义 HTML（与前端 buildDocumentHtml 共用同一份纯函数）。
 * 用途：桌面壳导出 PDF 时可走服务端；也便于调试与自动化测试。
 *
 * body:
 *   { qids: string[], settings?: Partial<HandoutSettings>, fileName?: string, outputMode?: 'student'|'teacher' }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const qids: string[] = Array.isArray(body.qids) ? body.qids.map(String) : [];
    if (qids.length === 0) {
      return Response.json({ error: '缺少 qids' }, { status: 400 });
    }

    const settings = normalizeSettings(body.settings);

    const sourceMap = new Map<string, QuestionSource>();
    const modules: HandoutModule[] = [];

    const m = makeModule('practice');
    m.title = defaultModuleTitle('practice');

    for (const qid of qids) {
      const q = getQuestionByQid(Number(qid));
      if (!q) continue;
      const hq: HandoutQuestion = {
        qid: String(q.qid),
        source: q.source || '',
        number: q.number || '',
        type: q.type || '',
        grade: q.grade || '',
        semester: q.semester || '',
        exam_type: q.exam_type || '',
        difficulty: q.difficulty ?? null,
        chapter: toStrArray(q.chapter),
        section: toStrArray(q.section),
        knowledge: toStrArray(q.knowledge),
        tags: toStrArray(q.tags),
      };
      sourceMap.set(hq.qid, { q: hq, sections: parseSections(q.content) });
      m.qids.push(hq.qid);
    }

    modules.push(m);

    const opts: HtmlBuildOptions = {
      blocks: flattenModules(modules),
      modules,
      settings,
      getQuestion: (qid) => sourceMap.get(qid),
    };

    const res = buildDocumentHtml(opts);

    // 调试/自动化：?format=html 直接返回 HTML；默认返回 JSON 摘要
    const url = new URL(req.url);
    if (url.searchParams.get('format') === 'html') {
      return new Response(res.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return Response.json({
      ok: true,
      questions: modules[0].qids.length,
      totalScore: res.totalScore,
      htmlLength: res.html.length,
      hasPageRule: /@page\s*\{/.test(res.html),
      hasPageNumber: /counter\(page\)/.test(res.html),
      hasWatermark: /hm-watermark/.test(res.html),
      hasBlank: /hm-blank/.test(res.html),
      hasCard: /hm-card/.test(res.html),
      moduleKinds: Object.keys(MODULE_META).length,
      defaultOutputMode: DEFAULT_HANDOUT_SETTINGS.outputMode,
      ordered: res.ordered.slice(0, 5),
    });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
