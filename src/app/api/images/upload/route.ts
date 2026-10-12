import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveImagesDir, ensureDir } from '@/lib/paths';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif']);

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return Response.json({ error: '未选择文件' }, { status: 400 });
  }

  const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const ext = ALLOWED_EXT.has(rawExt) ? rawExt : 'jpg';
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}.${ext}`;

  // 运行期解析图片目录，不存在则自动创建
  const imagesPath = resolveImagesDir(getConfig());
  ensureDir(imagesPath);

  const filePath = path.join(imagesPath, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buffer);
  }

  return Response.json({ filename, url: `/api/images/${encodeURIComponent(filename)}` });
}
