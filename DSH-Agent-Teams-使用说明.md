# DSH 智能体团队（Agent Teams）使用说明

> 撰写基准：本机 DSH `0.1.6-alpha.2`（`C:\Users\tiger\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`）
> 事实来源：随安装发布的五个 `dsh-experimental-*` 包自带的 `README.zh.md`、`cordis.patch.yml`、`lib/types/*.d.ts` 与客户端文案
> 适用 profile：`web`（本机 `~/.dsh/profiles/web`）

---

## 1. 一句话概览

**Agent Teams = 让一个会话里的 agent 变成 Lead，创建若干「具名 teammate」，用持久消息互相通信、在同一块共享任务板上协作。** 消息与任务状态能挺过崩溃、reload 与中断；离线的 teammate 恢复后会收到排队的消息。

三个要点先记住：

1. **它是官方插件，但以 `experimental` 命名公开发布，不承诺稳定性**——孵化期约定可自由变更。
2. **它是「组合」出来的，不是内建开关**：五个包分别是「领域服务 / 模型工具 / Host profile 层 / Web profile 层 / 浏览器 UI」，靠 profile 的 bundle 列表叠起来才生效。
3. **单进程 + 共享工作目录**：所有 teammate 共享同一个 cwd，改动立即可见；不提供 worktree 隔离、文件锁、跨进程协调。

---

## 2. 五个官方插件包（内容与职责）

| 包名 | 一句话职责 | 依赖 | 关键内容 |
|---|---|---|---|
| `dsh-experimental-agent-team` | **领域服务**：隐式根 Team 的 roster、持久 peer mailbox、共享任务 DAG | zod, dsh-brand, schemastery | `ctx.agentTeams` 服务、持久事件（`team/member`、`team/task`、`team/message/queued`、`team/message/delivered`）、生成的 Remote 方法 `agentTeams/view` / `createTask` / `updateTask` |
| `dsh-experimental-tool-agent-team` | **模型工具层**：九个 scoped 工具 + 一段共享协作策略 | schemastery | `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_*`（4 个）；`team:policy` system 段落 |
| `dsh-experimental-agent-team-profile` | **Host profile 层**：在 `dsh-base` 之上启用 Team | 上面两个包 | 只有运行时内容 `cordis.patch.yml`：禁用 4 个旧行 + 插入 Team 服务与工具行 |
| `dsh-experimental-agent-team-web-profile` | **Web profile 层**：让浏览器挂载 Team 面板 | `dsh-experimental-client-ui-agent-team` | `cordis.patch.yml` 里一条 `insert: ui-agent-team` |
| `dsh-experimental-client-ui-agent-team` | **浏览器 UI**：会话标题栏的 Team 入口、roster 面板、共享任务板、teammate 导航 | 无（peer） | 挂载 `ctx.remote.agentTeams`，注册中英文 locale 与一个 conversation-header slot；不存储 Team 状态、不注册模型输入 |

全部为 `0.1.6-alpha.2`。

**注意边界**：领域服务「本身不提供任何工具」，浏览器 projection「不扩展稳定 API Proxy、不存储 Team 状态、也不注册面向模型的输入」。工具、服务、UI 三层是分离的，缺一层就是残的。

---

## 3. 组合与启用（组合真相）

### 3.1 本机实况：已启用

`~/.dsh/profiles/web/package.json` 的 bundle 顺序（顺序有意义）：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dshmarket",
  "@deepseek-ai/dsh-experimental-agent-team-profile",
  "@deepseek-ai/dsh-experimental-agent-team-web-profile"
]
```

- 用户自己的 patch 层 `~/.dsh/profiles/web/cordis.patch.yml` 是空的 `[]`——**Team 能力完全来自上面两个实验层**，不是手工改行改出来的。
- 随安装发布的其他 profile（CLI / SDK / ACP / Python / headless）**默认不启用** Agent Teams，需要显式添加。

### 3.2 Host 层 patch 到底改了什么

`dsh-experimental-agent-team-profile/cordis.patch.yml`：

```yaml
# 先禁掉 4 个旧行
- id: tool-subagent-control        # 全局 continuable-child 控制
  disabled: true
- id: tool-subagent-list-agents    # 旧的 list_agents
  disabled: true
- id: tool-subagent                # 旧的全局 subagent
  disabled: true
- id: tool-subagent-fork           # 旧的全局 subagent_fork
  disabled: true

# 再插入 Team 两层
- insert:
    - id: agent-team
      name: '@deepseek-ai/dsh-experimental-agent-team'
      config: { maxMembers: 8, maxTasks: 256, maxPendingMessagesPerMember: 64,
                maxMessageBytes: 65536, disposalTimeoutMs: 5000 }
    - id: tool-agent-team
      name: '@deepseek-ai/dsh-experimental-tool-agent-team'
      config: { freshProvider: spawn, forkProvider: fork }
```

Web 层 patch 只有一行：

```yaml
- insert:
    - id: ui-agent-team
      name: '@deepseek-ai/dsh-experimental-client-ui-agent-team'
```

### 3.3 怎么开、怎么关

```bash
# 开（Host 层必须先于 Web 层）
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-web-profile

# 关（移除 Web 层不会破坏稳定的 base/web 组合）
dsh plugin --profile web remove @deepseek-ai/dsh-experimental-agent-team-web-profile
```

也可以在 **Web 侧栏的插件页**里开关。headless 等其他 profile 同理（`--profile headless`），但 headless 没有浏览器 UI，只有服务 + 工具。

### 3.4 与既有委派机制的关系

| 机制 | Team 层启用后 |
|---|---|
| `subagent` / `subagent_fork`（全局 host 行） | **被禁用** |
| `list_agents` / `interrupt_agent` / `send_message`（旧的全局 child control） | **被 Team 版本取代**（Team-scoped 注册覆盖同名全局控件） |
| `workflow` 的 `agent()` | **不受影响**——仍用 base 的 `spawn` 提供方创建 fresh 一次性子代理 |
| preset 作用域内的旧 subagent 控件 | ⚠️ **不会被顶层 host patch 覆盖**（见 §8 第 2 条） |

---

## 4. 模型侧：九个工具

挂载后，**Lead 与每个 teammate 拿到的是同样九个工具**（策略也相同），权限在执行时才裁决——**只有 Lead 能创建 / 中断 / 重新分配**。

### 4.1 创建与通信

| 工具 | 权限 | 语义 |
|---|---|---|
| `spawn_teammate` | 仅 Lead | 创建一个具名、持久 teammate。给唯一小写名（如 `reviewer`）+ 职责描述 + 初始任务。`context` 选 `fresh`（不携带 Lead 历史，默认）或 `fork`（继承 Lead 已完成轮次）。名字**永久且不复用**，创建失败也占用名字。 |
| `send_message` | 任何成员 | 发一条持久消息给任意成员或 Lead。running 目标在**最近步骤边界**收到（steering）；idle 目标**启动一个轮次**；inactive teammate **冷恢复**。 |
| `list_agents` | 任何成员 | 列出 Lead 与全部持久 teammate 的当前运行时状态。 |
| `wait_agent` | 任何成员 | 等待**本次调用开始之后**的下一次 roster / mailbox / task 变化。默认 30s，范围 10s–1h。**它不会唤醒任何成员**；当没有其他成员 running 或 provisioning 时立即返回 `noProgress`（提示先用 `send_message` 唤醒）。醒来后要**重新 list**，不要轮询。 |
| `interrupt_agent` | 仅 Lead | 停止某个 teammate 的当前轮次，**保留其待处理 inbox**；不释放任务归属。 |

### 4.2 共享任务板（4 个）

| 工具 | 语义 |
|---|---|
| `team_task_create` | 建一个**无 owner 的 pending 任务**：标题、详情、可选 `blocked_by` 依赖、可选 `write_scopes`（advisory 的文件/目录前缀）。 |
| `team_task_list` | 列任务：readiness、owner、revision、blockers、write-scope 警告。支持 `owner` 过滤（`unowned` 表示无主）与分页（1–100，默认 50）。 |
| `team_task_get` | 改任务前先读**完整最新值**（拿 revision）。 |
| `team_task_update` | **compare-and-set** 变更，必须带当前 revision。action：`claim` / `release` / `edit` / `set_dependencies` / `complete` / `reopen` / `reassign`（Lead 专用）/ `delete`。 |

### 4.3 三条会咬人的语义

1. **`send_message` 成功 ≠ 送达**：结果只有 `accepted`（已立即接受）或 `queued`（暂时投递不了，已安全落盘）。**queued 的消息绝不能重发**——它已经持久化了。
2. **任务更新是 CAS**：基于过期 revision 的编辑会被**拒绝**（`TEAM_TASK_STALE_REVISION`），而不是覆盖更新的成果。所以流程永远是 `team_task_get` → 改 → `team_task_update`。
3. **`wait_agent` 不制造进展**：它只是等变化。没有成员在跑就立刻 `noProgress` 返回——这是设计，不是错误。

---

## 5. 领域模型（持久状态）

- **TeamId = Lead 的 SessionId**：每个普通运行时 root 天然是一个隐式 Team 的 Lead，**没有「创建团队」这一步**；持久状态从第一条成员/消息/任务记录开始。
- **成员**（`TeamMemberView`）：`id`、`name`、`role`（`lead` / `teammate`）、`status`、`description`、`provider`、`context`、`model`、`diagnostics[]`。
  - 运行时状态：`running` / `idle` / `inactive`（存在但未加载）/ `provisioning` / `failed`
  - 持久生命周期（`phase`）：`provisioning` / `active` / `failed`
- **任务**（`TeamTaskView`）：`id`（`task-<n>`）、`revision`、`subject`、`description`、`status`（`pending` / `in_progress` / `completed` / `deleted`）、`ownerName`、`blockedBy[]`、`writeScopes[]`、`ready`、`writeScopeWarnings[]`。
- **持久性模型**：`team/member`、`team/task`、`team/message/queued`、`team/message/delivered` 这些事件**只存在于 Lead 会话日志**，从不进入会话展示面——所以协作记录不会污染模型历史、不额外消耗 token（任务与 roster 变化不加模型 token）。lead 会话日志是唯一真源，roster / mailbox / 任务状态都是**每次读取时回放派生**。
- **保证强度**：进程内重试 + 目标会话去重，**不是跨进程 exactly-once**；不支持多个 harness 进程同时操作同一 Team。

`writeScopes` 只是**提示**：它会产生「两个 in-progress 任务触及重叠路径」的警告，但**绝不阻止 claim，也不授予写权限**。Bash、formatter、代码生成器都可以绕过。

---

## 6. Web 界面（本机 GUI 里的实际样子）

GUI 地址：**http://127.0.0.1:3080**（本会话即运行在此）。

### 6.1 入口

**会话标题栏（conversation header）上的 Agent Teams action**。客户端插件注册的就是一个 conversation-header slot —— 打开某次会话，在标题栏找 Team/团队入口即可。（Host 层与 Web 层都必须在同一 profile 里，否则入口不出现。）

### 6.2 面板内容

打开 panel 会调用 `agentTeams/view`，拿到一个时点投影：`{ members: [...], tasks: [...] }`。

**成员区（Roster）**

- 每个成员一行：持久 `name`、运行时 `status`、`model`、`diagnostics`
- 健康 teammate 可点开：**打开 teammate 会话**（跳转到那次会话）
- 顶部动作：**刷新 Team**、**关闭**
- 加载态：`正在加载 Team…`

**共享任务板（Task board）**

- 每行展示：task identity、owner、blocker、readiness、提示性 write scope 与重叠 warning
- 可执行：**新建任务**、编辑、分配/取消分配、完成、重开、删除
- 新建/编辑表单字段：任务标题、任务描述、依赖任务 id（逗号分隔）、写入范围（逗号分隔）
- 空态：`还没有共享任务`

### 6.3 文案对照（中英）

| 分类 | 中文（本机 zh locale） | 对应值 |
|---|---|---|
| 面板动作 | 刷新 Team / 关闭 / 新建任务 / 编辑 / 完成 / 重开 / 删除 / 保存 / 取消 | — |
| 分组 | 成员 / 共享任务 / 模型 / 依赖 / 写入范围 | Roster / Tasks / Model / Blocked by / Write scope |
| 成员状态 | 运行中 / 空闲 / 未运行 / 准备中 / 失败 | running / idle / inactive / provisioning / failed |
| 任务状态 | 待处理 / 进行中 / 已完成 | pending / in_progress / completed |
| 任务判定 | 可开始 / 被依赖阻塞 / 未分配 | ready / blocked / unassigned |
| 导航 | 打开 teammate 会话 | open teammate session |
| 冲突提示 | 任务状态已变化，已重新加载；请检查后重试。 | `team-task-conflict` |

### 6.4 面板的能力边界（重要）

- **快照式刷新**：panel 只在「打开 / 手动刷新 / 发生一次 mutation 之后」刷新，**没有实时事件订阅、没有 mailbox 时间线**。想看最新进展就点刷新。
- **不能做生命周期操作**：面板**无法 spawn、rename、delete、interrupt** teammate —— 这些只能在对话里让 Lead 用工具做。
- **写范围只是 metadata**：面板展示它，但它不构成任何强制。
- **teammate 会话里的导航**走的是**稳定的 addressed-subagent 路径**（`{ parentSessionId, childSessionId, mode: 'continuable' }`），不是 Team 专用地址；在跳转后的会话里发的人类消息也走普通 child 提示词路径，**不是** Team peer mailbox。
- 每次 update 都发送界面上当前显示的 revision；create/update 被拒会作为**显式业务结果**展示，不会被静默吞掉（若刷新失败则显示重读错误）。

---

## 7. 三种用法

### A. 让 Lead 建团队（对话里怎么说）

```
用 Agent Teams 把这活拆给两个 teammate，等到都结束后汇总。
先建一个叫 reviewer 的 teammate 检查 diff，再把变更摘要发给它。
```

**固定策略只在明确要求「团队 / teammate」时才创建成员**，所以普通任务不会自作主张委派。典型节奏：

1. Lead `spawn_teammate`（名字 + 职责 + 初始任务）
2. Lead `team_task_create` 建任务（可带依赖与写范围）
3. teammate `team_task_list` → `team_task_get` → `claim` → 干活 → `complete`
4. 任何一方 `send_message` 通信；Lead `wait_agent` 等变化，醒来后重新 list
5. Lead **必须在给出最终答案前等齐必需的 teammate**，并检查最终 diff、跑验收

### B. 用 Web 面板监督

打开会话标题栏的 Team 入口 → 看成员是否都 `运行中` → 看任务板谁 owner 了什么、哪些被依赖阻塞 → 点成员跳进它的会话读完整轨迹 → 需要干预就回到 Lead 会话里下指令（面板不能替你 spawn/interrupt）。

### C. 调参与开关

改限制有两种途径：

- **改 profile patch**：`~/.dsh/profiles/web/cordis.patch.yml` 里按行 id 覆盖 `agent-team` 的 config（patch 是**整行 config 替换**，不是深合并，要写全）。
- **插件页**：Web 侧栏插件页里开关这两个 bundle。

可调字段（`agent-team`）：

| 字段 | 本机 profile 现值 | 包默认 | 含义 |
|---|---|---|---|
| `maxMembers` | **8** | 16 | 一支团队最多创建（含失败）的具名 teammate 数 |
| `maxTasks` | 256 | 256 | 任务板上最多活动任务数（tombstone 不计） |
| `maxPendingMessagesPerMember` | 64 | 64 | 单成员最多排队消息数 |
| `maxMessageBytes` | 65536 | 65536 | 单条消息最大字节数 |
| `disposalTimeoutMs` | 5000 | 5000 | 关闭清理的时间上限 |

`tool-agent-team` 只有两个开关：`freshProvider`（默认 `spawn`）、`forkProvider`（默认 `fork`）。

---

## 8. 已知限制与坑

1. **实验原型**：不承诺稳定性，schema 可自由变更；随发布的 profile 默认不启用它。
2. **preset 作用域的旧控件不会被顶层 patch 覆盖**——稳定 Web preset 仍在 preset scope 内挂载 continuable subagent 控件，因此 **Team roster 与旧 child 控件可能同时出现**。本会话就是实例：九个 Team 工具与 `subagent` / `subagent_fork` 并存。（官方记录为待办的 composition 工作。）
3. **单进程、共享 checkout**：成员共享同一个 cwd，改动立即可见；没有 worktree、没有远端成员、没有 merge、没有文件锁。会话登录同一 Team 的多个 harness 进程**不受支持**。
4. **write scope 只是提示**：Bash / formatter / codegen / 直接外部写入都能绕过文件版本检查——**Lead 必须协调 owner 并检查最终 diff**。
5. **roster 扁平且不可变**：只有 Lead 能创建**直接** teammate；不支持嵌套 Team、改名、删除、名字复用。
6. **owner 永不自动释放**：idle、interrupt、进程退出、工作失败**都不释放**任务 owner，需要人/Lead 显式 `release` 或 `reassign`。
7. **mailbox 不保证跨进程 exactly-once**。
8. **一次性子代理的可见性时序**：进程内一次性子代理在发布后才拿到 subagent descriptor，Team 安装可能**短暂把它们误当 Lead** 而暴露 Team 策略与工具；descriptor 落地后调用会被拒。
9. **提示词策略只管协调，不管 confinement**：它挡不住 Bash 或外部进程写重叠文件。
10. **需要持久会话存储**才能激活（本机已具备 `dsh-session-persistence-jsonl`）。

---

## 9. 速查

| 想做什么 | 去哪 |
|---|---|
| 看 Team 服务、持久类型与 `ctx.agentTeams` API | `…@deepseek-ai\dsh-experimental-agent-team\README.zh.md`、`lib\types\types.d.ts` |
| 看九个工具的 schema 与策略文本 | `…@deepseek-ai\dsh-experimental-tool-agent-team\README.zh.md`、`lib\index.js` |
| 看 Host 层改了什么行 | `…@deepseek-ai\dsh-experimental-agent-team-profile\cordis.patch.yml` |
| 看 Web 层挂了什么 | `…@deepseek-ai\dsh-experimental-agent-team-web-profile\cordis.patch.yml` |
| 看浏览器 UI 的文案与实现 | `…@deepseek-ai\dsh-experimental-client-ui-agent-team\lib\client.js`、`README.zh.md` |
| 改本机开关/顺序 | `~\.dsh\profiles\web\package.json`（bundles）、`~\.dsh\profiles\web\cordis.patch.yml`（覆盖） |
| 验证 preset 能否 mount | `ctx.agentPresets.standingKeyFor(id)`（cordis preset 会话内） |

**最快的验证方式**：随便开一次新会话，让 Lead 调一次 `list_agents`——它应返回一行 `lead`，状态 `运行中`；同时在会话标题栏应能看到 Team 入口。

---

## 10. 本机现状（核对结果）

**实测（直接读到的）**

- DSH 版本 `0.1.6-alpha.2`；五个 `dsh-experimental-*` Team 包同版本，均已随安装存在，且**能从 dsh 安装处解析**（bundle 解析顺序里优先这里，不必装进 profile 的 `node_modules`）。
- `~/.dsh/profiles/web/package.json` 的 bundles **已按正确顺序包含** Host 层与 Web 层。
- 用户 patch 层 `~/.dsh/profiles/web/cordis.patch.yml` 为 `[]`，**无额外覆盖**。
- **Host 层在跑**：本会话的工具集里九个 Team 工具齐备（`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create/_list/_get/_update`）——工具层挂载的直接证据。
- 同时存在 legacy `subagent` / `subagent_fork`（§8 第 2 条的已知现象，实测复现）。
- GUI 在 `127.0.0.1:3080` 上有监听（无凭据访问返回 401）。
- 限制被 profile patch 收紧为 `maxMembers: 8`（包默认 16）。

**由组合推断（未在浏览器里目视确认）**

- 会话标题栏的 Agent Teams 入口与面板：Web 层 bundle 已列出、客户端包可解析、GUI 在监听，三者齐备；但 3080 需要鉴权，命令行无法直接内省渲染出的界面。**打开一次会话看标题栏即可确认。**

**你自己的会话里怎么快速确认**

1. 让 Lead 调一次 `list_agents` → 应返回一行 `role: lead`、状态 `运行中`。
2. 看会话标题栏有没有 Team 入口；点开应出现「成员 / 共享任务」两块。
3. 若标题栏没有入口但工具在 → 说明缺 Web 层（只启用了 Host 层）。
