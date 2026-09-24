---
colors:
  paper: "#EDE6D6"
  paper-deep: "#DCD3BE"
  paper-shadow: "#C9BFA6"
  ink: "#141310"
  ink-soft: "#57503F"
  rule: "#BDB39C"
  signal: "#D6271C"
  marker: "#D9A521"
  card: "#F4EEDC"
  halftone: "#141310"
  tape: "#D9CDAE"
  stamp: "#8C2F24"
  string: "#B4342A"
  pin: "#B08A3E"
  cutout-shadow: "#8A806A"
  aging: "#8B6A34"
paper:
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
  body:
    family: "Noto Sans SC"
    weight: 400
  mono:
    family: "JetBrains Mono"
    weight: 500
  hand:
    family: "Caveat"
    weight: 700
layout:
  margin: "96px"
  gutter: "32px"
  radius: "0"
focus: "每帧恰好一个 data-focus 容器，最小覆盖 40% 画幅"
---

# Frame Design — VOX collage smoke

这是 `issues/11` 的最小视觉回归样例：纸面、逐件入场、接缝和纸 ASMR 都在同一条可复跑管线里验证。每帧只保留一个焦点，背景痕迹按帧号确定性生成。
