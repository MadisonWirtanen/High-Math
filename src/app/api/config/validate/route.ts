import { NextRequest } from 'next/server';
import fs from 'fs';
import { getConfig, AppConfig } from '@/lib/config';
import { resolveAll } from '@/lib/paths';
import { parseKnowledgeIndex } from '@/lib/knowledge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/config/validate
 * 校验「候选题库路径」是否可用，不写入配置。
 * body: { vaultPath, bankDirName?, imagesDirName? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const base = getConfig();

    const candidate: AppConfig = {
      ...base,
      vaultPath: body.vaultPath ?? base.vaultPath,
      bankDirName: body.bankDirName ?? base.bankDirName,
      imagesDirName: body.imagesDirName ?? base.imagesDirName,
    };

    if (!candidate.vaultPath || !String(candidate.vaultPath).trim()) {
      return Response.json({ ok: false, errors: ['路径为空'], warnings: [] }, { status: 200 });
    }

    const paths = resolveAll(candidate);
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 根目录
    if (!fs.existsSync(paths.vaultRoot)) {
      errors.push(`目录不存在：${paths.vaultRoot}`);
      return Response.json({ ok: false, errors, warnings, paths }, { status: 200 });
    }

    // 2. 题库目录
    if (!paths.bankDirExists) {
      warnings.push(`未找到题库目录：${paths.bankDir}（入库时会自动创建）`);
    }

    // 3. 写权限
    let writable = false;
    try {
      fs.accessSync(paths.bankDirExists ? paths.bankDir : paths.vaultRoot, fs.constants.W_OK);
      writable = true;
    } catch {
      errors.push('目标目录没有写入权限，将无法录入新题目');
    }

    // 4. 扫描题目
    let questionCount = 0;
    let sourceCount = 0;
    const sources: string[] = [];
    if (paths.bankDirExists) {
      for (const name of fs.readdirSync(paths.bankDir)) {
        const p = `${paths.bankDir}/${name}`;
        try {
          if (!fs.statSync(p).isDirectory()) continue;
        } catch {
          continue;
        }
        sources.push(name);
        for (const f of fs.readdirSync(p)) {
          if (f.toLowerCase().endsWith('.md') && !f.toLowerCase().endsWith('.bak')) questionCount++;
        }
      }
      sourceCount = sources.length;
    }

    // 5. 图片目录
    if (!paths.imagesDirExists) {
      warnings.push(`未找到图片目录（含图题目将无法显示，上传时会自动创建）：${paths.imagesDir}`);
    }

    // 6. 知识点总表（三级）
    let knowledgeCount = 0;
    let chapterCount = 0;
    let sectionCount = 0;
    if (paths.knowledgeTable) {
      try {
        const idx = parseKnowledgeIndex(fs.readFileSync(paths.knowledgeTable, 'utf-8'));
        knowledgeCount = idx.points.length;
        chapterCount = idx.chapterNames.length;
        sectionCount = idx.sectionNames.length;
      } catch {
        warnings.push('知识点总表存在但解析失败');
      }
      if (knowledgeCount === 0) {
        warnings.push(`知识点总表未解析出任何知识点：${paths.knowledgeTable}`);
      } else if (chapterCount === 0 || sectionCount === 0) {
        warnings.push('知识点总表缺少「一级（章）/ 二级（节）」列，将无法校验 chapter / section');
      }
    } else {
      warnings.push('未找到知识点总表，录入时无法校验章 / 节 / 知识点');
    }

    return Response.json({
      ok: errors.length === 0,
      errors,
      warnings,
      writable,
      questionCount,
      sourceCount,
      sources: sources.slice(0, 50),
      knowledgeCount,
      chapterCount,
      sectionCount,
      knowledgeTable: paths.knowledgeTable,
      paths: {
        vaultRoot: paths.vaultRoot,
        bankDir: paths.bankDir,
        imagesDir: paths.imagesDir,
        imagesDirExists: paths.imagesDirExists,
        imagesDirFrom: paths.imagesDirFrom,
        bankDirExists: paths.bankDirExists,
      },
    });
  } catch (e: any) {
    return Response.json({ ok: false, errors: [e.message || '校验失败'], warnings: [] }, { status: 200 });
  }
}
