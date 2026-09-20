# VOX 视觉语法（visual-grammar）

> **事实来源**：`projects/dsh-agent-teams-vox/frame.md`（令牌原文）、`references/_contract.md` §1/§3（接口契约）、
> `projects/dsh-agent-teams-vox/compositions/frames/*.html`（本项目实例实测）。本文每个数值都能在这三处找到出处。
> 源文件之间不一致、需要 Lead 裁决的点，一律标 **【待核】**，不在此处自行发明令牌。
>
> **帧数是参数，不是规律**（`_contract.md` §0.5）：总帧数写作 `{{FRAMES}}`，由项目自己定。
> 本文里出现的 `12`、`01/03/04/…`、具体秒数**一律是本项目实例数据**，读作参考取值，不是规范。
> 规范只有那些与帧数无关的约束——令牌、焦点判据、边缘锚样式、手绘法、Do/Don't。

---

## 1 · 一句话内核

**纸感底 + 近黑正文 + 单一信号蓝。红只用于警示与手绘记号，黄只用于荧光笔；两种颜色都不铺面，出现即意味着「这里要看」。**

它不是审美偏好，而是三条可执行的纪律：

| 纪律 | 含义 | 落到像素上 |
|---|---|---|
| 权威感来自排版 | 极粗黑体大字、等宽元信息、细线分隔 | 900 字重 / mono 22px / 1px `rule` 细线 |
| 信息量可以大，焦点只能一个 | 一屏一个主张 | `accent` 蓝只落在焦点上（§3） |
| 颜色是稀缺资源 | 红黄出现即「这里要看」 | 每帧 警示红 + 记号黄 合计 ≤ 2 处 |

零圆角、零阴影、零渐变是这三条的必然结果，不是额外口味。

---

## 2 · 令牌表

### 2.1 颜色（8 个，全部来自 `frame.md` frontmatter）

| 令牌 | 值 | 用途（帧内实测） |
|---|---|---|
| `paper` | `#F1EDE4` | 帧地面，永远画在 `data-track-index="0"` 的地面层，**不画在 `#root` 上** |
| `paper-deep` | `#E3DCCC` | 分区底、卡片底（`02`、`05`） |
| `ink` | `#121212` | 正文/大字；`3px solid` 的材料边框、卡片描边、闭合主张的分隔线 |
| `ink-soft` | `#514C44` | 边缘锚、字段注释、表头、等宽元信息 |
| `rule` | `#C9C2B4` | 细线：表格行 `border-bottom: 1px solid`、分区线 |
| `accent` | `#1D4ED8` | **只落焦点**：大字底衬色块、关键词高亮、状态「运行中」 |
| `signal` | `#E23A2E` | 警示（限制条目）+ 手绘红笔（圈注、下划线、勾） |
| `marker` | `#FFD400` | 荧光笔：命令关键词底、任务板高亮行、落笔涟漪 |

**表外实测值（不在 8 令牌内，【待核】）**——写新帧时优先用上面的令牌，除非需要同样的语义：

| 值 | 出现处 | 语义 |
|---|---|---|
| `#ded6c4` | `01/02/03/04/05/06/09/10/11/12` 共 10 帧 | 「垫纸」——材料图下面那张纸，用来做**纸做的阴影**（比 `paper-deep` 略深） |
| `#0d1117` | `05`、`09` | 代码/终端块的暗底（GitHub 深色） |
| `#fffaea` | `05` | marker 结果条底色（`#FFD400` 的极浅版） |
| `#ffffff` | `01/03/04/06` | **仅材料 stage 内部**（裁切窗口背后的底），**不是**帧地面 |

> 禁令里的「纯白底」指的是**帧地面**。材料图自身的白底不算违规。

### 2.2 字体（`frame.md` typography + 帧内 `@font-face`）

| 角色 | 族 | 字重 | 字号 / 字距 | 用途 |
|---|---|---|---|---|
| `display` | Noto Sans SC | 900 | 大字，`-0.02em`（紧） | 主标题、大字主张；一律粗黑 |
| `body` | Noto Sans SC | 400 | 行高 `1.5` | 正文、卡片文案 |
| `mono` | JetBrains Mono | 500（命令关键词 700） | `0.12em` + 大写 | 包名、命令、字段名、编号标签 |
| 手绘 | Caveat | 700 | — | 手写批注字（本片正文未用，组件里用） |

CSS 字体栈（帧内逐字复刻，别改）：

```
正文:  "Noto Sans SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif
等宽:  "JetBrains Mono", ui-monospace, monospace
```

`@font-face` 共 5 条，`src` 指向**项目根相对**路径：

| 族 | 文件 | 声明 |
|---|---|---|
| Noto Sans SC | `assets/fonts/NotoSansSC-VF.ttf` | `format("truetype-variations")`, `font-weight: 100 900` |
| JetBrains Mono | `assets/fonts/JetBrainsMono-400.woff2` | `font-weight: 400` |
| JetBrains Mono | `assets/fonts/JetBrainsMono-700.woff2` | `font-weight: 700` |
| Caveat | `assets/fonts/Caveat-700-latin.woff2` | `font-weight: 700` |
| Microsoft YaHei | `local("Microsoft YaHei"), local("MicrosoftYaHei")` | 兜底；**lint 要求字体栈里每个具名族都有声明**，`local()` 满足它且不必附字体文件 |

`font-display` 一律 `block`（避免渲染中途换字）。

### 2.3 间距与形状

| 令牌 | 值 | 实测落点 |
|---|---|---|
| `margin` | `96px` | 边缘锚 `left: 96px; right: 96px`；大字主张 `left: 96px`；材料左沿 `96px` |
| `gutter` | `32px` | 分栏/卡片间隙的基准单位 |
| `radius` | `0` | 卡片、材料框、色块全部直角 |

形状语言（全部帧一致）：

| 元素 | 做法 |
|---|---|
| 材料框 | `border: 3px solid #121212` |
| 卡片 / 墨块 | `border: 3px solid #121212`（实心墨块就是 `background: #121212` + 浅色字） |
| 分隔线 | 细：`border-bottom: 1px solid #c9c2b4`；重：`border-top: 3px solid #121212` |
| 阴影 | **不存在**。阴影一律用「错位垫纸」（`#ded6c4` + `rotate(0.6–0.9deg)` + 负 `inset`）做出来 |
| 唯一允许的圆 | 手绘落笔涟漪：`78×78`、`border: 5px solid #ffd400`、`border-radius: 50%`（几何必需，不是装饰圆角） |

---

## 3 · 「每屏一个焦点」的可操作判据

`frame.md` 的原文是「占 40% 以上画面重量」，把它翻译成能在画布上量出来的四条：

| # | 判据 | 怎么量 |
|---|---|---|
| 1 | 焦点占 **≥ 40%** 画面重量 | 焦点框（大字主张或主卡）的宽 × 高 ≥ 1920×1080 的 40% |
| 2 | **`accent` 蓝出现次数 = 焦点个数** | 一帧里数蓝色块：>1 就说明有第二个焦点 |
| 3 | 第二个重点**必须等第一个说完** | 同帧内两个焦点不得同时在场；入场用动效节拍错开（本项目实例，第 12 帧：材料 1.3s → 圈注 2.4s → 命令 5.3s → 限制 7.6s） |
| 4 | 支撑细节不许升级 | 卡片、表格、字段名一律 mono 或 `ink-soft`，不许用 `display` 字重或 `accent` |

焦点候选只有两种：**一个大字主张**，或**一张主卡（真实材料）**。中性灰块只做占位，不做装饰。

**警告色预算**：警示红（`signal`）+ 记号黄（`marker`）每帧合计 **≤ 2 处**（`frame.md` Composition Rules 5）。
第 12 帧（本项目实例）是边界用法：手绘圈注 ×2 用红笔、命令关键词 ×2 用黄笔——因为红笔改成了粉白且在暗底墨块内，视觉上仍只算一组。

---

## 4 · 边缘锚契约

边缘锚是本片里**唯一逐字复刻**的元素：本项目实例的 12 帧中两串文字完全相同，只有编号变——这是**契约**，不是内容：

| 位置 | 文本 | 备注 |
|---|---|---|
| 左上 | `DSH · Agent Teams` | 频道标签；换主题时替换成该项目的品牌串，其余样式不变 |
| 右上 | `NN / {{FRAMES}}` | 帧编号；`NN` 两位从 `01` 起，`{{FRAMES}}` = **该项目自己的总帧数**（`_contract.md` §0.5），不是固定的 12 |

> 本项目实例即 `12 / 12`。8 帧的片子这里就该是 `03 / 08`——分母跟着项目走，与本文其余任何数值无关。

样式（帧内 `.hdr`，逐字复刻）：

| 属性 | 值 |
|---|---|
| 定位 | `position: absolute; top: 56px; left: 96px; right: 96px` |
| 布局 | `display: flex; justify-content: space-between` |
| 字体 | `"JetBrains Mono", ui-monospace, monospace`，`font-weight: 500` |
| 字号 / 字距 | `22px` / `letter-spacing: 0.12em` |
| 变形 / 颜色 | `text-transform: uppercase` / `ink-soft`（`#514c44`） |
| 入场 | `opacity 0 → 1, y: -16 → 0`，`0.4s power2.out`，在槽位 `t=0` |

**永不抢焦点**：它是全帧唯一的 `22px` 上限文字，颜色是 `ink-soft`（不是 `ink`），且不参与任何强调。任何一帧里边缘锚比正文更醒目 = 出错了。

---

## 5 · 手绘标注法（唯一允许的「装饰」）

原则：**手绘必须指向真实信息**。它不是图案，是「伸手指过去」的替代物。

### 5.1 结构

```html
<div class="mat">                                  <!-- 材料整体：物理对象 -->
  <div class="mat-paper"></div>                    <!-- 错位垫纸（纸做的阴影） -->
  <div class="mat-stage">                          <!-- overflow: hidden，裁切窗口 -->
    <div class="mat-inner">                        <!-- 放大 + 位移，决定看到哪一块 -->
      <img src=".media/assets/….png">              <!-- 真实 2× 截屏 -->
      <svg class="mat-anno" viewBox="…">           <!-- 手绘覆盖层，与 img 同父 -->
        <path d="…"/>
      </svg>
    </div>
  </div>
  <div class="mat-frame"></div>                    <!-- 3px 墨色边框 -->
</div>
```

**关键**：`<svg>` 与 `<img>` 必须是**同一父节点**（`.mat-inner`）的兄弟，而不是盖在裁切窗口 `.mat-stage` 上——否则坐标会随裁切漂移。

### 5.2 viewBox = 该图自身的像素空间

`MATERIAL_MOTION_RECIPE.md` 与契约的原话是「`viewBox` 用图片自身像素空间（`0 0 3788 1960`），这样坐标按图内像素写、自动缩放」。
实测有四种写法，**同一条规则**，只是「图」不同：

| 情形 | viewBox | 帧 |
|---|---|---|
| 满幅 2× 截屏（3788×1960） | `0 0 3788 1960` | `01/03/04/05/06/09/10`（7 帧，标准写法） |
| 需要放大某区域 | 同一像素空间的**窗口** + `preserveAspectRatio="xMinYMin meet"` | `07` → `300 250 3280 1640`；`08` → `240 458 3080 1000` |
| 用的是**裁切派生**资产 | 该裁切文件自己的尺寸 | `11` → `0 0 1380 770`（`ui-tasks-a11.png`）；`12` → `0 0 1265 890`（`ui-patch-a12.png`） |
| 非材料的示意线（非本规则） | 画布坐标 | `02` → `0 0 1920 1080` |

### 5.3 路径样式

| 场景 | 样式 | 出现处 |
|---|---|---|
| **默认红笔**（画在纸/浅色材料上） | `fill:none; stroke:#e23a2e; stroke-width:6; stroke-linecap:round; stroke-linejoin:round` | `01/02/03/04/05/06/07/08/09/10/11` |
| **粉白笔**（画在暗底墨块内） | `stroke:#f1ede4; stroke-width:6` + 同上 | `12`（源注释：*a chalk-white pen reads on the dark code ground*） |
| 小记号 / 引导连线 | 同色，`stroke-width: 2.6–3` | `04`（`3`，连接线）、`05`/`06`（`3`）、`12`（`2.6`，`viewBox="0 0 24 24"` 的警示小竖线） |

### 5.4 dash 逐笔画出（`getTotalLength()` 律）

```js
function dash(id) {
  var p = document.getElementById(id);
  var len = p.getTotalLength();
  p.style.strokeDasharray = len + " " + len * 1.05;
  p.style.strokeDashoffset = len;
  return len;
}
// 然后 fromTo: strokeDashoffset len → 0, 0.92s, power2.out
```

- 长度必须**实测**（`getTotalLength()`），不许写死。
- 顺序：先 `tl.set(path, { visibility: "visible" }, at)`，再 `fromTo` 推 offset（`12` 实测 `0.92s power2.out`；小记号 `0.26s`）。
- **禁止** `pathLength` 属性；**禁止**在 dashed path 上用 `non-scaling-stroke`（dash 几何会失真）。
- 落笔涟漪（可选，只有一帧用）：`78×78` 圆，`border: 5px solid #ffd400`，`scale 0.25 → 2.2` + `opacity 0.9 → 0`，`0.5s power3.out`，定在**笔画终点**。

### 5.5 材料作为物理对象

真实截屏是「放在桌上的一张纸」，不是一张图。四个动作合起来才有这个感觉：

| 动作 | 实测 |
|---|---|
| 错位垫纸 | `inset: -16px -16px -22px -16px`（各帧 -13/-17 不等），`background: #ded6c4`，`rotate(0.6deg)` |
| 从画外甩入 | `x: 330, rotation: -4.2, opacity: 0` → 归位，`0.6s power4.out` |
| 落桌回弹 | 落定后 `y: 5`（0.1s）→ `y: 0`（0.16s power2.out），只此一下 |
| 视差 | 材料层相对帧根多走一点（`12`：材料 `y 12 → -14`，帧根 dolly `scale 1 → 1.05`） |

**绝不用 `box-shadow` 做阴影**——阴影是另一张纸。

---

## 6 · Do / Don't

| Do | Don't |
|---|---|
| 900 字重的大字主张，一屏一个 | 一帧塞两个同等重量的焦点 |
| 大留白（`margin 96`）+ 细线分隔 | 用边框/色块把版面填满 |
| 等宽元信息（包名、命令、字段名、编号） | 把字段名排成正文宋/黑体 |
| 真实字段名、真实截屏（`.media/assets/*.png`） | 现画一个「像 UI」的假界面 |
| 手绘标注指向真实元素 | 手绘当花纹用、指向空白 |
| `accent` 蓝只落焦点 | 蓝当装饰色铺面 |
| 红 ≤2 处、黄 ≤2 处，出现即信号 | 红黄同帧满地跑 |
| 直角、零阴影 | 渐变 / 投影 / 圆角 / 玻璃拟态 / emoji / 纯白帧底 |
| 纸做的阴影（错位垫纸） | `box-shadow`、`filter: drop-shadow` |
| 术语首次出现配一句人话解释，字号 ≥ 正文 `0.8×` | 用未解释术语（「事实必须有出处」是硬约束） |
| 实验性能力**明说**是实验性 | 把实验性能力说成稳定能力 |

---

## 7 · 中文排版注意

| 项 | 规定 | 实测依据 |
|---|---|---|
| 正文行高 | `1.5` | `frame.md` body |
| 大字行高 | `1.1` | `12` `.hdr` 之下的 `h2` |
| 卡片/条目行高 | `1.26 – 1.4` | `12` `.limit` 1.26、`.cmdn` 1.4 |
| 大字字距 | `-0.02em`（紧）；闭合主张 `-0.01em` | `frame.md` display；`12` `.close` |
| 等宽字距 | `+0.12em` + `text-transform: uppercase` | 边缘锚、表头、字段名 |
| 数字与字段名 | **一律 mono + `font-variant-numeric: tabular-nums`** | `04` `td.name`、`06` 表格 |
| 术语解释 | 首次出现配人话，字号 ≥ 正文 `0.8×` | `frame.md` Composition Rules 2 |
| 混排 | 中英/中数混排靠**行内块 + 间隙**分开，不靠 `letter-spacing` 拉横幅（CJK 字距一变就松散） | `12` `.key` 用 `display: inline-block` + 独立色块 |
| 小字下限 | 本片最小等宽字号 `16.5px`（命令正文）；表头 `20px`；元信息 `22px`。低于 `16.5px` 未出现，不要下探 | `12` `.cmds`、`04` `th`、边缘锚 |
| 中文行宽 | 单行不换行的大字用 `white-space: nowrap` 并**核对右边界**（`12` `h2` 72px 单行） | `12` `h2` |

---

## 8 · 与 registry 的分工

**先搜索，再动手**：`hyperframes-registry` 的搜索覆盖全部托管内容，判据是「有没有已存在的同名外观/手势」。本片实际装进 `compositions/components/` 的 6 个：

| 需求 | 用 | 别 |
|---|---|---|
| 纸纹颗粒 / 印刷网点 | `grain-overlay`（默认 `opacity 0.15`；本片用 `0.13`，放在 `data-track-index="2"` 的 grain 层，`pointer-events: none`，`z-index: 100`） | 手搓 CSS 噪点 / 每帧重写一份噪点 SVG |
| 关键词高亮 + 引导线 + 等宽批注（一个节拍） | `vox-annotate`（`style: highlight \| circle \| underline \| scribble`；marker→connector→label 是一次完整手势，不是三个事件） | 自己发明一套手势 |
| 手绘圈注 | `hw-callout-circle`（抖动椭圆轮廓 + 圈内元素） | 用 CSS `border-radius` 假装手绘圈 |
| 手绘箭头 | `hw-arrow` | 用 SVG 默认箭头 marker |
| 手绘下划线 | `hw-underline` | `text-decoration: underline` |
| 手绘框 + 标签 | `hw-box-label` | 加一个圆角描边框 |

两点实测纪律：

1. **`vox-annotate` 的 dash 律与 §5.4 同源**（源码注明继承自 marker-highlight：`getTotalLength` 量长度、显式 `fromTo` 推 `strokeDashoffset`，禁用 `pathLength`、禁用 `non-scaling-stroke`）。手写标注时照同一条律。
2. **装下来的组件是「解剖参考」，不是挂载件**：`compositions/components/*.html` 每个都是独立整页；本片（12 帧，本项目实例）**没有任何 `data-composition-src` 指向它们**——手势是按帧内联复刻的，坐标与 dash 自己写。
   这是**架构解耦的有意设计**：手绘标注的坐标与 viewBox 强绑定于该帧特定的材料图，直接内联到帧内使 DOM 层级扁平、无额外 iframe 上下文切换，且全片动效受单一 GSAP 时间轴直接确定性驱动。

---

## 9 · 与其它 references 的边界

| 本文负责 | 不负责（去别处） |
|---|---|
| 颜色/字体/间距令牌、焦点判据、边缘锚、手绘标注法、Do/Don't、中文排版、registry 分工 | 帧的 HTML 骨架与 `.clip` 时长四处相等 → `_contract.md` §3 + `pitfalls` |
| 视觉决策的事实值 | 怎么跑 lint/check/snapshot、怎么出片 → `pipeline-stages.md`、`verification.md` |
| 手绘的坐标与样式 | 动效节拍与时间轴编排 → `motion-doctrine` / `hyperframes-animation` |
