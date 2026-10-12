import {
  buildDocumentMarkdown,
  DEFAULT_HANDOUT_SETTINGS,
  normalizeSettings,
  analyzeHandout,
  reconcileBlocks,
} from '../src/lib/handout.ts';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
}

const q1 = {
  qid: '101', source: '25海淀一模', number: 'T1', type: '单选题', grade: '高中',
  semester: '高三上', exam_type: '一模', difficulty: 0.85,
  chapter: ['集合与常用逻辑用语'], section: ['集合的基本运算'],
  knowledge: ['【必备知识】补集及其常用结论'], tags: [],
};
const q2 = {
  qid: '102', source: '25海淀一模', number: 'T2', type: '多选题', grade: '高中',
  semester: '高三上', exam_type: '一模', difficulty: 0.35,
  chapter: ['一元函数的导数及其应用'], section: ['导数在研究函数中的应用'],
  knowledge: ['【必备知识】导数应用之求函数最值'], tags: [],
};
const q3 = {
  qid: '103', source: '25西城二模', number: '19', type: '解答题', grade: '高中',
  semester: '高三上', exam_type: '二模', difficulty: 0.3,
  chapter: ['立体几何'], section: ['空间向量'], knowledge: ['【必备知识】空间角'], tags: [],
};

const sources = new Map([
  ['101', { q: q1, sections: { 题目: '已知集合 A={1,2}，则 [选]', 选项: 'A. 1\nB. 2\nC. 3\nD. 4', 答案: 'A', 解析: '显然' } }],
  ['102', { q: q2, sections: { 题目: '下列结论正确的是 [多选]', 选项: 'A. 甲\nB. 乙\nC. 丙\nD. 丁', 答案: 'AB', 解析: '略' } }],
  ['103', { q: q3, sections: { 题目: '如图，求二面角。', 答案: '60°', 解析: '建系' } }],
]);
const getQuestion = (qid) => sources.get(qid);
const qb = (qid, score) => ({ id: 'b_' + qid, type: 'question', qid, score });

console.log('\n[1] 默认设置：题号 / 选项 / 答案 / 来源');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101'), qb('102'), qb('103')],
    settings: DEFAULT_HANDOUT_SETTINGS,
    getQuestion,
  });
  const md = r.markdown;
  check('第 1 题编号为 1.', /^1\\?\.\s*已知集合/m.test(md));
  check('多选题带 (多选) 标记', /2\\?\.\(多选\)/.test(md));
  check('选择题题干补 ()', md.includes('()'));
  check('填空题标记被替换（无 [填]）', !md.includes('[填]'));
  check('【答案】内联输出', md.includes('【答案】A'));
  check('【来源】输出', md.includes('【来源】25海淀一模T1'));
  check('【解析】内联输出', md.includes('【解析】'));
}

console.log('\n[1b] 题号不应被 markdown 当作有序列表');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101'), qb('102')],
    settings: DEFAULT_HANDOUT_SETTINGS,
    getQuestion,
  });
  const md = r.markdown;
  check('题号 1. 已转义为 1\\.', md.includes('1\\. '));
  check('ASCII 选项 A. 已转义（防列表）', md.includes('A\\. 1'));
  {
    const r2 = buildDocumentMarkdown({
      blocks: [qb('101')],
      settings: DEFAULT_HANDOUT_SETTINGS,
      getQuestion: (qid) => qid === '101'
        ? { q: q1, sections: { 题目: '题干', 选项: 'A．全角一\nB．全角二' } }
        : undefined,
    });
    check('全角选项 A． 不受影响', r2.markdown.includes('A．全角一'));
  }
  check('无未转义的行首数字点', !/^\d+\.\s/m.test(md));
}

console.log('\n[2] 倒序：题号按最终顺序重排，第一题仍是 1');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101'), qb('102'), qb('103')],
    settings: normalizeSettings({ reverse: true }),
    getQuestion,
  });
  const md = r.markdown;
  const i1 = md.indexOf('1\\. ');
  const i3 = md.indexOf('3\\. ');
  check('倒序后第 1 题是原第 3 题（解答题）', /^1\\?\.\s*如图/m.test(md));
  check('倒序后第 3 题是原第 1 题（集合）', md.indexOf('已知集合') > md.indexOf('如图'));
  check('编号仍为 1/2/3', i1 >= 0 && i3 > i1);
}

console.log('\n[3] 标题块不参与倒序');
{
  const blocks = [
    { id: 'h1', type: 'group', level: 1, text: '选择题', autoNumber: true },
    qb('101'), qb('102'),
    { id: 'h2', type: 'group', level: 1, text: '解答题', autoNumber: true },
    qb('103'),
  ];
  const r = buildDocumentMarkdown({ blocks, settings: normalizeSettings({ reverse: true, restartPerGroup: true }), getQuestion });
  const md = r.markdown;
  check('大题标题仍在题目之前', md.indexOf('选择题') < md.indexOf('解答题'));
  check('大题自动编号 一、二、', md.includes('## 一、选择题') && md.includes('## 二、解答题'));
}

console.log('\n[4] 分段编号：每个大题内从 1 开始');
{
  const blocks = [
    { id: 'h1', type: 'group', level: 1, text: '选择题', autoNumber: true },
    qb('101'), qb('102'),
    { id: 'h2', type: 'group', level: 1, text: '解答题', autoNumber: true },
    qb('103'),
  ];
  const r = buildDocumentMarkdown({ blocks, settings: normalizeSettings({ restartPerGroup: true }), getQuestion });
  const md = r.markdown;
  const afterHeading = md.split('## 二、解答题')[1] || '';
  check('第二个大题内从 1. 开始', /^\s*\n\s*1\\?\.\s*如图/m.test(afterHeading));
}

console.log('\n[5] 知识点模板（strip + join）');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101')],
    settings: normalizeSettings({ knowledgeMode: 'below', knowledgeTemplate: '考查知识点：{knowledge|strip|join:、}' }),
    getQuestion,
  });
  check('知识点去前缀输出', r.markdown.includes('考查知识点：补集及其常用结论'));
}

console.log('\n[6] 难度星级模板');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('102')],
    settings: normalizeSettings({ knowledgeMode: 'below', knowledgeTemplate: '难度 {difficulty|stars}' }),
    getQuestion,
  });
  check('难度 0.35 → 3 星', r.markdown.includes('难度 ★★★'));
}

console.log('\n[7] 原卷序号 + 去字母前缀');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101'), qb('103')],
    settings: normalizeSettings({ numberSource: 'origin', stripAlphaPrefix: true }),
    getQuestion,
  });
  check('T1 → 1.', /^1\\?\.\s*已知集合/m.test(r.markdown));
  check('19 保持 19.', /19\\?\.\s*如图/m.test(r.markdown));
}

console.log('\n[8] 答案文末统一 + 总分合计');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101', 5), qb('102', 5), qb('103', 12)],
    settings: normalizeSettings({ answerPosition: 'end', showScore: true }),
    getQuestion,
  });
  check('总分合计 22', r.totalScore === 22, '实际 ' + r.totalScore);
  check('答案不在题后', !r.markdown.includes('【答案】A\n'));
  check('文末出现参考答案', r.markdown.includes('## 参考答案'));
  check('分值显示（5分）', r.markdown.includes('（5分）'));
}

console.log('\n[9] 卷头');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101', 5)],
    settings: normalizeSettings({ headerEnabled: true, title: '数学一模', examTime: '120 分钟', sealLine: true }),
    getQuestion,
  });
  check('主标题 # 数学一模', r.markdown.startsWith('# 数学一模'));
  check('满分自动合计 5', r.markdown.includes('满分：5 分'));
  check('密封线信息栏', r.markdown.includes('姓名：'));
}

console.log('\n[10] 分页块输出 pandoc raw openxml');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101'), { id: 'p1', type: 'pagebreak' }, qb('102')],
    settings: DEFAULT_HANDOUT_SETTINGS,
    getQuestion,
  });
  check('包含 openxml 分页块', r.markdown.includes('```{=openxml}') && r.markdown.includes('w:type="page"'));
}

console.log('\n[11] 选项四个一行');
{
  const r = buildDocumentMarkdown({
    blocks: [qb('101')],
    settings: normalizeSettings({ optionLayout: 'four-in-line' }),
    getQuestion,
  });
  const line = r.markdown.split('\n').find(l => l.includes('A. 1'));
  check('四个选项合并到一行', !!line && line.includes('B. 2') && line.includes('D. 4'), line);
}

console.log('\n[12] reconcileBlocks：题目增删与排序');
{
  let b = reconcileBlocks([], ['101', '102'], () => undefined);
  check('初始按题目生成块', b.filter(x => x.type === 'question').map(x => x.qid).join(',') === '101,102');
  b = reconcileBlocks(b, ['102'], () => undefined);
  check('删除题目后块同步移除', b.filter(x => x.type === 'question').map(x => x.qid).join(',') === '102');
  b = reconcileBlocks(b, ['103', '102'], () => undefined);
  check('新增题目 + 顺序同步', b.filter(x => x.type === 'question').map(x => x.qid).join(',') === '103,102');
  b = [{ id: 'h', type: 'group', level: 1, text: 'A', autoNumber: true }, ...b];
  check('非题目块保持原位', b[0].type === 'group');
}

console.log('\n[13] 试卷分析');
{
  const a = analyzeHandout([q1, q2, q3], (qid) => (qid === '103' ? 12 : 5));
  check('题目数 3', a.total === 3);
  check('总分 22', a.totalScore === 22);
  check('题型分布有 3 类', a.byType.length === 3);
  check('难度分布分档', a.byDifficulty.length >= 2);
  check('知识点去前缀', a.byKnowledge.every(x => !x.label.startsWith('【')));
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
