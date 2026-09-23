# 技能内置字体 · 来源与许可

`init-vox-project.mjs` 会把本目录整体拷贝到新项目的 `assets/fonts/`，因此
`init --theme collage` 开箱即有字体、`hf.mjs check` 不会因 404 字体判红。

| 文件                      | 族 / 字重                    | 来源                                                                     | 许可                      |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `NotoSansSC-VF.ttf`       | Noto Sans SC（100–900 可变） | [Google Noto Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+SC) | SIL Open Font License 1.1 |
| `JetBrainsMono-400.woff2` | JetBrains Mono 400           | [JetBrains Mono](https://www.jetbrains.com/lp/mono/)                     | SIL Open Font License 1.1 |
| `JetBrainsMono-700.woff2` | JetBrains Mono 700           | 同上                                                                     | SIL Open Font License 1.1 |
| `Caveat-700-latin.woff2`  | Caveat 700（latin）          | [Google Fonts · Caveat](https://fonts.google.com/specimen/Caveat)        | SIL Open Font License 1.1 |

OFL 允许随软件再分发；保留本表作为来源与许可记录。

> `NotoSansSC-VF.ttf` = 17.8MB，超过仓库 500KB 的非 LFS 二进制上限，
> 已按 `.gitattributes` 的 `.agents/skills/**/*.ttf` / `.claude/skills/**/*.ttf`
> 规则走 **Git LFS**。克隆后需 `git lfs pull` 才拿到真实字体文件。
