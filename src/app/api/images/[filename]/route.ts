import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveImagesDir } from '@/lib/paths';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const imagesPath = resolveImagesDir(getConfig());
  const filePath = path.resolve(imagesPath, filename);

  // 安全检查：防止 ../ 路径遍历攻击（用 resolve 后比较，兼容大小写差异）
  const base = path.resolve(imagesPath);
  const rel = path.relative(base, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    return new Response(buffer, {
      headers: {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}
