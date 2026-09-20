# 已知坑清单 —— 每条都带现象、根因、修法、自证

> 全部来自 `projects/dsh-agent-teams-vox` 的实测。**接手前必读**：这些坑的共同特征是**静默失败**——
> 命令报 ok、渲染出成片、看起来没坏，但内容错了或根本没出现。
> 前 8 条里能静态扫出来的已由 `scripts/audit-frames.mjs` 覆盖（下表标 ✅ 的即已自动化）。

| # | 坑 | 已自动化 |
|---|---|---|
| 1 | `check` 浏览器阶段静默空跑还报 ok | ✅（`hf.mjs check` 包装） |
| 2 | Studio 预览会重写帧文件 | ⚠️ 流程纪律 |
| 3 | 相机推轨选择器写错会静默失效 | ✅ |
| 4 | `.js-hide` 无配对揭示 → 内容整块消失 | ✅ 检测 / 脚本修 |
| 5 | 隐藏与揭示的属性配错 → 场景泄漏 / 内容不出现 | ✅ |
| 6 | 字体策略不统一 → 混字体 + 体积翻倍 | ✅ |
| 7 | 时长有四处，只改一处 → 中途空屏 | ✅ |
| 8 | 可见标记里出现 `/*` → lint error | ✅ |
| 9 | 受限沙箱下子进程工具 EPERM | ⚠️ 环境 |

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

| 信号 | 期望 | 为 0 意味着 |
|---|---|---|
| 退出码 | 0 | — |
| `samples.Count` | **> 0** | 运行时阶段根本没跑 |
| `contrast.checked` | **> 0** | 对比度审计根本没跑 |
| `duration` | **≈ 成片总长** | 它读到的是一张空页 |

**本技能的 `scripts/hf.mjs`** 提供了程序化自验证通道：
1. 对 `check` 固定注入 `--no-browser-gpu`；
2. 支持 `--out <file>` 参数：内部使用 `fs.openSync` 传递文件描述符给子进程，避开 Node 管道与 PowerShell 编码重定向，并在子进程完成后自动解析 JSON，严格校验 `errors === 0`、`samples.length > 0`、`contrast.checked > 0` 和 `duration > 0`。校验通过返回退出码 0，校验失败返回退出码 1；
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
[data-composition-id="frame-NN-slug"][style*="visibility: hidden"] * ,
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

## 快速自检

```powershell
# 静态坑（§3/§4/§5/§6/§7/§8 全覆盖）
node tools/vox/audit-frames.mjs --project . --json          # 期望 findings: 0
# 时长四处（§7）
node tools/vox/sync-frame-durations.mjs --project . --check # 期望 N/N frames ok
# 时间闭环（§1 的成因之一：槽位与真实旁白不符）
node tools/vox/verify-timeline.mjs --project . --json       # 期望 0 error
```

`audit-frames.mjs` 覆盖 §3/§4/§5/§6/§7/§8；§1 只能靠"核对三项计数"（见 §1）；
§2/§9 是流程与环境纪律，没有脚本能替你遵守 —— 尤其 §2（编辑帧期间别开 preview）
和"一帧一个作者"，违反它们的代价是混合态，脚本查不出来。
