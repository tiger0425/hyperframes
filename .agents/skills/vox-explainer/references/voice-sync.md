# 画面与旁白同步（voice-sync）—— 让每个元素在"念到它的那一刻"出现

> **这份文件解决一个问题**：VOX 教学片的单帧时长由旁白决定（实测 8–27s，长片里常到 20–70s），
> 如果入场动画全挤在帧首那几秒，剩下的几十秒画面是静止的 —— 成片观感从"跟着讲解在长"退化成"翻幻灯片"。
> `pitfalls.md` §10 记的就是这个坑（`motion_frontload`）。
>
> **本文给出第二条、更精确的路**：不走"停顿检测 + 比例插值"，而是**直接量到词**。
> 全部数据来自 `projects/freetoken-v013-vox` 的实测（12 帧 / 267.4s / 97 条线索全部命中）。
>
> 相关：`pitfalls.md` §10（症状与阈值）· `verification.md` §9（怎么自证同步真的发生了）·
> `_contract.md` §3（本片实测数值）。

---

## 0 · 两条路，怎么选

| 路 | 做法 | 精度 | 什么时候用 |
|---|---|---|---|
| **beat（粗）** | `silencedetect` 量停顿 → 把句子边界对到停顿 → 句内按字符数线性插值 | 句级（±0.3–0.8s） | 旁白停顿充足；只想解决"动效全挤在帧首" |
| **word（精）** | faster-whisper 的**词级时间戳**把锁定稿逐字对齐到音频 | 词级（±0.05–0.15s） | 要求"元素在念到那个词的那一刻出现"；旁白里有工具名/数字/类名要逐个点亮 |

**两条可以并用**：`beat-*` 做"这句话在第几秒"的粗定位，词级对齐做"这个词在第几秒"的精定位。
本片只用 word 路（因为需求就是"元素与语音内容同步"），结果 97/97 命中，不需要任何插值假设。

---

## 1 · 数据流（四个文件，单向）

```
SCRIPT.md            锁定旁白稿（每条一行，逐字冻结）
   │
   ├─ tools/synthesize_voice.py ──▶ .media/audio/voice/voice_0NN.wav
   │                                └─▶ .media/voice-manifest.json（wav 头实测秒数）
   │
   ├─ tools/cues.json        ← **作者手写**：元素 → 锚短语（本文 §3 的格式）
   │
   └─ tools/align-cues.py ──▶ tools/cue-times.json  ← **机器产出**：帧 → 线索 → 秒
                                   │
                                   └─ tools/gen-frames.mjs 构建时注入 ──▶ 帧内 `const CUE = {...}`
                                                                          └─ tween 的 at() 读它
```

**单向纪律**：`SCRIPT.md` 是唯一的文案源；`cues.json` 只写锚短语**不写秒**；
`cue-times.json` 是机器产物、**不许手改**（改了下次对齐就丢）；帧里**不许写死秒数**。

---

## 2 · 前置：语音必须先合成、且必须过内容级复核

对齐的输入是**真实音频**，所以顺序不能反：

1. `python tools/synthesize_voice.py`（或按项目自己的 TTS 方案）合成 12 条 →
   `.media/voice-manifest.json` 里记 **wav 头实测秒数**（不要信任何转述来的时长）。
2. 跑一遍 `verify-film-audio.mjs`（见 `verification.md` §5）。
3. **用 ASR 读一遍转写文本**（`align-cues.py` 会顺手打印）—— 这是抓"TTS 把专有名词念错"的唯一手段。

**中文 TTS 的可读性拼写变体（实测，不是文案改动）**：

| 稿子里写 | TTS 常念成 | 处理 |
|---|---|---|
| `MoE` | 不成词的音节 | 口播文本写 `M O E`（逐字母）。中文技术圈本来也这么念 |
| `QuantScheme` / `QuantMethod` | `Quant Stream` / `Quant Basiled` | 写 `Quant Scheme` / `Quant Method`（驼峰拆成空格） |
| `PLE` | `Po` | 写 `P L E` |
| `--text-model-only` | 前导 `--` 变成噪声 | 口播文本去掉前导双横线，屏幕上仍写 `--text-model-only` |

三处都在 ASR 复核里确认念对了才继续。**这些是同一术语的拼写变体，要在 `SCRIPT.md` 的
`Delivery` 里注明"屏幕上写作 X、口播读作 Y"**，否则接手者会以为是文案漂移。

---

## 3 · 线索表格式（`tools/cues.json`）

一条线索 = **一个画面元素/动效** + **它在锁定稿里的锚短语**。锚短语必须是锁定稿的**连续子串**。

```json
{
  "04-mech-image-in": {
    "cues": [
      { "id": "apis-in",  "anchor": "图片从三个方向进来", "element": "三枚协议芯片落位（空槽先出现）" },
      { "id": "api1",     "anchor": "OpenAI", "alt": ["openai", "open AI"], "element": "芯片一 image_url + 黄笔底衬" },
      { "id": "api2",     "anchor": "Anthropic", "alt": ["anthropic"], "element": "芯片二 image block" },
      { "id": "src-note", "anchor": "本地文件都收", "element": "三枚芯片下方 URL / base64 / file:// 补齐" },
      { "id": "tag-radix","anchor": "同一个前缀缓存", "element": "小签 radix cache 亮起" }
    ]
  }
}
```

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 线索名。帧内用 `at("id")` 取时间，**同一帧内唯一** |
| `anchor` | ✅ | 锚短语。**用中文短语，别用纯英文/纯数字**（见下） |
| `alt` | 可选 | 候选写法。ASR 可能把同一段念成不同字（`OpenAI` → `open AI`），按顺序取第一个命中的 |
| `occurrence` | 可选 | 锚短语在稿里出现多次时取第几个，默认 1 |
| `element` | 建议 | 人读的说明"这条线索点亮什么"。写清楚，它就是帧作者的设计意图 |

**锚短语的选取纪律（踩过才知道）**：

1. **优先中文短语**。纯英文 / 纯数字锚（`image_url`、`47.7`）在 ASR 里最不稳；
   真要用就给 `alt` 并接受它是"尽力而为"。
2. **避免一句话里的第一个字**。`而`、`它`、`是` 这类单字锚容易被前一句的尾音吃掉，往前取两三个字。
3. **锚短语不能跨标点**（对齐是按字符序列做的，标点被归一化掉了，跨标点会错位）。
4. **锚短语要在语义上真的对应那个元素**。写成"随便找一句念到它"是这一步最常见的偷懒 ——
   元素会在观众还没听到那个概念时先跳出来，同步感立刻消失。
5. **一条线索一个元素**。一句话要点亮三样东西就写三条线索（本片 12 帧共 97 条，平均每帧 8 条）。

---

## 4 · 对齐脚本（`tools/align-cues.py`）

```powershell
python tools/align-cues.py --model medium            # 全量；产出 tools/cue-times.json
python tools/align-cues.py --model medium --frame 03 # 只重跑某帧，结果**并回**已有 json
```

算法（四步，全部确定性）：

1. **归一化**：稿子与 ASR 文本都做 NFKC + 小写，只留 `[0-9a-z\u4e00-\u9fff]`（标点/空白全丢）。
2. **词级时间戳**：`faster-whisper` 对每条 wav 出 `word_timestamps=True`，得到 (词, start, end) 列表；
   把每个词的 start 摊到它归一化后的每个字符上，得到"字符 → 时间"的序列。
3. **字符级单调对齐**：`difflib.SequenceMatcher` 对齐"稿子字符序列"与"ASR 字符序列"，
   对 `equal` 块建立"稿子 index → ASR index"的映射；缺失位置只允许在有限字符距离内取最近邻。
4. **查锚**：把锚短语也归一化，在稿子里找它的字符 index，查表得时间；整句命中率或最近邻距离不达标即失败。


**为什么是"字符级"而不是"词级"**：中文 TTS 的 ASR 分词与稿子的分词不一致（`image_url` 可能被拆成
`image` + `_url`），词级对齐会在这种地方崩掉；字符级对齐对分词不敏感，实测命中 97/97。

**`align_hit` 要读**：脚本会打印每帧的命中率。中文帧通常 85–97%；**混了大量英文/数字的帧会掉到 60–75%**
（ASR 对英文的识别弱）——这时要检查是不是靠 `alt` 兜住的，必要时给该帧的英文术语加 `alt`。
默认门槛为 **60%**，且每个锚点的最近邻映射距离不得超过 3 个字符；任一条件不满足，脚本返回失败且不覆盖旧的 `cue-times.json`。
低于门槛的帧必须纳入对拍，不能只抽固定数量的高命中帧；可用 `hf.mjs snapshot --pair-low-hit --min-align-hit 0.8` 自动挑选这些帧。

---

## 5 · 帧内怎么用（构建时注入）

帧**不写死秒数**。生成器在构建时把该帧的线索表注入成 `const CUE`：

```js
const CUE = {"apis-in":1.1,"api1":3.2,"api2":5.2,"api3":6.68, /* … */};
const at = (k, lead = 0) => Math.max(0, (CUE[k] === undefined ? 0 : CUE[k]) - lead);
```

然后**每一处 tween 都用 `at()` 定位**，不写数字：

```js
rise("#f4-t", at("apis-in", 0.4), 24);   // 旁白念"图片从三个方向进来"前 0.4s 起来
stamp("#f4-p1", at("api1"));             // 念到 OpenAI 的瞬间
stamp("#f4-p2", at("api2"));
ink("#f4-mat-m1", at("material-mark"), 0.8);
```

四条施工纪律：

1. **`at()` 的 `lead` 参数只用于入场动画**（提前 0.2–0.5s 让元素在说到之前一点点到位）。
   手绘描线用 `lead = 0`（笔要跟着词走，提前反而怪）。
2. **未定义的线索名返回 0**（元素从帧首就在场）。所以线索名写错**不会报错**——
   它只会让元素提前出现。**`audit-frames` 抓不到，只有快照能看出来。** 改完线索名一定重拍。
3. **同一个锚短语可以给多条线索**（本片第 03 帧的 `material-mark` 与 `branch-left` 共用 `加了一次能力`）；
   但**别为了省事把一堆元素挂到同一条线索上**，那等于把这一帧变成"一次到位"。
4. **元素必须挂 `.js-hide`**（`visibility: hidden`），否则它从 t=0 就在场，`at()` 形同虚设（`pitfalls.md` §5）。

---

## 6 · 自证：怎么确认同步真的发生了

四道，缺一不可：

1. **命中率与映射距离**：`align-cues.py` 打印的每帧 `align_hit` 与"线索 N/N"（本片 12/12 帧、97/97 条），且整句命中率和最近邻距离都过门槛。
2. **线索时间的单调性**：同一帧内线索时间必须随旁白推进递增；出现"后一句的线索时间早于前一句"就是锚选错了。
   用 `node -e "…"` 把 `cue-times.json` 每帧的 `id=t` 打出来扫一眼即可。
3. **快照按节拍对拍**（最可靠）：在**同一帧**里取两个靠得很近的时刻（例如线索前后各 ±0.5s），
   看元素是否**只在该出现时才出现**。
4. **低命中帧覆盖**：除固定抽样外，所有低于命中门槛的帧都要做一次成对快照；`hf.mjs snapshot --pair-low-hit` 会按命中率从低到高自动挑选。

   ```powershell
   # 取"念到第 1 条限制之前"与"之后"两个切点
   node tools/vox/hf.mjs snapshot --at 239.0,240.5 --no-end --output .hyperframes/sync-a
   ```

   本片的做法是每帧取"最满的那一刻"，再把 3–4 帧拼成**联系表**一次看多帧（`pitfalls.md` §19）。

---

## 7 · 已知边界

- **对齐质量受 ASR 限制**。旁白里英文/数字越多，命中率越低；给术语加 `alt` 是唯一手段。
- **`faster-whisper` 的模型大小有取舍**。实测 `medium` 在中文上明显好于 `small`
  （`small` 会把 `QuantScheme` 听成 `Quant Stream`，`medium` 能对上一半）。
  12 条 / 4 分钟的量级，`medium` 在 CPU int8 上跑一轮约 5 分钟，可接受。
- **锚短语是"人写的"，所以"同步对不对"最终靠人眼判**。脚本只能保证"锚到了那个时间点"，
  保证不了"那个时间点真的是讲这件事的时候"。
- **不适用**：没有锁定稿的片子（现成footage 的字幕/overlay 走 `embedded-captions` / `talking-head-recut`）、
  纯 beat 驱动的音乐片（走 `music-to-video` 的节拍网格）。
