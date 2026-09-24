# 验证 —— 怎么确认门禁真的跑了

> 这条管线最贵的教训不是"忘了验证"，是**验证假装通过了**。
> 本文件的第一原则：**每个门禁都要有一个"证明确实执行了"的信号，且这个信号不能是门禁自己报的 ok。**

---

## 0 · 三条原则

1. **门禁要自证。** `ok=true` 不够——它可能是零输入下的 ok。附带计数（samples / checked / frames）才算真跑过。
2. **动效要量像素，不靠肉眼。** "推轨生效了吗"这种问题，问一句"标题左边缘帧首帧尾差多少 px"就有确定答案。
3. **产物要人眼看。** JSON 全绿不等于画面能看。关键秒点必须 `read_image` 亲眼过一遍。

---

## 1 · 结构门禁

```powershell
node <skill>/scripts/hf.mjs lint --json      # 期望 ok=true，0 error / 0 warning
```

⚠️ **注意 `lint` 的 ok 与 warn 计数**：`ok=true` 只表示没有 error。
必须同时看 warning 计数为 0，否则"0 error"会掩盖一堆 warning。

## 2 · 浏览器门禁（**最容易假装通过的一关**）

```powershell
node <skill>/scripts/hf.mjs check --json --out .hyperframes/check-latest.json
```

先确认项目根的 `assets/vendor/gsap.min.js` 存在，并且 `index.html` 只从该路径加载 GSAP；本地运行时缺文件与 CDN 下载失败同样会表现为空动效。

**必须核对三件事，缺一不可（包装使用 `--out` 自动核对；未传 `--out` 返回退出码 3 拒绝假装通过）**：

| 信号                 | 期望           | 为什么                    |
| -------------------- | -------------- | ------------------------- |
| error / warning 计数 | 0 / 0          | 常规                      |
| `samples.Count`      | **> 0**        | 为 0 = 运行时阶段根本没跑 |
| `contrast.checked`   | **> 0**        | 为 0 = 对比度审计根本没跑 |
| `duration`           | **≈ 成片总长** | 为 0 = 它读到的是一张空页 |

**为什么不带 `--no-browser-gpu` 会出问题**：本机取不到真实 GPU 时运行时阶段静默跳过，
返回 `duration=0 / samples=[] / contrast.checked=0` 却报 ok。
`scripts/hf.mjs check` 已把 `--no-browser-gpu` 与 `--out` 自动核对逻辑**固定注入包装**——
所以**一律走包装**，不要直接调 CLI。

全片多秒点复查：

```powershell
node <skill>/scripts/hf.mjs check --at 5,20,35,55,80,100,125,145,170,190,210,232 --json --out .hyperframes/check-latest.json
```

秒点取每帧的中段（用 `verify-timeline.mjs` 输出的槽位表），不要取帧边界——边界上正则结算，容易误判。

### 2.1 采样点必须落在「画面最满的时刻」（节拍同步之后尤其重要）

一旦按 §10 把动效铺到整帧，元素是**逐段出现**的。此时用"帧中段"采样会**漏掉一大半元素**：实测同一个项目，中点采样只查到 **42** 处对比度对象，改到每帧 80% 处（画面最满）是 **62** 处。

```
秒点 = 该帧起点 + 0.80 × 该帧槽位
```

自证法：`contrast.checked` 的数量应当与"这一帧的元素总数"同量级。**如果数字明显偏低，先怀疑采样点，而不是以为片子干净。**

## 3 · 时长门禁（槽位对齐与侧车同步）

```powershell
node <skill>/scripts/sync-frame-durations.mjs --project . --check
```

**通过判据**：核对帧数 == 项目帧数，每帧报 `N layer(s) ok @ <槽位>`（按每帧实际层数，通常为 2–4 层，如 root / paper / content / grain）且伴生 `.motion.json` 侧车 `duration_s` 保持一致。
失败时输出会点名是哪个文件、哪些层的旧值、槽位是多少 —— 不带 `--check` 重跑即修。

## 4 · 时间轴门禁（槽位 vs 真实旁白）

```powershell
node <skill>/scripts/verify-timeline.mjs --project . --json
```

**它检查什么**：

- 每个 `voice_0NN.wav` 的实际秒数（读 wav 头，不靠猜）。
- 每个槽位是否 ≥ `0.3 + 旁白时长`（旁白必须放得下）。
- `data-start` 是否连续无空洞/重叠。
- 总长是否等于槽位之和。
- 输出**全局起点表**，供取快照用（本项目实例：`01=0 · 02=11.0 · 03=29.8 …`）。

失败时给**具体 retime 建议**（哪个槽位该改成多少），而不是只报错。

## 4.5 · 接缝渲染闸（门禁链第 6 道，v2 新增）

```powershell
node <motion-doctrine>/scripts/seam-stamp.mjs --ledger ledger.json --write index.html   # 布线（改了 ledger/槽位后重跑）
node <motion-doctrine>/scripts/seam-gate.mjs verify --ledger ledger.json --project . --json
```

- **它检查什么**：从 `ledger.json` 逐条接缝，量 `cut ± 0.1s` 的入场/出幕速度 —— **cut 前后不得 0 速度**（出幕的整张纸要一直动到 cut，见 `_contract.md` §3 的接缝时间模型）；载体位置/尺寸在容差内；`entry/exit` 的 selector 上禁 `stepped()` / `steps()` / `SteppedEase`（12fps 的 83ms 保持窗会落进采样窗 → 量到 0 速度）。
- **只对 v2 项目**（有 `ledger.json`）成立；旧片无账本 → 跳过（产物存在性分档）。
- **布线**：先跑 `seam-stamp --ledger ledger.json --write index.html` 把出/入幕补间写进 `index.html`（改了 `ledger.json` 或槽位后必须重跑）；未布线直接跑本步会 FAIL（`exit-*` / `entry-*`）。
- 通过判据：每条接缝 `exit` / `entry` 全绿、无 `0` 速度。

## 5 · 语音判别（**抓"合出来是杂音"**）

```powershell
node <skill>/scripts/verify-film-audio.mjs <media> <start> <dur>
```

**为什么需要它**：TTS 引擎加载错权重版本时会**成功产出音频文件**——只是内容是杂音。
文件在、时长对、能播放，一切看起来正常。

判别特征（实测）：

|                                     | 变异系数 CV                                | 静音帧占比 |
| ----------------------------------- | ------------------------------------------ | ---------- |
| **正常语音**（edge-tts 参考值）     | **≥ 0.9**                                  | **25–65%** |
| **正常语音**（克隆音 + AAC 转码后） | 实测 0.73–0.93（**硬判据仍 ≥ 0.9**，见下） | **25–65%** |
| 杂音（权重不匹配）                  | ≈ 0.36                                     | ≈ 2%       |

**⚠️ CV 阈值不是常数 —— 它随 TTS 引擎与是否转码而变（第二个数据点实测）**：

| 环节                                  | 实测 CV 区间    |
| ------------------------------------- | --------------- |
| edge-tts 源 wav（22050Hz，参考项目）  | 1.10–1.27       |
| **IndexTTS 克隆音源 wav**（24000Hz）  | **0.836–0.934** |
| 上述音频进 **AAC 48kHz 成片**后再抽段 | **0.734–0.883** |

原因：CV 量的是**包络起伏的尖峰度**。克隆音的合成器比 edge-tts 更"平"（少尖峰），
AAC 的有损编码又会再抹掉一点动态 —— 两者都会把 CV 往下压，**但都远离杂音的 0.36**。

**⚠️ 脚本与文档的口径（2026-09-22 已对齐）**：脚本 `SPEECH_CV_MIN = 0.9` 是**唯一硬判据**，
**不要**把它读成"克隆音按 0.7 就能过"（旧文档就是这么写的，是错的）。三档是：

| CV                    | 脚本 verdict                  | 处置                                      |
| --------------------- | ----------------------------- | ----------------------------------------- |
| **≥ 0.9**             | `speech`（exit 0）            | 通过                                      |
| **0.7 – 0.9**         | `gray`（exit 1，附 ASR 指引） | **必须补第二道**（内容级 ASR 对稿，见下） |
| **< 0.6 且静音 ≈ 2%** | `noise`                       | 去查权重与 `--version`                    |
| 其余                  | `ambiguous`                   | 人工听                                    |

> **静音帧带是 25–65%，不是 25–48%（2026-09-22 更正）**：整片实测真实旁白（edge-tts，jev 14 条）
> 落在 **46–56%**；旧的 0.48 上界把 **12/14 条**误判为 `ambiguous`（连 10s 中间窗也 3/4 中招）。
> 上界放宽到 **0.65**。真杂音 ≈ 2%，仍分得开。**测量用 8–12s 窗**（整片会被句间的数字静音拉高）。

灰区（0.7–0.9）必须补第二道（内容级）：

**内容级自证（更硬，强烈建议做）**——把抽出来的段落用 ASR 转写，与锁定稿对一下：

```powershell
# 从成片抽 8–12s，单声道 16k，喂给 faster-whisper
ffmpeg -y -v error -ss <旁白起点> -t 12 -i renders/<成片>.mp4 -ac 1 -ar 16000 chk.wav
# 再用 faster_whisper 转写 chk.wav（language='zh'），与 SCRIPT.md 的锁定稿逐句比
```

**转写文本与 `SCRIPT.md` 的锁定稿一致 = 这一段的语音是对的**。
这一道同时抓两件事：不是静音、不是杂音，**且 TTS 没把专有名词念错**（见 [`voice-sync.md`](./voice-sync.md) §2）。

**用法**：阶段④对每条 wav 跑一遍 CV + 静音帧；出片后对成片里的旁白段再抽 2–3 处
（CV + 静音帧 + **ASR 转写对稿**）。

**⚠️ 片子里加了纸 ASMR 轨之后（`_contract.md` §3，`issues/19`）—— 判据不改，做法要改**：

1. **主门禁跑混音前的 `.media/audio/voice/*.wav`** —— 那里没有 ASMR，判据完全不受影响。
2. **成片抽查的采样窗避开所有 ASMR 入点 ±1.0s**（入点表在 `gen-index.mjs` 的 `ASMR` 数组里，程序化过滤，零成本）。
3. ASMR 只会把采样窗的包络抬高 → 造成 **`ambiguous` 假失败**，**不会**造成假 `noise`
   （那需要"持续噪声铺满"）；灰区用上面的 ASR 对稿兜底。
4. `verify-timeline.mjs` 不受影响：它按 `src` 含 `audio/voice/` 过滤旁白 —— ASMR 只要落在 `.media/audio/asmr/` 就不会被误认。

> 本机实例：正确入口是 OpenMontage 的 `apps/indextts-bridge/client.py → IndexTTSSession`
> （`model_version="2.5"`、纯零样本克隆、不传 `emo_vector`）。
> 用 2.0 结构加载 2.5 权重 → 日志出现 `missing keys (212)` / `skipping spk_emb_proj` → 产出杂音。

## 6 · 像素量测（验证动效真的发生了）

动效失败**不报错**。GSAP 接受空目标集合并静默返回——所以"推轨没生效"从日志里看不出来。

**方法**：对同一元素在帧首与帧尾各拍一张快照，量一个几何特征，比较差值。

```powershell
node <skill>/scripts/hf.mjs snapshot --at <帧首> --no-end --timeout 30000 --output .hyperframes/snaps-a
node <skill>/scripts/hf.mjs snapshot --at <帧尾> --no-end --timeout 30000 --output .hyperframes/snaps-b
```

本项目实例：`tools/_title_left.mjs <snapshot.png>` 量标题左边缘，
**帧首与帧尾应差 40–50px**（推轨规模 1.0 → 1.05、x 0 → −16 的预期位移）。

**通用做法**：把"这个动效的预期几何变化"写成一个可复跑的一次性脚本，
把这个数字固化下来。下次改这一帧，跑一遍就知道有没有破坏它。

⚠️ `--no-end` 必须带，否则会顺手把 end 帧也拍掉。

## 7 · 人眼验收（不可省略）

```powershell
node <skill>/scripts/hf.mjs snapshot --at <秒> --no-end --timeout 30000 --output .hyperframes/snaps-eye
```

然后用 `read_image` 看图，逐项确认：

- [ ] 材料清晰（不是糊的、不是被裁掉了关键信息）
- [ ] 手绘标注**真的落在材料的目标元素上**（不是飘在旁边）
- [ ] 文案无重叠、无溢出画面
- [ ] 边缘锚在（左上频道标签 + 右上 `NN / 总帧数`）
- [ ] 这一帧只有一个焦点
- [ ] 该帧"禁止出现"的东西确实没出现

**每帧至少看一张。** 12 帧就是 12 张 —— 这一步不能省，它是唯一能抓到"内容根本没出现"这类问题的手段。

三条省时与防错纪律（都来自第二个数据点的实测）：

1. **用联系表一次看多帧**：`snapshot` 会在输出目录里顺手写一张 `contact-sheet.jpg`，
   把同一批的 3–4 张拼成一张。**读联系表**而不是逐张读，上下文成本降到 1/4。
2. **一个批次可能整体失败**：实测出现过一次"同一批 4 张全空、但逐帧头部与材料正常"（重拍即好）。
   **先重拍确认是批次问题，再去改代码** —— 否则会在错误的现场上做修复动作，把好的帧改坏（`pitfalls.md` §19）。
3. **帧内顺序也要看**：元素"挤在帧顶 / 上下顺序与设计不符"是定位模型错（漏写 `position`）的症状，
   不是排版问题（`pitfalls.md` §16）。看到顺序不对，先查 `getComputedStyle(el).position`。

## 8 · 出片后

```powershell
node ..\..\packages\cli\dist\cli.js render .
```

**>4 分钟必设长片闸门**（否则默认的磁盘帧缓存路线会要求上百 GB 临时空间而直接失败）：

```powershell
$env:PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS = "1200"   # 默认 240
node ..\..\packages\cli\dist\cli.js render . -q looks
```

出片日志必须出现 `streaming-encode gate {… "enabled":true, "maxDurationSeconds":1200}`。

- 出片后**只留一版**，删掉中间版本（否则接手者不知道该信哪个）。
- 用 `verify-film-audio.mjs` 抽查 2–3 段旁白（CV + 静音帧），**并用 ASR 把这几段转写出来对稿**（§5）。
- 记下成片参数：分辨率 / fps / 时长 / 体积 / 编码 / 音轨，以及渲染路线与耗时。
- 回写 `BRIEF.md` 运行中记录。

## 9 · 画面与旁白同步（**做节拍/词级同步的片子必跑**）

同步失败**不报错** —— 元素只是"出现得早了"，画面看着完全正常。
唯一能抓住它的是"同一帧里取两个靠近的时刻对拍"。完整方法见 [`voice-sync.md`](./voice-sync.md) §6，
这里只给最小可执行的三步：

```powershell
# 1 · 线索命中率与条数（期望 N/N 帧、N/N 条）
python tools/align-cues.py --model medium

# 2 · 线索时间的单调性（同一帧内必须随旁白递增）
node -e "const j=require('./tools/cue-times.json');for(const k of Object.keys(j)){const c=j[k].cues;if(c.some((x,i)=>i&&x.t<c[i-1].t))console.log('NOT MONOTONIC',k)}"

# 3 · 对拍：线索前 0.5s / 后 0.5s 各一张，看元素是否"只在该出现时才出现"
node <skill>/scripts/hf.mjs snapshot --at <线索前>,<线索后> --no-end --output .hyperframes/sync-a
```

**通过判据**：① 线索 N/N 命中；② 每帧线索时间单调；③ 对拍快照上元素确实"跟着词出现"。

### 9.1 · 成对快照：`--pair`（issues/22 §6 规则 10）

把上面第 3 步的换算收进包装 —— **只需给线索名**，全局秒点由 `hf.mjs` 自己算
（`帧内秒 = CUE[k] + 0.3 − 0.2`，全局 = 槽位起点 + 帧内秒；线索跨帧重名时用 `--frame NN` 消歧）：

```powershell
node <skill>/scripts/hf.mjs snapshot --pair --cue <线索名> [--window 0.15] [--frame NN]
```

它在 `cue ± 0.15s` 各拍一张（同一浏览器会话），并把两张放在同一目录里。

**判据（两条，缺一不可）**：

1. **硬判**：两张 PNG **逐字节相同 ⇒ 失败**。同一页面同一会话下，像素相同就必然字节相同 ——
   字节相同意味着该窗口内**画面没有任何变化**，即这条线索的落定**没有落在 ±0.15s 里**
   （要么线索名/锚短语写错导致 `at()` 返回 0 而元素从帧首就在场，要么元素根本没出现）。
   ⚠️ 反过来**不成立**：字节不同只说明"有变化"（推轨本身也在动），**不等于通过**。
2. **眼判（真正的那条）**：`read_image` 亲眼看后一张相对前一张**多出了哪些元素**，
   确认它们正是该线索名指代的元素 —— 即"在場元素集合不同，且差集 = 该线索的元素"。

**抽 10 条**（至少每帧一条，优先挑"元素最晚落定"的那条），跨帧各跑一遍。单帧内可以对多条线索各跑一次。

**注意**：线索名写错**不会报错**——`at()` 对未定义的线索返回 0，元素会从帧首就在场。
所以**改完线索名（或锚短语）必须重拍**，不能只看脚本输出。

---

## 一页速查

| 门禁         | 命令                                                            | 通过判据                                                               |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 静态扫描     | `audit-frames.mjs --json`                                       | `findings: 0`                                                          |
| 结构         | `hf.mjs lint --json`                                            | 0 error **且** 0 warning                                               |
| 运行时       | `hf.mjs check --json`                                           | 0/0 **且** samples>0 **且** contrast.checked>0                         |
| 时长         | `sync-frame-durations.mjs --check`                              | N/N frames ok                                                          |
| 时间轴       | `verify-timeline.mjs --json`                                    | 每帧 slot ≥ 0.3+voice，start 连续                                      |
| 接缝         | `seam-gate.mjs verify --ledger ledger.json`                     | 每条接缝 cut±0.1s 无 0 速度（v2 项目；旧片跳过）                       |
| 语音（CV）   | `verify-film-audio.mjs <media> <start> <dur>`                   | **CV ≥ 0.9**（`gray` 0.7–0.9 必须 ASR 对稿）；静音帧 **25–65%**        |
| 语音（内容） | ASR 转写抽段 vs `SCRIPT.md`                                     | 与锁定稿逐句一致                                                       |
| 同步         | `align-cues.py` + 线索单调性 + `hf.mjs snapshot --pair`（§9.1） | 线索 N/N 命中 · 同帧时间单调 · 对拍两张**字节不同**且差集=该线索的元素 |
| 动效         | 快照 + 量测脚本                                                 | 几何差值落在预期区间                                                   |
| 眼睛         | 快照 + `read_image`（读 `contact-sheet.jpg`）                   | 6 条清单全过                                                           |
