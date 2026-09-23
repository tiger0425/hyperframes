---
colors:
  paper: "#F1EDE4"
  paper-deep: "#E3DCCC"
  paper-shadow: "#DED6C4"
  ink: "#121212"
  ink-soft: "#514C44"
  rule: "#C9C2B4"
  accent: "#1D4ED8"
  signal: "#E23A2E"
  marker: "#FFD400"
paper:
  # C2（issues/15 四轮 → 落地 issues/19）：半调只落**图像与垫纸**，纸面（地面层）不铺网点。
  # 下面三个 halftone-* 令牌供图像/垫纸的半调用；纸面只靠纸色 + grain-opacity 的纤维层。
  halftone-pitch: 10
  halftone-radius: 1.15
  halftone-opacity: 0.12
  grain-opacity: 0.13
  pin-size: 14
  cutout-shadow-offset: "3px 4px"
typography:
  display:
    family: "Noto Sans SC"
    weight: 900
    tracking: "-0.02em"
    usage: "主标题、大字主张；一律粗黑、紧字距"
  body:
    family: "Noto Sans SC"
    weight: 400
    usage: "正文、卡片文案；行高 1.5"
  mono:
    family: "JetBrains Mono"
    weight: 500
    usage: "包名、命令、字段名、编号标签；大写 + 0.12em 字距"
layout:
  margin: "96px"
  gutter: "32px"
  radius: "0"
focus: "（待填：声明本片每帧恰一个焦点元素 —— 门禁 focus_declaration 会量它；见 references/visual-grammar.md）"
---

# Frame Design — {{TITLE}} · VOX 解说体系

> 这是 `@hyperframes-creative` 读的设计令牌文件。写法与字段见
> `.claude/skills/vox-explainer/references/visual-grammar.md`。

## Overview

（一句话说清这套视觉的内核。VOX 的内核是：**纸感底 + 近黑正文 + 单一信号蓝**。
红色只用于警示与手绘记号，黄色只用于荧光笔——两种颜色都不铺面，出现即意味着"这里要看"。
权威感来自排版本身：极粗的黑体大字、等宽字体的元信息、1px 细线分隔、零圆角零阴影。
信息量可以大，但每一屏只有一个焦点。）

## The Frame

- **底**：`paper`，带一层极轻的纸纹颗粒（build 阶段叠加，sketch 不画）。**纸面不铺网点**（半调只落图像与垫纸）。
- **焦点**：每帧一个大字主张或一张主卡，占 40% 以上画面重量；`accent` 蓝只落在焦点上。
- **边缘锚**：左上角固定的频道标签，右上角帧编号（`NN / 总帧数`）；两者用 mono、小字号、
  `ink-soft`，永不抢焦点。
- **支撑细节**：卡片、表格、字段名用 mono；中性灰块只做占位，不做装饰。
- **禁止**：渐变、投影、圆角、玻璃拟态、emoji、纯白底。

## Composition Rules

1. 一屏一个主张。第二个重点必须等第一个说完（build 阶段用动效的节拍分开，sketch 阶段只做静态布局）。
2. 术语首次出现必须配一句人话解释，字号不小于正文的 0.8 倍。
3. 数字与字段名一律 mono + `tabular-nums`。
4. 手绘标注（圈注、箭头、连接线）是唯一允许的"装饰"——它必须指向真实信息。
5. 荧光笔（marker）配额**按信息块数量缩放**：信息屏 `≤ ceil(信息块数/3)`（至少 1），叙事拍 `1`；警示红（signal）出现即信号，不铺面。

## Do / Don't

**Do**：大字、留白、细线、等宽元信息、真实字段名、手绘标注指向真实元素。

**Don't**：不用渐变/阴影/圆角；不把实验性能力说成稳定能力；不用未解释的术语；
不让装饰元素脱离信息独立存在。

## Notes

- 字体落地为**项目内文件**：`assets/fonts/`（Noto Sans SC VF / JetBrains Mono 400+700 /
  Caveat 700，Microsoft YaHei 用 `local()` 兜底）。lint 要求任何出现在字体栈里的族名都有
  `@font-face` 声明。
- 纸纹颗粒用注册表区块实现（`grain-overlay`），**不在 CSS 里手搓**。
- 手绘圈注用注册表区块（`vox-annotate` / `hw-*` 系列），装之前先走
  `hyperframes-registry` 搜索，别手搓已有实现。
