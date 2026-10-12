'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useConfig, pickDirectory } from '@/components/ConfigProvider';
import styles from './settings.module.css';

interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  writable?: boolean;
  questionCount?: number;
  sourceCount?: number;
  knowledgeCount?: number;
  chapterCount?: number;
  sectionCount?: number;
  knowledgeTable?: string | null;
  paths?: {
    vaultRoot: string;
    bankDir: string;
    imagesDir: string;
    imagesDirExists: boolean;
    imagesDirFrom: string;
    bankDirExists: boolean;
  };
}

interface PandocStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

export default function SettingsPage() {
  const { config, reload, loading } = useConfig();

  const [form, setForm] = useState({
    vaultPath: '',
    bankDirName: '题库',
    imagesDirName: 'images',
    defaultGrade: '高中',
    gradeList: '初中,高中',
    subjectSuffix: '数学',
    pandocPath: '',
    knowledgeTablePath: '',
  });

  const [inited, setInited] = useState(false);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pandoc, setPandoc] = useState<PandocStatus | null>(null);
  const [checkingPandoc, setCheckingPandoc] = useState(false);

  // 配置加载完成后回填表单（只做一次）
  useEffect(() => {
    if (loading || inited) return;
    const raw = config as any;
    setForm({
      vaultPath: raw.vaultPath || '',
      bankDirName: raw.bankDirName || '题库',
      imagesDirName: raw.imagesDirName || 'images',
      defaultGrade: raw.defaultGrade || '高中',
      gradeList: (raw.gradeList || []).join(','),
      subjectSuffix: raw.subjectSuffix || '数学',
      pandocPath: raw.pandocPath || '',
      knowledgeTablePath: raw.knowledgeTablePath || '',
    });
    setInited(true);
  }, [config, loading, inited]);

  const set = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleBrowse = async () => {
    const dir = await pickDirectory();
    if (dir) {
      set('vaultPath', dir);
      setResult(null);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setResult(null);
    try {
      const res = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setResult(await res.json());
    } catch {
      setMessage('❌ 校验请求失败');
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`❌ ${data.error || '保存失败'}`); return; }
      setMessage('✅ 配置已保存');
      await reload();
      setResult(null);
    } catch {
      setMessage('❌ 网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('确定恢复默认配置？（题库路径将重置为 ./demo-vault）')) return;
    setSaving(true);
    try {
      await fetch('/api/config', { method: 'DELETE' });
      setMessage('✅ 已恢复默认配置');
      setInited(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const handleCheckPandoc = async () => {
    setCheckingPandoc(true);
    try {
      const res = await fetch('/api/pandoc', { cache: 'no-store' });
      setPandoc(await res.json());
    } catch {
      setPandoc({ available: false, path: '', error: '请求失败' });
    } finally {
      setCheckingPandoc(false);
    }
  };

  const isDesktop = config.isDesktop;

  return (
    <AppShell title="设置">
      <div className={styles.container}>
        <div className="hm-page-head">
          <div>
            <h1 className="hm-page-title">设置</h1>
            <p className="hm-page-sub">题库位置、学段分类、导出与诊断</p>
          </div>
        </div>

      {message && <div className={styles.message}>{message}</div>}

      {/* ===== 1. 题库位置 ===== */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>1. 题库位置</h2>
        <p className={styles.hint}>
          选择包含题库的文件夹。程序会读取其中的题目 markdown，并把新录入的题目写回该目录。
        </p>

        <label className={styles.label}>题库根目录</label>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={form.vaultPath}
            onChange={e => { set('vaultPath', e.target.value); setResult(null); }}
            placeholder="例如 D:\\高中数学 或 /srv/mathbank"
          />
          {isDesktop && (
            <button className={styles.btnSecondary} onClick={handleBrowse}>浏览…</button>
          )}
          <button className={styles.btnSecondary} onClick={handleValidate} disabled={validating}>
            {validating ? '校验中…' : '校验'}
          </button>
        </div>

        <div className={styles.modeRow}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              checked={form.bankDirName !== '.'}
              onChange={() => { set('bankDirName', '题库'); setResult(null); }}
            />
            Obsidian Vault 模式
            <span className={styles.radioHint}>（所选目录是 Vault 根目录，题目在其中的「题库」子目录）</span>
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              checked={form.bankDirName === '.'}
              onChange={() => { set('bankDirName', '.'); setResult(null); }}
            />
            直接题库模式
            <span className={styles.radioHint}>（所选目录本身就是题库目录）</span>
          </label>
        </div>

        {/* 校验结果 */}
        {result && (
          <div className={styles.result}>
            <div className={result.ok ? styles.resultOk : styles.resultErr}>
              {result.ok ? '✅ 校验通过' : '❌ 校验未通过'}
            </div>
            {result.errors.map((e, i) => <div key={`e${i}`} className={styles.errLine}>· {e}</div>)}
            {result.warnings.map((w, i) => <div key={`w${i}`} className={styles.warnLine}>· {w}</div>)}

            {result.paths && (
              <table className={styles.pathTable}>
                <tbody>
                  <tr><td>题目目录</td><td>{result.paths.bankDir}{result.paths.bankDirExists ? '' : '（不存在）'}</td></tr>
                  <tr><td>图片目录</td><td>{result.paths.imagesDir}{result.paths.imagesDirExists ? '' : '（不存在，上传时自动创建）'}</td></tr>
                  <tr><td>题目数量</td><td>{result.questionCount ?? 0} 题 · {result.sourceCount ?? 0} 个来源</td></tr>
                  <tr><td>知识点总表</td><td>{result.knowledgeTable ? `${result.knowledgeTable}（${result.chapterCount ?? 0} 章 · ${result.sectionCount ?? 0} 节 · ${result.knowledgeCount ?? 0} 知识点）` : '未找到'}</td></tr>
                  <tr><td>写权限</td><td>{result.writable ? '可写' : '不可写'}</td></tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        <details className={styles.advanced}>
          <summary>高级：自定义子目录名</summary>
          <div className={styles.row}>
            <label className={styles.miniLabel}>
              题库子目录名
              <input className={styles.inputSm} value={form.bankDirName} onChange={e => set('bankDirName', e.target.value)} />
            </label>
            <label className={styles.miniLabel}>
              图片子目录名
              <input className={styles.inputSm} value={form.imagesDirName} onChange={e => set('imagesDirName', e.target.value)} />
            </label>
          </div>
        </details>
      </section>

      {/* ===== 2. 学段与分类 ===== */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>2. 学段与分类</h2>
        <div className={styles.row}>
          <label className={styles.miniLabel}>
            默认年级
            <input className={styles.inputSm} value={form.defaultGrade} onChange={e => set('defaultGrade', e.target.value)} />
          </label>
          <label className={styles.miniLabel}>
            可选年级列表（逗号分隔）
            <input className={styles.inputSm} value={form.gradeList} onChange={e => set('gradeList', e.target.value)} />
          </label>
          <label className={styles.miniLabel}>
            学科后缀
            <input className={styles.inputSm} value={form.subjectSuffix} onChange={e => set('subjectSuffix', e.target.value)} />
          </label>
        </div>
      </section>

      {/* ===== 3. 知识点总表（三级分类） ===== */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>3. 知识点总表（三级分类）</h2>
        <p className={styles.hint}>
          用于校验录入题目的「章 / 节 / 知识点」三级字段，防止自造名称、防止层级错配。
          留空则自动在题库目录、Vault 根目录中查找 <code>高中数学知识点总表.md</code>。
        </p>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={form.knowledgeTablePath}
            onChange={e => set('knowledgeTablePath', e.target.value)}
            placeholder="留空 = 自动探测"
          />
        </div>
        <div className={styles.statusLine}>
          当前解析到：{config.knowledgeTable
            ? <span className={styles.ok}>
                {config.knowledgeTable}（{config.chapterCount} 章 · {config.sectionCount} 节 · {config.knowledgeCount} 知识点）
              </span>
            : <span className={styles.warn}>未找到</span>}
        </div>
      </section>

      {/* ===== 4. Word 导出（Pandoc） ===== */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>4. Word 导出（可选）</h2>
        <p className={styles.hint}>导出 Word 讲义需要 Pandoc。留空则自动探测。</p>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={form.pandocPath}
            onChange={e => set('pandocPath', e.target.value)}
            placeholder="留空 = 自动探测"
          />
          <button className={styles.btnSecondary} onClick={handleCheckPandoc} disabled={checkingPandoc}>
            {checkingPandoc ? '检测中…' : '检测'}
          </button>
        </div>
        {pandoc && (
          <div className={styles.statusLine}>
            {pandoc.available
              ? <span className={styles.ok}>✅ 可用 · {pandoc.version} · {pandoc.path}</span>
              : <span className={styles.warn}>⚠️ 不可用（{pandoc.path || '未找到'}）—— 不影响其它功能，仅 Word 导出不可用</span>}
          </div>
        )}
      </section>

      {/* ===== 操作栏 ===== */}
      <div className={styles.actions}>
        <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存配置'}
        </button>
        <button className={styles.btnSecondary} onClick={handleReset} disabled={saving}>恢复默认</button>
      </div>

      {/* ===== 诊断 ===== */}
      <details className={styles.advanced}>
        <summary>诊断信息</summary>
        <pre className={styles.pre}>
{`版本：HighMath v${(config as any).diagnostics?.version || '—'}
配置文件：${(config as any).diagnostics?.configFile || '—'}
配置已存在：${(config as any).diagnostics?.configFileExists ? '是' : '否'}
环境变量覆盖：${((config as any).diagnostics?.envKeys || []).join(', ') || '无'}
运行模式：${isDesktop ? '桌面应用' : 'Web 服务'}
题库目录：${config.bankDir || '—'}
图片目录：${config.imagesDir || '—'}（来源：${(config as any).imagesDirFrom || '—'}）`}
        </pre>
      </details>
      </div>
    </AppShell>
  );
}
