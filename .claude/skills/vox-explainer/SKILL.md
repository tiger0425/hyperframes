---
name: vox-explainer
description: Author a VOX-style Chinese explainer/teaching video end to end — brief → storyboard → locked narration → TTS → real-material frames → gates → render. Use when the user wants a 教学片 / 讲解片 / VOX 风格视频 from a topic, doc set, or product feature (not from a website URL, not from existing footage), or says "VOX 风格" / "像 VOX 那样讲" / "做成教学片". Ships the narrative arc, the paper-and-ink visual grammar, the real-material + hand-drawn-annotation method, the voice-driven timing loop, and the gate chain (sync-frame-durations / audit-frames / verify-timeline / lint / check / snapshots) as runnable scripts. Distilled from a shipped 4-minute, 12-frame Chinese explainer — frame COUNT is a parameter, not a rule.
metadata:
  internal: true
---

# VOX Explainer — 中文教学片全链路管线

**Input:** 一个主题 / 一份文档 / 一个产品能力（**不是**网站 URL，**不是**现成footage）。
**Output:** 一个 lint 与 check 全绿的 HyperFrames 项目 + 成片 MP4。

> 本技能是把一次真实交付（`projects/dsh-agent-teams-vox`，1920×1080 / 30fps / 244.1s /
> 真实中文旁白）的施工记录沉淀成的管线。**每条坑都是实测结论，不是推测。**

## 先读这三份，再动任何东西

| 顺序 | 文件 | 为什么 |
|---|---|---|
| 1 | `references/_contract.md` | **单一事实来源**：项目布局、命名契约、五阶段、脚本签名、已实测数值。**含 §0.5「帧数是参数，不是规律」** |
| 2 | `references/pitfalls.md` | 9 条已知坑。共同特征是**静默失败** —— 报 ok、渲染出片、但内容错了或没出现 |
| 3 | `references/pipeline-stages.md` | 每阶段做什么、什么算做完 |

写帧之前再读：`references/visual-grammar.md`（视觉语法）· `references/narrative-arc.md`（叙事弧线与帧数怎么定）· `references/material-sourcing.md`（材料化）。
下结论"做完了"之前读：`references/verification.md`（怎么确认门禁真的跑了）。

## 最重要的三条

### 1 · 帧数是参数，不是规律

稳定的是**叙事弧线的顺序**和**每帧一个职责**。帧数由内容分段决定：
先列出内容（几个机制、几步演示、边界要不要单独一帧），**段数就是帧数**。
参考区间：单概念/motion graphic 4–6 帧；单一主题教学片 12 帧上下；多机制产品 14–20 帧。
**4 个机制就 4 帧，别硬塞进 3。** 本技能的参考项目是 12 帧，那是一个取值，不是规范。
下文凡出现 `{{FRAMES}}` 都指"该项目自己的帧数"。

### 2 · 时长由旁白决定，不由故事板决定

故事板的 `duration` 是**意图值**。拿到真实语音秒数后重算槽位：

```
槽位 = 0.3（帧首入点） + 旁白真实时长 + 2.4（帧内呼吸）      末帧额外 +1.6s 定格
```

（实测：12/12 帧的「槽位 − 旁白」落在 2.67–2.73s。）
然后**四处时长必须相等**：帧根 + 帧内三条 `.clip`（paper/content/grain）。
最后把真实值**回写** `index.html` 与 `BRIEF.md` 运行中记录 ——
参考项目这一漏做过一次，导致 `BRIEF.md` / `SCRIPT.md` / `STORYBOARD.md` 至今写着
旁白重建**前**的旧数字（195s / 153.88s），而成片是 244.1s / 210.09s。

### 3 · 门禁会假装通过

`check` 有两类静默失败，**只看退出码分不出来**：

| 情形 | 症状 | 应对 |
|---|---|---|
| 运行时阶段静默空跑 | 报 ok，但 `samples=[]` / `contrast.checked=0` / `duration=0` | `hf.mjs` 已固定注入 `--no-browser-gpu`；**仍必须核对这三项计数** |
| 环境边界（沙箱禁命名管道） | `check_runtime_failure: spawn EPERM`，exit 1 | **不是片子的 bug**；换到允许子进程管道的环境重跑。`--no-browser-gpu` 绕过不了 |

**唯一可信的通过条件是四项同时成立**：退出码 0 · `samples.Count > 0` · `contrast.checked > 0` · `duration ≈ 成片总长`。

## 门禁链（顺序固定：sync 修 → audit → sync --check → verify → lint → check → 眼睛）

```powershell
# 0 · 起项目（支持 --theme paper|terminal-dark|minimal-swiss）
node <skill>/scripts/init-vox-project.mjs <targetDir> --title "…" --channel-tag "…" [--theme paper]

# 0.5 · 前置文案时序估算与草稿打样（阶段②/③使用，带相对中位数节奏诊断与可选 edge-tts 真实测距）
node tools/vox/draft-voice-timeline.mjs --project . [--speed normal] [--draft-tts] [--update-storyboard --force]

# 1 · 槽位与侧车同步（自动同步 HTML data-duration 与 .motion.json duration_s，必须在 audit 之前）
node tools/vox/sync-frame-durations.mjs --project . [--frame NN]

# 2 · 静态扫 9 条已知坑（支持 --frame NN 单帧快速扫，含侧车与 HTML 槽位一致性）
node tools/vox/audit-frames.mjs --project . [--frame NN] --json            # 期望 findings: 0

# 2.5 · 复核时长与侧车 0 漂移
node tools/vox/sync-frame-durations.mjs --project . [--frame NN] --check   # 期望 N/N frames ok（N=项目帧数）

# 3 · 时间轴：槽位 vs 真实旁白
node tools/vox/verify-timeline.mjs --project . --json         # 期望 0 error

# 4 · 结构与运行时
node tools/vox/hf.mjs lint --json                             # 期望 0 error 且 0 warning
node tools/vox/hf.mjs check --json --out .hyperframes/check-latest.json
#    （退出码 0 即通过自验证；若不传 --out 会按契约返回退出码 3 告警未自检）

# 5 · 眼睛（不可省）
node tools/vox/hf.mjs snapshot --at <秒> --output .hyperframes/snaps-eye
#    然后用 read_image 亲眼看：每帧至少一张
```

**手绘标注快速生成**（自动生成带自然抖动曲线的确定性 SVG path 与 GSAP 动效，可选 `--fit`）：

```powershell
node tools/vox/gen-vox-annotation.mjs --rect "x,y,w,h" --shape circle --color "#e23a2e" [--fit]
```

**旁白合完必须过语音判别**（抓"引擎加载错权重所以产出杂音"——文件在、时长对、能播放，但内容是噪声）：

```powershell
node tools/vox/verify-film-audio.mjs .media/audio/voice/voice_001.wav 0 8.3
# 语音：CV ≥ 0.9 且静音帧 25–48%    ｜    杂音：CV ≈ 0.36 且静音帧 ≈ 2%
```

## 施工协作纪律（派工时写进每个任务描述）

1. **一帧一个作者，写入范围互斥。** 并发写同一帧 = 混合态快照，还可能覆盖掉刚改的内容。
2. **编辑帧期间不要开 `preview`。** Studio 会重写帧文件（给每个元素盖 `data-hf-id`）。要审片时再开，审完 `--stop`。
3. **两个集成块原样保留，别删**：`hf-scene-visibility-leak-guard`、`hf-js-hide-reveal-pass`。
   ⚠️ 帧内隐藏用 `visibility`，不是 `opacity` —— `opacity: 0` 的元素在冷渲染/布局审计里**仍然占位可见**。
4. **事实必须有出处。** 画面里每个字符串都要能追到源文件；实验性能力不许说成稳定能力；结尾必须点到已知限制。
5. **旁白锁定后不许改文案**；要改就是回退到阶段③④（重合成 + 重算槽位 + 回写记录）。

## 与其它技能的分工

| 需求 | 加载 |
|---|---|
| 合成契约（`data-*` / `class="clip"` / `window.__timelines`） | `hyperframes-core` |
| 动效规则 / 场景蓝图 / 入场矢量 | `hyperframes-animation`、`motion-doctrine` |
| 设计令牌与 frame.md 写法 | `hyperframes-creative` |
| CLI 全量命令与排错 | `hyperframes-cli` |
| 素材（TTS / BGM / 图 / 图标 / 转写 / 去背） | `media-use` |
| 装注册表区块与组件 | `hyperframes-registry` |
| 混音（人声压低 BGM、效果链、submix） | `hyperframes-audio` |
| 要加字幕 | `captions-overlay` |

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
  pitfalls.md                   ← 9 条静默失败
  pipeline-stages.md            ← 五阶段 I/O 与出口判据
  narrative-arc.md              ← 弧线骨架 + 帧数怎么定 + 时间闭环
  visual-grammar.md             ← 令牌 / 每屏一焦点 / 手绘标注法
  material-sourcing.md          ← 真实材料从哪来、怎么植进帧
  verification.md               ← 怎么确认门禁真的跑了
templates/
  frame-skeleton.html           ← 帧骨架（含两个集成块 + 推轨选择器写法）
  frame.motion.json             ← 运动侧车
  index-timeline.html           ← 主时间轴（槽位 + 旁白轨 + 音效轨）
  brief.md storyboard.md script.md frame.md
scripts/
  init-vox-project.mjs          ← 起项目（支持主题预设，并把脚本复制进项目 tools/vox/）
  draft-voice-timeline.mjs      ← 前置文案时序估算与极速打样
  gen-vox-annotation.mjs        ← DOM/坐标锚定手绘 SVG 生成器
  audit-frames.mjs              ← 静态扫坑（支持 --frame 单帧）
  sync-frame-durations.mjs      ← 四处时长对齐（支持 --frame 单帧）
  verify-timeline.mjs           ← 槽位 vs 真实旁白 + 产出全局起点表
  verify-film-audio.mjs         ← 语音 vs 杂音判别
  hf.mjs                        ← 门禁包装（lint / check / snapshot）
```
