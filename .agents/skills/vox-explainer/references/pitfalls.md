# 已知坑清单 —— 每条都带现象、根因、修法、自证

> 全部来自 `projects/dsh-agent-teams-vox` 与 `projects/freetoken-v013-vox` 的实测。**接手前必读**：这些坑的共同特征是**静默失败**——
> 命令报 ok、渲染出成片、看起来没坏，但内容错了或根本没出现。
> 前 8 条里能静态扫出来的已由 `scripts/audit-frames.mjs` 覆盖（下表标 ✅ 的即已自动化）。
> **§16–§19 来自第二个数据点**（`freetoken-v013-vox`，12 帧 / 267.4s / IndexTTS 克隆音），它们**没有一条能被现有门禁自动抓出**，
> 只能靠"生成器兜底 + 人眼快照"覆盖。§16 与 §11 是**同一症状的两个不同成因**，判错方向会白改一通。

| #   | 坑                                                         | 已自动化                           |
| --- | ---------------------------------------------------------- | ---------------------------------- |
| 1   | `check` 浏览器阶段静默空跑还报 ok                          | ✅（`hf.mjs check` 包装）          |
| 2   | Studio 预览会重写帧文件                                    | ⚠️ 流程纪律                        |
| 3   | 相机推轨选择器写错会静默失效                               | ✅                                 |
| 4   | `.js-hide` 无配对揭示 → 内容整块消失                       | ✅ 检测 / 脚本修                   |
| 5   | 隐藏与揭示的属性配错 → 场景泄漏 / 内容不出现               | ✅                                 |
| 6   | 字体策略不统一 → 混字体 + 体积翻倍                         | ✅                                 |
| 7   | 时长有四处，只改一处 → 中途空屏                            | ✅                                 |
| 8   | 可见标记里出现 `/*` → lint error                           | ✅                                 |
| 9   | 受限沙箱下子进程工具 EPERM                                 | ⚠️ 环境                            |
| 10  | **动效全部前置 → 画面与旁白脱节，剩下几十秒静止**          | ✅（`motion_frontload`）           |
| 11  | `content_overlap` 是字体度量盒的**假阳性**（紧排中文大字） | ⚠️ 靠版心调整 / 显式声明           |
| 12  | 解析器静默少一条（`\Z` 不是 JS 锚点）                      | ⚠️ 靠条数断言                      |
| 13  | 复合选择器「类名存在、组合不命中」→ 那组动效静默不发生     | ✅（`selector_miss_within_scope`） |
| 14  | 长片渲染的磁盘闸门（默认要求 ~172 GB 临时帧）              | ⚠️ 环境 / 必设环境变量             |
| 15  | 渲染期 CDN 告警 → 必须从成片抽帧自证动效真的执行了         | ⚠️ 流程                            |
| 16  | 帧内元素漏写 `position: absolute` → 集体落回普通流         | ❌ 靠 `autoPosition()` 兜底 + 人眼 |
| 17  | 帧脚本抛错 → 全帧 `.js-hide` 集体消失（整帧近乎空白）      | ❌ 只能靠 `runtime.errors` + 人眼  |
| 18  | 对比度审计在淡入中途采样 → 深底文字被判低对比              | ❌ 靠 `show()`（只位移不透明）     |
| 19  | `check` 只采固定若干秒点；采样点之外的布局问题抓不到       | ❌ 靠"每帧至少一张快照" + 联系表   |

---

## §1 `check` 的浏览器阶段会静默失败（两种，退出码分不出来）

`check` 是本管线**唯一会假装通过**的门禁。两种失败模式：

### 1a · 静默空跑却报 ok

- **现象**：`check` 返回 ok，但 `duration=0`、`samples=[]`、`contrast.checked=0` —— 它其实什么都没测。
- **根因**：运行时阶段取不到 GPU 时就跳过，而不报错。
- **修法**：**一律带 `--no-browser-gpu`**（走软件渲染 SwiftShader）。

### 1b · 被环境打断，却长得像代码有 bug

- **现象**：`check_runtime_failure: spawn EPERM`，exit 1，看起来像片子坏了。
- **根因**：受限沙箱**禁止命名管道**，而 CLI 内部 spawn 无头浏览器需要管道 → 浏览器起不来。
  **这是环境边界，不是片子的 bug。** 实测 `--no-browser-gpu` **并不能**绕过它（Chrome 仍要用管道）。
- **修法**：换到允许子进程管道的环境（或在 IDE / CI 里）重跑。
- **本会话实测**：即便在参考项目上，本沙箱内 `check` 也只能得到 `spawn EPERM`；
  仓库里那些 `check-final*.json` 全绿记录是**更早、未受限**的环境里产出的。

### 唯一可信的通过条件（四者同时成立）

| 信号               | 期望           | 为 0 意味着        |
| ------------------ | -------------- | ------------------ |
| 退出码             | 0              | —                  |
| `samples.Count`    | **> 0**        | 运行时阶段根本没跑 |
| `contrast.checked` | **> 0**        | 对比度审计根本没跑 |
| `duration`         | **≈ `index.html` 根总长**（差值 ≤ 0.1s） | 它读到的是一张空页或错误时间轴 |

**本技能的 `scripts/hf.mjs`** 提供了程序化自验证通道：

1. 对 `check` 固定注入 `--no-browser-gpu`；
2. 支持 `--out <file>` 参数：内部使用 `fs.openSync` 传递文件描述符给子进程，避开 Node 管道与 PowerShell 编码重定向，并在子进程完成后自动解析 JSON，严格校验 `errors === 0`、`samples.length > 0`、`contrast.checked > 0`，以及 `duration` 与 `index.html` 根 `data-duration` 的差值不超过 0.1 秒。校验通过返回退出码 0，校验失败返回退出码 1；
3. **严格防假冒通过**：若未传 `--out <file>`，脚本无法执行程序化自核对，将按契约返回**退出码 3**，禁止在自动化流水线中假装通过！

```powershell
node tools/vox/hf.mjs check --json --out .hyperframes/check-latest.json
# 退出码 0 = 通过自核对；退出码 3 = 未传 --out 未自检；退出码 1 = 门禁失败
```

## §2 Studio 预览会重写帧文件

- **现象**：编辑帧期间开着 `preview`，快照拍到"混合态"（一半旧一半新），甚至刚改的内容被覆盖回去。
- **根因**：Studio 打开帧时会给每个元素盖上 `data-hf-id` 并回写文件。
- **修法**：**编辑帧期间不要开 preview**。要审片时再开，审完立刻停：

```powershell
npx hyperframes preview --background   # 审片
npx hyperframes preview --status
npx hyperframes preview --stop
```

- **自证**：改帧前后比对文件 mtime；有写入就重拍快照。**一帧只允许一个作者**，这是同一个根因的另一面。
- **附带**：Studio 也会回写 **`index.html`**（给 wrapper 盖 `data-hf-id`）。所以脚本解析 `id` 必须用带词界的 `(?:^|\s)id="…"` —— 裸 `\bid="…"` 会抢到 `data-hf-id` / `data-composition-id` 里的 `id`，把 wrapper 认成别的元素（issues/14 实测：`#f01` 被解析成 `#hf-ww17`，`sync --check` 误报 `wrapper-stale`）。

## §3 相机推轨的正确选择器（写错会静默失效）

- **现象**：推轨（dolly）完全没生效，画面静止；但 GSAP 不报错。
- **根因**：所有合成根的元素 id 都叫 `root`。写成 `#root[data-composition-id="frame-0X-…"]` 时，
  编译器改写后**匹配不到任何元素**；GSAP 接受空目标集合并静默返回。
- **修法**：用**带帧 id 的限定选择器** —— `[data-composition-id="frame-0X-slug"]`（不加 `#root` 前缀）。
- **自证**：量像素，不靠肉眼。本项目 `tools/_title_left.mjs` 量标题左边缘，**帧首与帧尾应差 40–50px**。
  这类"动效到底有没有发生"的验证要固化成一次性脚本，别每次靠看。

```js
// 对
tl.fromTo('[data-composition-id="frame-04-roster"]', { scale: 1, x: 0, y: 0 },
          { scale: 1.05, x: -16, y: -10, duration: slot - 0.6, ease: "none" }, 0.2);
// 错（静默失效）
tl.fromTo('#root[data-composition-id="frame-04-roster"]', { … }, { … });
```

> 裸 `#root` 更危险：它会命中 `index.html` 的主根，把**整片**一起缩放。

## §4 `.js-hide` 没有配对揭示 → 内容整块消失

- **现象**：整张卡、整张表、整组注释在成片里**根本不出现**；快照上看是空的。
- **根因**：`.js-hide`（`#root .js-hide { opacity: 0 }`）**不是框架惯用法**，是帧作者自造的开场隐藏约定。
  作者给**部分**元素写了揭示写入，忘了的那些就永远不出现——而且不报任何错。
- **修法**：不要手工逐个补 tween。每帧加一个 build 期 pass：遍历时间轴自己的 tween 目标，
  取每个 `.js-hide` 元素的**最早 tween 起点**，在该点注册零时长揭示（`visibility: "visible"`，
  与 CSS 的 `visibility: hidden` 配对）；从未被任何 tween 触及的元素在 0 处揭示
  （宁可早出现，也不能静默丢弃作者写的内容）。这个块带 marker，重跑幂等。
- **代价**：手工揭示（`tl.set(el, {visibility:"visible"}, t)`）也是**合法**的 ——
  作者自己揭示时，reveal pass 因为"已有 tween"而跳过它。两条路都对，**但必须成对**
  （CSS 用 `visibility: hidden` → 揭示就要设 `visibility:"visible"`；只设 `opacity` 会永远不可见）。
- **自证（这里刻意不自动化）**：`audit-frames.mjs` 只报事实（`js_hide_reveal_ownership`），
  **不做判定**。原因：作者常用变量间接引用、条件分支、循环批量揭示，静态正则跟不住 ——
  实测对真实项目误报 38 处，而**一个误报会让人开始忽略整个检查器**。
  真正的判定交给两条可靠手段：`check` 的布局审计 + **亲眼看快照**（`verification.md` §7）。

### §4b 装了注册表条目但没接线（同一类"内容不在场"）

- **现象**：`hyperframes add` 装了 6 个区块/组件，帧里一个都没接 —— 手绘与颗粒全是帧内内联复刻。
  不报任何错，因为**没接线的条目只是不存在**。
- **根因**：把"装进 `compositions/components/`"当成了"用上了"。这不是技术阻拦（见
  `material-sourcing.md` §七 的三点澄清）。
- **修法**：按**文件形状**判角色（剥掉 HTML 注释后是否含 `data-composition-id`）：
  含 → 用 `data-composition-src` 挂载；不含 → 粘贴其 HTML/CSS/JS。
  **不要**用目录名或 `registry-item.json` 的 `type` 判断（实测 6 个 JSON 全标 `snippet`，却有 5 个是子合成）。
- **自证**：对每个已安装条目，能举证 (a) 存在指向它的 `data-composition-src`，或 (b) 其 markup 已粘贴进某帧，
  或 (c) 显式声明这是有意的参考复刻。**lint 抓不到这一条**，只能靠代码检索 + 人眼。

## §5 隐藏要真的把元素移出 paint —— 用 `visibility` 隐藏，`opacity` 只做动画

- **现象**：非活动场景泄漏进布局审计，整片被判**几十处重叠**（本项目实测 80 处）；冷渲染能看到不该出现的文字。
- **根因**：定位型场景宿主隐藏时用的是 `visibility: hidden`（不会 `display: none`）。
  帧内任何设了 `visibility: visible` 的元素会**逃出**那个继承的隐藏态。
- **正确模型（**这一条曾写错，现按 12 帧实测更正**）**：帧级开场隐藏一律
  `#root .js-hide { visibility: hidden }`，揭示由 reveal pass 写 `{ visibility: "visible" }`；
  位移/淡入的 `opacity` tween 只负责动画。
  **不要**改成 `opacity: 0` 隐藏 —— `opacity: 0` 的元素在冷渲染与布局审计里**仍然占位可见**，
  那正是泄漏本身。本项目有 `.js-hide` 的 5 帧（04/05/06/11/12）全部用 `visibility`。
- **配套（必须有）**：两者叠加使用，缺一不可 ——
  1. 帧级隐藏：`#root .js-hide { visibility: hidden }`（配 reveal pass，见 §4）
  2. 宿主级守卫（每帧 `<style>` 顶部原样保留）：

```css
/* hf-scene-visibility-leak-guard */
[data-composition-id="frame-NN-slug"][style*="visibility: hidden"] *,
[data-composition-id="frame-NN-slug"][style*="visibility: hidden"] {
  visibility: hidden !important;
}
```

- **注意**：守卫块与 §4 的 reveal pass 是**一对**，且守卫的失效前提是帧内确实用了 `visibility` 隐藏——
  **改帧时两块原样保留，别删、也别把隐藏换成 `opacity`**（换了守卫就变成空操作，泄漏悄悄回来）。
- **自证**：`audit-frames.mjs` 报 `js_hide_reveal_property_mismatch` / `missing_leak_guard`；
  `check` 的 layout 项应无 `content_overlap`。

## §6 字体策略必须统一

- **现象**：同一片里出现两种字形；每帧多出约 150 KB 重复 base64。
- **根因**：并发作者各自选路——有人 base64 内嵌子集，有人写文件引用。
- **修法**：全项目**只有一套** `@font-face`，指向 `assets/fonts/` 里的真实文件（本项目 5 条：
  Noto Sans SC VF / JetBrains Mono 400 / 700 / Caveat 700 / Microsoft YaHei 用 `local()` 兜底）。
  由 `normalize-frame-fonts` 统一，幂等。
- **注意**：lint 要求**任何在字体栈里出现的族名都必须有 `@font-face` 声明**——
  OS 自带字体用 `src: local("…")` 满足它，不必真带字体文件。
- **自证**：`audit-frames.mjs` 报 `font_face_drift`（出现 `base64` 或族名不在规范集内）。

## §7 时长有四处，只改一处 = 中途空屏（含伴生侧车漂移）

- **现象**：某幕在旧时长那一刻内容整块消失，以近乎空屏收尾；或者 `audit-frames` 报 `motion_sidecar_duration_drift`。
- **根因**：帧根 + 三条 `.clip` 层（paper / content / grain）各带自己的时间窗，且伴生动效侧车 `${stem}.motion.json` 记录了 `duration_s`。
  旁白重建把槽位拉长后，若帧内层或侧车还停在旧值，将导致运行时内容层关掉或侧车审计报错。
- **修法**：改完统一跑 `sync-frame-durations.mjs`（会自动同时更新 HTML 各层 `data-duration` 与 `.motion.json` 的 `duration_s`；`--check` 只报告不改）。
- **注意：层数是每帧自己的事。** 实测 12 帧里 2 处、3 处、4 处都有（有 grain 层的帧才 4 处）。
  **不变量只有一个：帧内所有 `data-duration` 与伴生侧车 `duration_s` 都等于槽位。** 脚本按这个查与同步，不按层数。
- **自证**：`--check` 应报全帧 ok，且核对帧数等于项目帧数
  （输出形如 `N/N frames ok`，N 是项目自己的帧数，不是固定的 12）。

## §8 可见标记里出现 `/*` 会触发 `visible_markup_comment` error

- **现象**：lint 报 error，位置指向你写进**可见文本**的 `/*`。
- **根因**：这是范围里 `packages/cli/**` 这类文本的常见形态，lint 把可见的注释标记当错误。
- **修法**：用 **CSS 生成内容**表达，不要用 HTML 实体：

```css
.globstars::after { content: "**"; }   /* 对 */
&#42;                                   /* 错：Studio 重新序列化会把实体解码回去 */
```

- **自证**：`audit-frames.mjs` 报 `visible_markup_comment`；修完 lint 必须 0 error。

## §9 受限沙箱下会 spawn 子进程的工具 EPERM

- **现象**：`oxfmt` / `bunx` 一类工具报 EPERM 失败。
- **根因**：受限文件沙箱禁止命名管道，捕获子进程 piped stdio 会失败
  （Node 的 `child_process.spawn`/`exec` 默认 `stdio: 'pipe'`）。
- **修法**：本技能的脚本一律**直接 `node` 跑**（`.mjs`），不经包管理器包装器；
  需要 spawn 时用 `stdio: 'inherit'` 或 `'ignore'`，**不要捕获输出**。
- **连带影响（本会话实测）**：同一根因也让 `hf.mjs check` 起不了无头浏览器（见 §1b），
  并让任何"从 Node 里读子进程 stdout"的写法直接 EPERM —— 所以本项目所有验证脚本
  **都不捕获子进程输出**，需要机器可读结果时写成文件或走 `--json` 自行重定向。
- **注意**：这不是命令写错，是策略边界 —— 不要换个写法反复重试，按上面重构命令。

---

## §10 动效全部前置 → 画面与旁白脱节（**本条最贵**）

- **现象**：每帧开场 5–7 秒内所有元素到齐，之后几十秒画面完全静止。成片观感是"翻幻灯片"，不是"跟着讲解在长"。观众体感一句话就能说清：**开场闪一下，然后挂一张图。**
- **根因**：帧时长由旁白决定（实测单帧 22–72 秒），但作者的动效习惯是"入场动画 = 开场那几秒"。两者从未对齐，而且**三道门禁全都发现不了**：
  - `lint` 只管 tween 之间冲不冲突；
  - `check` 只管某一时刻的布局与对比度；
  - `audit` 当时只管静态结构。
    **没有任何一道在看"动效在时间轴上是怎么分布的"**。
- **修法**：把每个元素的出画时刻对到旁白的**句子节拍**上。四步：

  ```powershell
  # 1 · 量真实停顿（silencedetect -35dB/0.16s），把 SCRIPT.md 的句子边界对到停顿上
  node tools/vox/beat-timeline.mjs --project .          # -> .media/beat-map.json
  # 2 · 写 tools/beat-spec.json：每帧列出「这一帧里哪句话触发哪个元素」
  # 3 · 把「某句话」换算成帧内秒点（beat 区间内按字符数线性插值）
  node tools/vox/beat-at.mjs tools/beat-spec.json --project .
  # 4 · 帧内出画时刻 = 0.3（旁白入点）+ 句内时刻 − 0.35（提前量，让元素在说到之前一点点到位）
  ```

  `beat-timeline` 的输出会标明每条用的是 `silence-anchored` 还是 `proportional` —— 前者是量出来的真值，后者是停顿不够时的兜底。

  > **更精确的一条路（第二个数据点实测）**：不走"停顿 + 比例插值"，而是**直接量到词**——
  > 用 faster-whisper 的词级时间戳把锁定稿逐字对齐到音频，产出"线索表"（元素 → 锚短语 → 秒）。
  > 12 帧 / **97 条线索全部命中**，不需要任何插值假设。做法与脚本见 [`voice-sync.md`](./voice-sync.md)。
  > 两条路可并用：`beat-*` 做"这句话在第几秒"的粗定位，词级对齐做"这个词在第几秒"的精定位。

- **判据**：最晚的 tween 起点 ≥ 槽位的 **60%**；`< 40%` 由 `audit-frames` 报 `motion_frontload` error。要显式声明"这一帧就是一次到位"的，给根节点加 `data-hf-motion-frontload="ok"`。
- **自证**：从成片本体抽同一帧的 3–4 个时间切片，确认是"逐段长出"。`verification.md` §9。
- **顺带要改的两个习惯**：
  1. `STORYBOARD.md` 的 `poster` 不再是"入场动画结束后 +1s"，而是**画面最满的那一瞬**（最后一个节拍之后）。
  2. 长段落必须有东西可画。实测第 07 帧有 22 秒纯概念讲解（"为什么输出 token 免费"），原设计在这 22 秒里没有任何元素出场 —— 补了一组"聊天模型 vs Jev"的两行对照条才填住。
- ⚠️ **本规则的 0.40 阈值会让参考项目 `dsh-agent-teams-vox` 也报警**（它的入场同样挤在每帧前 25–50%）。这说明这条缺陷当时没被发现，**不是它的例外**。新项目按本条做。

---

## §11 `content_overlap` 是字体度量盒的**假阳性**

- **现象**：`check` 报十几处 `content_overlap`，人眼却看不到任何文字碰撞。
- **根因**：布局审计用**字体度量盒**（含 ascent/descent 的溢出部分）判交叠。中文大标题在 `line-height < 1.2` 时，相邻行的度量盒必然相交，而 CJK 字形实际只占 em 盒的中段 —— 于是"度量盒相交"≠"字形碰撞"。
- **两种解法，按是否真的有意紧排来选**：
  - **a. 版心下移**（默认选它）：把标题与上一元素（通常是 kicker）的间距拉到度量盒不相交。实测**下移 16–26px 就够**，视觉上几乎无感。
  - **b. 显式声明**：确实需要有意紧排的（例如钩子帧的逐行大字，`line-height: 1.0`），给元素加 `data-layout-allow-overlap`。这是框架**提供**的机制（`fixHint` 里就写着），不是绕过 —— 但**声明前必须人眼确认无碰撞**。
- **⚠️ 同症状的第二个成因**：`content_overlap` 也可能是**真的叠在一起**——帧内元素漏写 `position`、集体落回普通流（见 **§16**）。
  分辨法：前者人眼看不到碰撞、调版心 16–26px 就消失；后者人眼能看出**顺序不对 / 元素挤在帧顶**，调版心**不会**修好。
  **先看快照判断是哪一个，再动手。**
- **判据**：`check` 的 `layout.errorCount` 与 `layout.warningCount` 同时为 0。
- **注意**：`severity` 会随交叠**持续时间**在 warning / error 之间变化（`heldMs` 越长越是 error）。所以 `--at` 单点采样看到的级别，与全片采样可能不同 —— 别用单点结果下结论。

---

## §12 解析器静默少一条（`\Z` 不是 JS 锚点）

- **现象**：TTS 合成出 14 条旁白，下游解析只拿到 **13** 条，最后一行被无声丢掉，后续槽位表跟着错。
- **根因**：`SCRIPT.md` 的解析正则写成 `(?=\n---\n|\Z)`。Python 的 `re` 认 `\Z`（串尾），**JavaScript 不认** —— JS 里 `\Z` 是"字面量 Z"。于是最后一块（后面没有 `---`）永远匹配不上。
- **修法**：JS 里不要用 `\Z`；**按 `\n---\n` 切块再逐块解析**最稳，也最容易读。
- **自证**：解析产物必须**断言条数**并打印出来（形如 `parsed 14 narration lines`），与源文档里 `## Line` 的条数对账。
- **通用教训**：任何"从文档里抽 N 条"的解析器，都要把 N 打出来。只打印"成功"而不报条数 = 静默失败。

---

## §13 复合选择器「类名存在、组合不命中」

- **现象**：某一组动效**完全没发生**。控制台只有一条 `GSAP target not found` 警告，`check` 照样通过。
- **根因**：作者写 `#frame-05-mech-primitives-c1 .orow`，而 `.orow` 只存在于 **c2** 卡里。类名 `.orow` 在文件里**确实存在**，所以"类名是否存在"这种粗查一路放行；GSAP 拿到空目标集合后**不报错、不抛异常**，只是那组动画永远不发生。与 §3 同一家族，只是从"漏了限定前缀"变成"指错了父节点"。
- **修法**：`audit-frames` 的 `selector_miss_within_scope` —— 把 `#id` 那个元素的**整棵子树**扫出来（标签深度扫描），要求后代部分真的出现在这棵子树里。
- **自证**：`audit` findings 0；运行期不该出现 `GSAP target` 警告。
- **定位技巧**：若只拿到一条**无归属**的 console 警告，用"按帧子集二分"定位 —— 把 `index.html` 的槽位逐段注释掉再跑 `check`。见 `verification.md` §6。

---

## §14 长片渲染的磁盘闸门（必设一个环境变量）

- **现象**：
  ```
  Disk capture may need ~171893.1 MB of temporary frame storage,
  but only 66390.1 MB is free at …\captured-frames
  ```
  渲染直接失败。690.8s × 30fps = **20724 帧**，PNG 帧缓存要 **172 GB** —— 本机 66 GB 空闲也差得远，**清磁盘解决不了**。
- **根因**：默认走"磁盘帧缓存"路线。`streaming-encode` 闸门本来能避免（帧直接流进 ffmpeg、不落盘），但它默认上限 `maxDurationSeconds: 240`，长片被挡在门外。
- **修法**：

  ```powershell
  $env:PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS = "1200"   # 覆盖默认 240
  node packages/cli/dist/cli.js render .
  ```

- **判据**：渲染日志出现 `streaming-encode gate {… "enabled":true, "maxDurationSeconds":1200}`。若仍是 `"enabled":false`，就是没生效。
- **通用**：**>4 分钟就必设**。

---

## §15 渲染期 CDN 告警 → 必须从成片抽帧自证

- **现象**：render 日志出现
  ```
  [WARN] [Compiler] WARNING: Failed to download CDN script:
  https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js — fetch failed
  ```
- **风险**：如果 GSAP 真的没加载，成片会是**每帧的初始静止态**（元素全在 `opacity:0` 或未入场），而渲染**照样报成功**、体积甚至更小。这是典型的"假通过"。
- **修法**：不必立刻重渲。**从成片本体抽帧自证**：取同一帧的早 / 中 / 晚三个切点，看画面是否在变。

  ```powershell
  ffmpeg -v error -ss <t> -i renders/<成片>.mp4 -frames:v 1 -y slice-<t>.png
  ```

- **已落地**：GSAP 3.14.2 随技能资产复制到项目 `assets/vendor/gsap.min.js`，主时间轴模板与 `gen-index.mjs` 只加载这个本地路径；不再在 render-time 取必需资产。
- **自证**：确认项目内存在 `assets/vendor/gsap.min.js`，且 `index.html` 没有 GSAP CDN 引用；切片比对通过（画面确实在长）；顺带 `ffmpeg -v error -i 成片 -f null -` 退出码 0（整片可完整解码）。

---

## §16 帧内元素漏写 `position: absolute` → 集体落回普通流，堆在帧顶

> 来源：`projects/freetoken-v013-vox`（2026-09-21）。12 帧里 **47 条**规则命中，`check` 一次报 **34 处 `content_overlap`**。

- **现象**：`check` 报几十处 `content_overlap`（"Two text blocks overlap and may render unreadable."），
  但把报出来的每一对拉到画布上看，它们明明在不同位置；快照上则是**元素顺序错乱、挤在帧顶**
  （例如"品牌大字"跑到"定义文字"下面、一条全宽分隔线跑到帧首）。
- **根因**：模板骨架只给了 `#root` 的 CSS 变量，**既没给 `#root` 加 `position: relative`，
  也没有 `html, body { margin: 0 }`**。作者写逐帧规则时习惯只写 `left/top`——
  静态定位元素上 `left/top` 被忽略，元素就按 DOM 顺序在普通流里堆叠。
  `lint` 抓不到，`audit-frames` 也抓不到（它不知道你"打算"放哪）。
- **修法**：两层一起改，缺一不可。
  1. **生成器层**：加 `autoPosition(css)` —— 凡声明块里含 `left/top/right/bottom/inset` 而不含 `position`
     的规则，一律补 `position: absolute`，并在构建时把命中的选择器打印出来（可审计、可核对）。
  2. **模板层**：`templates/frame-skeleton.html` 里补上
     `html, body { margin:0; width:1920px; height:1080px; overflow:hidden }`
     与 `#root { position: relative; width:1920px; height:1080px }`。
- **自证**：`check` 的 `content_overlap` 计数归零；快照上元素的上下顺序与设计一致。
- **注意**：这一条**只能靠人眼发现"顺序不对"**。只看门禁数字会以为"重排一下版心就能修"，
  实际是定位模型错了——先确认 `getComputedStyle(el).position`，再谈坐标。

---

## §17 帧脚本中途抛错 → **全帧 `.js-hide` 内容集体消失**（整帧近乎空白）

> 来源：同上。一次 `TypeError: p.getTotalLength is not a function` 让第 03 帧只剩纸底与边缘锚。

- **现象**：某一帧只剩下纸底（含网点/颗粒）、边缘锚，以及**少数没挂 `.js-hide` 的元素**
  （典型是材料块）；其余内容全部不出现。看起来像"作者忘了写这一帧"。
- **根因（两层，第二层才是关键）**：
  1. **直接原因**：`ink()` 这类手绘工具对**非 SVG path** 调用 `getTotalLength()`。
     本项目第 03 帧把分支卡 `<div>` 传给了 `ink()` → 运行期 `TypeError`。
  2. **放大机制**：**reveal pass 写在帧脚本的最末尾**。脚本一抛错，`tl.seek(0)` 与 reveal pass
     都执行不到，`window.__timelines[<id>] = tl` 也没注册；于是所有 `.js-hide` 永远停在
     CSS 的 `visibility: hidden`——症状是"内容集体消失"，而不是一个显眼的报错。
- **修法**：`ink()` 只接受 `path`。要框住一个 `<div>` 就画一条真的 SVG 路径
  （本项目为此加了 `inkRect()`，画手绘方框）。
- **自证**：`hf.mjs check` 的 `runtime.errors` 必须为 0；快照上这一帧的内容齐全。
- **推论（比这一条本身更值钱）**：**任何在 reveal pass 之前抛出的异常，症状都是"整帧内容消失"。**
  所以排查顺序永远固定：
  1. 先看 `check` 的 `runtime.errors`（是 0 就说明脚本没抛错，问题在别处）；
  2. 再看该帧快照；
  3. 最后才怀疑 reveal pass 的配对（§4/§5）。
     反过来做（先怀疑隐藏/揭示配对）会在错误的现场上改代码。

---

## §18 对比度审计会在**淡入中途**采样 → 深底文字被判低对比

> 来源：同上。`LAYER[.KIND] / NAME` 表头（浅字压深底）被量成 **1.52:1**。

- **现象**：`contrast_aa_failure`，比值出现 1.03 / 1.52 这类"像同色压同色"的数字，
  或只报某一行、某个表头，而该处实际清晰可读。
- **根因**：对比度阶段**在固定秒点采样**。若某个深底文字块用 `opacity 0 → 1` 淡入，
  而采样点正好落在淡入中途，审计量到的是"半透明文字压在浅底上"的混合色
  （1.03 那种就是"还没显影"）。
- **修法**：**深底上的文字不要用透明度入场。** 提供一个只做位移、不做透明度的入场函数：

  ```js
  function show(sel, t, dy) {
    // 深底文字专用：位移 + 零时长揭示
    tl.set(sel, { visibility: "visible" }, t);
    tl.fromTo(
      sel,
      { y: dy === undefined ? 20 : dy },
      { y: 0, duration: 0.45, ease: "power3.out" },
      t,
    );
  }
  ```

  浅底文字仍可用 `rise/fade`（那类采样点是安全的）。

- **自证**：`contrast.warningCount === 0`（且 `contrast.checked > 0`，见 `verification.md` §2）。
- **另一类真问题不要混进来**：文字压在"还没出现的深色底"上（1.03:1）是**真缺陷**，
  修法是挪位置或改字号，不是加 `data-layout-allow-overlap`。两类要分开判。

---

## §19 `check` 的采样是**固定若干个秒点** —— 采样点之外的布局问题它抓不到

> 来源：同上。267.4s 的片子，布局与对比度阶段只采了 **9 个秒点**；
> 一处"材料压住说明文字"的真重叠落在两个采样点之间，`check` 全绿而快照上一眼可见。

- **现象**：`check` 报 0 error，但快照上明显有文字被材料压住、元素越界顺序不对。
- **根因**：布局/对比度阶段只在固定秒点（本项目 9 个）采样。帧内绝大多数时刻没被扫过。
  帧越多、帧越长，覆盖率越低。
- **修法**：把 `check` 当**下限**而不是**上限**：
  - 人眼快照必须覆盖**每一帧至少一张**，且取该帧**内容最满**的时刻（不是帧首——帧首大半元素还没入场）。
  - 帧数很多时，用**联系表**（把 3–4 张快照拼成一张图）一次看多帧，成本低得多。
- **附带纪律：`snapshot` 的一批可能整体失败。** 本项目出现过一次"同一批 4 张全空、但逐帧头部与
  材料正常"（另一次重拍即全部正常）。**先怀疑批次，重拍一遍再改代码**——
  否则会在错误的现场上做修复动作，把好的帧改坏。

---

## §20 高光记号的多段 path 必须**共用一个 `<g>`**（issues/09）

> 来源：`../vox-collage/issues/09`（笔触物理性）。`hwOnUpdate` 的 x/y 归属按 `<g>` 走；
> 多段 path 若各自独立成 `<g>`，帧内位移会被当成三套独立位移 —— 多描的微错位反而变成整体漂移。

- **现象**：高光笔触看起来"在抖/在飘"，或 `hw-boil` 的姿势只作用到其中一两段。
- **根因**：两档笔法 `inkStroke` 产出多段 `<path>`（normal ×3 / highlight ~30），它们必须被**同一个**
  `<g data-ink="normal|highlight">` 包住。分成多个 `<g>` 后，`hwOnUpdate` 逐 `<g>` 算变换，归属错乱。
- **修法**：一律用 `inkMarkup(d, kind, opts)`（`tools/ink.mjs`）产出**一个** `<g data-ink=…>`；
  不要手写多段 path 再各自包 `<g>`。门禁 `highlight_per_screen` 按 `<g data-ink="highlight">` 计数（≤3/屏）。

## §21 手绘坐标必须**量测**，不许估（issues/15 重演）

> 来源：`../vox-collage/issues/15`。四帧重绘里 `cover-01` 的红圈与 `frame-14` 的第二圈都**估错了行**；
> 教训早写在 `material-sourcing.md` §四，但直到 `issues/09` 才配门禁。

- **现象**：圈注 / 箭头落在材料的目标元素**旁边**（差一行或半格），静态门禁全绿。
- **根因**：`viewBox` 与元素坐标是"目测"写的，不是量出来的。
- **修法**：坐标写**原图像素空间**，用量测工具（`tools/_measure.py grid|crop`）量出真实坐标；
  量测记录落 `*.measure.json`，门禁 `ink_coords_measured`（**info**，硬门禁判不了"量没量"）。

## §22 撕边必须**低频**，且**相对振幅随元素尺寸缩放**（issues/15 二轮 / 本轮）

> 来源：`../vox-collage/issues/15`。高频锯齿（左右各 8 段 × 3%）读起来是「撕碎的纸屑」；
> 同一个 1.4% 振幅在 880px 卡上合适、在 1730px 长条上就成「锯齿相框」。

- **现象**：纸边读成碎屑/锯齿，或宽元素边缘的撕口夸张得像相框。
- **根因**：撕边空间频率太高，或振幅是**绝对值**而非**相对尺寸**缩放。
- **修法**：用 `tools/torn.mjs` 的 `torn(w,{seed})` 产出 `clip-path` —— 每边 **3–4 个顶点**、
  切幅 **1–6%**、含 **1–2 处长裂口**；**按元素宽度分档**（`>1000px` 用浅档 `wide`）。
  元素带 `data-torn="soft|mat|wide"` + 内联 `clip-path: polygon(…%…)`，
  门禁 `torn_spatial_frequency` / `torn_amplitude_scales_with_size`（仅 v2 项目）。

---

## §23 账本里的 `cut` 必须是**数字**，不能是字符串（issues/14）

- **现象**：`seam-gate verify` 报 `page error … SyntaxError: missing ) after argument list`，但页面本身没坏、lint/audit 全绿。
- **根因**：旧 `gen-index.mjs` 把 `cut` 写成字符串（`"10.8"`）；gate 用 `cut + dt` 采样，字符串被拼成 `10.80.0333…`，注入页面的求值表达式直接语法错。
- **修法**：`gen-index` 出 `Number(…)`；`seam-gate` 侧也 `Number(seam.cut)` 兜底。**账本 `cut` 是数字**（schema 见 `motion-doctrine/references/seam-gate.md`）。

## §24 接缝载体是 `class="clip"` 的 wrapper —— 只动 `opacity`，**禁 `autoAlpha`/`visibility`/`display`**（issues/14）

- **现象**：`hf.mjs lint` 报 `gsap_animates_clip_element`（error），seam-stamp 生成的补间被判红。
- **根因**：接缝载体是 index 级 wrapper（`class="clip"`），而运行时**自己**管夹层可见性；GSAP 再写 `visibility`/`display`/`autoAlpha` 会与它打架（`autoAlpha` 顺带写 `visibility`）。
- **修法**：`seam-stamp` 一律用 **`opacity`**（gate 量的也是 opacity）；transform 类属性安全。已落进 `seam-stamp.mjs`。

## §25 `gen-index` 的帧序**必须取旁白清单顺序**，不能 `Object.keys(SLOTS)`（issues/11 落地期）

- **现象**：`ledger.json` 的 seams **顺序与 `cut` 值整体错位**（帧号 `01/07/12/14` 实测得到 `12→14 / 14→01 / 01→07`），`audit-frames` 报 `ledger_seam_row_missing`，`seam-gate verify` 按错的 `cut` 采样。
- **根因**：JS 对象把**规范整数串键**（`"12"`/`"14"`）排在前、把**带前导零的键**（`"01"`/`"07"`）按插入序排在后面 —— `Object.keys(SLOTS)` 在**帧号混合**（个位 + 十位并存）时给出错序。全 `"01".."09"` 看不出问题；`"01".."12"` 这类（freetoken 旧版、jev 四帧）必然踩。
- **修法**：帧序以**旁白清单**为准 —— `slots.mjs` 的 `VOICE`（= `.media/voice-manifest.json` 的 `lines` 顺序），`gen-index` 写 `VOICE.map((l) => l.frame)`。**别**用 `Object.keys(SLOTS)` / `Object.entries` 的键序当帧序。
- **自证**：`seam-gate verify` 全 PASS、`audit-frames` 无 `ledger_seam_row_missing`；`ledger.json` 的 seam `id` 与真实相邻帧号一致（`01→07 → 07→12 → 12→14`）。
- **说明**：同一坑对任何"按帧号做键"的生成器成立（`beat-at.mjs` / `draft-voice-timeline.mjs` 若按帧号聚合亦然）—— 需要帧序时，一律从清单数组取，不要从对象键取。

## §26 技能内 `examples/` 比普通项目多一层，`hf.mjs` 的 CLI 搜索要够深（缺口 3 留样）

- **现象**：在 `examples/collage-smoke/` 运行 `hf.mjs lint`，报「找不到 hyperframes CLI」；同一套门禁在 `.scratch` 项目里正常。
- **根因**：`examples/collage-smoke` 到仓库根比普通项目多一层路径；`findCli()` 原来只向上找 5 层，漏掉 `packages/cli/dist/cli.js`。
- **修法**：CLI 搜索保留项目内 `node_modules` 优先级，再把仓库路径探测扩到 6 层；不要把样例硬搬到根 `examples/` 绕过路径问题。
- **自证**：从 `.agents` 与 `.claude` 两份样例目录运行 `hf.mjs lint/check` 均能找到 CLI 并通过。

---

## 快速自检

```powershell
# 静态坑（§3/§3b/§4/§5/§6/§7/§8/§10 全覆盖）
node tools/vox/audit-frames.mjs --project . --json          # 期望 findings: 0
# 时长四处（§7）
node tools/vox/sync-frame-durations.mjs --project . --check # 期望 N/N frames ok
# 时间闭环（§1 的成因之一：槽位与真实旁白不符）
node tools/vox/verify-timeline.mjs --project . --json       # 期望 0 error
# 节拍（§10）
node tools/vox/beat-timeline.mjs --project .                # 看每条是 silence-anchored 还是 proportional
```

```powershell
# 定位模型（§16）、脚本健康（§17）、对比度（§18）：只能从 check 的细分计数读
node tools/vox/hf.mjs check --json --out .hyperframes/check-latest.json
#   → runtime.errors === 0        （§17 的唯一自动化信号）
#   → layout.errorCount === 0     （§16 与 §11 的主要信号，两者必须分开判）
#   → contrast.warningCount === 0 （§18）
```

`audit-frames.mjs` 覆盖 §3/§3b/§4/§5/§6/§7/§8/§10；**v2 项目另含 §20/§21（笔触，按产物存在性分档）**；§1 只能靠"核对三项计数"（见 §1）；
§2/§9/§13（定位）/§14 是流程与环境纪律，没有脚本能替你遵守 —— 尤其 §2（编辑帧期间别开 `preview`）
和"一帧一个作者"，违反它们的代价是混合态，脚本查不出来。

**§16–§19 没有一条能靠静态扫描抓出。** 覆盖它们的是两条固定的工程纪律：

1. **生成器兜底**：字体块 / 泄漏守卫 / reveal pass / 四层时长 / `position` 补齐 **各写一次**，
   逐帧只提供"属于它自己的东西"（CSS + markup + 时间轴）。手抄 N 份帧必然在某一份漏掉一条契约
   —— §15、§16 都是这么发生的。
2. **每帧至少一张快照 + 人眼**，取该帧**内容最满**的时刻（不是帧首）。
   出现"整帧空白"先重拍确认是批次问题，再去改代码（§19）。
