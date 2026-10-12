import { NextRequest, NextResponse } from 'next/server';
import { scanAllQuestionsMeta, invalidateMetaCache } from '@/lib/questions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/questions/meta?refresh=1 —— 返回全部题目元数据，refresh=1 时强制重扫 */
export async function GET(req: NextRequest) {
  const refresh = new URL(req.url).searchParams.get('refresh');
  if (refresh === '1') invalidateMetaCache();
  return NextResponse.json(scanAllQuestionsMeta());
}
