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

**必须核对三件事，缺一不可（包装使用 `--out` 自动核对；未传 `--out` 返回退出码 3 拒绝假装通过）**：

| 信号 | 期望 | 为什么 |
|---|---|---|
| error / warning 计数 | 0 / 0 | 常规 |
| `samples.Count` | **> 0** | 为 0 = 运行时阶段根本没跑 |
| `contrast.checked` | **> 0** | 为 0 = 对比度审计根本没跑 |
| `duration` | **≈ 成片总长** | 为 0 = 它读到的是一张空页 |

**为什么不带 `--no-browser-gpu` 会出问题**：本机取不到真实 GPU 时运行时阶段静默跳过，
返回 `duration=0 / samples=[] / contrast.checked=0` 却报 ok。
`scripts/hf.mjs check` 已把 `--no-browser-gpu` 与 `--out` 自动核对逻辑**固定注入包装**——
所以**一律走包装**，不要直接调 CLI。

全片多秒点复查：

```powershell
node <skill>/scripts/hf.mjs check --at 5,20,35,55,80,100,125,145,170,190,210,232 --json --out .hyperframes/check-latest.json
```

秒点取每帧的中段（用 `verify-timeline.mjs` 输出的槽位表），不要取帧边界——边界上正则结算，容易误判。

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

## 5 · 语音判别（**抓"合出来是杂音"**）

```powershell
node <skill>/scripts/verify-film-audio.mjs <media> <start> <dur>
```

**为什么需要它**：TTS 引擎加载错权重版本时会**成功产出音频文件**——只是内容是杂音。
文件在、时长对、能播放，一切看起来正常。

判别特征（实测）：

| | 变异系数 CV | 静音帧占比 |
|---|---|---|
| **正常语音** | **≥ 0.9** | **25–48%** |
| 杂音（权重不匹配） | ≈ 0.36 | ≈ 2% |

**用法**：阶段④对每条 wav 跑一遍；出片后对成片里的旁白段再抽 2–3 处跑一遍
（证明渲染出来的确实是语音，而不是静音或杂音）。

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

## 8 · 出片后

```powershell
node ..\..\packages\cli\dist\cli.js render .
```

- 出片后**只留一版**，删掉中间版本（否则接手者不知道该信哪个）。
- 用 `verify-film-audio.mjs` 抽查 2–3 段旁白。
- 记下成片参数：分辨率 / fps / 时长 / 体积 / 编码 / 音轨。
- 回写 `BRIEF.md` 运行中记录。

---

## 一页速查

| 门禁 | 命令 | 通过判据 |
|---|---|---|
| 静态扫描 | `audit-frames.mjs --json` | `findings: 0` |
| 结构 | `hf.mjs lint --json` | 0 error **且** 0 warning |
| 运行时 | `hf.mjs check --json` | 0/0 **且** samples>0 **且** contrast.checked>0 |
| 时长 | `sync-frame-durations.mjs --check` | N/N frames ok |
| 时间轴 | `verify-timeline.mjs --json` | 每帧 slot ≥ 0.3+voice，start 连续 |
| 语音 | `verify-film-audio.mjs <media> <start> <dur>` | CV ≥ 0.9 且静音帧 25–48% |
| 动效 | 快照 + 量测脚本 | 几何差值落在预期区间 |
| 眼睛 | 快照 + `read_image` | 6 条清单全过 |
