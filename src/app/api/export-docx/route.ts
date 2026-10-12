import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getQuestionByQid, parseSections } from '@/lib/questions';
import { resolveImagesDir } from '@/lib/paths';
import { getConfig } from '@/lib/config';
import { execPandoc, checkPandoc } from '@/lib/pandoc';
import {
    buildDocumentMarkdown,
    DEFAULT_HANDOUT_SETTINGS,
    toStrArray,
    type Block,
    type HandoutQuestion,
    type QuestionSource,
} from '@/lib/handout';

export const dynamic = 'force-dynamic';

/** 把题库元数据 + 正文组装成生成器需要的形态 */
function toSource(qid: number): QuestionSource | null {
    const q = getQuestionByQid(qid);
    if (!q) return null;
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
    return { q: hq, sections: parseSections(q.content) };
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // ===== 1. 取 markdown 与图片映射 =====
        // 新协议：前端已经把「设置 → markdown」算好，直接透传（Word 自动继承全部设置）
        // 旧协议：只传 qids，服务端用默认设置生成（保持向后兼容）
        let markdown: string;
        let imageEntries: [string, string][];
        let baseName = 'HighMath';

        if (typeof body.markdown === 'string' && body.markdown.trim()) {
            markdown = body.markdown;
            imageEntries = Object.entries((body.imageMap || {}) as Record<string, string>);
            if (typeof body.fileName === 'string' && body.fileName.trim()) {
                baseName = body.fileName.trim();
            }
        } else {
            const { qids } = body as { qids?: unknown };
            if (!Array.isArray(qids) || qids.length === 0) {
                return Response.json({ error: '请提供 markdown 或题目 qid 列表' }, { status: 400 });
            }

            const sources = new Map<string, QuestionSource>();
            const blocks: Block[] = [];
            for (const rawQid of qids) {
                const src = toSource(Number(rawQid));
                if (!src) continue;
                sources.set(src.q.qid, src);
                blocks.push({ id: `q_${src.q.qid}`, type: 'question', qid: src.q.qid });
            }
            if (blocks.length === 0) {
                return Response.json({ error: '未找到任何题目' }, { status: 404 });
            }

            const built = buildDocumentMarkdown({
                blocks,
                settings: DEFAULT_HANDOUT_SETTINGS,
                getQuestion: (qid) => sources.get(qid),
            });
            markdown = built.markdown;
            imageEntries = [...built.imageMap.entries()];
        }

        // ===== 2. 检测 Pandoc =====
        const pandocStatus = await checkPandoc();
        if (!pandocStatus.available) {
            return Response.json({
                error: 'Pandoc 未安装或不可用',
                pandocPath: pandocStatus.path,
                hint: '请在「设置」页填写 pandoc 路径，或安装 Pandoc（Windows 也可放到项目的 tool/pandoc-3.10/ 目录下）',
            }, { status: 500 });
        }
        const pandocPath = pandocStatus.path;

        // ===== 3. 写临时目录 + 拷贝图片 + pandoc =====
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-'));
        console.log('📁 临时目录:', tmpDir);

        try {
            const mdPath = path.join(tmpDir, '讲义.md');
            fs.writeFileSync(mdPath, markdown, 'utf-8');

            const imagesDir = resolveImagesDir(getConfig());
            for (const [hashFilename, newName] of imageEntries) {
                const imgSrc = path.join(imagesDir, hashFilename);
                const imgDst = path.join(tmpDir, newName);
                if (fs.existsSync(imgSrc)) {
                    fs.copyFileSync(imgSrc, imgDst);
                } else {
                    console.warn('⚠️ 图片未找到:', hashFilename);
                }
            }

            const docxPath = path.join(tmpDir, '讲义.docx');
            console.log('📄 开始生成 Word 文档...');
            await execPandoc(pandocPath, [
                mdPath,
                '--resource-path', tmpDir,
                '-o', docxPath,
                '-f', 'markdown+tex_math_dollars+raw_attribute',
                '-t', 'docx',
            ], tmpDir);
            console.log('✅ Word 文档生成成功');

            const fileBuffer = fs.readFileSync(docxPath);

            // 纯英文文件名，避免编码问题
            const now = new Date();
            const ts = [
                now.getFullYear(),
                String(now.getMonth() + 1).padStart(2, '0'),
                String(now.getDate()).padStart(2, '0'),
                String(now.getHours()).padStart(2, '0'),
                String(now.getMinutes()).padStart(2, '0'),
                String(now.getSeconds()).padStart(2, '0'),
            ].join('');
            const safeBase = baseName.replace(/[^\w.-]+/g, '_') || 'HighMath';
            const fileName = `${safeBase}_${ts}.docx`;

            return new Response(fileBuffer, {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'Content-Disposition': `attachment; filename="${fileName}"`,
                },
            });

        } finally {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
                console.log('🧹 临时目录已清理');
            } catch (cleanupError) {
                console.warn('⚠️ 清理临时目录失败:', cleanupError);
            }
        }

    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('❌ docx 导出错误:', e);
        return Response.json({
            error: msg || '导出失败',
            suggestion: '请检查 Pandoc 是否正确安装',
        }, { status: 500 });
    }
}
