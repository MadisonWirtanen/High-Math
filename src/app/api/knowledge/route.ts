import { NextRequest } from 'next/server';
import {
  loadKnowledge,
  loadKnowledgeIndex,
  searchKnowledge,
  validateKnowledge,
  validateChapters,
  validateSections,
  getTaxonomyTree,
} from '@/lib/knowledge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/knowledge
 *   ?tree=1                   → 返回「章 → 节」完整树（前端级联筛选用）
 *   ?chapter=xxx              → 返回该章下的节列表
 *   ?section=yyy              → 返回该节下的知识点列表
 *   ?q=关键词&limit=30        → 模糊搜索知识点
 *   ?check=A,B,C              → 校验知识点是否在总表内
 *   ?checkChapter=A,B         → 校验章
 *   ?checkSection=A,B         → 校验节
 *   无参数                     → 返回总表概览
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const info = loadKnowledge();

  // 三级树
  if (searchParams.get('tree') === '1') {
    return Response.json({
      available: info.available,
      chapterCount: info.chapterCount,
      sectionCount: info.sectionCount,
      knowledgeCount: info.count,
      tree: getTaxonomyTree(),
    });
  }

  // 按章取节 / 按节取知识点
  const chapter = searchParams.get('chapter');
  const section = searchParams.get('section');
  if (chapter !== null || section !== null) {
    const idx = loadKnowledgeIndex();
    if (section !== null && section !== '') {
      const points = idx.points.filter(p => p.section === section).map(p => p.name);
      return Response.json({ available: idx.available, section, knowledge: points });
    }
    const sections = idx.chapters.find(c => c.name === chapter)?.sections.map(s => s.name) ?? [];
    return Response.json({ available: idx.available, chapter, sections });
  }

  // 校验
  const check = searchParams.get('check');
  if (check !== null) {
    const names = check.split(',').map(s => s.trim()).filter(Boolean);
    return Response.json({ ...validateKnowledge(names), count: info.count });
  }
  const checkChapter = searchParams.get('checkChapter');
  if (checkChapter !== null) {
    return Response.json(validateChapters(checkChapter.split(',').map(s => s.trim()).filter(Boolean)));
  }
  const checkSection = searchParams.get('checkSection');
  if (checkSection !== null) {
    return Response.json(validateSections(checkSection.split(',').map(s => s.trim()).filter(Boolean)));
  }

  // 搜索
  const q = searchParams.get('q');
  if (q !== null) {
    const limit = Number(searchParams.get('limit') || 30);
    return Response.json({
      available: info.available,
      path: info.path,
      count: info.count,
      results: searchKnowledge(q, isNaN(limit) ? 30 : limit),
    });
  }

  return Response.json({
    available: info.available,
    path: info.path,
    count: info.count,
    chapterCount: info.chapterCount,
    sectionCount: info.sectionCount,
  });
}
