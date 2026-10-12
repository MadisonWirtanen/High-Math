import { NextRequest } from 'next/server';
import { getConfig, updateConfig, getConfigDiagnostics, DEFAULT_CONFIG, AppConfig } from '@/lib/config';
import { resolveAll } from '@/lib/paths';
import { loadKnowledge } from '@/lib/knowledge';
import { scanBankStats, invalidateMetaCache } from '@/lib/questions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 返回给前端的配置视图（附带解析后的路径与统计） */
function buildView() {
  const cfg = getConfig();
  const paths = resolveAll(cfg);
  const bank = scanBankStats();
  const kb = loadKnowledge();

  return {
    // 原始配置
    vaultPath: cfg.vaultPath,
    bankDirName: cfg.bankDirName,
    imagesDirName: cfg.imagesDirName,
    defaultGrade: cfg.defaultGrade,
    gradeList: cfg.gradeList,
    subjectSuffix: cfg.subjectSuffix,
    pandocPath: cfg.pandocPath,
    knowledgeTablePath: cfg.knowledgeTablePath,
    port: cfg.port,

    // 解析结果
    vaultName: paths.vaultName,
    vaultRoot: paths.vaultRoot,
    bankDir: paths.bankDir,
    imagesDir: paths.imagesDir,
    imagesDirExists: paths.imagesDirExists,
    imagesDirFrom: paths.imagesDirFrom,
    bankDirExists: paths.bankDirExists,
    knowledgeTable: paths.knowledgeTable,
    knowledgeCount: kb.count,
    chapterCount: kb.chapterCount,
    sectionCount: kb.sectionCount,

    // 统计
    questionCount: bank.questionCount,
    sourceCount: bank.sourceCount,

    // 诊断
    diagnostics: getConfigDiagnostics(),
  };
}

export async function GET() {
  try {
    return Response.json(buildView());
  } catch (e: any) {
    return Response.json({ error: e.message || '读取配置失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const patch = (await req.json()) as Partial<AppConfig>;
    const allowed: (keyof AppConfig)[] = [
      'vaultPath', 'bankDirName', 'imagesDirName',
      'defaultGrade', 'gradeList', 'subjectSuffix',
      'pandocPath', 'knowledgeTablePath', 'port',
    ];
    const clean: Partial<AppConfig> = {};
    for (const k of allowed) {
      if (k in patch) (clean as any)[k] = (patch as any)[k];
    }
    if (typeof clean.gradeList === 'string') {
      clean.gradeList = (clean.gradeList as unknown as string).split(',').map(s => s.trim()).filter(Boolean);
    }
    updateConfig(clean);

    // 目录可能变了 → 清空题库缓存
    invalidateMetaCache();

    return Response.json({ ok: true, config: buildView() });
  } catch (e: any) {
    return Response.json({ error: e.message || '保存配置失败' }, { status: 500 });
  }
}

/** DELETE：恢复默认配置 */
export async function DELETE() {
  try {
    updateConfig({ ...DEFAULT_CONFIG, vaultPath: './demo-vault' });
    invalidateMetaCache();
    return Response.json({ ok: true, config: buildView() });
  } catch (e: any) {
    return Response.json({ error: e.message || '重置失败' }, { status: 500 });
  }
}
