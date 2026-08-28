# NoNeedWork v0.1 系统设计规格

- 状态：已批准
- 日期：2026-08-28
- 首发平台：Windows 10/11 x64
- 计划周期：单人开发 12 周
- 目标用户：使用本地代码仓库的个人开发者
- 黄金任务：读取仓库、制订计划、修改代码、运行测试、验证结果并交付可审阅补丁

## 1. 执行摘要

NoNeedWork v0.1 是一个 local-first、无需登录、基于 PI SDK 的开源软件工程 Agent。它不是 PI 的 fork，也不是 OpenCode 的换皮。PI 提供成熟的 Agent Harness，包括模型适配、`AgentSession`、消息树、事件流、Session 持久化、Context Compaction、Retry、ResourceLoader、Skill 和 Extension 机制；NoNeedWork 在其外部拥有产品级 Task 状态机、权限与审批、Tool Gateway、Docker Sandbox、可恢复执行、受控多智能体、Trace、Eval 和 Workbench。

产品默认在隔离 workspace 中自治工作。Agent 不能直接写入真实仓库，最终变更以 patch Artifact 交付；用户审阅并批准绑定具体 patch hash 的请求后，NoNeedWork 才能把补丁应用到真实仓库。

v0.1 完全本地运行，不包含账号、云同步、远程任务或计费。架构仅保留 `SandboxProvider`、`ArtifactStore` 和 `IdentityProvider` 等替换边界，为后续官方 Cloud 或 Self-host 版本留出空间。

## 2. 产品目标与非目标

### 2.1 产品目标

1. 让个人开发者在 Windows 上对真实 Git 仓库发起可验证的软件工程任务。
2. 在 12 周内交付 CLI 和 Tauri Workbench，共享同一 Runtime 和协议。
3. 基于 PI 的成熟工程实践，同时把 PI 依赖限制在可替换 Adapter 内。
4. 对所有副作用实施 mandatory mediation：Schema、路径规范化、Policy、Approval、Budget、Sandbox、Trace 缺一不可。
5. 支持进程退出、模型中断、工具超时和审批等待后的恢复或安全停机。
6. 提供真实但受限的多智能体：Supervisor 可委派给有界 Worker，Worker 不可递归创建子 Agent。
7. 建立可复现 Eval Harness，评估功能、安全、恢复、多智能体和成本回归。

### 2.2 v0.1 非目标

- Cloud、登录、设备同步、计费、团队或多租户。
- macOS 和 Linux 的正式发布支持。
- Browser、Document、Spreadsheet、Research 等非软件工程 Agent。
- 长期 Memory、向量数据库和 RAG。
- 递归 Agent、自由群聊、Agent 自主组队或并行多写者。
- 自动加载用户全局或项目中的第三方 PI Extension。
- 通用 Host Shell、Host Filesystem、GitHub PR、`git push` 或自动部署。
- 使用 Docker 承载恶意多租户代码的强隔离承诺。
- 任意 Shell 副作用的 exactly-once 保证。

## 3. 方案选择

### 3.1 选定方案：嵌入 PI SDK

NoNeedWork Runtime 直接依赖 `@earendil-works/pi-coding-agent@0.84.3`，通过 SDK 创建和恢复 `AgentSession`。依赖使用精确版本和 lockfile 固定，只允许 `packages/pi-adapter` 导入 PI 包。

不 fork PI 仓库。NoNeedWork 使用自定义 `ResourceLoader`、自定义 Tool 和事件订阅接入，避免继承 PI CLI/TUI 产品代码，也避免自动发现不受信任 Extension。PI 升级在独立分支完成，并必须通过 Adapter Contract Suite、Eval Smoke 和安全回归。

### 3.2 未选方案

- 自研 Python Runtime：差异化和控制力最高，但 12 周内需要重复实现 PI 已经成熟的 Session、Compaction、Provider、Retry 和 Harness 能力，交付风险更高。
- OpenCode 产品引擎：最快获得完整 Coding Agent，但 NoNeedWork 的差异化会停留在外层 UI；也不利于独立拥有 Task、恢复、权限和 Eval 领域模型。
- Fork PI：短期改动方便，长期会承担上游合并和内部 API 演进成本。PI 已提供 SDK 和 Extension 边界，没有 fork 的必要。

## 4. 总体架构

```text
nw CLI ─────────────┐
                    ├── Local API / WebSocket ── nw-runtime (Node/TypeScript)
Tauri Workbench ────┘                                  │
                                                      ├── Task Orchestrator
                                                      ├── PI Session Adapter
                                                      ├── Policy / Approval
                                                      ├── Tool Gateway
                                                      ├── SubAgent Coordinator
                                                      ├── SQLite Ledger
                                                      └── Trace / Eval
                                                               │
                                                     Sandbox Provider
                                                               │
                                                  Docker Desktop + WSL2
                                                               │
                                            ephemeral workspace / test / patch
```

### 4.1 进程边界

1. `nw` CLI：工程入口，只通过 `client-sdk` 调用 Local API。
2. Tauri Workbench：React WebView 和最小 Rust Shell。WebView 不获得通用 Shell 或 Filesystem 权限。
3. `nw-runtime` Sidecar：唯一包含 Agent 业务逻辑的可信 Node 进程。
4. Task Container：不可信执行环境。每个 TaskRun 使用独立容器和 workspace。

Local API 只绑定 loopback 随机端口。Runtime 每次启动生成随机 bearer token，校验客户端 Origin 和协议版本。Tauri 从受控 sidecar 启动握手获取端口和 token。CLI 通过仅当前 Windows 用户可读的 runtime discovery 文件定位进程，并校验 PID、启动 nonce 和协议版本。

### 4.2 PI 与 NoNeedWork 的责任边界

PI 负责：

- 模型和凭据适配。
- AgentSession、消息树、steer/follow-up 和流式事件。
- Context、Compaction 和模型调用 Retry。
- Session 文件、Skill 和 ResourceLoader 基础能力。

NoNeedWork 负责：

- Project、Task、TaskRun、PlanStep、Lease、Checkpoint 和恢复。
- Tool/MCP/Skill 的 Capability Registry。
- Policy、Approval、Sandbox、Artifact 和安全审计。
- Supervisor/Worker 协调、预算和取消。
- Normalized Trace、Eval、CLI、Workbench 和发布。

PI Session 文件是模型消息树的事实源；NoNeedWork SQLite 是产品状态的事实源。两者通过 `pi_session_id` 和 `pi_session_file` 关联，不复制两套消息历史。

## 5. Runtime 状态机与可恢复执行

### 5.1 TaskRun 状态

```text
CREATED
  -> PREPARING
  -> PLANNING
  -> AWAITING_APPROVAL
  -> EXECUTING
  -> VERIFYING
       -> SUCCEEDED
       -> REPLANNING -> EXECUTING
       -> FAILED

任一非终态 -> CANCELLED
```

默认预算为 40 个模型 Turn、20 个写操作、2 次 Replan、3 个并行 Worker 和 90 分钟墙钟时间。预算耗尽时进入 `AWAITING_APPROVAL` 或 `FAILED`，禁止无限自治循环。

`PlanStep` 使用独立状态：`PENDING -> READY -> RUNNING -> SUCCEEDED | PARTIAL | FAILED | SKIPPED | CANCELLED`。只有依赖已满足的 Step 才能进入 `READY`。需要写 workspace 的 Step 必须获取单写者租约。

### 5.2 持久化和并发控制

- SQLite 启用 WAL、foreign keys 和 busy timeout。
- 每个 TaskRun 持有 `state_version`；状态更新使用 compare-and-swap。
- Worker 使用短租约字段 `lease_owner` 和 `lease_expires_at`，即使 v0.1 只有单 Runtime 也防止重复执行。
- `run_events` 是 append-only 日志，使用每个 Run 单调递增 sequence。
- Checkpoint 只写在稳定边界，不把任意流式 token 当作恢复点。

稳定边界包括：PI 收到完整 Tool Observation、PlanStep 状态提交、Approval 决议提交、Sandbox Operation 得到可查询终态以及最终 Artifact 写入成功。

### 5.3 有副作用 Tool Call 的顺序

```text
INTENT persisted
  -> POLICY_DECISION persisted
  -> APPROVAL persisted/consumed when required
  -> OPERATION_STARTED with operation_id
  -> OPERATION_FINISHED and Artifact persisted
  -> result returned to PI
  -> CHECKPOINT persisted
```

`INTENT` 保存 `tool_call_id`、参数哈希、Task/Step/Session 关联。Approval token 绑定 Task、Step、Capability、规范化资源、参数哈希、过期时间和 nonce，且只能消费一次。

### 5.4 重启恢复

Runtime 启动后扫描所有非终态 TaskRun，回收过期租约，并从 SQLite Ledger 和具体 PI Session 文件重建状态：

- 模型流或只读 Tool 中断：把 Turn 标记为 interrupted，从最近稳定 Checkpoint 继续。
- Sandbox Operation 可查询：使用 `operation_id` 重新连接并读取终态，不重复启动命令。
- Operation 结果未知：进入 `UNKNOWN_OUTCOME`，先运行 verifier；无法证明结果时要求人工确认补偿或重试。
- Approval 等待：保持 `AWAITING_APPROVAL`，重启不会自动批准或拒绝。
- SQLite、Artifact 或 Checkpoint 写入失败：立即停止推进状态，保留 sandbox 和诊断信息。

NoNeedWork 不宣称任意 Shell 命令 exactly-once。它保证意图可审计、可查询操作不重复启动、未知结果不静默重放，以及文件变更可通过隔离 worktree 和 patch 验证或回滚。

## 6. 权限、审批与沙箱

### 6.1 Trust Zone

```text
Host Trust Zone
  PI Runtime / Model Key / SQLite / Tauri / CLI
            │
            ▼
Mandatory Mediation
  Schema -> Canonicalize -> Policy -> Approval -> Budget -> Dispatch -> Audit
            │
            ▼
Sandbox Trust Zone
  container / copied workspace / process / network / artifacts
```

NoNeedWork 不向模型暴露 PI 默认 `bash`、`edit` 和 `write`。所有读写、进程和网络能力均使用 NoNeedWork 自定义 Tool。自定义 ResourceLoader 默认只加载内置、版本固定的 Extension factory；用户 PI Extension 和项目 `.pi/extensions` 不参与安全模式启动。

Skill 作为不可信文本指令处理，不能自行获得 Capability。MCP Server 首版默认禁用；后续接入时每个 Server/Method 必须映射独立 Capability，并通过相同 Tool Gateway。

### 6.2 Policy 模型

Policy 使用版本化 JSON 规则，不引入可执行脚本语言。输入包含 principal、role、capability、canonical resource、phase、risk、Task、Step 和当前预算。判定结果只有 `ALLOW`、`ASK` 和 `DENY`，使用 deny-overrides。

默认矩阵：

| Capability | Supervisor | Worker | 说明 |
|---|---|---|---|
| sandbox workspace read/search | ALLOW | ALLOW | 仅任务 workspace |
| sandbox workspace write | ALLOW + TRACE | Implementer ALLOW | 真实仓库不直接写 |
| test/build/lint | ALLOW | ALLOW | 结构化命令、超时、资源限制 |
| package install/network egress | ASK | DENY | 授权绑定域名、时间和任务 |
| apply patch to host | ASK | DENY | token 绑定 patch hash |
| local git commit | ASK | DENY | `git push` 为 DENY |
| host filesystem/shell/credential | DENY | DENY | v0.1 不开放 |
| Docker socket/privileged/host network | DENY | DENY | 防止横向控制 |

子 Agent 权限始终为 `父 Agent 已获权限 ∩ Worker role policy ∩ 当前 Step budget`，委派只能收窄权限。

### 6.3 Sandbox Profile

Windows v0.1 使用 Docker Desktop WSL2 Backend：

- 一个 TaskRun 一个临时容器和 workspace 副本。
- 不把真实仓库作为可写 bind mount。
- 非 root 用户、`cap-drop ALL`、`no-new-privileges`、默认 seccomp、read-only rootfs、`/tmp` tmpfs。
- 禁止 Docker socket、privileged、host PID、host IPC 和 host network。
- 默认 2 CPU、4 GiB RAM、256 PID、10 GiB workspace、单命令 10 分钟、任务 90 分钟。
- 默认 `network=none`。网络 Profile 必须 ASK，并通过独立 egress proxy 的域名 allowlist；禁止直接 IP 出网。
- 模型 API Key 永远留在 Host PI Runtime。v0.1 不向容器注入通用 Secret。
- Sandbox image 按 digest 固定并生成 SBOM。

Docker 用于降低个人开发者的误操作风险，不作为恶意多租户代码的最终隔离层。未来 Cloud 执行必须使用 microVM、gVisor、Kata 或 OpenShell 等更强边界。

## 7. 多智能体协调

### 7.1 角色

- Supervisor：唯一持有 Task/Plan、面向用户、请求审批、整合结果并发起最终 patch 应用的 PI AgentSession。
- Explorer：只读代码搜索、依赖分析和影响面定位，可并行。
- Implementer：在隔离 workspace 中完成一个有界修改；全局只允许一个写租约。
- Verifier：运行确定性测试和独立代码审查；不能修改源码。

### 7.2 委派契约

Supervisor 只能通过 NoNeedWork `delegate_task` Tool 创建 Worker：

```ts
type DelegateTask = {
  objective: string;
  role: "explorer" | "implementer" | "verifier";
  inputs: ArtifactRef[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
  budget: { turns: number; tokens: number; deadlineMs: number };
  dependsOn: string[];
};

type WorkerResult = {
  status: "succeeded" | "partial" | "failed";
  summary: string;
  evidence: EvidenceRef[];
  artifacts: ArtifactRef[];
  filesChanged: string[];
  verification: CheckResult[];
  unresolved: string[];
};
```

Worker 不复制 Supervisor 全部聊天，也不接收隐藏推理，只获得任务契约、必要文件清单、项目规则和依赖 Artifact。结果只返回摘要、证据、Artifact 和验证数据。

### 7.3 调度约束

- 最大深度为 1；Worker 不加载 `delegate_task`。
- 同时活跃 Worker 不超过 3，超额任务进入队列。
- 同一 workspace 只有一个写者。
- Task 取消、失败或预算耗尽时级联取消 Worker。
- Worker 需要额外权限时返回 `NEEDS_APPROVAL`，由 Supervisor 向用户请求。
- Verifier 只获取目标、patch、验收条件和测试入口，不读取 Implementer 的过程性推理；失败证据返回 Supervisor 决定 Replan。

PI 官方 Sub-Agent 示例证明独立 PI 进程、隔离 context 和并行/链式调用可行。NoNeedWork 参考其机制，但自行实现持久 Task Ledger、Capability 继承、单写者、预算和恢复。

## 8. Trace、Eval 与回归

### 8.1 Trace 数据模型

NoNeedWork 使用内部稳定 Trace Schema，再导出为 OpenTelemetry。不能直接把当前仍处于 Development 状态的 GenAI Semantic Conventions 当作持久数据模型。

```text
task.run
  plan.step
    gen_ai.invoke_agent
      gen_ai.inference
      tool.call
        policy.decision
        approval
        sandbox.operation
      subagent.run
  artifact.produced
  eval.grade
```

所有事件携带 `task_id`、`run_id`、`step_id`、`pi_session_id`、`tool_call_id`、`operation_id` 和可选 `worker_run_id`。Trace 保存 ID、哈希、计数、时延和 Artifact 引用；完整消息仍在 PI Session，完整工具输出仍在 Artifact Store。

`config_hash` 必须覆盖 NoNeedWork commit、PI package version、模型和 thinking、system prompt hash、policy version、sandbox image digest。Trace 导出默认移除 prompt、代码正文、环境变量和原始 Tool 输出，仅保留脱敏摘要。

### 8.2 NoNeedWorkBench v0.1

内部基准包含 30 个可复现仓库任务：

- 10 个 Bug Fix。
- 6 个 Feature。
- 4 个 Refactor。
- 4 个 Tool Failure：超时、截断、非零退出、重试和降级。
- 3 个 Crash Recovery：在 Intent、Operation 和 Observation 后注入崩溃。
- 3 个 Security：路径穿越、提示注入、越权网络和 Host 写入。

部分功能任务额外标注 multi-agent 场景，用于检查委派是否有效、Worker 是否越权和单写者是否生效。

每个 Case 包含固定 repo fixture/base commit、Task prompt、Sandbox image digest、允许和禁止路径、预算、公开测试、隐藏 grader、期望 Capability 事件和 Case schema version。Agent 完成后只导出 patch；grader 在全新容器中应用 patch 并运行隐藏测试，避免 Agent 篡改 grader 环境。

Primary Verdict 只有 `SUCCESS` 或失败原因。成功必须同时满足：patch 可应用、隐藏测试通过、禁止路径未改变、没有未授权副作用。LLM-as-Judge 只评可读性和解释质量等软指标，不能把确定性失败改判为成功。

### 8.3 CI 分层

- 每个 PR：状态机、Policy、Tool Contract、Sandbox 和 fault injection 的确定性测试，不调用真实 LLM。
- 带模型凭据的 PR 或手动：6 个 Smoke Case，各运行 1 次。
- Nightly：30 Case 各运行 1 次，与主分支逐 Case 对比。
- Weekly：30 Case 各运行 3 次，报告 success rate 和三次全通过率。
- Monthly/Release：SWE-bench Verified 固定 20-Case 子集，只作为 Coding 能力参考。

v0.1 发布门槛：

- 未授权 Host 副作用为 0。
- 黄金 10-Case task success 不低于 80%。
- 完整 30-Case task success 不低于 70%。
- 100 个 fault injection 点恢复或安全停机比例不低于 95%。
- Tool Contract 测试成功率不低于 98%。
- 相对 baseline 的中位 token/成本回退不超过 20%。

## 9. 仓库结构与数据模型

### 9.1 Monorepo

```text
apps/
  runtime/                 # Node 模块化单体和 Local API
    src/modules/
      tasks/
      planning/
      policy/
      capabilities/
      tools/
      sandbox/
      agents/
      artifacts/
      telemetry/
      evals/
      storage/
      api/
  cli/                     # CLI
  desktop/                 # React + Tauri 2
packages/
  protocol/                # Zod API 和 WebSocket Event schema
  pi-adapter/              # 唯一允许导入 PI 的包
  client-sdk/              # CLI/Desktop 共用客户端
benchmarks/
  cases/
  fixtures/
  suites/
images/
  sandbox/
docs/
  adr/
  specs/
scripts/
```

Runtime 采用模块化单体。业务模块不各自发布 package，也不各自启动进程。只有跨 App 共享、隔离上游依赖或定义 wire protocol 的代码才进入 `packages/`。

### 9.2 核心表

- `projects`：规范化 root path、仓库 fingerprint。
- `tasks`：用户目标、标题、Project 关联和当前状态摘要。
- `task_runs`：状态、`state_version`、PI Session 引用、config hash、policy version、lease 和 checkpoint。
- `plan_steps`：顺序、依赖、目标、验收条件、状态和写租约需求。
- `run_events`：append-only 事件序列。
- `tool_operations`：Tool call、Capability、args hash、Policy、Approval、Sandbox operation 和 Result Artifact。
- `approvals`：请求、绑定哈希、有效期、nonce、决议和 consumed time。
- `sandboxes`：provider、container、workspace、resource profile 和生命周期。
- `worker_runs`：role、parent step、PI Session、预算和结果。
- `artifacts`：sha256、media type、size、producer、retention 和 filesystem location。
- `eval_runs`、`eval_results`：suite、config、case、verdict、metrics 和 evidence。

所有 ID 使用 UUIDv7，时间使用 UTC ISO-8601，持续时间另存 monotonic duration。JSON 列必须携带 `schema_version` 并通过 Zod 解析。数据库迁移只向前执行，升级前使用 SQLite backup API 生成备份。

### 9.3 本地文件布局

```text
%LOCALAPPDATA%/NoNeedWork/
  noneedwork.db
  pi/sessions/
  artifacts/sha256/ab/cd...
  workspaces/<run-id>/
  logs/
  config/
```

模型 Provider 凭据保存于 Windows Credential Manager，不保存到 SQLite、日志、Trace 或 Sandbox 环境变量。

## 10. Workbench 与 CLI

Workbench 是 Task-first 控制台，不是 Chat-first 界面。

- 左侧：Project、Task、Eval、Model/Key 和 Sandbox。
- 中间：Plan、当前 Step、Tool Event、Replan、Approval、Steering 和最终结果。
- 右侧：Task 状态、预算、Sandbox、Worker、Artifact 和 Trace Inspector。
- 最终交付页同时展示 diff、测试、未解决问题、成本和安全事件。

用户主路径：

```text
选择 Git 仓库
  -> Preflight（模型、Docker、Git 状态、预算）
  -> 生成并查看 Plan/权限
  -> 在 Sandbox 中执行
  -> 对具体风险发起 Approval
  -> 确定性测试 + 独立 Verifier
  -> 审阅并批准具体 patch hash
  -> 应用到真实仓库
```

关闭 Workbench 不终止 Runtime 中的 Task。重新打开后，UI 通过 `/tasks/{id}` snapshot 和带 cursor 的 WebSocket events 从 Ledger 恢复；前端不能把内存状态当作事实源。

CLI 至少提供：

```text
nw doctor
nw task start --repo <path> <objective>
nw task watch <task-id>
nw task pause|resume|cancel <task-id>
nw approval show|approve|deny <approval-id>
nw eval run|compare|report
nw trace export <task-id> --redacted
```

## 11. 错误处理原则

- Model：PI 只对明确可重试的 Provider/网络错误执行有限 Retry；认证、配额和上下文错误直接暴露。Retry 计入预算和 Trace。
- Tool：只读或显式幂等 Tool 可自动 Retry；有副作用 Tool 未确认终态时不得自动重放。
- Sandbox：创建失败时 Task 停留在 `PREPARING`；容器异常退出时保留日志和 workspace，尝试重连或安全失败。
- Approval：过期后默认拒绝；修改参数必须生成新请求，不能复用旧 token。
- Worker：单 Worker 失败返回结构化 partial/failed；只有 Plan 允许降级时 Supervisor 才能继续。
- Storage：事务或 Artifact 持久化失败时停止推进，不向 PI 返回虚假成功。
- Event Stream：客户端断线使用 cursor 重放；cursor 已被 GC 时返回 snapshot 加最新 cursor。
- Cancellation：先停止产生新工作，再取消 Worker 和 Sandbox operation，最后写入终态；取消本身必须可重复调用。

## 12. 技术选型冻结

| 领域 | 选择 |
|---|---|
| Runtime | Node 24 LTS、TypeScript strict |
| Agent Kernel | `@earendil-works/pi-coding-agent@0.84.3`，精确锁定 |
| Local API | Fastify、WebSocket、Zod wire protocol |
| Storage | `node:sqlite`、prepared SQL、Repository、手写迁移，不使用 ORM |
| Desktop | React、Vite、Tauri 2 |
| Sandbox | Docker Desktop WSL2、Docker Provider 接口 |
| Telemetry | 内部 Trace Schema、OpenTelemetry exporter |
| Test | Vitest、Docker integration、Playwright Workbench smoke |
| Workspace | npm workspaces、package-lock、直接依赖精确版本 |

开发期 Runtime 使用 Node。Windows Release 将 compiled JS、PI 运行资源和 Node Runtime 打包为 Tauri external sidecar。Week 1 必须验证单文件或自包含目录打包。若单文件方案与 PI 动态资源加载不兼容，Fallback 是安装器捆绑 Node Runtime 与 compiled resources；不能把安装 Node 的责任留给最终用户。

## 13. 12 周里程碑

### Week 1–2：风险先行

- Monorepo、CI、ADR、protocol skeleton。
- PI SDK Adapter、自定义只读 Tool、Docker workspace。
- Tauri 启动 Runtime sidecar、`nw doctor`。
- Gate：打包 Runtime 能在 Docker 中读取 fixture，模型 Key 不进入容器。

### Week 3–4：第一个闭环

- Task/Run/Step Ledger、Plan/Execute/Verify。
- CLI start/watch/cancel、Artifact 和 patch export。
- PI Session 持久化、5 个黄金 Case。
- Gate：真实小仓库任务可重复完成，重启后可继续。

### Week 5–6：安全与恢复

- Policy、Approval、Sandbox hardening、Lease、Checkpoint、fault injection。
- 10 个 Benchmark Case。
- Gate：未经审批不能写 Host；30 个注入点恢复或安全停止。

### Week 7–8：受控多智能体

- `delegate_task`、三类 Worker、单写者、预算、级联取消、Trace。
- 20 个 Benchmark Case。
- Gate：Worker 可独立审计，不能递归或扩权。

### Week 9–10：产品化与 Eval

- Workbench 的 Plan、Trace、Approval、Artifact 和恢复 UI。
- Eval run/compare/report、30-Case Nightly。
- Gate：桌面端跑通完整主路径，CLI/UI 行为一致。

### Week 11–12：发布硬化

- Windows installer、SBOM、安全/恢复回归、三次稳定性评测。
- Threat model、README、贡献和诊断文档。
- Gate：通过发布门槛，陌生用户能按 README 独立跑通。

范围滑坡时依次裁掉：SWE-bench Adapter、受限联网 Profile、Trace 高级可视化和视觉打磨。不能裁掉 Tool Gateway、Sandbox 默认断网、Policy、参数哈希绑定 Approval、恢复、Eval、单写者和 PI Adapter。

## 14. 主要风险

| 风险 | 预案 |
|---|---|
| PI SDK 演进 | 精确锁版、隔离 Adapter、Upgrade Contract Suite |
| Sidecar 打包失败 | Week 1 Spike；Fallback 为随安装器捆绑 Node Runtime 与资源目录 |
| Windows/WSL 路径差异 | canonicalization Contract Suite；Broker 只接受容器内部规范路径 |
| Docker 安装门槛 | `nw doctor`、引导页、可复制诊断报告；无 Docker 只开放只读模式 |
| LLM 非确定性 | config hash、固定参数、逐 Case baseline、每周三次重复 |
| 30-Case 建设耗时 | Week 3 起持续添加；每个能力 PR 同时添加 Benchmark/Fault Case |
| Policy 漏洞 | deny-overrides、结构化 Capability、路径规范化、攻击 Case 和零 Host 副作用发布门槛 |

## 15. 验收定义

v0.1 只有在以下条件全部满足时可以发布：

1. Windows 新用户可安装、完成 `nw doctor` 并配置 BYOK 模型。
2. CLI 和 Workbench 都能完成黄金任务全流程。
3. 真实仓库默认不被 Agent 直接写入。
4. 所有副作用可在 Task Trace 中定位到 Policy、Approval 和 Sandbox Operation。
5. Runtime 进程在指定 fault injection 点退出后能恢复或安全停机。
6. Worker 深度、并发、权限和写租约限制可由自动测试证明。
7. 通过第 8.3 节所有发布门槛。
8. README、Threat Model、数据位置、删除方式和安全边界描述准确。

## 16. 参考资料

- [PI SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [PI 权限与容器化](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)
- [PI Sub-Agent 示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts)
- [PI 仓库与 MIT License](https://github.com/earendil-works/pi)
- [Tauri Node Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [OpenTelemetry GenAI Agent Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [SWE-bench Evaluation Harness](https://github.com/SWE-bench/SWE-bench/blob/main/docs/reference/harness.md)
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
