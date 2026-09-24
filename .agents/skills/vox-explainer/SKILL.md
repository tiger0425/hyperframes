---
name: vox-explainer
description: Author a VOX-style Chinese explainer/teaching video end to end — brief → storyboard → locked narration → TTS → real-material frames → gates → render. Use when the user wants a 教学片 / 讲解片 / VOX 风格视频 from a topic, doc set, or product feature (not from a website URL, not from existing footage), or says "VOX 风格" / "像 VOX 那样讲" / "做成教学片". Ships the narrative arc, the paper-and-ink visual grammar, the real-material + hand-drawn-annotation method, the voice-driven timing loop, word-level narration sync (every element appears on the word that names it), a frame generator that keeps the contract in one place, and the gate chain (sync-frame-durations / audit-frames / verify-timeline / lint / check / snapshots) as runnable scripts. Distilled from two shipped Chinese explainers — frame COUNT is a parameter, not a rule.
metadata:
  internal: true
---

# VOX Explainer — 中文教学片全链路管线

**Input:** 一个主题 / 一份文档 / 一个产品能力（**不是**网站 URL，**不是**现成footage）。
**Output:** 一个 lint 与 check 全绿的 HyperFrames 项目 + 成片 MP4。

> 本技能是**两次真实交付**的施工记录沉淀成的管线，**每条坑都是实测结论，不是推测**：
>
> | 数据点 | 交付                           | 规格                                 | 同步方式                        |
> | ------ | ------------------------------ | ------------------------------------ | ------------------------------- |
> | 1      | `projects/dsh-agent-teams-vox` | 12 帧 / 244.1s / edge-tts            | `beat-*`（停顿 + 比例插值）     |
> | 2      | `projects/freetoken-v013-vox`  | 12 帧 / 267.4s / **IndexTTS 克隆音** | **词级对齐**（97 条线索全命中） |
>
> 两者独立复现了「槽位余量 ≈ 2.7s」「7 个稀疏音效」这些**规律**；帧数与时长是**实例取值**。
>
> 主时间轴的 GSAP 3.14.2 随 `init` 复制到项目 `assets/vendor/gsap.min.js`；必需运行时资产不从 CDN 获取。

## 先读这四份，再动任何东西

| 顺序 | 文件                            | 为什么                                                                                                            |
| ---- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | `references/_contract.md`       | **单一事实来源**：项目布局、命名契约、五阶段、脚本签名、两个数据点的实测数值。**含 §0.5「帧数是参数，不是规律」** |
| 2    | `references/pitfalls.md`        | **26 条已知坑**。共同特征是**静默失败** —— 报 ok、渲染出片、但内容错了或没出现                                    |
| 3    | `references/pipeline-stages.md` | 每阶段做什么、什么算做完                                                                                          |
| 4    | `references/voice-sync.md`      | **画面与旁白同步**（线索表 → 词级对齐 → 构建时注入）。要"元素跟着旁白出现"就必读                                  |

写帧之前再读：`references/visual-grammar.md`（视觉语法）· `references/narrative-arc.md`（叙事弧线与帧数怎么定）· `references/material-sourcing.md`（材料化）。
下结论"做完了"之前读：`references/verification.md`（怎么确认门禁真的跑了）。

## 最重要的四条

### 1 · 帧数是参数，不是规律

稳定的是**叙事弧线的顺序**和**每帧一个职责**。帧数由内容分段决定：
先列出内容（几个机制、几步演示、边界要不要单独一帧），**段数就是帧数**。
参考区间：单概念/motion graphic 4–6 帧；单一主题教学片 12 帧上下；多机制产品 14–20 帧。
**4 个机制就 4 帧，别硬塞进 3。** 两个参考项目都是 12 帧，但分段不同
（dsh 是 `3+3+1+1+3+1`，freetoken 是 `3+4+1+1+2+1`）—— **12 是算出来的，不是抄来的**。
下文凡出现 `{{FRAMES}}` 都指"该项目自己的帧数"。

### 2 · 时长由旁白决定，不由故事板决定

故事板的 `duration` 是**意图值**。拿到真实语音秒数后重算槽位：

```
槽位 = 0.3（帧首入点） + 旁白真实时长 + 2.4（帧内呼吸）      末帧额外 +1.6s 定格
```

（两个数据点独立复现：`槽位 − 旁白` 分别落在 2.67–2.73s 与 2.70–2.78s。）
然后**四处时长必须相等**：帧根 + 帧内三条 `.clip`（paper/content/grain）。
槽位表由 `tools/slots.mjs` **算一次**（十分之一秒整数累加），`gen-frames` 与 `gen-index` 共用它——
不要手抄任何一处时长。最后把真实值**回写** `index.html` 与 `BRIEF.md` 运行中记录 ——
参考项目这一漏做过一次，导致三份档案至今写着旁白重建**前**的旧数字。

### 3 · 画面必须跟着旁白长，不是开场闪一下

单帧时长 8–70s。如果入场动画全挤在帧首那几秒，剩下的时间画面静止，观感就是翻幻灯片。
两条路（详见 `voice-sync.md`）：

- **beat（粗）**：量停顿 → 句子边界 → 句内按字符数插值。产物 `beat-map.json`。
- **word（精）**：**faster-whisper 词级时间戳**把锁定稿逐字对齐到音频 →
  线索表（元素 → 锚短语 → 秒）→ 构建时注入帧内。freetoken 实测 **12 帧 / 97 条线索全部命中**。

判据：最晚的 tween 起点 ≥ 槽位的 **60%**（`< 40%` 由 `audit-frames` 报 `motion_frontload`）。
**同步失败不报错**，只有"同一帧取两个靠近的时刻对拍"能抓住它（`verification.md` §9）。

### 4 · 门禁会假装通过

`check` 有两类静默失败，**只看退出码分不出来**：

| 情形                       | 症状                                                         | 应对                                                                          |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 运行时阶段静默空跑         | 报 ok，但 `samples=[]` / `contrast.checked=0` / `duration=0` | `hf.mjs` 已固定注入 `--no-browser-gpu`；**仍必须核对这三项计数**              |
| 环境边界（沙箱禁命名管道） | `check_runtime_failure: spawn EPERM`，exit 1                 | **不是片子的 bug**；换到允许子进程管道的环境重跑。`--no-browser-gpu` 绕过不了 |

**唯一可信的通过条件是四项同时成立**：退出码 0 · `samples.Count > 0` · `contrast.checked > 0` · `duration ≈ index.html 根总长`（包装器容差 0.1s）。

而且 `check` **只是下限**：它的布局/对比度只在固定若干秒点采样（freetoken 267.4s 只采 9 个点），
采样点之外的问题它抓不到。**每帧至少一张快照 + 人眼**是唯一覆盖手段（`pitfalls.md` §19）。

## 门禁链 v2（顺序固定：生成 → sync 修 → lint → audit-frames → sync --check → verify-timeline → seam-gate → check → 同步对拍 → 眼睛）

> v2 相对 v1 新增第 6 道 **`seam-gate`**（接缝渲染闸，需无头 Chrome）。本节与
> `references/_contract.md` §2·§5·§6、`references/verification.md` §1–5 **三处口径必须一致**（`issues/08` 收口）。
> 接缝布线 = `seam-stamp` 把出/入幕补间写进 `index.html`（**在 `seam-gate` 之前跑一次**；改了 `ledger.json` 或槽位后必须重跑）。未升级到接缝 v2（无 `ledger.json`）的项目跳过该步。

```powershell
# 0 · 起项目（支持 --theme paper|collage|terminal-dark|minimal-swiss）
node <skill>/scripts/init-vox-project.mjs <targetDir> --title "…" --channel-tag "…" [--theme collage]

# 0.5 · 前置文案时序估算与草稿打样（阶段②/③使用，带相对中位数节奏诊断与可选 edge-tts 真实测距）
node tools/vox/draft-voice-timeline.mjs --project . [--speed normal] [--draft-tts] [--update-storyboard --force]

# 0.6 · 作者侧生成（**改了 frames-data / cues.json 之后必须按这个顺序重跑**）
python tools/synthesize_voice.py             # 旁白 → .media/voice-manifest.json（wav 头实测秒数）
python tools/align-cues.py --model medium    # 线索 → tools/cue-times.json（词级对齐）
node   tools/gen-frames.mjs                  # N 帧 + N 个侧车 + tools/assemble-table.json
node   tools/gen-index.mjs                   # index.html（槽位 + 旁白轨 + 音效轨 + 纸 ASMR 轨）+ ledger.json
node   tools/gen-asmr.mjs                    # 纸 ASMR 素材（通道 C；纸滑/线嘶/房间底噪走通道 G 手动入库；改了 tools/asmr.json 后重跑 gen-index）
node   <motion-doctrine>/scripts/seam-stamp.mjs --ledger ledger.json --write index.html   # 接缝布线：把出/入幕补间写进 index.html（改了 ledger/槽位必重跑）

# 1 · 槽位与侧车同步（先修后验；必须在 audit 之前。自动同步 HTML data-duration 与 .motion.json duration_s）
node tools/vox/sync-frame-durations.mjs --project . [--frame NN]

# 2 · 结构与静态（先 lint，再静态扫坑 + v2 门禁）
node tools/vox/hf.mjs lint --json                                 # 期望 0 error 且 0 warning
node tools/vox/audit-frames.mjs --project . [--frame NN] --json   # 期望 findings: 0

# 3 · 复核时长与侧车 0 漂移（不带 --check 会自动修）
node tools/vox/sync-frame-durations.mjs --project . [--frame NN] --check   # 期望 N/N frames ok（N=项目帧数）

# 4 · 时间轴：槽位 vs 真实旁白
node tools/vox/verify-timeline.mjs --project . --json         # 期望 0 error

# 5 · 接缝布线 + 渲染闸（第 6 道；需无头 Chrome，会 spawn fresh preview server）
node <motion-doctrine>/scripts/seam-stamp.mjs --ledger ledger.json --write index.html   # 布线（生成补间）
node <motion-doctrine>/scripts/seam-gate.mjs verify --ledger ledger.json --project . --json

# 6 · 结构与运行时
node tools/vox/hf.mjs check --json --out .hyperframes/check-latest.json
#    （退出码 0 即通过自验证；若不传 --out 会按契约返回退出码 3 告警未自检）
#    细分计数也要看：runtime.errors 0（脚本健康）· layout.errorCount 0（定位模型）· contrast.warningCount 0

# 7 · 同步对拍（做了节拍/词级同步就必跑）
python tools/align-cues.py --model medium                     # 线索 N/N、整句命中率与映射距离门槛
node tools/vox/hf.mjs snapshot --at <线索前>,<线索后> --no-end --output .hyperframes/sync-a
#    看元素是否"只在该出现时才出现"
node tools/vox/hf.mjs snapshot --pair --cue <线索名>          # 成对快照 cue ± 0.15s（判据见 verification.md §9.1）
node tools/vox/hf.mjs snapshot --pair-low-hit --min-align-hit 0.8  # 自动覆盖低命中帧

# 8 · 眼睛（不可省）
node tools/vox/hf.mjs snapshot --at <秒> --no-end --output .hyperframes/snaps-eye
#    读输出目录里的 contact-sheet.jpg（3–4 帧一张，省上下文）；每帧至少看一张
```

**手绘标注快速生成**（自动生成带自然抖动曲线的确定性 SVG path 与 GSAP 动效，可选 `--fit`）：

```powershell
node tools/vox/gen-vox-annotation.mjs --rect "x,y,w,h" --shape circle --color "#e23a2e" [--fit]
```

**旁白合完必须过语音判别**（抓"引擎加载错权重所以产出杂音"——文件在、时长对、能播放，但内容是噪声）：

```powershell
node tools/vox/verify-film-audio.mjs .media/audio/voice/voice_001.wav 0 8.3
# 语音：CV ≥ 0.9 且静音帧 25–65%（脚本硬判据；静音带上界 2026-09-22 由 0.48 更正）
# 杂音：CV ≈ 0.36 且静音帧 ≈ 2%
# 灰区（0.7 ≤ CV < 0.9）：脚本报 gray（exit 1），必须补第二道 —— ASR 转写这一段，与 SCRIPT.md 的锁定稿逐句比
```

## 施工协作纪律（派工时写进每个任务描述）

1. **不要手抄帧**：契约部分（字体块 / 泄漏守卫 / reveal pass / 四层时长 / `position` 补齐）由
   `gen-frames.mjs` 写一次，逐帧只提供"属于它自己的东西"（CSS + markup + 时间轴）。
   手抄 N 份必然在某一份漏掉一条契约 —— `pitfalls.md` §16/§17 都是这么发生的。
2. **不要手改 `cue-times.json`，不要在帧里写死秒数**。前者是机器产物，后者会毁掉同步的可复现性。
   改完线索名或锚短语**必须重拍快照**（写错不会报错，元素只会提前出现）。
3. **一帧一个作者，写入范围互斥。** 并发写同一帧 = 混合态快照，还可能覆盖掉刚改的内容。
4. **编辑帧期间不要开 `preview`。** Studio 会重写帧文件（给每个元素盖 `data-hf-id`）。要审片时再开，审完 `--stop`。
5. **两个集成块原样保留，别删**：`hf-scene-visibility-leak-guard`、`hf-js-hide-reveal-pass`。
   ⚠️ 帧内隐藏用 `visibility`，不是 `opacity` —— `opacity: 0` 的元素在冷渲染/布局审计里**仍然占位可见**。
6. **事实必须有出处。** 画面里每个字符串都要能追到源文件；实验性能力不许说成稳定能力；结尾必须点到已知限制。
7. **旁白锁定后不许改文案**；要改就是回退到阶段③④（重合成 + 重算槽位 + 回写记录）。

## 与其它技能的分工

| 需求                                                                               | 加载                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------ |
| 合成契约（`data-*` / `class="clip"` / `window.__timelines`）                       | `hyperframes-core`                         |
| 动效规则 / 场景蓝图 / 入场矢量                                                     | `hyperframes-animation`、`motion-doctrine` |
| 设计令牌与 frame.md 写法                                                           | `hyperframes-creative`                     |
| CLI 全量命令与排错                                                                 | `hyperframes-cli`                          |
| 素材（TTS / BGM / 图 / 图标 / 转写 / 去背）                                        | `media-use`                                |
| 装注册表区块与组件                                                                 | `hyperframes-registry`                     |
| 混音（人声压低 BGM、效果链、submix）                                               | `hyperframes-audio`                        |
| 要加字幕                                                                           | `captions-overlay`                         |
| 词级转写（本文的 `align-cues.py` 直接用 faster-whisper；要更完整的转写能力走这个） | `hyperframes-media`                        |

**入口路由**：任何"做视频"的请求先过 `hyperframes`。本管线挂在 `general-video` 之下 ——
不是网站 URL（→ `product-launch-video`）、不是现成footage（→ `embedded-captions` / `talking-head-recut`）、
不是 PR（→ `pr-to-video`）。

## 文件地图

```
SKILL.md                        ← 你在这里
themes/
  paper.json                    ← 经典复古牛皮纸风（默认）
  terminal-dark.json            ← 暗黑极客命令行终端风
  minimal-swiss.json            ← 现代极简瑞士平面排版风
references/
  _contract.md                  ← 单一事实来源（先读）
  pitfalls.md                   ← 26 条静默失败
  voice-sync.md                 ← 画面与旁白同步（线索表 → 词级对齐 → 注入）
  pipeline-stages.md            ← 五阶段 I/O 与出口判据
  narrative-arc.md              ← 弧线骨架 + 帧数怎么定 + 时间闭环
  visual-grammar.md             ← 令牌 / 每屏一焦点 / 手绘标注法
  material-sourcing.md          ← 真实材料从哪来、怎么植进帧
  verification.md               ← 怎么确认门禁真的跑了（含 §9 同步自证）
templates/
  frame-skeleton.html           ← 帧骨架（两个集成块 + html/body/#root 定位 + show() + 推轨选择器写法）
  frame.motion.json             ← 运动侧车
  index-timeline.html           ← 主时间轴（槽位 + 旁白轨 + 音效轨）
  assets/vendor/gsap.min.js     ← GSAP 3.14.2 运行时，init 复制到项目
  brief.md storyboard.md script.md frame.md
scripts/                        ← 通用门禁（init 会复制进项目 tools/vox/）
  init-vox-project.mjs          ← 起项目（支持主题预设）
  draft-voice-timeline.mjs      ← 前置文案时序估算与极速打样
  gen-vox-annotation.mjs        ← DOM/坐标锚定手绘 SVG 生成器
  audit-frames.mjs              ← 静态扫坑（支持 --frame 单帧）
  sync-frame-durations.mjs      ← 四处时长对齐（支持 --frame 单帧）
  verify-timeline.mjs           ← 槽位 vs 真实旁白 + 产出全局起点表
  verify-film-audio.mjs         ← 语音 vs 杂音判别
  gate-tier.mjs                 ← v2 产物存在性分档（所有 v2 门禁经它定级别）
  theme.mjs                     ← 令牌源（themes/<name>.json → tools/theme.json）
  motion-const.mjs              ← NARRATION_LEAD / DEFAULT_LEAD + 11 个动效契约常量
  hf.mjs                        ← 门禁包装（lint / check / snapshot）
examples/
  collage-smoke/                ← 可提交的长期回归样例（四帧、ASMR、接缝、联系表）
```

> 门禁链第 6 道 **`seam-gate.mjs`** 不在本技能内，在 **`motion-doctrine/scripts/`**（需无头 Chrome）。

## 长期样例

`examples/collage-smoke/` 是本技能随仓库保存的最小回归 fixture：四种句式、collage 纸面、四函数、接缝和 ASMR 都在里面；四条旁白是确定性静音占位，只用于槽位门禁。运行方式、资产来源和被排除的 jev 真实材料见该目录的 `README.md`。

### 作者侧脚本（随项目走，不在本技能的 `scripts/` 里）

`freetoken-v013-vox` 把下面这些写成了可复跑的脚本，新项目可以直接抄（详见 `_contract.md` §5 的签名表）：

| 脚本                        | 作用                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/slots.mjs`           | 槽位表的唯一计算处（读 wav 头真值，整数累加）                                                                                                |
| `tools/gen-frames.mjs`      | 生成 N 帧 + N 个侧车；含 `buildFrame()` 契约套件与 `autoPosition()` 兜底                                                                     |
| `tools/gen-index.mjs`       | 装配 `index.html`（槽位 + 旁白轨 + 音效轨）                                                                                                  |
| `tools/ink.mjs`             | 确定性手绘路径（6 生成器 + 两档 `inkStroke`/`inkMarkup`：多描 / 收锋）；产出共用一个 `<g data-ink=…>`                                        |
| `tools/torn.mjs`            | 确定性**低频撕边** `clip-path`（`torn(w,{seed})`）；按宽度分档、含长裂口                                                                     |
| `tools/synthesize_voice.py` | 旁白合成 + 量真实秒数 + 写清单（支持单条重跑并回）                                                                                           |
| `tools/align-cues.py`       | 词级对齐（SCRIPT.md + cues.json + faster-whisper → cue-times.json）                                                                          |
| `tools/gen-asset.mjs`       | 生成资产命名桥（调 `media-use` 的 comfyui provider → `.media/assets/gen-<role>-<nn>.png` + `.media/gen/<role>-<nn>.workflow.json` + M5 账本行，含 `model_file`/`model_sha256`/`seed`；一致性 = 锚图 + 固定 seed + 参考编辑） |
| `tools/shot.ps1`            | 本机 Chrome 无头实拍真实页面（2× → 3788×1960）                                                                                               |
