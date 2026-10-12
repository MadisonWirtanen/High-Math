<p align="center">
  <img src="docs/logo.png" width="104" height="104" alt="HighMath 图标" />
</p>

<h1 align="center">HighMath</h1>

一个轻量的高中数学题库浏览、组卷与讲义编排工具。以 **文件夹为数据库**，基于 Next.js 构建，可打包为 **Windows 桌面应用**，也可部署到 **Linux 服务器**做成网页应用 —— 两者共用同一份代码。

**当前版本：v2.2.0** ｜ **技术栈**：Next.js 16 · React 19 · TypeScript · Electron 33 ｜ **许可**：[MIT](LICENSE)

> 📖 **完整使用说明见 [`docs/使用说明.md`](docs/使用说明.md)**
> 本文档只做项目速览；安装、界面、编讲义、草稿、构建踩坑等全部细节以 `docs/使用说明.md` 为准。

---

## 三种用法

| 用法 | 适合谁 | 入口 |
| --- | --- | --- |
| **桌面应用** | 老师 / 个人，双击即用 | `HighMath-Setup-2.2.0.exe` |
| **本地 Web** | 开发者调试 | `npm run dev` |
| **服务器 Web** | 团队共享 | `Dockerfile` / `node server.js` |

---

## 核心功能

- **三级分类筛选**：按「章 → 节 → 知识点」逐级收窄，选项顺序与教材一致
- 按年级、来源、题型、难度、标签、题号范围筛选题目
- **试题篮**：纯粹的候选清单，看清已选题目，一键送去编讲义
- **编讲义**：**十种模块**（总标题 / 知识点标题 / 知识点讲解 / 例题讲解 / 变式训练 / 真题练习 / 方法总结 / 提示框 / 自由文本 / 分页符），侧边抽屉从试题篮挑题插入指定位置
- **A4 分页预览**：基于 Paged.js 的真实纸张视图，所见即 A4，支持缩放与页码
- **PDF 一键导出**：预览与 PDF 同源同渲染，保证「所见即所得」
- **教师版 / 学生版 / 双版本**：学生版自动隐藏答案与解析，并按题型插入答题留白
- **版面设置**：选项排布、正文分栏、页眉页脚、水印、卡片皮肤
- **草稿自动保存**：编讲义过程自动存草稿（保留最近 20 份 / 30 天），关闭不丢失
- **录入题目**：粘贴 markdown，或直接拖入 `.md` / `.zip` 批量导入
- **入库前校验**：结构检查 + **三级知识点总表比对**（章 / 节 / 知识点逐字查表，并检查隶属关系）
- **导出讲义**：PDF（主）/ Word（补充）/ Markdown 打包下载
- 深色 / 浅色模式切换、Obsidian 一键跳转
- 运行时配置：**指定题库文件夹即可使用**，切换目录无需重启

---

## 快速开始

### 桌面版（Windows）

1. 运行安装包，一路下一步；
2. 打开后进 **⋯ 更多 → ⚙ 设置 → 浏览…**，选择你的题库文件夹；
3. 点 **校验** 确认题目数量正确，再点 **保存配置**。

程序自带示例题库（38 题，已按规范完成三级知识点标注），不配置也能直接体验。
桌面版不需要安装 Node.js —— Electron 内置了运行时。

### 从源码运行

**环境**：Node.js 20+（推荐 22）

```bash
npm install          # 已配置国内镜像（.npmrc）
npm run dev          # http://localhost:3000
```

配置自己的题库有两种方式：

1. **界面配置（推荐）**：启动后进「⚙ 设置」选目录，配置存到用户目录，无需重启；
2. **环境变量**：复制 `.env.local.example` 为 `.env.local` 后修改。

---

## 题库目录结构

**Obsidian Vault 模式**（默认）：

```
高中数学/                    ← 设置里选这一层
├── 题库/                    ← 题目（名字可在设置里改）
│   ├── 25全国1/
│   └── 25全国2/
├── images/                  ← 题目用到的图片
└── 高中数学知识点总表.md      ← 用于校验「章 / 节 / 知识点」三级字段
```

**直接题库模式**：设置里选到 `题库` 这一层，并把「题库子目录名」改为 `.`。

> 目录结构完全由你掌控，程序**不会移动、重命名或删除**任何已有文件。因此 Obsidian 阅读与手动校对不受影响。
> 组卷、编讲义、导出等全部功能对题库**只读**，不产生任何写入。

---

## 桌面版构建

```bash
npm run desktop:build       # 构建 + 装配资源到 desktop/resources/app
npm run desktop:dev         # 用 Electron 启动（开发调试）
npm run desktop:dist        # 打包 Windows 安装包 → desktop/dist
npm run desktop:dist:linux  # 打包 Linux AppImage / deb
```

> ⚠️ **`desktop/resources/` 必须在 `next build` 前清空**，否则 Next 会扫描它导致构建严重劣化。
> `desktop:build` 已内置 `desktop:clean`；手动分步执行时务必先跑 `npm run desktop:clean`。
> 其它踩坑（exe 图标、`.next/lock`、符号链接）见 `docs/使用说明.md` 第十六节。

---

## 服务器版部署

```bash
# Docker（默认不含 pandoc，加 --build-arg INSTALL_PANDOC=1 启用 Word 导出）
docker build -t highmath .
docker run -d -p 3000:3000 -v /srv/mathbank:/data -e VAULT_PATH=/data highmath

# 或裸机
npm run build
VAULT_PATH=/srv/mathbank PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

> standalone 产物**不会**自动包含 `.next/static` 与 `public`，部署时需手动拷贝（`Dockerfile` 已处理）。

---

## 目录结构

```
├── src/                          业务代码（桌面版与服务器版共用）
│   ├── app/                      页面（选题 / 试题篮 / 编讲义 / 添加题目 / 设置）
│   │   ├── api/                  接口（config / knowledge / import / drafts / export-docx …）
│   │   ├── icon.svg              浏览器标签页图标（矢量）
│   │   ├── favicon.ico           浏览器标签页图标（16–48px 位图兜底）
│   │   └── apple-icon.png        iOS 主屏图标 180×180
│   ├── lib/
│   │   ├── config.ts             运行时配置中心（跨平台）
│   │   ├── paths.ts              路径解析（Vault 模式 / 直接题库模式）
│   │   ├── knowledge.ts          知识点总表三级解析与校验
│   │   ├── validate.ts           题目校验
│   │   ├── ingest.ts             入库核心
│   │   ├── questions.ts          题库读取
│   │   ├── basket.ts             试题篮状态
│   │   ├── questionText.ts       题目文本解析/序列化
│   │   ├── handout.ts            讲义引擎（Block / Module / Settings）
│   │   ├── handoutHtml.ts        ★ 讲义 HTML 渲染源（预览与 PDF 共用）
│   │   ├── pdfExport.ts          ★ PDF 导出（桌面 IPC / 网页打印兜底）
│   │   ├── handoutDraft.ts       草稿三级持久化
│   │   ├── handoutExport.ts      讲义导出
│   │   ├── docxFallback.ts       纯 JS DOCX 降级导出
│   │   ├── latexMath.ts          LaTeX → OMML
│   │   └── pandoc.ts             Pandoc 跨平台探测
│   └── components/               导航外壳、题库表格、浏览视图、公式渲染
│       ├── AppShell.tsx          导航外壳（含左上角品牌标识）
│       └── PagedPreview.tsx      ★ A4 分页预览（Paged.js）
├── public/
│   ├── paged.polyfill.js         Paged.js（A4 分页引擎）
│   └── katex/                    KaTeX 样式与字体（导出 HTML 自包含）
├── desktop/                      Electron 外壳
│   ├── main.js                   主进程（启动内置服务、窗口、PDF 导出）
│   ├── preload.js                预加载脚本（暴露 exportPdf 等）
│   ├── electron-builder.yml      打包配置
│   └── build/                    应用图标（icon.ico / icon.png / icon.icns）
├── scripts/                      构建与测试脚本（prepare-desktop / handout-test …）
├── demo-vault/                   自带示例题库（38 题 + 图片 + 知识点总表）
├── Dockerfile                    Linux 部署
├── docker-compose.yml            容器编排
├── docs/                         文档（使用说明 / 设计记录 / 审计报告 / logo.png）
└── LICENSE                       MIT
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/使用说明.md`](docs/使用说明.md) | **完整使用说明**（安装、三大功能、知识点总表、草稿、部署、构建踩坑、FAQ） |
| [`docs/编讲义功能进化迭代方案.md`](docs/编讲义功能进化迭代方案.md) | 编讲义 **PDF 优先架构**的设计方案（v2.0，已实施） |
| [`docs/前端功能优化报告-编讲义与试题篮.md`](docs/前端功能优化报告-编讲义与试题篮.md) | 编讲义 / 试题篮 的设计与实现记录 |
| [`docs/文件审计报告.md`](docs/文件审计报告.md) | 项目文件审计与清理记录 |

---

## 环境要求

- **桌面版**：Windows 10/11（无需 Node.js）
- **源码运行**：Node.js 20+（推荐 22）
- **Word 导出**：可选依赖 [Pandoc](https://pandoc.org/)（未安装时自动降级）
- **PDF 导出**：桌面版内置（Electron 无头打印）；网页版走系统「另存为 PDF」，无需额外依赖
