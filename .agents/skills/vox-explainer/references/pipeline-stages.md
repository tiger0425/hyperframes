# 五阶段流水线 —— 每阶段的输入、产物、出口判据

> 契约（产物路径、脚本签名、已实测数值）见 [`_contract.md`](./_contract.md)。本文件只讲**做什么、按什么顺序做、什么算做完**。
> 门禁命令的**自证方法**（怎么确认门禁不是假装通过）见 [`verification.md`](./verification.md)。

```
brief ──▶ storyboard ──▶ script ──▶ voice ──▶ build ──▶ render
  ①          ②             ③          ④         ⑤
  ↑brief.md  ↑STORYBOARD   ↑SCRIPT    ↑*.wav    ↑{{FRAMES}} 帧 + index.html
                           ↑frame.md             ↑lint/check 全绿
```

每个阶段都是**单向闸门**：出口判据不满足就别往下走。唯一允许的回退是 ③→④（改文案必须重跑该条 TTS 并重算槽位），以及 ⑤ 内单帧返工。

---

## ① brief —— 确认意图，别急着画

**做什么**：把"做什么片、给谁看、说哪句话、多长、什么画幅"钉死。

**产物**：`BRIEF.md`，顶部 frontmatter 是契约：

```yaml
---
workflow: general-video # 本管线挂在 general-video 之下
flow: automation # automation（一次跑完）| companion（边做边确认）
storyboard: yes
message: "一句话主张——全片每帧都在为它服务"
destination: youtube # youtube | bilibili | 内部分享 …
aspect: 1920x1080
language: zh
length: content-driven # 或具体秒数；VOX 教学片建议 content-driven
angle: concept-then-demo # 先概念后演示，本项目用的就是这个
audience: 首次接触的初学者 # 决定术语纪律的严格程度
---
```

**出口判据**：

- frontmatter 十项齐全，`message` 是**一句可被反驳的主张**，不是话题名（"Agent Teams 是什么"不合格；"一个会话可以变成一支团队"合格）。
- `audience` 明确到能据此决定"哪些词必须当场解释"。
- 正文写清：内容范围与事实出处、必须点到的边界/限制、自定义项（用真实材料还是一比一重画的 mock）。

**`BRIEF.md` 是一份活文件**：阶段 ④ 之后必须回写"运行中记录"——实际时长为什么与估计不同、配音方案、无配乐/无字幕这类决策、集成阶段做的修复清单。接手者读的是这份记录，不是你的记忆。

---

## ② storyboard —— 切出帧骨架，每帧一个职责

**第一件事是定帧数，不是照抄 12。** 帧数 = 内容的自然切分结果，见 [`_contract.md`](./_contract.md) §0.5。
先把内容按弧线分段（几个机制、几步演示、要不要单独一帧讲边界），段数就是帧数；
本项目恰好是 12（前后 6 帧 + 3 机制各 1 帧 + 3 步演示各 1 帧），那是一个取值，不是规范。

**做什么**：按 [`narrative-arc.md`](./narrative-arc.md) 的弧线把内容切成帧，每帧写清"这一帧只负责什么"与"禁止出现什么"。

**产物**：`STORYBOARD.md`。

**每帧必备字段**：

| 字段            | 含义                               | 注意                                             |
| --------------- | ---------------------------------- | ------------------------------------------------ |
| `scene`         | 画面的动作描述，一句话             | 描述**动作**（"五个方块散落归位"），不是描述主题 |
| `duration`      | **意图**时长                       | 意图值，会被阶段④改写                            |
| `poster`        | 封面取帧的秒数                     | 该帧内最具代表性的一瞬                           |
| `transition_in` | 入场转场                           | `cut` \| `crossfade`                             |
| `status`        | `outline` → `animated`             | **施工完成后必须逐帧推进**，别留 `outline`       |
| `src`           | `compositions/frames/NN-slug.html` | 命名契约见 `_contract.md` §1                     |
| `motion`        | 1–2 个动效规则名                   | 施工时按名实现，并落到 `NN-slug.motion.json`     |
| `voiceover`     | 旁白**指导稿**                     | 允许粗糙，阶段③再逐字锁定                        |

**出口判据**：

- 帧数与第①阶段定的内容范围相符，`NN` 连续无跳号，共 `{{FRAMES}}` 帧；字段齐、每帧的"禁止出现"都写得出来（写不出来的帧说明职责没切开）。
- 帧与帧之间没有职责重叠。若两帧都在解释同一个机制，合并或改写。
- 旁白指导稿连起来读一遍，是**一条完整的话**，没有为画面服务的填充句。
- **推荐工具**：跑 `node tools/vox/draft-voice-timeline.mjs --update-storyboard`，基于智能音节与停顿规约前置推导槽位与节奏诊断（预警单帧 >25s 或 <5s），并自动将合理意图值回写至 `duration`。若本地支持 `edge-tts` 可带 `--draft-tts` 获得物理真值。

---

## ③ script —— 逐字锁定，此后不许改

**做什么**：把指导稿写成**可直接朗读**的锁定稿，同时把设计令牌落到 `frame.md`。

**产物**：`SCRIPT.md`（每条：Time 区间 + 音频文件名 + 交付提示 + 逐字正文）、`frame.md`（设计令牌，格式见 `visual-grammar.md`）。

**出口判据**：

- 每条旁白逐字确定，包括标点与停顿（旁白是 TTS 的输入，改一个字就得重跑该条并重算槽位）。
- 术语纪律已执行：面向小白时未解释的术语为零（`narrative-arc.md` §术语纪律）。
- `frame.md` frontmatter 含 colors / typography / layout 三段。
- `SCRIPT.md` 写明**配音方案**（引擎、音色参考、seed、采样参数、是否归一化）——接手者要能复现同一条声音。

> 这一步之后，"文案"是冻结的。要改文案 = 明确承认回退到 ③④（重合成 + 重算槽位 + 回写 `BRIEF.md`）。

---

## ④ voice —— 先拿到真实秒数，再定槽位

**做什么**：合成旁白 → 量出每条真实时长 → 用真实时长反推槽位 → 回写 `index.html` 与 `BRIEF.md`。

**产物**：`.media/tts-batch.json`、`.media/audio/voice/voice_0NN.wav`、槽位表。

**为什么这个顺序不能反**：故事板的 `duration` 是意图值；一旦真实语音比它长，槽位就得让路。**旁白贴合画面是对的，画面不该被拉伸到旁白之外。** 本项目实测：12 条旁白合计 153.88s，按"槽位 = 旁白 + 呼吸"定帧长后成片 244.1s。

**槽位算法**（经验值，可直接用）：

1. 帧首旁白在槽位开始后 **0.3s** 进入。
2. 帧尾留 `0.2–0.6s` 呼吸（语速快的条目取大值）。
3. 槽位 = `0.3 + 旁白时长 + 呼吸`，然后向上取整到 0.1s。
4. `data-start` = 前序槽位累加。

**出口判据**：

- 每条 wav **过语音判别**（`verify-film-audio.mjs`，语音 CV ≥ 0.9、静音帧 25–48%）——
  这一步专门抓"引擎加载错了权重所以产出杂音"这类事故：杂音的 CV ≈ 0.36、静音帧 ≈ 2%。
- 槽位表算完，`verify-timeline.mjs` 全绿。
- `BRIEF.md` 运行中记录已回写实际时长与配音方案。

---

## ⑤ build —— 帧施工、装配、过门禁

**做什么**：逐帧做视觉与动效 → 写侧车 → 装配 `index.html` → 修集成问题 → 过门禁。

### 5.1 逐帧施工（**一帧一个作者，写入范围互斥**）

每帧照 `templates/frame-skeleton.html` 的骨架长，骨架里两处集成块**原样保留**。
真实材料植入与手绘标注的手法见 [`material-sourcing.md`](./material-sourcing.md)；手绘 SVG 标注推荐使用 `node tools/vox/gen-vox-annotation.mjs --rect "x,y,w,h" --shape box|circle|underline|arrow` 自动生成平滑路径与 GSAP 描线动效。
单帧迭代期间，随时运行 `node tools/vox/audit-frames.mjs --frame NN` 与 `node tools/vox/sync-frame-durations.mjs --frame NN --check` 实施增量快速校验，避免全量门禁的中间噪音。

### 5.2 每帧交付三样，缺一不可

| 产物                  | 内容                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NN-slug.html`        | 帧本体（bare `<template>` 片段），四处时长等于槽位                                                                   |
| `NN-slug.motion.json` | 运动侧车：`scene` / `duration_s` / `rules` / `exit`（vector + still_moving）/ `entry`（vector + from_rest）/ `notes` |
| 快照                  | 至少一张该帧代表时刻的 PNG，用 `read_image` 亲眼看过                                                                 |

**侧车不是形式主义**：`exit`/`entry` 的 vector 是把多帧连成"一次连续镜头"的依据（见 `motion-doctrine` 的矢量法则）。本项目有一次事故就是某帧作者没交侧车，集成阶段只能从故事板反推补写。

### 5.3 装配 `index.html`

- `{{FRAMES}}` 个场景槽位（数目=帧数），`data-start` 累加、`data-duration` 等于槽位。
- 旁白轨 `data-track-index="10"`，音效轨 `"11"`。
- 音效是**稀疏标点**（本项目 7 个），不是垫床。
- `window.__timelines["main"] = tl;` 末尾 `tl.seek(0)`。

### 5.4 集成阶段必做的四项修复（都已是脚本）

| 问题                  | 症状                                   | 脚本                                                |
| --------------------- | -------------------------------------- | --------------------------------------------------- |
| 混合字体策略          | 同片两种字体、每帧上百 KB 重复 base64  | `normalize-frame-fonts`（见 `pitfalls.md` §6）      |
| 可见性泄漏            | 布局审计把非活动场景算成几十处重叠     | `pitfalls.md` §5                                    |
| `.js-hide` 无配对揭示 | 整张卡/表格在成片里根本不出现          | `pitfalls.md` §4                                    |
| 时间线图层缺稳定 id   | Studio 报 `studio_missing_editable_id` | 给每个 `.clip` 层加 `id="<composition-id>-<layer>"` |

### 5.5 出口判据（**全部满足才算 build 完成**）

> **顺序固定：先 sync（修）→ 再 audit → 最后 sync --check（复核）。**
> `sync-frame-durations` 现同时对齐帧内四处 `data-duration` 与 `.motion.json` 侧车 `duration_s`；
> 若 audit 先跑，侧车漂移会先报出一串 error。命令形状见 `SKILL.md` 门禁段与 `_contract.md` §6。

1. `sync-frame-durations.mjs`（不带 `--check`，自动写回）→ 帧内四处与侧车 `duration_s` 全部对齐槽位。
2. `audit-frames.mjs` → `findings: 0`（扫 9 条已知坑）。
3. `sync-frame-durations.mjs --check` → 全帧 ok（`N/N frames ok`，N = 该项目帧数）。
4. `hf.mjs lint --json` → `ok=true`，**0 error / 0 warning**。
5. `hf.mjs check --json --out .hyperframes/check-latest.json` → **退出码 0（自验证通过）**：
   **0 error / 0 warning，且 `samples.length > 0`、`contrast.checked > 0`、`duration` 与 `index.html` 根总长相差不超过 0.1 秒**。
   不传 `--out` 时包装按契约返回**退出码 3（未自检）**，脚本/CI 不得判为通过；不带
   `--no-browser-gpu`（包装已固定注入）时它会静默空跑却报 ok（`pitfalls.md` §1）。
6. 关键秒点快照用 `read_image` 亲眼看过（不是只看 JSON）。

### 5.6 render

```powershell
node ..\..\packages\cli\dist\cli.js render .
```

出片后**只留一版**，删掉中间版本；用 `verify-film-audio.mjs` 抽查成片里的旁白段
（证明渲染出来的是语音而不是静音也不是杂音）。

---

## 规模参考（本项目实测，用于估工）

| 项            | 值                                                       |
| ------------- | -------------------------------------------------------- |
| 帧数 / 成片长 | 12 帧 / 244.1s（**该主题切出来的取值**，别的主题会不同） |
| 渲染          | 7323 帧，约 6–7 分钟（`check` 另计）                     |
| 旁白          | 12 条，合计 153.88s；单条 8.3–22.2s                      |
| 材料          | 11 份 2× PNG（3788×1960）                                |
| 音效          | 7 个稀疏标点                                             |
| 帧施工        | 四个 worker 并发，一帧一作者、写入范围互斥               |
