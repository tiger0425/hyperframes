# 材料化 —— 把"真实"做成画面里的材料

> VOX 风格里最有说服力的不是排版，是**真实材料**：真实包名、真实版本号、真实字段、
> 真实配置片段、真实工具调用行。一帧"不像 PPT"的实质，就是材料真的植进去了，并且手绘标注真的落在材料身上。
> 设计令牌与手绘样式见 [`visual-grammar.md`](./visual-grammar.md)；本文件只讲材料从哪来、怎么落进帧。

## 一、材料从哪来：真实优先，重画是降级

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1 | 真实文件与源码（`README.zh.md`、`cordis.patch.yml`、源码片段、CLI 输出） | 字段名、版本号、配置、限制清单 |
| 2 | 真实运行界面截图 | 产品有可截的界面且你能访问到 |
| 3 | **一比一重画的 mock**（字段与中文文案取自真实文件） | 界面在鉴权之后、命令行截不到 |

**铁律**：进画面的每一个字符串都要能追到出处。不许凭印象写一个"看起来像"的字段名。
本项目唯一一处 mock 面板（第 10 帧）是因为本机 GUI 在鉴权之后截不到，于是**按真实插件的字段与中文文案一比一重画**——
不是编一个界面，是换一种方式搬运真实。

## 二、素材生成页 → 截屏 → 入库

生成的中间页放在项目 `.hyperframes/_assets/` 下（不参与渲染，只是截图靶子）。
一页多份材料时用 hash 路由，避免为每份材料建一个文件：

```
.hyperframes/_assets/material.html#<packages|terminal|limits|roster|tasks>
.hyperframes/_assets/team-panel.html      ← 整屏含桌面
.hyperframes/_assets/panel-face.html      ← 纯屏面（裁掉桌面）
.hyperframes/_assets/team-patch.html
.hyperframes/_assets/tool-registry.html
```

**截屏规格（决定后面所有坐标）**：

| 项 | 值 | 为什么 |
|---|---|---|
| 缩放 | **2×** | 渲染时缩下来更锐；手绘坐标有亚像素余量 |
| 输出尺寸 | **3788×1960** | = 1894×980 视口 × 2。手绘 SVG 直接按这个像素空间写坐标 |
| 格式 | PNG | 文字边缘不能有 JPEG 振铃 |

```powershell
node tools/_asset-shot.mjs <page[#hash]> <out.png> [scale]   # 默认 2×
```

**入库**：每份材料在 `.media/manifest.jsonl` 记一行（路径、来源、尺寸、生成方式）。
账本是"这份材料是什么、从哪来"的唯一记录——没有账本的材料，接手者不敢用。

## 三、把材料植进帧

材料一律用**项目根相对路径**引用（与 `assets/fonts/...` 同基准）：

```html
<img src=".media/assets/ui-roster.png" alt="">
```

**四种材料化手法**（本项目全部用过，按帧的语义挑 1–2 种）：

| 手法 | 做什么 | 用在 |
|---|---|---|
| 错位垫纸 | 材料下方垫一层纸做投影偏移（**不是 CSS 阴影**） | 所有材料帧的基座 |
| 画外甩入回弹 | 材料从画外进入并轻微回弹 | 开场、机制帧 |
| 视差 | 材料与背景以不同速率位移 | 需要纵深时 |
| 遮罩擦入 | `clip-path` 逐步揭开材料 | 演示帧、面板展开 |

**材料是超大图按窗口裁切的**：材料 3788×1960 大于画布能容纳的实读尺寸，
所以按窗口裁切是设计内的。裁切会让元素越出容器，触发 info 级
`container_overflow` / `escaped_container`——**给该元素加 `data-layout-allow-overflow` 清掉**
（本项目第 9 帧就是这么清的，第 4/6 帧产生 info 级 escaped_container 报警留着没清，第 5 帧未报）。

## 四、手绘标注必须落在材料上

手绘（圈注、箭头、下划线、对勾）是 VOX 里**唯一允许的装饰**，判据只有一条：**它必须指向真实信息**。

**坐标系统**：用 inline `<svg>` 覆盖在图片上，`viewBox` 取**该图片自身的像素空间**——
这样坐标按图内像素写、自动缩放，换窗口裁切位置也不用改路径。三种写法（实测）：

| 情形 | viewBox | 实例 |
|---|---|---|
| 满幅 2× 截屏（占多数） | `0 0 3788 1960` | 7 帧 |
| 要放大某区域 | 同一像素空间给一个窗口 + `preserveAspectRatio="xMinYMin meet"` | 07 帧 `300 250 3280 1640`；08 帧 `240 458 3080 1000` |
| 裁切派生的材料 | 该文件自身尺寸 | 11 帧 `0 0 1380 770`（`ui-tasks-a11.png`）；12 帧 `0 0 1265 890`（`ui-patch-a12.png`） |

```html
<div class="material">
  <img src=".media/assets/ui-tool-registry.png" alt="">
  <svg viewBox="0 0 3788 1960" preserveAspectRatio="none">
    <path class="scribble" d="M 812 640 C 900 600, 1180 604, 1240 660 …"/>
  </svg>
</div>
```

**路径样式与描画**：

```css
.scribble {
  fill: none;
  stroke: #e23a2e;          /* signal 红（默认） */
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 落在暗底/墨块内（例如真实代码块 #0d1117）改用粉白，否则看不见 */
.scribble.on-dark { stroke: #f1ede4; }
```

逐笔画出用 `getTotalLength()` 的 dash（**画完必须归零偏移**，否则重播时线是断的）：

```js
document.querySelectorAll(".scribble").forEach((p) => {
  const len = p.getTotalLength();
  gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
  tl.to(p, { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, at);
});
```

**怎么定位坐标**：不要靠猜。先从材料页/截图里量出目标元素在图内的像素位置，
或者写一个临时的测量脚本截取局部放大图用 `read_image` 看。本项目为此有
`_png_geom.mjs` / `_measure.mjs` / `_png_rows.mjs` / `_term_cols.mjs` 这类一次性量测工具——
**量出来再写，不要估**。

## 五、每帧材料与语义的对应（本项目实例，作为"怎么配"的示范）

| 帧 | 材料 | 手绘该指向哪 |
|---|---|---|
| 03 是什么 | `ui-package-list.png`（五个真实包 + 真实版本） | 圈住 `agent-team` 与 `client-ui-agent-team` 两行 |
| 04 花名册 | `ui-roster.png` | 圈住 Lead 行；划在状态芯片下 |
| 05 信箱 | `ui-terminal.png` | 划在 `send_message(...)` 那一行 |
| 06 任务板 | `ui-tasks.png` | 圈住 task-3 的 `依赖 / 可开始` |
| 07 工具面 | `ui-tool-registry.png` | 圈住 `spawn_teammate` 与 `team_task_*` 四行 |
| 08 那个坑 | `ui-limits.png` | 划在「owner 不释放」「写入范围只是提示」两行 |
| 09 演示 | `ui-terminal.png` | 圈住 `spawn_teammate(...)` 那一行 |
| 11 验收 | `ui-tasks.png` | 三个勾画在材料上（三次描线） |
| 12 边界 | `ui-team-patch.png` | 划在 `maxMembers: 8` 与 `forkProvider: fork` |

**没有截图可用的帧怎么办**：就做抽象示意（本项目第 2 帧用三卡 + 手绘汇聚箭头），
**不要为了"有材料"而伪造一张界面**。抽象图 + 手绘是诚实的；假 UI 不是。

## 六、音效：标点，不是垫床

本项目无配乐（无云端曲库凭据），按 VOX 习惯用 **7 个稀疏音效**做标点：
开场一记、机制切换点、驳回提示、演示段起手与打字、验收勾、收尾。
`data-track-index="11"`。

**不要用劣质合成音乐垫底**——宁可安静。音效只在"画面发生了一件事"的位置出现，
不要按固定间隔铺。

> 若拿到了配乐凭据：音乐也应**让位于旁白**（人声压低音乐），走 `hyperframes-audio` 的
> voiceover carve 与 submix，而不是简单调低总音量。

## 七、注册表区块/组件的接线规则（**装 ≠ 接线**）

这条规则来自一次真实的施工缺失：某片装了 6 个注册表条目，**一个都没接线** ——
手绘与颗粒全是帧内内联复刻，而项目自己的规格里写着"纸纹颗粒用注册表区块实现，不在 CSS 里手搓"。

### 判据：看**文件形状**，不看目录、不看 `registry-item.json` 的 `type`

装完 `hyperframes add <X>` 后打开 `compositions/components/<X>.html`，**剥掉 HTML 注释**再看：

| 剥注释后是否含 `data-composition-id` | 角色 | 必须怎么做 |
|---|---|---|
| **含** | 子合成（sub-composition） | **必须用 `data-composition-src` 挂载** |
| **不含** | 片段（snippet） | **必须把它的 HTML / CSS / JS 粘贴进宿主帧** |

```html
<!-- 子合成：挂载 -->
<div class="clip" data-composition-id="<同名>" 
     data-composition-src="compositions/components/<X>.html"
     data-start="2" data-duration="4" data-track-index="0"></div>
```

出处：`skills/hyperframes-registry/references/component-quality-bar.md` §1。
原文警告：**把子合成内联会变成"文档套文档"并渲染成黑屏** —— 那读起来正好像"这个条目坏了"。

### 三个容易搞错的点

1. **`registry-item.json` 的 `type` 不可信。** 实测 6 个条目的 `files[].type` **全是**
   `"hyperframes:snippet"`，但其中 5 个的 `.html` 实际含 `data-composition-id`（是子合成）。
   只有"文件形状"这个判据可靠。
2. **目录名不可信。** 它们都躺在 `compositions/components/` 下，但那不能证明它们是片段。
   实测 6 个里只有 `grain-overlay.html` 是裸片段（无 doctype / 无 `<template>` / 无 timeline 注册），
   其余 5 个（`vox-annotate`、`hw-arrow`、`hw-callout-circle`、`hw-box-label`、`hw-underline`）
   都是**完整 HTML 页 + 自带 `window.__timelines` 注册**，属于子合成。
3. **组件自带 CDN `<script>` 不是"不能挂载"的理由。** 已发布条目大量自带 CDN gsap，
   runtime 有专门路径支持它，lint 甚至建议加它。但要知道代价：
   CDN 脚本打包后**仍是外链**，离线渲染会黑屏，并被诊断为
   `"GSAP is not loaded — CDN script may have failed to download"`。
   **挂载组件时 GSAP 首选本地**（确定性教条禁 render-time 取必需资产）。

### 验收判据（写进 build 阶段的自检）

> **"注释里提到过某个条目" 不等于 "接线了"。**

对每个已安装的条目，二选一必须能举证：

- (a) 存在指向它的 `data-composition-src`（子合成），或
- (b) 它的 markup / CSS 已逐条粘贴进某帧（片段），或
- (c) **显式声明**这是有意的参考复刻（帧内重画该手法），并说明为什么不直接接线。

`hf.mjs lint` 抓不到这个 —— 没接线的条目不会报错，它只是**不存在**。
所以这属于**人眼验收 + 代码检索**的职责：搜 `data-composition-src` 与条目名，
两头对不上就是没接线。

### 片段 vs 复刻的边界

片段可以抄手法（本项目抄了 `grain-overlay` 的 `feTurbulence` data URI 与类名），
但**子合成要么挂载、要么在帧内有意识地重画该手法**，两者不可混同。
实测本项目复刻颗粒时还顺手改了语义：组件的颗粒是
`top:-50%;left:-50%;width:200%;height:200%` + `0.5s steps(1) infinite` 动画，
帧内复刻改成 `inset:0` + 背景 tile 重复 + **无动画**（静态纸纹）。
这类改动是有意的（避开无限动画与确定性风险），但要写进侧车 `notes`，别让它变成无声的偏差。
