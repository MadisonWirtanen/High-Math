import { checkPandoc } from '@/lib/pandoc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/pandoc —— 检测 Pandoc 是否可用 */
export async function GET() {
  const status = await checkPandoc();
  return Response.json(status);
}
