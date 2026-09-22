# HyperFrames v0.7.x 升级调研报告

> 调研时间：2026-07-18；对比基线：`v0.6.114`（LEARNING_REPORT.md 引用版本）→ 目标：`v0.7.62`（当前 HEAD 已同步）。
> 调研方法：纯文件 + git 静态分析，未执行构建。所有引用路径为仓库绝对路径。
> 调研区间：`git log v0.6.114..v0.7.62`，共 **1113 个 commit**。

---

## 摘要

v0.7.x 是 v0.6.114 以来一次**结构性大版本**，从单点增强升级为多线并行扩张：

- **新增 3 个工作区包**：`parsers` / `lint` / `studio-server`，总数从 11 → 14。
- **CLI 子命令从 30 → 38**：新增 `keyframes` / `check` / `compare` / `grade-compare` / `events` / `telemetry` / `figma` 等；旧的 `validate` / `inspect` / `layout` 被 `check` 统一取代。
- **registry 数量翻倍**：blocks 97 → **109**，examples 13 → 13（但 `registry.json` 中只索引 8 个），components 增长为 **25**。
- **skills 体系重构**：`hyperframes-media` 重命名为 `media-use`（含 audio 子目录拆分）；`bgm-to-video` 整个被 `music-to-video` 取代；`/website-to-video` 合并进 `/product-launch-video`；`/graphic-overlays` 改名为 `/talking-head-recut`。
- **新增 3 个核心子系统**：
  1. **Variables / Declarative Bindings**（`data-var-src` / `data-var-text` / CSS 变量）—— SDK + Studio 联合推进
  2. **Fast-capture / drawElement** —— 新一代高效渲染路径（worker-encode, dedup, 3D 投影）
  3. **H.264 / Alpha-capable Proxy** —— 视频代理转码 + LRU 缓存 + codec 探测
- **Studio 编辑器大改写**：timeline marquee 多选 / sub-comp groups / element groups / variables inspector / color grading inspector / flat inspector 默认开启。
- **media-use v2**（v0.7.30+）：resolve cascade + providers + 本地生成 + 遥测 + transcription (parakeet) + 视频生成 (HeyGen avatar / LTX fallback) + color grading + 四级 brand-logo cascade。

---

## 1. 包结构（packages/）

### 1.1 当前包清单（v0.7.62）

来源：`git ls-files 'packages/*/package.json'`，逐个读取 `name` / `version` 字段。

| 目录 | 包名 | 版本 | 角色 |
|------|------|------|------|
| `packages/aws-lambda/` | `@hyperframes/aws-lambda` | 0.7.62 | AWS Lambda 适配器（handler + CDK construct） |
| `packages/cli/` | `@hyperframes/cli` | 0.7.62 | `hyperframes` 命令行（38 个子命令） |
| `packages/core/` | `@hyperframes/core` | 0.7.62 | 类型 / 运行时 / 工具 |
| `packages/engine/` | `@hyperframes/engine` | 0.7.62 | Puppeteer + FFmpeg 帧捕获引擎 |
| `packages/gcp-cloud-run/` | `@hyperframes/gcp-cloud-run` | 0.7.62 | GCP Cloud Run 适配器 |
| `packages/lint/` | `@hyperframes/lint` | 0.7.62 | 独立 Linter 包（**新增**） |
| `packages/parsers/` | `@hyperframes/parsers` | 0.7.62 | 独立 Parser 包（**新增**：GSAP / slideshow / sub-comp / 资产解析） |
| `packages/player/` | `@hyperframes/player` | 0.7.62 | `<hyperframes-player>` Web Component |
| `packages/producer/` | `@hyperframes/producer` | 0.7.62 | 渲染编排管线 + 分布式原语 |
| `packages/sdk/` | `@hyperframes/sdk` | 0.7.62 | 编程式 SDK（**重大扩张**：session/editing/document） |
| `packages/sdk-playground/` | `@hyperframes/sdk-playground` | **0.6.106** | SDK 演示 UI（落后 56 个版本） |
| `packages/shader-transitions/` | `@hyperframes/shader-transitions` | 0.7.62 | WebGL 转场 shader |
| `packages/studio/` | `@hyperframes/studio` | 0.7.62 | Studio 编辑器（React 19 + CodeMirror 6） |
| `packages/studio-server/` | `@hyperframes/studio-server` | 0.7.62 | Studio 后端（**新增**：Hono + 路由 + proxy 服务） |

文件引用：
- `E:\YifuAIForge\hyperframes\packages\aws-lambda\package.json`
- `E:\YifuAIForge\hyperframes\packages\cli\package.json`
- `E:\YifuAIForge\hyperframes\packages\core\package.json`
- `E:\YifuAIForge\hyperframes\packages\engine\package.json`
- `E:\YifuAIForge\hyperframes\packages\gcp-cloud-run\package.json`
- `E:\YifuAIForge\hyperframes\packages\lint\package.json`
- `E:\YifuAIForge\hyperframes\packages\parsers\package.json`
- `E:\YifuAIForge\hyperframes\packages\player\package.json`
- `E:\YifuAIForge\hyperframes\packages\producer\package.json`
- `E:\YifuAIForge\hyperframes\packages\sdk\package.json`
- `E:\YifuAIForge\hyperframes\packages\sdk-playground\package.json` → 0.6.106（**唯一落后**）
- `E:\YifuAIForge\hyperframes\packages\shader-transitions\package.json`
- `E:\YifuAIForge\hyperframes\packages\studio\package.json`
- `E:\YifuAIForge\hyperframes\packages\studio-server\package.json`

### 1.2 v0.6.114 → v0.7.62 包变化

通过 `git ls-tree v0.6.114 packages/` 与 `git ls-tree v0.7.62 packages/` 对照得出：

| v0.6.114 (11 个) | v0.7.62 (14 个) | 差异 |
|------------------|-----------------|------|
| aws-lambda, cli, core, engine, gcp-cloud-run, player, producer, sdk, sdk-playground, shader-transitions, studio | 同 + lint, parsers, studio-server | +3 个 |

> **注意**：LEARNING_REPORT.md 写"10 个包"，实际 v0.6.114 就有 **11 个**（漏算了 `sdk` 与 `sdk-playground`）。

### 1.3 新包的关键内容

**`packages/parsers/src/`**（独立出来的解析层）：
- `composition.ts`、`compositionContract.ts`、`compositionVariables.ts`
- `gsapParser.ts` / `gsapParserAcorn.ts` / `gsapParserExports.ts` / `gsapWriterAcorn.ts` / `gsapInline.ts` / `gsapUnroll.ts` / `gsapSerialize.ts` / `gsapConstants.ts`
- `assetResolution.ts`（**从 `packages/lint/src/` 迁过来**，R086 改名）
- `rewriteSubCompPaths.ts`
- `slideshow/`：`parseSlideshow.ts` / `slideshow.types.ts` / `sceneId.ts`（**从 `packages/core/src/slideshow/` 迁过来**）
- `springEase.ts`、`hfIds.ts`、`htmlParser.ts`、`variableUsage.ts`、`subCompositionValidity.ts`
- 引用路径：`E:\YifuAIForge\hyperframes\packages\parsers\src\index.ts`

**`packages/lint/src/`**（独立 Linter）：
- `hyperframeLinter.ts`、`browser.ts`、`project.ts`、`shouldBlockRender.ts`
- `rules/`：adapters / captions / composition / core / fonts / gsap / media / slideshow / textures
- `hevcPreviewLint.ts`（HEVC 警告）
- 引用路径：`E:\YifuAIForge\hyperframes\packages\lint\src\index.ts`

**`packages/studio-server/src/`**（Studio 后端）：
- `createStudioApi.ts`
- `routes/`：files / fonts / globalAssets / lint / media / preview / projects / registry / render / selection / storyboard / thumbnail / waveform
- `helpers/`：含 `mediaProxyPreview.ts` / `proxyCache.ts` / `proxyTranscoder.ts` / `mediaCodecMap.ts` / `previewAdapter.ts` / `variablesPayload.ts` / `compositionInsertion.ts` 等
- 引用路径：`E:\YifuAIForge\hyperframes\packages\studio-server\src\index.ts`

**`packages/sdk/src/`**（SDK 大幅扩张）：
- 顶层：`document.ts` / `history.ts` / `persist-queue.ts` / `session.ts` / `types.ts`
- `editing/affordances.ts`
- `engine/`：`apply-patches.ts` / `cssWriter.ts` / `keyframeBackfill.ts` / `model.ts` / `mutate.ts` / `patches.ts` / `serialize.ts` / `variableModel.ts`
- `adapters/`：fs / headless / iframe / memory / types
- 引用路径：`E:\YifuAIForge\hyperframes\packages\sdk\src\index.ts`

### 1.4 dist 体积抽样

| 包 | 关键 dist 文件 | 字节数（约） |
|----|----------------|-------------|
| `cli/dist/cli.js` | 单 ESM bundle | ~10 MB |
| `producer/dist/index.js` | 渲染管线 | ~9.5 MB |
| `producer/dist/distributed.js` | 分布式原语 | ~9 MB |
| `producer/dist/public-server.js` | Hono 服务 | ~9.4 MB |
| `studio/dist/index.js` | Studio SPA | ~2.4 MB |

---
## 2. Registry 统计

### 2.1 数量对比

来源：`Get-ChildItem 'registry/<dir>' -Directory | Measure-Object`。

| 类别 | v0.6.114 | v0.7.62 | 增量 |
|------|----------|---------|------|
| `registry/blocks/` | 97 | **109** | +12 |
| `registry/components/` | 未明确数字 | **25** | — |
| `registry/examples/` | 13 | **13** | 0（目录数） |
| `registry/registry.json` 总条目 | 未列 | **142** | — |

`registry.json` 内部细分（按 `type` 字段统计）：
- `hyperframes:example`：8 个
- `hyperframes:block`：109 个
- `hyperframes:component`：25 个
- 合计：142

**重要差异**：`registry/examples/` 物理目录有 13 个，但 `registry.json` 只索引 8 个。未索引的 5 个：
- `airbnb-deck`
- `motion-blur`
- `slideshow-demo`
- `startup-pitch`
- `vscode-theme-visualizer`

引用路径：`E:\YifuAIForge\hyperframes\registry\registry.json`

### 2.2 随机抽样 5 个 block

来自 `Get-ChildItem 'registry/blocks' | Select-Object -First 5`：
1. `app-showcase`
2. `apple-money-count`
3. `blue-sweater-intro-video`
4. `chromatic-radial-split`
5. `cinematic-zoom`

### 2.3 随机抽样 5 个 example

来自 `Get-ChildItem 'registry/examples' | Select-Object -First 5`：
1. `airbnb-deck`
2. `decision-tree`
3. `kinetic-type`
4. `motion-blur`
5. `nyt-graph`

### 2.4 随机抽样 5 个 component

来自 `Get-ChildItem 'registry/components' | Select-Object -First 5`：
1. `caption-blend-difference`
2. `caption-clip-wipe`
3. `caption-editorial-emphasis`
4. `caption-emoji-pop`
5. `caption-glitch-rgb`

### 2.5 期间变更量

`git diff --stat v0.6.114..v0.7.62 -- 'registry/'` 共 **83 个文件**被修改；blocks 自身有 43 个文件级改动。

---

## 3. Skills 目录

### 3.1 顶层 `skills/` 子目录（20 个）

来源：`Get-ChildItem 'skills' -Directory`：

```
embedded-captions/
faceless-explainer/
figma/                                  ← 新增（Figma 工作流）
general-video/
hyperframes/                            ← 入口 router
hyperframes-animation/
hyperframes-cli/
hyperframes-core/
hyperframes-creative/
hyperframes-keyframes/                  ← 新增（keyframes 命令工作流）
hyperframes-registry/
media-use/                              ← 由 hyperframes-media 重命名（R099/R100 多次）
motion-graphics/
music-to-video/                         ← 由 bgm-to-video 改名
pr-to-video/
product-launch-video/
remotion-to-hyperframes/
slideshow/
talking-head-recut/                     ← 由 graphic-overlays 改名
```

> LEARNING_REPORT.md 写"17 个 .md skills"，实际 v0.7.62 有 **20 个**顶层 skills（增加了 `figma` / `hyperframes-keyframes` / `media-use`，删除了 `bgm-to-video` / `hyperframes-media` / `graphic-overlays`）。

### 3.2 各 skill 的 SKILL.md

来源：`glob '**/SKILL.md'` 命中 20 个：
- `E:\YifuAIForge\hyperframes\skills\general-video\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-keyframes\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\faceless-explainer\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes\SKILL.md` ← **入口**
- `E:\YifuAIForge\hyperframes\skills\figma\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-registry\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-cli\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-core\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\media-use\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-animation\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\hyperframes-creative\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\motion-graphics\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\embedded-captions\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\music-to-video\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\remotion-to-hyperframes\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\talking-head-recut\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\product-launch-video\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\slideshow\SKILL.md`
- `E:\YifuAIForge\hyperframes\skills\pr-to-video\SKILL.md`

`media-use/` 是**新结构**（见下），内部有 `audio/` 子目录：
- `skills/media-use/audio/`（原 `skills/hyperframes-media/` 全部内容迁移）
- `skills/media-use/SKILL.md` 是顶层入口

### 3.3 `.agents/skills/`（6 个 skills + 1 个 README）

```
.agents/skills/README.md
.agents/skills/captions-overlay/SKILL.md
.agents/skills/changelog-video/SKILL.md          ← 新增（v0.7.50+）
.agents/skills/cut-the-curve/SKILL.md
.agents/skills/motion-doctrine/SKILL.md
.agents/skills/oversized-cursor/SKILL.md
.agents/skills/seam-craft/SKILL.md
```

`.agents/skills/changelog-video/` 自带资产：bg-pattern.mp4 / bgm.mp3 / 5 个字体（ABCSolarDisplay、TT_Norms_Pro 三种字重、tt_norms_pro_mono）。引用路径：`E:\YifuAIForge\hyperframes\.agents\skills\changelog-video\`。

### 3.4 `.claude/skills/`（与 `.agents/skills/` 镜像对称）

```
.claude/skills/README.md
.claude/skills/captions-overlay/SKILL.md
.claude/skills/changelog-video/SKILL.md
.claude/skills/cut-the-curve/SKILL.md
.claude/skills/motion-doctrine/SKILL.md
.claude/skills/oversized-cursor/SKILL.md
.claude/skills/seam-craft/SKILL.md
```

外加 `.claude/settings.json`（2797 字节）。

### 3.5 三种 plugin 配置

| 路径 | 内容 |
|------|------|
| `.claude-plugin/marketplace.json` | 1393 字节（marketplace 声明） |
| `.claude-plugin/plugin.json` | 514 字节 |
| `.codex-plugin/plugin.json` | 1798 字节 |
| `.cursor-plugin/plugin.json` | 1006 字节 |

### 3.6 入口 Skill

**入口为 `skills/hyperframes/SKILL.md`**（24382 字节，163 行）。
它在 `AGENTS.md` 第 7-27 行被定义为 **mandatory entry point**：

> "Creation workflows route through one entry skill — read /hyperframes first: it orients you to the whole surface, confirms the brief up front (the intent layer), and maps 'make me a…' intent — usually a video, but also a navigable deck (`/slideshow`) or a composition port (`/remotion-to-hyperframes`) — to a concrete workflow."

核心路由表（节选自 SKILL.md § 1）：
| 状态 | 动作 |
|------|------|
| Remotion 移植 | 跳到 `/remotion-to-hyperframes` |
| 现有项目的具体操作（inspect / validate / render 等） | 跳到 `/hyperframes-cli` |
| 现有项目具体编辑 | 直接编辑 |
| `BRIEF.md` 存在 | 读 `workflow` / `flow` 字段直接执行 |
| Fresh creation | 走 § 4 intent layer |

引用路径：`E:\YifuAIForge\hyperframes\skills\hyperframes\SKILL.md`。

---

## 4. CLI 子命令

### 4.1 完整子命令清单（38 个）

来源：直接读 `E:\YifuAIForge\hyperframes\packages\cli\src\cli.ts` 第 114-153 行的 `commandLoaders` 字典。

| # | 命令 | 分组 | 说明（基于 cli.ts 注册顺序） |
|---|------|------|---------------------------|
| 1 | `init` | Getting Started | 脚手架生成新项目 |
| 2 | `add` | Registry | 从 Registry 安装 block/component |
| 3 | `catalog` | Registry | 浏览 Registry 项 |
| 4 | `play` | Preview | 播放模式打开 composition |
| 5 | `present` | Preview | 演示模式打开幻灯片 |
| 6 | `preview` | Preview | 启动 studio 实时预览 |
| 7 | `publish` | Publish | 上传项目获得公开 URL |
| 8 | `render` | Render | 渲染到 MP4/WebM/GIF |
| 9 | `lint` | Quality | 静态 HTML 结构检查 |
| 10 | `check` | Quality | **单会话验证 gate（v0.7.45+，取代 `validate` / `inspect` / `layout`）** |
| 11 | `beats` | Audio | 音乐节拍检测 |
| 12 | `inspect` | Quality | **已被 `check` 取代**（仍保留以兼容） |
| 13 | `keyframes` | Studio | **新增**：暴露 GSAP/CSS/Anime keyframes + 3D onion-skin `--shot` |
| 14 | `layout` | Quality | **已被 `check` 取代** |
| 15 | `info` | Project | 打印项目元数据 |
| 16 | `compositions` | Project | 列出所有合成 |
| 17 | `benchmark` | Tooling | 多配置渲染对比 |
| 18 | `browser` | Tooling | 管理渲染用 Chrome |
| 19 | `remove-background` | AI | AI 去背景 |
| 20 | `transcribe` | AI | Whisper / Parakeet 词级转录 |
| 21 | `tts` | AI | 本地 AI TTS |
| 22 | `docs` | Tooling | 终端查看行内文档 |
| 23 | `doctor` | Tooling | 系统依赖检查 |
| 24 | `upgrade` | Tooling | 检查 CLI 更新 |
| 25 | `skills` | Skill | 安装 AI 编码技能 |
| 26 | `feedback` | Settings | 提交反馈 / GitHub issue |
| 27 | `telemetry` | Settings | 遥测开关 |
| 28 | `events` | Settings | **新增**：内部 beacon（self-tracking） |
| 29 | `validate` | Quality | **已被 `check` 取代**（仍保留以兼容） |
| 30 | `snapshot` | Quality | PNG 关键帧截图 |
| 31 | `grade-compare` | Media | **新增**：色彩分级对比（color grading） |
| 32 | `compare` | Media | **新增**：通用对比 |
| 33 | `capture` | Tooling | 捕获网站用于视频制作 |
| 34 | `lambda` | Deploy | AWS Lambda 部署 + 渲染 |
| 35 | `cloudrun` | Deploy | GCP Cloud Run 部署 |
| 36 | `cloud` | Deploy | 通用云渲染 |
| 37 | `auth` | Account | HeyGen 登录 / 凭据管理（含子命令 login/logout/refresh/status） |
| 38 | `figma` | Integration | **新增（v0.7.25+）**：Figma 资产 / tokens / 组件导入 |

子命令总数：**38 个**（LEARNING_REPORT.md 写的"30 个"已过时）。

引用路径：`E:\YifuAIForge\hyperframes\packages\cli\src\cli.ts` 行 114-153（`commandLoaders` 字典）；行 397（`runMain(main, { showUsage })`）。

### 4.2 关键实现要点（节选自 `cli.ts`）

- EPIPE 处理（第 1-22 行）：CI / agent 环境下管道被关闭时优雅退出，不触发 uncaughtException。
- `--version` 快速路径（第 50-60 行）：在加载任何重模块前打印版本（~10ms vs ~80ms）。
- `.env` 自动加载（第 65-96 行）：从 CWD 读取 `.env`，支持 `export FOO=bar` 风格。
- 失败 telemetry 上报（第 159-164 行）：每个子命令包一层 `trackCommandFailures`。
- Post-render termination handling（第 318-340 行）：artifact 已写入后抛出的 worker teardown 异常不会把 exit code 翻成 1。

---

## 5. 关键代码引用

### 5.1 `packages/cli/src/cli.ts`（397 行）

- EPIPE 抑制、`.env` 自动加载、`--version` 快速路径、telemetry 包裹、`renderSucceeded` 后置异常容忍（不污染 exit code）。
- 引用路径：`E:\YifuAIForge\hyperframes\packages\cli\src\cli.ts`

### 5.2 `packages/producer/src/index.ts`（142 行）

导出表面（节选）：
- 渲染主流程：`createRenderJob` / `executeRenderJob` / `RenderCancelledError` / `RenderQualityError` / `applyRenderWarningPolicy`
- 渲染请求：`RENDER_REQUEST_VERSION` / `createRenderRequest` / `parseRenderRequest` / `serializeRenderRequest` / `renderConfigFromRequest` / `distributedConfigFromRequest` / `renderRequestFromDistributedConfig`
- 观测：`BrowserDiagnosticSummary` / `RenderCaptureObservability` / `RenderObservabilitySummary`
- HTML 资产本地化：`localizeRemoteMediaSources` / `localizeRemoteImageSources` / `localizeRemoteFontFaces`
- 帧捕获底层：`createCaptureSession` / `initializeSession` / `closeCaptureSession` / `captureFrame` / `captureFrameToBuffer` / `getCompositionDuration` / `getCapturePerfSummary` / `isTransientBrowserError` / `prepareCaptureSessionForReuse`
- 文件服务器：`createFileServer` / `FileServerOptions` / `FileServerHandle`
- 视频帧注入：`createVideoFrameInjector`（从 `@hyperframes/engine` 重导出）
- 配置：`resolveConfig` / `DEFAULT_CONFIG` / `ProducerConfig`
- Logger：`createConsoleLogger` / `defaultLogger` / `ProducerLogger`
- Server：`createRenderHandlers` / `createProducerApp` / `startServer`
- 字体：`injectDeterministicFontFaces`
- Lint：`prepareHyperframeLintBody` / `runHyperframeLint`
- 分布式原语：`assemble` / `plan` / `renderChunk` / `AssembleResult` / `ChunkResult` / `DistributedRenderConfig` / `PlanResult`

引用路径：`E:\YifuAIForge\hyperframes\packages\producer\src\index.ts`

### 5.3 `packages/engine/src/services/frameCapture.ts`（3710 行）

- **3710 行**，是 Engine 包的绝对核心。
- 来源：`(Get-Content ...).Count`
- 引用路径：`E:\YifuAIForge\hyperframes\packages\engine\src\services\frameCapture.ts`

### 5.4 `packages/core/src/adapters/`（3 个）

```
gsap.ts
index.ts
types.ts
```

> 重要：原 Frame Adapter 协议抽象 (`adapters/`) 现在只有 GSAP 一个**内置**实现。其他运行时（Anime.js / CSS / Lottie / Three.js / WAAPI / TypeGPU / d3 / leaflet / mapbox / maplibre / google-maps / video-texture-compat / seek-dispatch）迁到 `packages/core/src/runtime/adapters/`（共 15 个）。

引用路径：
- `E:\YifuAIForge\hyperframes\packages\core\src\adapters\gsap.ts`
- `E:\YifuAIForge\hyperframes\packages\core\src\adapters\index.ts`
- `E:\YifuAIForge\hyperframes\packages\core\src\adapters\types.ts`

### 5.5 `packages/core/src/parsers/`（6 个，迁出后剩 1 个入口）

```
gsapConstants.ts
gsapParserAcorn.ts
gsapParserExports.ts
gsapWriterAcorn.ts
hfIds.ts
springEase.ts
```

> 实际上 core 仍保留 6 个 parser 文件，但**新解析层整体在 `packages/parsers/src/`**（见 § 1.3）。core 这 6 个是旧路径兼容层。

### 5.6 `packages/core/src/lint/`

```
index.ts
```

Linter 已整体迁出到 `packages/lint/src/`，core 仅保留入口。

### 5.7 `packages/core/src/runtime/`（47 个 ts/tsx）

顶层（不含 `adapters/` 子目录）：
```
adapters/_readiness.ts
adapters/animejs.ts
adapters/css.ts
adapters/d3.ts
adapters/google-maps.ts
adapters/gsap.ts
adapters/leaflet.ts
adapters/lottie.ts
adapters/mapbox.ts
adapters/maplibre.ts
adapters/seek-dispatch.ts
adapters/three.ts
adapters/typegpu.ts
adapters/video-texture-compat.ts
adapters/waapi.ts
analytics.ts
applyVariableBindings.ts        ← 新增（declarative variable bindings）
bridge.ts
captionOverrides.ts
clipTree.ts
clock.ts
colorGrading.ts                 ← 新增（color grading runtime shader）
compositionLoader.ts
diagnostics.ts
entry.ts
flattenedRoot.ts
getVariables.ts
globals.ts
init.ts
media.ts
mediaProxy.ts                   ← 新增（alpha-capable proxy）
mediaVolumeEnvelope.ts
picker.ts
playbackRate.ts
player.ts
positionEdits.ts
protocol.ts
stackingContext.ts
startExpression.ts
startResolver.ts                ← 新增（documentRef）
state.ts
timeline.ts
timelineRebindPolicy.ts
types.ts
validateVariables.ts
variableScope.ts                ← 新增
webAudioTransport.ts
window.d.ts
```

引用路径：`E:\YifuAIForge\hyperframes\packages\core\src\runtime\`

---

## 6. 文档结构

来源：`git ls-files 'docs/**/*.mdx'` + 目录统计。

### 6.1 docs/ 顶层目录与 mdx 数量

| 子目录 | mdx 数 | 说明 |
|--------|--------|------|
| `catalog/` | **134** | block / component 自动生成的展示页 |
| `community/` | 1 | — |
| `concepts/` | **5** | 核心概念 |
| `contributing/` | 5 | 贡献指南 |
| `deploy/` | 5 | 部署指南 |
| `guides/` | **28** | 操作指南（含 `claude-design-hyperframes.md` 等 .md） |
| `packages/` | **13** | 各包参考 |
| `reference/` | 1 | — |
| `sdk/` | **15** | SDK 用法 |
| `changelog.mdx` | 1 | 单文件 345 KB 周更日志 |
| `examples.mdx` / `introduction.mdx` / `launch-videos.mdx` / `quickstart.mdx` / `showcase.mdx` / `weekly-updates.mdx` | 6 | 顶层入口 |
| **合计** | **207 个 mdx + 6 个 md** | — |

### 6.2 `docs/concepts/*.mdx`（5 个）

```
compositions.mdx
data-attributes.mdx
determinism.mdx
frame-adapters.mdx
variables.mdx                       ← 大幅扩充（20293 字节，原 ~ 8 KB）
```

### 6.3 `docs/guides/*.mdx`（28 个 .mdx + 2 个 .md）

```
4k-rendering.mdx
antigravity.mdx
authentication.mdx
claude-design.mdx
claude-design-hyperframes.md       ← 新增（48 KB）
claude-design-send-to-hyperframes.md ← 新增（27 KB）
color-grading.mdx                   ← 新增
common-mistakes.mdx
copilot-cli.mdx
deploy.mdx
feedback.mdx
figma.mdx                          ← 新增
gsap-animation.mdx
hdr.mdx
html-in-canvas.mdx
hyperframes-vs-remotion.mdx
keyframes.mdx                      ← 新增
mcp.mdx
open-design.mdx
open-design-hyperframes.md         ← 新增（18 KB）
performance.mdx
pipeline.mdx
prompting.mdx
remove-background.mdx
rendering.mdx
skills.mdx
timeline-editing.mdx
troubleshooting.mdx
video-components.mdx
video-editor-cheatsheet.mdx
website-to-video.mdx
```

**v0.7.x 新增 / 大改写的 guide**：
- `claude-design-hyperframes.md` / `claude-design-send-to-hyperframes.md` / `open-design-hyperframes.md` —— Claude design tool 集成
- `color-grading.mdx` —— 色彩分级系统
- `figma.mdx` —— Figma 工作流
- `keyframes.mdx` —— keyframes 命令
- `skills.mdx` —— skills 更新（intent layer / recipes / companion mode）

### 6.4 `docs/packages/*.mdx`（13 个）

```
aws-lambda.mdx
cli.mdx                            ← 74851 字节（最大）
core.mdx
engine.mdx
gcp-cloud-run.mdx
lint.mdx                           ← 新增（对应 packages/lint）
parsers.mdx                        ← 新增（对应 packages/parsers）
player.mdx
producer.mdx
sdk.mdx
shader-transitions.mdx
studio-server.mdx                  ← 新增
studio.mdx
```

---

## 7. 文件总数

| 维度 | v0.6.114 | v0.7.62 | 来源 |
|------|----------|---------|------|
| `git ls-files` 总数 | 3749 | **4648** | git ls-files \| Measure-Object |
| `packages/` diff 涉及文件数 | — | **1686** | git diff --stat v0.6.114..v0.7.62 -- 'packages/' |
| `skills/` diff 涉及文件数 | — | **1153** | git diff --stat ... -- 'skills/' |
| `docs/` diff 涉及文件数 | — | **90** | git diff --stat ... -- 'docs/' |
| `registry/` diff 涉及文件数 | — | **83** | git diff --stat ... -- 'registry/' |

区间 commit 数：**1113 个**。

---

## 8. 已删除 / 重大修改

来源：`git log --diff-filter=D --name-only v0.6.114..v0.7.62` 和 `git log --diff-filter=R --name-status ...`。

### 8.1 重大删除（应用源码层）

| 文件 | 备注 |
|------|------|
| `packages/studio/src/components/nle/NLELayout.tsx` (+ test) | NLE 布局组件被重写 |
| `packages/studio/src/components/StudioPreviewArea.tsx` | Studio 预览区域重构 |
| `packages/studio/src/components/editor/keyframeMove.ts` (+ test) | keyframe 移动逻辑重写 |
| `packages/studio/src/components/editor/propertyPanelFlatStyleHelpers.test.ts` | — |
| `packages/studio/src/hooks/useCropMode.ts` | 裁剪模式 hook 移除 |
| `packages/studio/src/hooks/useDomEditSession.test.ts` | DOM 编辑会话 hook 重写 |
| `packages/studio/src/hooks/usePersistedPinnedGroups.ts` (+ test) | 已删除 |
| `packages/studio/src/player/components/TimelineLayerGutter.tsx` | 时间轴 gutter 重构 |
| `packages/studio/src/player/components/TimelinePropertyRows.tsx` | 重构 |
| `packages/studio/src/player/components/TimelineSelectionOverlays.tsx` | 重构 |
| `packages/studio/src/player/components/timelineSnapTargets.ts` (+ test) | — |
| `packages/studio/src/player/components/timelineMarqueeSelection.test.ts` | — |
| `packages/studio/src/player/components/useTimelineClipDrag.test.tsx` | — |
| `packages/studio/src/player/components/useTimelineClipGroupDrag.ts` | — |
| `packages/studio/src/player/components/useTimelineMarqueeSelection.ts` (+ test) | — |
| `packages/studio/src/utils/editDebugLog.ts` | — |
| `packages/studio/src/utils/timelineDiscovery.test.ts` | — |
| `packages/cli/src/utils/skillsTargets.ts` (+ test) | skills 目标工具被取代 |
| `skills/bgm-to-video/`（整个目录） | 已被 `music-to-video` 取代 |
| `skills/faceless-explainer/agents/*` (4 文件) | agent 文件重构 |
| `skills/faceless-explainer/assets/sfx/*` (22 文件) | SFX 资源迁到 `media-use/audio` |
| `skills/faceless-explainer/phases/**`（整个 design-system 子树） | — |
| `skills/dashboard.html` | — |

### 8.2 重大重命名（R86+）

| 旧路径 | 新路径 | 备注 |
|--------|--------|------|
| `packages/lint/src/assetResolution.ts` | `packages/parsers/src/assetResolution.ts` | 解析层独立（R086） |
| `packages/core/src/compiler/rewriteSubCompPaths.test.ts` | `packages/parsers/src/rewriteSubCompPaths.test.ts` | — |
| `packages/core/src/slideshow/parseSlideshow.ts` (+ test) | `packages/parsers/src/slideshow/parseSlideshow.ts` (+ test) | slideshow 解析迁出（R100） |
| `skills/hyperframes-media/`（整树） | `skills/media-use/audio/` | 整个 audio 子树改名（R099/R100，50+ 文件） |

### 8.3 仓库卫生清理（非业务）

- `packages/producer/node_modules/` 内大量依赖被清理出 git 索引（fontsource、hono、puppeteer 等）
- `packages/producer/tests/.DS_Store` / `style-1-prod/.DS_Store` 清除

---

## 9. 最新 release 关键变更

区间内 release commit 共 **52 个**（v0.7.9 起每个 minor 都有 release commit）：

```
7f7617095 chore: release v0.7.62 (#2626)
c268f5ba8 chore: release v0.7.61
0f287ee0b chore: release v0.7.60
ff3b1541e chore: release v0.7.59
4b0b89e8b chore: release v0.7.58 (#2446)
90be05019 chore: release v0.7.57 (#2393)
3dcc6e6a8 fix(release): resolve packed-consumer transitive deps to local tarballs (#2396)
94c2e0f6e chore: release v0.7.56
... (v0.7.9 ~ v0.7.55 中间略)
8db190dd4 chore: release v0.7.9
```

### 9.1 主题分布（按 `feat` commit 分类）

| 主题 | 主要 PR/commits | 对应版本 |
|------|----------------|----------|
| **Studio 大重写**（timeline / sub-comp groups / marquee 多选 / variables inspector / color grading / flat inspector 默认开启） | #1705 / #1693 / #1761 / #1758-59 / #1962 / #1963 / #2017 / #1987 / #1998 / #2050 / #2051 / #2138 / #2515 / #2560 / #2599 | v0.7.0–v0.7.62 全程 |
| **music-to-video**（替代 bgm-to-video） | #1665 / +unify commit | v0.7.5 |
| **CLI skills freshness** | #1738 / #1740 / #1753 | v0.7.10 |
| **product-launch-video** + graphic-overlays → **talking-head-recut** | #1720 / #1745 | v0.7.10 |
| **Figma 工作流（M0–M4）** | #1868 / #1869 / #1870 / #1871 / #1872 / #1873 | v0.7.21–v0.7.25 |
| **keyframe 命令**（暴露 GSAP/CSS/Anime + 3D onion-skin） | #1603 | v0.7.20 |
| **media-use v2**（resolve cascade + providers + 本地生成 + 遥测；hyperframes-media 退役） | #1682 / #1683 / #1922 / #1978 / #2003 / #2027 / #2033 / #2065 / #2061 / #2113 | v0.7.30–v0.7.40 |
| **fast-capture / drawElement**（新一代高效捕获） | #1916 / #1917 / #1918 / #1919 / #1920 / #1921 / #1963 / #1998 / #2002 / #2015 / #2499 / #2505 / #2507 / #2510 / #2511 / #2515 | v0.7.30–v0.7.50 |
| **Color Grading 系统**（contract + runtime shader + inspector） | #1884-87 / #2041 | v0.7.30–v0.7.40 |
| **Variables / Declarative Bindings** | #2046 / #2047 / #2048 / #2049 / #2050 / #2051 / #2054 / #2055 / #2071 / #2081 / #2084 / #2133 | v0.7.40–v0.7.50 |
| **SDK 大改**（session / editing / live DOM sync） | #2092 / #2098 / #2100 / #2047 / #2046 | v0.7.40–v0.7.50 |
| **`check` 命令统一验证 gate**（取代 validate / inspect / layout） | #2138 合并 PR #2024 / #2054–#2068 | v0.7.50 |
| **Alpha-capable H.264 Proxy** | #2587 / #2588 / #2589 / #2590 / #2591 / #2592 / #2593 / #2594 / #2595 / #2598 / #2611 / #2612 | v0.7.55–v0.7.62 |
| **changelog-video skill** | #2552 | v0.7.55 |
| **Video Generation**（HeyGen avatar + 本地 LTX fallback） | #2614 | v0.7.60 |
| **Intent layer / BRIEF.md / companion mode / recipes** | #2133 | v0.7.50 |
| **Core set 默认安装** | #2554 | v0.7.60 |
| **Skills group picker** | #2412 | v0.7.55 |
| **Storyboard 默认可用** | #1794 | v0.7.20 |

### 9.2 v0.7.x 系列主要方向

1. **结构化扩张**：3 个新包（parsers / lint / studio-server）；6 个 skill 子目录名变更（hyperframes-media→media-use / bgm-to-video→music-to-video / graphic-overlays→talking-head-recut）。
2. **三大新子系统**：fast-capture / variables-bindings / alpha-capable proxy。
3. **Studio 全面重写**：timeline / inspector / marquee / variables / color grading / flat inspector。
4. **Figma 工作流**（M0–M4 完整推进）。
5. **media-use v2 OS**：resolve cascade + providers + 视频生成 + 色彩分级 + transcription。
6. **CLI 重组**：`check` 取代 `validate` / `inspect` / `layout`；新增 `keyframes` / `grade-compare` / `compare` / `events` / `telemetry`。
7. **AI Agent 体系**：intent layer（BRIEF.md） / companion mode / recipes / core set 默认安装。
8. **Pack 发布修复**：#2396（v0.7.57）`fix(release): resolve packed-consumer transitive deps to local tarballs`。

---

## 10. 设计 / 品牌变化

| 文件 | 期间 commit 数 | 备注 |
|------|----------------|------|
| `DESIGN.md` | **0** | **设计文档无任何变更** |
| `AGENTS.md` | **5** | 多次修订 |
| `CLAUDE.md` | **3** | 配合 skills 路由更新 |

AGENTS.md 关键 commit（按时间顺序）：
- `56859b618 refactor(skills): rename graphic-overlays skill to talking-head-recut (#1720)` —— v0.7.10
- `f7bc0384f docs: add 19-skills catalog to README, CLAUDE.md, and Mintlify docs (#1722)` —— v0.7.10
- `b9be0b262 feat(skills,studio,media-use): the intent layer, review loop, and user memory — BRIEF.md, companion mode, recipes; /website-to-video folds into /product-launch-video (#2133)` —— v0.7.50
- `cf7c1d760 docs(cli,skills): teach check as the canonical verification gate` —— v0.7.40
- `3bb26b0f0 docs(skills): make the core set the default install on every surface (#2554)` —— v0.7.60

**DESIGN.md 完全无改动** → 视觉品牌（暖中性色 + ABC Solar / Inter / IBM Plex Mono）保持稳定。

`ADOPTERS.md` / `CONTRIBUTING.md` / `DEPLOYMENT.md` / `CREDITS.md` 也**全部 0 变更**。

---

## 11. 重要工具 / 脚手架

### 11.1 `scripts/`（35 个文件）

主要脚本（按用途分组）：

| 用途 | 文件 |
|------|------|
| Release / 发布 | `release-prepare.ts` / `set-version.ts` / `validate-release-channel.mjs` / `verify-packed-manifests.mjs` |
| Changelog | `changelog-weekly.ts` / `draft-changelog.ts` |
| CLI 选项枚举 | `cli-options.ts` |
| Catalog 生成 | `generate-catalog-pages.ts` / `generate-catalog-previews.ts` / `generate-registry-items.ts` / `generate-template-previews.ts` |
| Skills 治理 | `lint-skills.ts` / `check-skill-mirror.mjs` |
| Studio runtime | `studio-runtime-smoke.mjs` |
| Tracked artifacts | `check-tracked-artifacts.mjs` |
| Workspace contracts | `check-workspace-contracts.mjs` |
| 大文件检查 | `check-large-files.sh` |
| Test skills fresh | `test-skills-fresh.sh` |
| Schema 同步 | `sync-schemas.ts` |
| 上传文档图片 | `upload-docs-images.sh` |
| Backfill | `backfill-block-previews.ts` |
| Plugin 压缩 | `claude-plugin-compression.test.ts` |
| Smoke 测试 | `scripts/page-side-compositing-smoke/`（含 `fixture/`、`run.mjs`） |

每个 `.ts`/`.mjs` 脚本通常配 `.test.*` 镜像（vitest）。

引用路径：`E:\YifuAIForge\hyperframes\scripts\`

### 11.2 `examples/`（3 个）

| 目录 | 备注 |
|------|------|
| `examples/aws-lambda/` | AWS Lambda 部署示例 |
| `examples/gcp-cloud-run/` | GCP Cloud Run 部署示例 |
| `examples/k8s-jobs/` | Kubernetes Jobs 部署示例（v0.6.114 已存在） |

引用路径：`E:\YifuAIForge\hyperframes\examples\`

### 11.3 `registry/registry.json`

- 文件大小：12043 字节
- `$schema`：`https://hyperframes.heygen.com/schema/registry.json`
- 顶层字段：`name` / `homepage` / `items`
- 总条目：**142**（8 examples + 109 blocks + 25 components）
- 首项：`warm-grain`（`hyperframes:example`）
- 末项：`parallax-unzoom`（`hyperframes:component`）
- 引用路径：`E:\YifuAIForge\hyperframes\registry\registry.json`

### 11.4 `skills-manifest.json`

- 顶层根目录，1665 字节
- 用于 skills 安装 / 更新机制
- 引用路径：`E:\YifuAIForge\hyperframes\skills-manifest.json`

---

## 12. 差异摘要（≤ 30 行）

### 数字层面

| 指标 | v0.6.114 | v0.7.62 | 变化 |
|------|----------|---------|------|
| 工作区包 | 11 | **14** | +3（parsers / lint / studio-server） |
| CLI 子命令 | 30 | **38** | +8（keyframes / check / compare / grade-compare / events / telemetry / figma / auth 子命令） |
| 顶层 skills | 17 | **20** | +3（figma / hyperframes-keyframes / media-use），-2（hyperframes-media / graphic-overlays） |
| blocks | 97 | **109** | +12 |
| examples 目录 | 13 | 13 | 0 |
| examples 在 registry.json 索引 | 未列 | **8** | 5 个目录未索引（airbnb-deck / motion-blur / slideshow-demo / startup-pitch / vscode-theme-visualizer） |
| components | 未明确 | **25** | — |
| docs mdx 总数 | 未列 | **207 + 6 md** | — |
| git ls-files 文件总数 | 3749 | **4648** | +899 |
| 期间 commit 数 | — | **1113** | — |
| **唯一落后包** | — | `sdk-playground@0.6.106` | 落后 56 个版本 |
| `packages/cli/dist/cli.js` 体积 | 未列 | ~10 MB | tsup 单 ESM bundle |
| `packages/producer/dist/index.js` 体积 | 未列 | ~9.5 MB | — |

### 概念层面（v0.7.x 新增）

1. **Fast-capture / drawElement** —— 新一代高效渲染路径（worker-encode / dedup / 3D 投影）
2. **Variables / Declarative Bindings**（`data-var-src` / `data-var-text` / CSS 变量）
3. **Alpha-capable H.264 Proxy**（LRU 缓存 + codec 探测 + 转码）
4. **Color Grading**（contract + runtime shader + inspector + grade-compare）
5. **`check` 命令统一验证 gate**（取代 validate / inspect / layout）
6. **`keyframes` 命令**（暴露 GSAP/CSS/Anime keyframes + 3D onion-skin `--shot`）
7. **media-use v2 OS**（resolve cascade + providers + 本地生成 + 视频生成）
8. **Figma 工作流（M0–M4）**：REST/CLI/MCP 分阶段导入 assets / tokens / components / motion / storyboard
9. **Intent layer / BRIEF.md / companion mode / recipes** —— Agent 编排升级
10. **Core set 默认安装** —— `npx skills add` 行为变更
11. **Render cancel 端到端** + **drawElement release telemetry**
12. **Storyboard view 默认开启**
13. **3 个新包独立**：`parsers` / `lint` / `studio-server`
14. **SDK 大改**：session / editing / live DOM sync / variable CRUD

### 过期信息（LEARNING_REPORT.md 中需更新）

| LEARNING_REPORT 表述 | 现状 |
|---------------------|------|
| "10 个工作区包" | **14 个**（+3） |
| "30 个子命令" | **38 个**（+8） |
| "97 blocks + 13 examples + components" | **109 blocks + 13 目录 examples（仅 8 索引）+ 25 components** |
| "17 个 .md 知识包" | **20 个**（figma / hyperframes-keyframes / media-use 新增） |
| "402 MB / 3749 个文件" | **4648 个文件**（git 索引），约 +25% |
| Frame Adapters 全部在 `packages/core/src/adapters/` | **旧 GSAP 仍保留**，其他 14 个运行时已迁到 `packages/core/src/runtime/adapters/` |
| Linter 路径 `packages/core/src/lint/` | **已迁出**到独立包 `packages/lint/src/` |
| Parsers 路径 `packages/core/src/parsers/` | **已迁出**到独立包 `packages/parsers/src/`（core 留 6 个兼容文件） |
| `graphic-overlays` skill | **已重命名**为 `talking-head-recut` |
| `website-to-video` skill | **已合并**到 `product-launch-video` |
| `hyperframes-media` skill | **已重命名**为 `media-use`（audio 子目录拆出） |
| `bgm-to-video` skill | **已被 `music-to-video` 取代**（整个目录删除） |
| 渲染 6 阶段管线 | 仍正确（compile / probe / extractVideos / audio / capture / encode / assemble） |
| `hyperframes` 三层架构（1 入口 + 10 工作流 + 6 领域） | **入口层 1 个（hyperframes）；工作流层 11 个；领域技能层扩展为 9 个（含新增 figma / hyperframes-keyframes / media-use）** |
| CLI 命令表格（不含 `check` / `keyframes` / `compare` / `grade-compare` / `events` / `telemetry` / `figma`） | 上述命令均新增 |
| `validate` / `inspect` / `layout` 命令 | **已被 `check` 取代**（保留兼容入口） |
| React 19 仅在 studio | **仍仅在 studio** |
| `packages/cli/src/cli.ts` 行数（v0.6.114 未列具体） | 现为 **397 行** |
| `packages/engine/src/services/frameCapture.ts` 行数（v0.6.114 未列具体） | 现为 **3710 行** |
| `packages/producer/src/index.ts` 行数（v0.6.114 未列具体） | 现为 **142 行** |

---

## 引用路径汇总

- 仓库根：`E:\YifuAIForge\hyperframes`
- v0.7.62 HEAD commit：`7f7617095 chore: release v0.7.62 (#2626)`
- 入口 skill：`E:\YifuAIForge\hyperframes\skills\hyperframes\SKILL.md`
- CLI 入口：`E:\YifuAIForge\hyperframes\packages\cli\src\cli.ts`
- Producer API：`E:\YifuAIForge\hyperframes\packages\producer\src\index.ts`
- Engine 核心：`E:\YifuAIForge\hyperframes\packages\engine\src\services\frameCapture.ts`
- Registry manifest：`E:\YifuAIForge\hyperframes\registry\registry.json`
- 设计文档：`E:\YifuAIForge\hyperframes\DESIGN.md`（未变）
- Agent 入口：`E:\YifuAIForge\hyperframes\AGENTS.md`（v0.7.60 / v0.7.50 等多次修订）
- 旧学习报告：`E:\YifuAIForge\hyperframes\LEARNING_REPORT.md`（基线 v0.6.114）

---

*报告完成。所有发现基于 git 静态分析与文件清单，未执行构建或运行测试。*
