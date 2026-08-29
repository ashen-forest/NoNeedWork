# NoNeedWork Qwen 与 MiniMax Token Plan 适配设计

- 日期：2026-08-29
- 状态：已批准
- 目标版本：v0.1 / Phase 3
- PI SDK：`@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` `0.84.3`

## 1. 背景

NoNeedWork 的 Phase 2 已实现基于 PI `AgentSession` 的耐久单智能体执行链、Docker
隔离工作区、工具网关、任务恢复和产物导出。当前真实模型路径仍依赖 PI 默认的
`auth.json`、`models.json` 和环境变量发现，Runtime 没有稳定的产品级模型配置、凭据
管理、模型运行快照和供应商错误语义。

本设计在 Phase 3 中增加阿里云百炼 Qwen Token Plan 中国区和 MiniMax Token Plan
中国区适配。两者都复用 PI `0.84.3` 已内置的 provider，不重新实现 OpenAI 或
Anthropic 流式协议。

官方接口与当前 PI provider 的对应关系如下：

| NoNeedWork Profile | PI Provider | 协议 | PI 内置 Base URL | 默认模型 |
| --- | --- | --- | --- | --- |
| `qwen-cn` | `qwen-token-plan-cn` | `openai-completions` | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `qwen3.7-plus` |
| `minimax-cn` | `minimax-cn` | `anthropic-messages` | `https://api.minimaxi.com/anthropic` | `MiniMax-M3` |

参考资料：

- [阿里云百炼接入更多编程工具](https://help.aliyun.com/zh/model-studio/more-tools)
- [阿里云百炼 Token Plan 概述](https://help.aliyun.com/zh/model-studio/token-plan-overview)
- [MiniMax Token Plan 概要](https://platform.minimaxi.com/docs/token-plan/intro)
- [MiniMax 其他编程工具接入](https://platform.minimaxi.com/docs/token-plan/other-tools)

供应商会更新模型和套餐规则。NoNeedWork 的发布包以锁定的 PI 版本及其静态模型目录
为准；升级 PI 时必须重新运行 provider 合约测试并更新本规范，而不是在运行时静默
下载未知模型配置。

## 2. 目标

1. 为产品层提供稳定的 `qwen-cn` 和 `minimax-cn` Profile，不向 Runtime 泄漏 PI
   provider 类型。
2. 使用 PI 原生 provider、消息转换、流式输出、工具调用和认证接缝。
3. 将供应商密钥保存在 Windows Credential Manager，仅在任务生命周期内注入 PI
   `ModelRuntime` 内存。
4. 在 TaskRun 发起任何模型请求前固化 provider、模型和 PI SDK 版本，以支持恢复、
   评测和审计。
5. 为套餐耗尽、鉴权失败、限流、模型下线、部分输出后断流等情况提供可恢复且不静默
   重放的错误语义。
6. 建立离线 provider 合约测试和用户显式触发的本地真实连接测试。

## 3. 非目标

本次不实现：

- 自动跨供应商或跨模型故障切换；
- 任意自定义 Base URL、Header、API 协议或代理；
- 云端账号、云端凭据同步或多用户认证；
- 将个人 Token Plan 密钥放入 GitHub Actions；
- 运行时远程模型目录刷新；
- 完整 Eval Harness、多智能体、RAG、长期记忆或递归 Agent；
- 阿里云旧版 Coding Plan `coding.dashscope.aliyuncs.com` provider。

网络下载仍可由开发者在终端显式配置代理；模型 provider 配置本身不新增任意代理
入口。

## 4. 方案选择

### 4.1 采用的方案：NoNeedWork Profile 薄层

NoNeedWork 定义稳定、有限的 Profile，并在 `packages/pi-adapter` 内映射到 PI 内置
provider。Runtime 只处理 NoNeedWork Schema 和错误类型。

该方案在复用 PI 成熟工程实践的同时，为凭据、任务快照、评测和 UI 提供稳定边界。

### 4.2 未采用：Runtime 直接使用 PI provider

改动更少，但会让 Runtime、数据库、API 和评测直接依赖 PI provider/model 类型及
命名，PI 升级时影响面过大。

### 4.3 未采用：自行实现兼容 provider

自行维护 OpenAI/Anthropic 流式协议、thinking、工具调用和错误转换会重复 PI 已完成
的工作，并扩大安全和兼容测试面。

## 5. 架构与模块边界

调用链为：

```text
CLI / Desktop
  -> Runtime Model API
  -> ModelService
  -> CredentialService
  -> packages/pi-adapter
  -> PI ModelRuntime / AgentSession
  -> Qwen Token Plan 或 MiniMax Token Plan
```

### 5.1 `packages/protocol`

新增非秘密的公共 Schema：

- `modelProfileIdSchema`：仅允许 `qwen-cn`、`minimax-cn`；
- `modelSelectionSchema`：`profileId`、`modelId`；
- `modelProfileSchema`：显示名、默认模型、可选模型和能力；
- `modelCredentialStatusSchema`：是否已配置及更新时间；
- `modelProbeResultSchema`：成功状态、延迟、协议能力和脱敏错误；
- `taskModelBindingSchema`：TaskRun 固化的模型身份。

持久化 DTO、响应 DTO 和事件 DTO 不包含密钥。设置密钥的写入请求必须在进程边界使用
Zod 校验，但它是 write-only 输入：不进入响应、OpenAPI 示例、日志、事件或持久化
对象。

### 5.2 `apps/runtime/src/modules/models`

新增模块：

- `model-profile.ts`：静态 Profile 定义；
- `model-selection.ts`：选择和默认值解析；
- `model-service.ts`：查询、选择、预检和 probe 编排；
- `model-errors.ts`：供应商错误分类；
- `model-binding-repository.ts`：TaskRun 模型快照；
- `model-preference-repository.ts`：本地默认模型选择。

Profile 只暴露 NoNeedWork 标识。PI provider ID 映射由 Adapter 持有，Runtime 不导入
任何 PI 包。

模型列表来自锁定 PI 版本随包发布的静态目录。`allowModelNetwork` 和 create-time
refresh 必须关闭。用户只能选择指定 Profile 下 PI 静态目录中存在的模型，不能提交
任意 provider、模型元数据或 Base URL。

### 5.3 `apps/runtime/src/modules/credentials`

新增：

- `credential-vault.ts`：产品接口；
- `keyring.ts`：基于 `@napi-rs/keyring@1.3.0` 的 Windows 实现；
- `model-credentials.ts`：Profile 与 PI provider 凭据槽映射；
- `fake-credential-vault.ts`：测试实现。

Windows Credential Manager 条目使用：

```text
service: NoNeedWork/model-provider
account: qwen-cn | minimax-cn
value: {"schemaVersion":1,"secret":"...","updatedAt":"ISO-8601"}
```

Keyring value 是经过 Zod 校验的版本化秘密 envelope，整体只保存在 Credential
Manager 中；其中的 `updatedAt` 用于生成状态，SQLite 不保存该 envelope。`list` 只返回
非秘密元数据。密钥设置使用覆盖写；删除操作可重复执行。Keyring 错误必须被包装为
稳定的 NoNeedWork 错误，禁止在消息中包含原始密钥或 keyring 原始对象。

### 5.4 `packages/pi-adapter`

新增产品级工厂，例如：

```ts
createNoNeedWorkModelRuntime({ profileId, modelId, credential })
```

具体实现只能存在于此包，并执行：

1. 将 `qwen-cn` 映射到 `qwen-token-plan-cn`，或将 `minimax-cn` 映射到
   `minimax-cn`；
2. 使用 PI `InMemoryCredentialStore` 创建任务专属 `ModelRuntime`；
3. 设置 `modelsPath: null`、`allowModelNetwork: false`、`refreshOnCreate: false`；
4. 通过 `setRuntimeApiKey()` 写入非持久化覆盖；
5. 使用 `getModel()` 解析固定模型；
6. 返回 Adapter 自己的 opaque handle、模型身份和 dispose 操作；
7. dispose 时调用 `removeRuntimeApiKey()` 并释放引用。

产品路径不再给 PI `ModelRuntime` 传递 `authPath`，也不创建或读取 `auth.json`。无
Credential Manager 密钥时，ModelService 必须在调用 Adapter 前失败，不能回退到
PI 的环境变量发现。测试 seam 可显式注入假凭据，但生产 Runtime 不使用环境变量作为
凭据来源。

`createNoNeedWorkSession()` 继续执行封闭工具集断言，PI 内置 `bash`、`powershell`、
`edit` 和 `write` 始终不可见。

### 5.5 Task 执行接入

Task 创建请求允许一个可选的 `model` 选择；缺省时使用本地默认选择。TaskRun 创建
事务必须同时写入模型绑定，之后才能进入 `PREPARING` 或创建 Docker sandbox。

`PiTaskDriver` 接收 Adapter 生成的任务专属模型 handle，不负责读取 Credential
Manager，也不持有持久化凭据接口。

## 6. 数据模型

新增 migration `002-model-provider-bindings.ts`，创建两个表。

### 6.1 `model_preferences`

```text
id              TEXT PRIMARY KEY CHECK (id = 'default')
profile_id      TEXT NOT NULL
model_id        TEXT NOT NULL
updated_at      TEXT NOT NULL
```

该表只保存单用户本地默认选择。

### 6.2 `task_run_models`

```text
run_id              TEXT PRIMARY KEY REFERENCES task_runs(id)
profile_id          TEXT NOT NULL
pi_provider_id      TEXT NOT NULL
model_id            TEXT NOT NULL
pi_sdk_version      TEXT NOT NULL
selection_source    TEXT NOT NULL CHECK (selection_source IN ('default', 'task_override'))
created_at          TEXT NOT NULL
```

密钥、Base URL 和 Header 不在数据库中。读取行时通过 Zod Schema 校验。TaskRun 一旦
离开 `CREATED`，绑定不可修改。

## 7. Runtime API 与 CLI

所有端点继续绑定 loopback，并使用现有 Runtime local-auth token。

### 7.1 Runtime API

- `GET /v1/models/profiles`：静态 Profile 和 PI 静态模型目录；
- `GET /v1/models/selection`：当前默认选择；
- `PUT /v1/models/selection`：更新默认选择；
- `GET /v1/models/credentials`：非秘密状态；
- `PUT /v1/models/credentials/:profileId`：write-only 密钥写入；
- `DELETE /v1/models/credentials/:profileId`：删除；
- `POST /v1/models/probe/:profileId`：用户显式发起真实连接测试。

凭据写入端点禁用请求体日志。全局日志 redactor 在异常进入日志前使用任务当前密钥做
精确替换。Fastify 错误对象、headers、请求体和 PI Runtime 对象均不得直接序列化。

### 7.2 CLI

```powershell
nw model list
nw model credential set qwen-cn
nw model credential set minimax-cn
nw model credential list
nw model credential delete <profile-id>
nw model select <profile-id> <model-id>
nw model test <profile-id>
```

`credential set` 使用隐藏输入，不接受位置参数、命令选项或 stdin 管道中的明文密钥，
避免 PowerShell 历史、进程列表和脚本日志泄漏。自动化测试通过依赖注入提供 secret
reader，不调用真实交互终端。

`model test` 会明确提示它将消耗套餐额度。它不挂载项目、不创建 Docker，也不创建或
执行任何 PI `ToolDefinition`。Adapter 直接通过任务专属 `ModelRuntime` 做两个有界
协议 probe：一个验证流式文本，另一个在请求中提供 synthetic tool schema 并验证上游
返回的 tool-call 结构，但不执行该调用。输出只包含能力和延迟摘要。

### 7.3 Doctor

`nw doctor` 增加：

- 默认 Profile 和模型是否可由当前 PI 静态目录解析；
- Qwen/MiniMax Credential Manager 配置状态；
- 不再把环境变量存在视为生产凭据就绪。

Docker Desktop 正常但 `noneedwork/sandbox:0.1` 缺失时仍给出：

```powershell
docker build -t noneedwork/sandbox:0.1 images/sandbox
```

## 8. 凭据生命周期与安全边界

1. CLI 通过隐藏输入取得密钥，并通过本地鉴权 API 发送给 Runtime；
2. Runtime Zod 校验后立即写入 Credential Manager；
3. TaskRun 启动时由 CredentialService 读取一次；
4. Adapter 将密钥注入任务专属 PI Runtime 内存；
5. TaskRun 结束、失败、暂停后的 session 释放或取消时清除 runtime override；
6. 进程重启后只从 Credential Manager 重新读取，不从 TaskRun、PI session 或
   `auth.json` 恢复。

安全约束：

- 密钥不进入 SQLite、日志、事件、trace、artifact、PI session 文件或 Docker；
- 不把当前供应商密钥前缀作为永久的硬校验，只校验 trim 后非空和合理长度；
- 不把密钥传给 sandbox 创建参数、环境变量或命令参数；
- v0.1 不允许自定义 endpoint，从而避免 SSRF 和凭据误投；
- Credential Manager 删除或轮换影响新 TaskRun；已启动任务保留启动快照。若需立即
  阻断，用户先取消任务，再删除凭据；
- 容器检查测试必须搜索环境变量名和随机哨兵密钥的完整值。

## 9. 模型选择、运行与恢复

### 9.1 固定模型语义

同一 TaskRun 内模型绑定不可变化。进程恢复必须重新解析相同的 Profile、PI provider、
model ID 和 PI SDK 版本。

模型不再可用时进入 `PAUSED`，不静默更换模型。若用户希望换模型，应创建新的
TaskRun 并保留旧运行记录。

### 9.2 错误分类

| 原因 | Task 状态 | 自动重试 |
| --- | --- | --- |
| `MODEL_CREDENTIAL_MISSING` | `PAUSED` | 否 |
| `MODEL_AUTH_REJECTED` | `PAUSED` | 否 |
| `MODEL_QUOTA_EXHAUSTED` | `PAUSED` | 否 |
| `MODEL_RATE_LIMITED` | `PAUSED` | 仅满足安全条件时 |
| `MODEL_TEMPORARILY_UNAVAILABLE` | `PAUSED` | 仅满足安全条件时 |
| `MODEL_UNAVAILABLE` | `PAUSED` | 否 |
| `MODEL_PROTOCOL_ERROR` | `FAILED` | 否 |
| `UNKNOWN_MODEL_OUTCOME` | `PAUSED` | 否 |

`PAUSED` 的 DIAGNOSTIC 事件必须包含结构化、非秘密的 `modelBlock`：原因、Profile、
model ID、是否可恢复、建议动作以及可选的 `retryAfterMs`。恢复目标状态使用当前
TaskService 已支持的 resume checkpoint 语义。

### 9.3 重试与未知结果

- 401、403、套餐耗尽和模型不存在不重试；
- 429 或临时网络失败只有在尚未观察到文本、thinking、tool call 或其他模型输出时，
  才能遵循 `Retry-After` 重试；
- 最多重试两次，且等待和请求时间均计入 Task wall-clock budget；
- 收到任何部分输出后断流时进入 `UNKNOWN_MODEL_OUTCOME`，禁止自动重放；
- 不在 Qwen 与 MiniMax 间自动切换。

实现前必须用 PI Adapter Contract 测试确认 PI 内部 retry 满足上述规则。在合约尚未
证明“部分输出后不重放”之前，真实 provider session 的自动 retry 保持关闭。不能仅
根据对 PI 实现的假设放开重试。

## 10. 测试策略

### 10.1 离线 CI

使用本地 fake HTTP provider 或 PI fake seam，覆盖：

- Qwen OpenAI-compatible 流式文本、thinking 和 tool call；
- MiniMax Anthropic-compatible 流式文本、thinking 和 tool call；
- 401、403、429、超时、套餐耗尽、模型不存在、非法帧和半截流；
- 部分输出后不重放；
- Profile 到 PI provider/model 的映射；
- TaskRun 绑定的创建、不可变性和进程重启恢复；
- Keyring set/list/delete、并发修改和底层失败；
- API/CLI Schema、隐藏输入和响应脱敏；
- SQLite、日志、PI session、artifact、trace 和 Docker inspect 中不存在随机哨兵密钥；
- PI `bash`、`powershell`、`edit`、`write` 继续不可见；
- 每个新增状态转换、错误分类、恢复行为和安全边界。

### 10.2 本地真实 provider 测试

真实测试默认跳过，只有用户显式设置以下开关时运行：

```powershell
$env:NONEEDWORK_LIVE_MODEL_TESTS = "1"
npm run test:providers
```

真实密钥仍从 Credential Manager 读取，不从 CI secret、环境变量或测试参数读取。
测试输出是脱敏报告；无开关或无凭据时必须明确显示 `skipped`，不能伪装为通过。

### 10.3 Docker 验证

适配实现完成后构建固定镜像并运行 sandbox 集成测试：

```powershell
docker build -t noneedwork/sandbox:0.1 images/sandbox
npm run test:integration
```

真实 model probe 不进入 Docker；模型请求在 host Runtime 发出，工具副作用仍必须经过
Tool Gateway 和 SandboxProvider。

## 11. 评测衔接

本次只建立 Eval Harness 需要的稳定模型身份和 TaskRun 快照。后续 Eval 阶段可对同一
benchmark 分别运行：

```text
qwen-cn/qwen3.7-plus
minimax-cn/MiniMax-M3
```

报告维度包括 provider、模型、PI SDK 版本、任务成功率、工具调用正确率、重试次数、
未知结果次数、延迟和 Token 使用。模型目录更新或 PI 升级不得覆盖既有评测记录中的
模型身份。

## 12. 实施顺序

1. Protocol Schema 和 migration；
2. 静态 Profile、选择服务和 repositories；
3. Credential Vault、fake keyring 及安全测试；
4. PI Adapter 任务专属 Runtime 和映射合约；
5. TaskRun 创建、恢复和错误分类接入；
6. Runtime API、client SDK 和 CLI；
7. Doctor、离线 provider 合约与泄漏测试；
8. Docker 镜像及完整 CI；
9. 用户接入真实密钥后运行显式 live probe。

每一步都必须保持仓库构建、类型检查和既有测试通过。任何步骤都不能提前开放任意
endpoint、将凭据传入 Docker，或暴露 PI 内置宿主工具。

## 13. 验收标准

1. `qwen-cn/qwen3.7-plus` 和 `minimax-cn/MiniMax-M3` 能被锁定 PI 静态目录解析；
2. 无真实密钥时所有离线 CI 可通过，live tests 明确跳过；
3. 设置凭据后，`nw model test` 能完成流式文本和无副作用工具调用 probe；
4. TaskRun 在模型请求前持久化不可变模型绑定；
5. 重启后使用同一模型恢复，模型或凭据缺失时进入结构化 `PAUSED`；
6. 已有部分输出的失败不会被自动重放；
7. SQLite、日志、事件、session、artifact、trace 和 Docker inspect 不包含哨兵密钥；
8. PI 内置 `bash`、`powershell`、`edit`、`write` 仍不可见；
9. `npm run ci` 和 Docker integration tests 全部通过；
10. 公共 GitHub Actions 不包含个人 Token Plan 凭据。
