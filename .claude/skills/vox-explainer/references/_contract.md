# vox-explainer — 内部接口契约（写任何产物之前先读这一份）

> 本文件是这条管线的**单一事实来源**。SKILL.md、其余 references、templates、scripts 全部按这里写死的名字与签名对齐。
> 改这里就必须同步改引用它的文件。文件名以下划线开头：**它不是给用户读的文档，是给作者对齐用的契约**。

---

## 0 · 这条管线的经验来源

全部来自一次真实交付：`projects/dsh-agent-teams-vox`（DSH Agent Teams 中文教学片，
1920×1080 / 30fps / 244.1s / 12 帧 / 真实中文旁白 / lint 与 check 全绿）。
契约里的每个数字与每条坑都是那次**实测**结论，不是推测。原文见该项目
`BRIEF.md`、`tools/MATERIAL_MOTION_RECIPE.md` 与交接文档 §4。

---

## 0.5 · 帧数是参数，不是规律（**先读这一条**）

**帧数由内容决定，不是固定的 12。** 管线里稳定的是**约束**，不是取值：

- 稳定（不许动）：叙事弧线的**顺序**、每帧一个职责、写入范围互斥、时长由旁白真实秒数决定。
- 参数（每个项目自己定）：**帧数 `{{FRAMES}}`**、每帧的时长、几何机制/演示各占几帧、材料份数、音效个数。

参考取值（这条管线唯一的经验数据点，仅供起步估算，别当规范）：

| 内容规模                  | 帧数  | 说明                                        |
| ------------------------- | ----- | ------------------------------------------- |
| 单个概念 / motion graphic | 4–6   | 钩子 → 概念 → 一两个例证 → 收尾             |
| 单一主题教学片（本项目）  | 12    | 前后 6 帧 + 3 机制各 1 帧 + 3 步演示各 1 帧 |
| 多机制产品讲解            | 14–20 | 机制与演示按实际条数展开，别硬塞进 3        |

**因此下文出现的 `12` 一律读作 `{{FRAMES}}`（该项目自己的帧数）**，`NN` 是帧序号。
`NN / 12` 这类边缘锚请写成 `NN / <总帧数>`。

派生规则（脚本与门禁按这个走，不按常数）：

- `index.html` 的场景槽位数 = `{{FRAMES}}`，不是 12。
- `sync-frame-durations --check` 的判据是 **`已核对帧数 == 项目帧数`**，不是 `12/12`。
- 帧序号 `NN` 两位宽（`01`…`99`），超过 99 帧才需要改宽度。
- 时长、`data-start`、总长全部由槽位表算出，不存在任何常数。
- **帧不是手抄的，是生成的**：字体块 / 泄漏守卫 / reveal pass / 四层时长 / `position` 补齐
  各写一次（`tools/gen-frames.mjs` 的 `buildFrame()`），逐帧只提供 CSS + markup + 时间轴。
  手抄 N 份帧必然在某一份漏掉一条契约 —— `pitfalls.md` §16/§17 就是这么发生的。

---

## 1 · 项目布局（产物契约）

一个 VOX 项目长这样。**路径名是契约的一部分**，脚本与门禁按这些路径找产物：

```
<project>/
  BRIEF.md                      ← 阶段1 产物（含运行中记录，必须回写）
  STORYBOARD.md                 ← 阶段2 产物（每帧 status 必须从 outline 推进到 animated）
  SCRIPT.md                     ← 阶段3 产物（锁定旁白稿，每条一行 + 对应音频文件名）
  frame.md                      ← 设计令牌（@hyperframes-creative 读的那个文件）
  index.html                    ← 主时间轴（{{FRAMES}} 个场景槽位 + N 条旁白 + M 个音效）
  meta.json  package.json  AGENTS.md
  compositions/
    frames/NN-slug.html         ← 帧，bare `<template>` 片段
    frames/NN-slug.motion.json  ← 运动侧车（每帧一个，必产）
    components/*.html           ← 装过的注册表区块（vox-annotate / hw-* / grain-overlay）
  assets/fonts/                 ← 项目内字体文件（@font-face 指向这里）
  assets/vendor/gsap.min.js    ← 项目内 GSAP 运行时（主时间轴唯一依赖入口）
  assets/vendor/GSAP-NOTICE.txt ← GSAP 许可说明
  .media/
    assets/*.png                ← "真实材料"截屏（2×，3788×1960）；生成资产另用 gen-<role>-<nn>.png（M5，见 §5 gen-asset.mjs）
    gen/<role>-<nn>.workflow.json ← ComfyUI API-format 快照（M5 生成资产的可复现输入）
    audio/voice/voice_0NN.wav   ← 旁白（index.html 真正播放的那一份）
    audio/sfx/sfx_0NN.mp3       ← 音效标点
    audio/asmr/asmr-*.wav       ← 纸 ASMR 点缀（PCM WAV / 48k / mono / ≤2.5s；**绝不能放 voice/**）
    manifest.jsonl              ← 素材账本（每份资产一行）
    tts-batch.json              ← TTS 批合成规格（indextts_batch 的输入）
  tools/                        ← 施工脚本副本（用本技能 scripts/ 初始化）
  renders/*.mp4                 ← 成片（唯一一版，中间版本删掉）
```

### 帧的命名契约

- 帧文件名 `NN-slug.html`，`NN` 两位从 `01` 起。
- **composition id = `frame-NN-slug`**（与文件名同，去扩展名）。
- 帧内根节点：`<div id="root" data-composition-id="frame-NN-slug" data-width="1920" data-height="1080" data-duration="<槽位>">`
- index.html 槽位：`data-composition-id="frame-NN-slug"`（**不是** `frame-NN` 或别的缩写）——
  `sync-frame-durations` 与 `audit-frames` 都靠这个正则对齐，写错就静默不同步。

---

## 2 · 五阶段与门禁

| 阶段 | 名字         | 产物                                                                                                                                 | 出口判据（不满足不许进下一阶段）                                                                                                                                                                                                   |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `brief`      | `BRIEF.md`                                                                                                                           | frontmatter 齐全：workflow/flow/storyboard/message/destination/aspect/language/length/angle/audience                                                                                                                               |
| 2    | `storyboard` | `STORYBOARD.md`                                                                                                                      | 每帧有 scene/duration/poster/transition_in/status/src/motion/voiceover + 一段"画面"描述                                                                                                                                            |
| 3    | `script`     | `SCRIPT.md` + `frame.md`                                                                                                             | 旁白**逐字锁定**（后面不许改文案）+ 设计令牌落盘                                                                                                                                                                                   |
| 4    | `voice`      | `.media/audio/voice/*.wav` + `.media/tts-batch.json`                                                                                 | 每条旁白合成完毕且**过语音判别**（见 `verification.md` §2）                                                                                                                                                                        |
| 5    | `build`      | {{FRAMES}} 帧 + `NN-slug.motion.json` + `index.html`（v2 项目另有 `tools/theme.json` / `tools/assemble-table.json` / `ledger.json`） | 门禁链 v2 全绿：`lint` 0/0 · `audit-frames` 0 finding · `sync --check` N/N · `verify-timeline` 0 error · `seam-gate verify` 绿（v2 项目；旧片跳过）· `check` 三项自证（`samples` / `contrast.checked` / `duration`，且带 `--out`） |

门禁命令一律以 `.mjs` 脚本表示，**统一入口**见 §4。

### 时间闭环（阶段 4→5 的关键动作）

旁白真实时长决定槽位，不由故事板的 `duration` 拍脑袋。流转：

1. TTS 产出每条 wav 的真实秒数（**读 wav 头算，不要信记录**）。
2. 槽位 = 该帧旁白时长 + **2.7s 余量**（含帧首 0.3s 入点；实测 12/12 帧落在 2.67–2.73s）。
   下面这个公式是**实测验证过**的，可以直接用：

   ```
   槽位(秒) = 0.3（帧首入点） + 旁白时长 + 2.4（帧内呼吸）
   末帧额外留白：+1.6s（尾部定格收尾）
   ```

   | 帧  | 旁白   | 槽位 | 槽位−旁白                |
   | --- | ------ | ---- | ------------------------ |
   | 01  | 8.266  | 11.0 | 2.734                    |
   | 02  | 16.126 | 18.8 | 2.674                    |
   | 03  | 17.287 | 20.0 | 2.713                    |
   | …   | …      | …    | …（12 帧全部 2.67–2.73） |
   | 12  | 18.762 | 23.1 | 4.338 ← 末帧留白         |

   合计：旁白 **210.09s**，槽位 **244.1s**，差 **34.0s**。

3. **每一处时长都必须等于槽位**：帧根 + 帧内的 `.clip` 层（paper / content / 有时还有 grain）。
   **层数是每帧自己的事**（实测 12 帧里 2、3、4 处都有），不变量只有一个：
   **帧内所有 `data-duration` 都等于槽位**。`sync-frame-durations.mjs` 按这个不变量检查，不按层数。
4. 槽位表回写 `index.html`（`data-start` 累加 + `data-duration`），并**同步 `BRIEF.md` 的运行中记录**。

> ✅ **本契约的数值取自成片与 `index.html`（权威）**：成片 244.1s / 旁白 210.09s。
> ⚠️ **权威数值也必须自证**：用 `verify-timeline.mjs` 从 wav 头重算一遍再信。
> 本项目就踩过"记录与成片不符"：`BRIEF.md` 运行中记录、`SCRIPT.md` 头部、
> `STORYBOARD.md` frontmatter 曾写着旁白**重建前**的旧数字（195s / 153.88s / 3m15s），
> 而成片是 244.1s / 210.09s —— 即 §2 第 4 步"回写运行中记录"当时漏做了。
> （该项目三份档案**已按本步回写为真值 244.1s / 210.09s**；此段保留为教学实例。）
> **这类漏写会让接手者按错的时长干活**，所以第 4 步是硬要求，不是礼貌。
> （完整对照表见 `narrative-arc.md` §6。）

> 实测教训：旁白重建把某槽位从 19s 拉到 24.1s，但帧内 `.clip` 层还停在 19s，
> 结果内容层在第 19 秒关掉，这一幕以近乎空屏收尾。这就是 `sync-frame-durations` 存在的原因。

---

## 3 · 已实测的项目事实（写文档/脚本时直接引用，不要再猜）

| 事实                                | 值                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 画布                                | 1920×1080 @ 30fps，`data-resolution="landscape"`                                                                                                                                                                                                                                                                                                                                                                                            |
| 成片总长                            | **244.1s**（12 帧 / 7323 帧）— **本条取自成片与 index.html，权威**；帧数是本项目实例，不是规范                                                                                                                                                                                                                                                                                                                                              |
| 旁白总长                            | **210.09s** / 12 条（wav 头实测，22050Hz·16bit·mono）；单条 8.266–22.166s                                                                                                                                                                                                                                                                                                                                                                   |
| 槽位余量                            | 槽位 − 旁白 = **2.67–2.73s**（12 帧一致）；末帧 +4.338s（尾部留白）                                                                                                                                                                                                                                                                                                                                                                         |
| ✅ 记录已闭环                       | 该项目三份档案曾写 195s / 153.88s / 3m15s（旁白重建**前**旧值），已按 §2 时间闭环回写为 **244.1s / 210.09s**；保留为"回写漏做 → 补齐"的教学实例                                                                                                                                                                                                                                                                                             |
| 色调令牌                            | paper `#F1EDE4` · paper-deep `#E3DCCC` · **paper-shadow `#DED6C4`（垫纸用，实测 10/12 帧）** · ink `#121212` · ink-soft `#514C44` · rule `#C9C2B4` · accent `#1D4ED8` · signal `#E23A2E` · marker `#FFD400`                                                                                                                                                                                                                                 |
| 字体                                | Noto Sans SC（100–900 VF，display 900 / body 400）· JetBrains Mono（400/700）· Caveat 700（手绘）· Microsoft YaHei（`local()` 兜底）                                                                                                                                                                                                                                                                                                        |
| 材料图尺寸                          | 满幅 2× 截屏 **3788×1960**；裁切派生的材料用其自身尺寸（实例：`ui-tasks-a11.png` = 1380×770、`ui-patch-a12.png` = 1265×890）                                                                                                                                                                                                                                                                                                                |
| 手绘 viewBox                        | **= 该 `<img>` 自身的像素空间**（不是写死 3788×1960）。需要放大时给同一像素空间一个窗口，如 `viewBox="300 250 3280 1640"` + `preserveAspectRatio="xMinYMin meet"`                                                                                                                                                                                                                                                                           |
| 手绘路径样式                        | 默认红笔 `fill:none;stroke:#e23a2e;stroke-width:6;stroke-linecap:round`；**落在暗底/墨块内改粉白 `stroke:#f1ede4`**（实例：第 12 帧代码块）                                                                                                                                                                                                                                                                                                 |
| 手绘描画                            | 用 `getTotalLength()` 的 dash 逐笔画出                                                                                                                                                                                                                                                                                                                                                                                                      |
| 材料框                              | `3px solid #121212`（12 帧一致）；细线 `border-bottom:1px solid #c9c2b4`；重线 `border-top:3px solid #121212`                                                                                                                                                                                                                                                                                                                               |
| 音轨分层                            | 帧槽位 `data-track-index="1"`，地面层 `"0"`，旁白 `"10"`，音效 `"11"`                                                                                                                                                                                                                                                                                                                                                                       |
| 旁白入点                            | 槽位开始后 0.3s                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 音效数量                            | 7 个稀疏标点（不是垫床）——VOX 的克制用法                                                                                                                                                                                                                                                                                                                                                                                                    |
| **纸 ASMR 轨（新增，`issues/19`）** | `data-track-index="12"`（**独立于 `11`**，便于独立计数与调平）；`.media/audio/asmr/*.wav`；**PCM s16le / 48kHz / mono / ≤2.5s / 峰值 −18~−14 dBFS（转场处可到 −10）/ `data-volume` 0.15–0.4**；每种 ≥2 变体、冻结入库、进 `manifest.jsonl` 带 `license`；**入点只许落槽位余量（≈2.7s 静默），3–8 处/片**；**不做全片底噪**；**绝不放 `.media/audio/voice/`**（会被 `verify-timeline` 当旁白）；**ASMR 不 ducking 口播**（改入点，不压旁白） |
| 内置库音效响度                      | ⚠️ `media-use` 内置 19 件 Pixabay 库**母带极响**（实测 `impact-bass-1` mean −5.0 / max −0.4dB，旁白 mean −18.1 / max −1.5dB = **响 13dB**）→ **入库前必须归一化到峰值 ≤ −14 dBFS** 并配 `data-volume` 0.15–0.35；ffmpeg 合成音相反**偏静**（max ≈ −19.5dB），需补 makeup gain                                                                                                                                                               |
| 素材基准                            | 帧内 `src` 写**项目根相对**路径，如 `.media/assets/ui-roster.png`、`assets/fonts/...`；主时间轴的 GSAP 写 `assets/vendor/gsap.min.js`                                                                                                                                                                                                                                                                                                       |
| 时间轴注册                          | `window.__timelines["<composition-id>"] = tl;`（非 paused），末尾 `tl.seek(0)`                                                                                                                                                                                                                                                                                                                                                              |
| `#root` 定位模型                    | **必须 `position: relative` + 显式 `1920×1080`**，且 `html, body { margin:0 }`。漏了它，帧内绝对定位元素会落回普通流（`pitfalls.md` §16）                                                                                                                                                                                                                                                                                                   |
| 深底文字入场                        | 用「只位移不透明」的 `show()`，不用 `fade()`（否则对比度审计会在淡入中途采样，`pitfalls.md` §18）                                                                                                                                                                                                                                                                                                                                           |

### 第二个数据点（`freetoken-v013-vox`）—— 用来判断「哪些是实例、哪些是规律」

| 事实            | 第一个数据点（dsh，参考实例）                                 | 第二个数据点（freetoken）                                 |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 帧数            | 12                                                            | **12**（但分段不同：`3+4+1+1+2+1`，机制 4 条、演示 2 步） |
| 成片总长        | 244.1s                                                        | **267.4s**                                                |
| 旁白总长 / 引擎 | 210.09s / edge-tts                                            | **233.472s / IndexTTS 2.5 零样本克隆**                    |
| 单条旁白        | 8.266–22.166s                                                 | **8.057–26.706s**                                         |
| 槽位余量        | 2.67–2.73s                                                    | **2.70–2.78s**（同一条规律，独立复现）                    |
| wav 规格        | 22050Hz·16bit·mono                                            | **24000Hz·16bit·mono**                                    |
| 音轨            | 7 个稀疏音效                                                  | **7 个稀疏音效**（ffmpeg 确定性合成，无配乐）             |
| 同步方式        | `beat-*`（停顿 + 比例插值）                                   | **词级对齐**（12 帧 / 97 条线索全命中）→ `voice-sync.md`  |
| 渲染            | 690.8s，需设 `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS` | 267.4s，**同样必须设**（默认 240 会挡）                   |

**读法**：帧数、时长、余量都是实例取值；**跨项目稳定的是「槽位余量 ≈ 2.7s」、7 个稀疏音效、
30fps 1920×1080、以及那条长片渲染闸门** —— 第二个数据点把这几条各复现了一次。

### 帧内骨架的硬结构（`templates/frame-skeleton.html` 就是这个）

> **`.js-hide` 的隐藏属性是 `visibility`，不是 `opacity`。** 这一点曾经被写错，现按实测更正：
> 12 帧里有 `.js-hide` 的 5 帧（04/05/06/11/12）**一致使用 `#root .js-hide { visibility: hidden }`**，
> 揭示由 `hf-js-hide-reveal-pass` 写入 `{ visibility: "visible" }` 完成，`opacity` 只负责淡入。
> **理由**：隐藏必须把元素真正移出 paint —— 用 `opacity: 0` 隐藏的元素在冷渲染/布局审计里仍占位可见，
> 那正是 leak guard 要挡的泄漏。所以"隐藏用 visibility、动画用 opacity"是本管线的**故意设计**，
> 且必须有 leak guard 配套（见 `pitfalls.md` §5）。
> 改帧时这是骨架的一部分：**两个集成块都别删。**

```
<template>
  <style>
    /* hf-scene-visibility-leak-guard */   ← 与 visibility 隐藏配套，见 pitfalls §5
    <5 条 @font-face，指向 assets/fonts/>
    ...
    #root .js-hide { visibility: hidden }   ← 与 reveal pass 配套，见 pitfalls §4
  </style>
  <div id="root" data-composition-id="frame-NN-slug" data-width="1920" data-height="1080" data-duration="<槽位>">
    <div id="frame-NN-slug-paper"   class="clip" data-start="0" data-duration="<槽位>" data-track-index="0" ...>
    <div id="frame-NN-slug-content" class="clip" data-start="0" data-duration="<槽位>" data-track-index="1" ...>
    <div id="frame-NN-slug-grain"   class="clip" data-start="0" data-duration="<槽位>" data-track-index="2" ...>
  </div>
  <script>
    (function () {
      const tl = gsap.timeline();
      ... 动效 ...
      tl.seek(0);
      window.__timelines["frame-NN-slug"] = tl;
    })();
  </script>
</template>
```

---

## 4 · 模板占位符约定

`templates/` 里的 `{{…}}` 分两类，**别混**：

| 形式                                                                                                            | 含义                         | 谁来填                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `{{TITLE}}` `{{FRAMES}}` `{{TOTAL}}` `{{CHANNEL_TAG}}` `{{AUDIENCE}}`                                           | **文档级**参数，全项目一个值 | `init-vox-project.mjs` 已自动替换                                              |
| `{{COMPOSITION_ID}}` `{{DURATION}}` `{{NN}}` `{{FRAME_NN}}` `{{slug}}` `{{HEADLINE}}` `{{RULE_1}}` `{{RULE_2}}` | **逐帧**参数，每帧不同       | 作者**逐帧**替换（`_templates/frame-skeleton.html` 复制 N 份，每份填成对应帧） |

`init-vox-project.mjs` 只对**文档级**占位符做替换，逐帧占位符**故意保留**在
`_templates/` 里（它退出时会分别报告"文档级残留"=失败、"逐帧残留"=预期）。

### ⚠️ 一条硬教训：注释里的元素仍会被解析

**模板的注释里不要放真实元素。** 实测：
`<!-- <audio src=".media/audio/sfx/sfx_001.mp3" …> -->` 让 `lint` 报
`audio_src_not_found`（它照样解析注释里的标记），而且那个 `<audio>` 还会被
`verify-timeline` 当成一条真旁白，产生"找不到所属槽位"的连锁误报。

推论（两条都踩过）：

1. 注释里的槽位/旁白元素会**污染**门禁结果 —— 模板里的结构示例一律写成**缩进文本**，不写标签。
2. 不要把占位符放进 HTML 注释里：替换后 `<!-- …{{X}}… -->` 会变成 `--{{X}}-->` 这类破损注释。
   所以 `index-timeline.html` 的示例区**不含任何 `{{…}}`**。

`frame-skeleton.html` 里以 HTML 注释形式给出的材料与手绘用法示例是**教学示意**（不含真实 src），
作者按需改写成真实内容。

---

## 5 · 脚本契约（名字、参数、退出码固定）

位置：`.claude/skills/vox-explainer/scripts/`。**项目根可传参**，默认 `process.cwd()`。
统一约定：`--json` 输出机器可读；退出码 `0` = 通过，`1` = 有 finding，`2` = 用法/环境错误。
**`hf.mjs check` 额外使用 `3` = 未自验证**（未传 `--out`，无法程序化核对 `samples/contrast/duration`），
脚本与 CI 必须把 `3` 视为**未通过**。

| 脚本                       | 用途                                                                         | 调用                                                                                                           | 通过判据                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `init-vox-project.mjs`     | 从 templates 起一个项目骨架                                                  | `node <skill>/scripts/init-vox-project.mjs <targetDir> [--theme paper\|collage\|terminal-dark\|minimal-swiss]` | 目录建好，`assets/vendor/gsap.min.js` 已复制，无 `{{` 残留                                               |
| `draft-voice-timeline.mjs` | 前置文案时序推导与打样                                                       | `node <skill>/scripts/draft-voice-timeline.mjs [--project .] [--draft-tts] [--update-storyboard --force]`      | 产出各帧预估槽位与节奏诊断（覆写需 `--force`）                                                           |
| `gen-vox-annotation.mjs`   | DOM/坐标锚定手绘 SVG 生成器                                                  | `node <skill>/scripts/gen-vox-annotation.mjs --rect "x,y,w,h" [--shape box\|circle\|underline\|arrow] [--fit]` | 产出确定性 SVG path 及配套 GSAP 动效                                                                     |
| `audit-frames.mjs`         | 静态扫已知坑 + v2 门禁（主题/焦点/装配/密度/账本/生成物；支持 --frame 单帧） | `node <skill>/scripts/audit-frames.mjs [--project .] [--frame NN] [--json]`                                    | `findings: 0`（error 与 warning 均须为 0）                                                               |
| `sync-frame-durations.mjs` | 时长对齐与侧车同步（支持 --frame 单帧）                                      | `node <skill>/scripts/sync-frame-durations.mjs [--project .] [--frame NN] [--check]`                           | `已核对帧数 == 目标帧数`（同时同步 `.motion.json`）                                                      |
| `verify-timeline.mjs`      | 槽位 vs 旁白真实时长                                                         | `node <skill>/scripts/verify-timeline.mjs [--project .] [--json]`                                              | 每帧 `slot - voice >= 0`（允许至多 0.5s 的呼吸余量以下）                                                 |
| `verify-film-audio.mjs`    | 语音 vs 杂音判别                                                             | `node <skill>/scripts/verify-film-audio.mjs <media> <start> <dur>`                                             | 语音 **CV ≥ 0.9** 且静音帧 **25–65%**；`gray`（0.7–0.9）必须补 ASR 内容级对稿（见 `verification.md` §5） |
| `hf.mjs`                   | 门禁 CLI 包装（lint/check/snapshot）                                         | `node <skill>/scripts/hf.mjs <lint\|check\|snapshot> [args] [--out <file>]`                                    | `lint: 0 error / 0 warning; check: samples>0 && contrast>0 && duration>0 && 0 error (未传 --out 返回 3)` |

> **v2 依赖模块**（`init` 一并复制进 `tools/`，与生成器同源，不单列命令）：
> `gate-tier.mjs`（**产物存在性分档** —— 所有 v2 门禁经它决定 `error`/`warning`/`info`，缺产物绝不判红）·
> `theme.mjs`（令牌源：`themes/<name>.json` → `tools/theme.json`，生成器只读它）·
> `motion-const.mjs`（`NARRATION_LEAD=0.3` / `DEFAULT_LEAD=0.2` / `RENDER_FPS=30` + 11 个动效契约常量）。
>
> **门禁链第 6 道 `seam-gate.mjs`** 在 **`motion-doctrine/scripts/`**（不随 vox 复制，需无头 Chrome）：
> `node <motion-doctrine>/scripts/seam-gate.mjs verify --ledger ledger.json --project . [--json]`。

**作者侧脚本**（不是通用门禁，随项目初始化复制进 `tools/`；列在这里是为了名字与签名统一）：

| 脚本                  | 用途                                                                                                                                                                                                                                                     | 调用                                                                                                                                                 | 通过判据                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `slots.mjs`           | **槽位表的唯一计算处**（读 `.media/voice-manifest.json` 的 wav 头真值，十分之一秒整数累加避免浮点漂移）                                                                                                                                                  | 被 `gen-frames.mjs` / `gen-index.mjs` import                                                                                                         | 无独立输出；`TOTAL` 应等于 `index.html` 根 `data-duration`                                                  |
| `gen-frames.mjs`      | **按 `frames-data.mjs` 生成 N 帧 + N 个侧车**；含 `buildFrame()` 契约套件与 `autoPosition()`                                                                                                                                                             | `node tools/gen-frames.mjs`                                                                                                                          | 打印每帧 `slot / 线索数`；`autoPosition` 命中的选择器逐条列出                                               |
| `gen-index.mjs`       | **装配 `index.html`**（槽位 + 旁白轨 + 音效轨 + **纸 ASMR 轨 12**，读可选 `tools/asmr.json`）                                                                                                                                                            | `node tools/gen-index.mjs`                                                                                                                           | 槽位数 == 帧数；总长 == `slots.mjs` 的 `TOTAL`；ASMR 入点不落进旁白窗口                                     |
| `gen-asmr.mjs`        | **纸 ASMR 素材生成器（通道 C）**：6 种（卡纸敲/胶带压/章砰/橡皮章落/钉咔/**线嘶**）用 `lavfi` + 固定 `seed` 确定性合成；`--with-fallbacks` 补纸滑/房间底噪的合成近似版；`--only <slug,…>` 只重生成指定项                                                 | `node tools/gen-asmr.mjs [--with-fallbacks] [--only <slug,…>] [--write-manifest] [--force]`                                                          | PCM s16le · 48k · mono · ≤2.5s · 峰值 **−18 ~ −14 dBFS**；同 ffmpeg+seed 产出同字节                         |
| `gen-asset.mjs`       | **生成资产命名桥**：调公共技能 `media-use` 的 comfyui provider 出氛围/转场/封面图 → 改名为 `.media/assets/gen-<role>-<nn>.png` → 写入 `.media/gen/<role>-<nn>.workflow.json` → 追加 vox 账本的 `tier:"M5"` 行（`model_file`/`model_sha256`/`seed`/`workflow_path`/`refs`/`license`）；一致性 = 中性锚图 + 固定 seed + 每张从锚图做参考编辑 | `node tools/gen-asset.mjs --role <anchor\|mood\|transition\|cover> --intent "<…>" [--ref <锚图>] [--seed 20260923] [--model-sha256 <64-hex>] [--width --height] [--self-test]` | 产物落 `.media/assets/gen-<role>-<nn>.png`；快照落 `.media/gen/<role>-<nn>.workflow.json`；账本行含 `tier:"M5"`/`model_file`/`model_sha256`/`seed`/`workflow_path`/`license`；`--self-test` OK |
| `ink.mjs`             | 确定性手绘路径（6 个旧生成器 + 两档 **`inkStroke` / `inkMarkup`**：`normal` 多描 ×3 · `highlight` 收锋 24 段 + 顿点 + 细尾 + 干笔）                                                                                                                      | 被 `frames-data.mjs` import                                                                                                                          | 同一 seed 每次产出同一条 path；产物必须共用一个 `<g data-ink=…>`（`pitfalls.md` §20）                       |
| `torn.mjs`            | 确定性**低频撕边** `clip-path`（`TORN_FREQ` 每边 3–4 点 · `TORN_AMP` 按宽度分档 `soft/mat/wide` · 含 1–2 处长裂口）                                                                                                                                      | `torn(w,{seed,tier})` / `tornClip(w,{seed})`；被 `frames-data.mjs` import                                                                            | 输出 `%` 坐标 polygon；元素带 `data-torn` + 内联 `clip-path`（`pitfalls.md` §22）                           |
| `synthesize_voice.py` | 旁白合成 + 量真实秒数 + 写 `.media/voice-manifest.json`（支持 `--frame NN` 单条重跑并并回清单）                                                                                                                                                          | `python tools/synthesize_voice.py [--frame NN] [--list]`                                                                                             | 每条合成成功且 wav 头可读；合计秒数与清单一致                                                               |
| `align-cues.py`       | **词级对齐**：`SCRIPT.md` + `tools/cues.json` + faster-whisper → `tools/cue-times.json`                                                                                                                                                                  | `python tools/align-cues.py --model medium [--frame NN]`                                                                                             | 线索 N/N 命中；打印 `align_hit` 与逐帧 ASR 转写                                                             |
| `shot.ps1`            | 本机 Chrome 无头实拍真实页面（2× → 3788×1960）                                                                                                                                                                                                           | `powershell -File tools/shot.ps1 -Url <url> -Out <png> [-Height 980]`                                                                                | 输出文件存在且 `ffprobe` 报出预期尺寸                                                                       |

> **作者侧脚本的纪律**：`tools/cues.json` 是**手写的唯一来源**；`tools/cue-times.json` 是**机器产物、不许手改**；
> 帧里**不许写死秒数**。三者一旦互相污染，同步就再也复现不出来（详见 `voice-sync.md`）。

`hf.mjs check` **必须在包装里固定注入 `--no-browser-gpu`**，并支持 `--out <file>`
由子进程直接写出 JSON，程序化自验证 `samples.length`、`contrast.checked` 与 `duration` 均有效通过（返回 0；未指定 `--out` 返回退出码 3 说明未自验证）。

> 为什么是 `.mjs`：与 `motion-doctrine/scripts/*.mjs` 同风格，Node 22 在 PATH 上直接用；
> 本机受限沙箱里 `bunx`/`oxfmt` 之类**会 spawn 子进程**的工具会 EPERM，而直接 `node` 不会。

---

## 6 · 门禁命令的固定形状

```powershell
# 0 · 改完 frames-data.mjs / cues.json 之后，先生成产物（顺序不能反）
python tools/synthesize_voice.py          # 旁白 → .media/voice-manifest.json
python tools/align-cues.py --model medium # 线索 → tools/cue-times.json
node   tools/gen-frames.mjs               # 帧 + 侧车 + tools/assemble-table.json
node   tools/gen-index.mjs                # index.html（槽位 + 旁白轨 + 音效轨 + 纸 ASMR 轨）+ ledger.json
node   tools/gen-asmr.mjs                 # 纸 ASMR 素材（通道 C；纸滑/房间底噪走通道 G 手动入库；线嘶 走 C —— 盲听结论）

# 1 · 槽位与侧车同步（先修后验；自动同步 HTML data-duration 与 .motion.json duration_s）
node <skill>/scripts/sync-frame-durations.mjs

# 2 · 结构 + 静态审计 + v2 门禁（期望 0 error / 0 warning；期望 findings: 0）
node <skill>/scripts/hf.mjs lint --json
node <skill>/scripts/audit-frames.mjs --json

# 3 · 复核时长与侧车 0 漂移（期望 N/N frames ok）
node <skill>/scripts/sync-frame-durations.mjs --check

# 4 · 时间轴：槽位 vs 真实旁白（期望 0 error）
node <skill>/scripts/verify-timeline.mjs --json

# 5 · 接缝渲染闸 —— 门禁链第 6 道（需无头 Chrome；仅 v2 项目有 ledger.json）
node <motion-doctrine>/scripts/seam-gate.mjs verify --ledger ledger.json --project . --json

# 6 · 浏览器门禁（包装已带 --no-browser-gpu；--out 自动完成三项计数自核对，未传则返回退出码 3）
node <skill>/scripts/hf.mjs check --json --out .hyperframes/check-latest.json

# 7 · 取快照看图（--no-end 必须带，否则会顺手把 end 帧也拍掉）
node <skill>/scripts/hf.mjs snapshot --at <全局秒> --no-end --timeout 30000 --output .hyperframes/snaps-x

# 8 · 出片
node ..\..\packages\cli\dist\cli.js render .
```

> **历史实测教训（侧车漂移现已消除）**：
> 参考项目曾因手工调帧未同步更新 `.motion.json`，在旧版 `audit-frames` 中出现 10/10 侧车漂移报警。
> 现已在 `sync-frame-durations.mjs` 中将侧车 `duration_s` 纳入自动同步，并且调整门禁顺序为 `sync` 优先，彻底消除该漂移风险。

全局起点表（改帧/取快照用）：**每个项目由 `verify-timeline.mjs` 产出，不要照抄别的项目。**
下面这张只是本项目（`dsh-agent-teams-vox`，12 帧）的实例：

`01=0 · 02=11.0 · 03=29.8 · 04=49.8 · 05=68.6 · 06=93.5 · 07=114.8 · 08=134.5 · 09=159.3 · 10=179.3 · 11=203.4 · 12=221.0`

---

## 7 · 协作纪律（派工时写进每个任务的描述）

1. **一帧一个作者，写入范围必须互斥。** 并发写同一帧 = 混合态：快照拍到半成品，
   还可能把刚改的内容覆盖回去。改帧前后比对 mtime。
2. **编辑帧期间不要开 `preview`。** Studio 会重写帧文件（给每个元素盖 `data-hf-id`）。
   要审片时再 `preview --background`，审完 `preview --stop`。
3. **集成修复块原样保留，别删**：`hf-scene-visibility-leak-guard` 与
   `hf-js-hide-reveal-pass` 是两个集成补丁，改帧时当它们是骨架的一部分。
4. **事实必须有出处。** 讲产品能力时禁用未解释术语；实验性能力不许说成稳定能力。
   本项目取数来源：每个包自带的 `README.zh.md`、`cordis.patch.yml`、源码。
5. **旁白锁定后不许改文案**。要改就得重跑该条 TTS + 重算槽位（阶段 3→5 回退）。
6. **不要手抄帧**。契约部分由生成器写一次，逐帧只写「属于它自己的东西」。
   同理：**不要手改 `cue-times.json`**、**不要在帧里写死秒数** —— 同步的可复现性全押在这两条上。
   改完线索名或锚短语**必须重拍快照**：线索名写错不会报错，元素只会提前出现（`voice-sync.md` §5）。
