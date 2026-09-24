# VOX collage smoke fixture

这是 `vox-explainer` 的长期回归样例，保留 `issues/11` 中四种最小句式：

- `01-hook`：叙事拍
- `02-mech`：信息屏 · 机制
- `03-data`：信息屏 · 数据
- `04-close`：收尾

样例保留令牌、四函数生成的帧、装配表、接缝账本、纸 ASMR 轨和一张背景验证联系表。四条旁白是 8 kHz 单声道确定性静音占位文件，只用于保持真实槽位与时间轴门禁；它们不是语音样本，也不用于 `verify-film-audio`。

## 运行门禁

在本目录执行：

```powershell
node ..\..\scripts\hf.mjs lint --json
node ..\..\scripts\audit-frames.mjs --project . --json
node ..\..\scripts\sync-frame-durations.mjs --project . --check
node ..\..\scripts\verify-timeline.mjs --project . --json
node ..\..\..\..\..\.agents\skills\motion-doctrine\scripts\seam-gate.mjs verify --ledger ledger.json --project . --json
node ..\..\scripts\hf.mjs check --json --out .hyperframes/check-example.json
```

通过判据是 `lint` 0 error / 0 warning、`audit-frames` 0 error / 0 warning、时长 4/4、timeline 0 error、3 条接缝全 PASS，以及 `check` 的 `samples`、`contrast.checked`、`duration` 均非零。

## 资产与来源

- `assets/vendor/gsap.min.js`：GSAP 3.14.2，许可说明在同目录。
- `assets/fonts/`：技能自带的 OFL 字体；大字体走 Git LFS，新 clone 需要 `git lfs pull`。
- `.media/audio/asmr/`：由 `gen-asmr.mjs` 的固定 `ffmpeg lavfi` 配方生成，`license: self`。
- `proof/contact-sheet.jpg`：背景验证的生成证据，不是源文件。

## 有意不纳入的内容

`.hyperframes/`、逐帧 PNG、MP4、真实旁白、Qwen 生成图片和 jev 的真实材料/旁白不随本样例提交。jev 四帧的完整验收证据仍保留在本机 `.scratch/vox-collage-landing/jev-repaint/`，在补齐来源与可再分发许可前不作为公共样例。

本目录是静态回归 fixture；需要重新生成时，使用 `vox-explainer` 技能当前脚本，不要把旧项目里的本机路径复制回来。
