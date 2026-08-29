# Qwen 与 MiniMax Token Plan

NoNeedWork v0.1 只开放两个固定的产品 Profile。模型清单来自锁定的 PI `0.84.3`
静态目录，不能由用户设置 Base URL、协议、请求头或任意 provider。

| Profile | PI provider | 协议 | 默认模型 |
| --- | --- | --- | --- |
| `qwen-cn` | `qwen-token-plan-cn` | OpenAI-compatible completions | `qwen3.7-plus` |
| `minimax-cn` | `minimax-cn` | Anthropic Messages | `MiniMax-M3` |

旧版阿里云 Coding Plan 接口和 endpoint 不受支持。Qwen 仅适配当前中国区 Token Plan
Profile；NoNeedWork 不提供旧 endpoint、自定义 endpoint 或自动迁移。

## 配置

先构建 Runtime/CLI 与固定沙箱镜像：

```powershell
npm run build
docker build -t noneedwork/sandbox:0.1 images/sandbox
node apps/cli/dist/main.js doctor
```

凭据只能通过交互式、无回显的终端提示写入 Windows Credential Manager：

```powershell
node apps/cli/dist/main.js model list
node apps/cli/dist/main.js model credential set qwen-cn
node apps/cli/dist/main.js model credential list
node apps/cli/dist/main.js model select qwen-cn qwen3.7-plus
```

MiniMax 使用 `minimax-cn` 和 `MiniMax-M3`。环境变量、命令行参数、重定向 stdin、PI
`auth.json`、PI `models.json`、SQLite 和普通文件都不是凭据来源。

删除凭据：

```powershell
node apps/cli/dist/main.js model credential delete qwen-cn
```

删除是幂等的，并阻止后续 provider 请求。已持久化的 TaskRun 模型绑定不会被改写；恢复
该任务前，需要重新配置同一个 Profile 的有效凭据。若凭据已泄漏，还应在供应商侧轮换或
撤销，因为本地删除不能撤回供应商已经接收的请求。

## TaskRun 绑定与恢复

创建 TaskRun 时，NoNeedWork 在同一数据库事务中持久化 Profile、PI provider、model、
PI SDK 版本与选择来源，然后才允许进入 `PREPARING` 或创建 Docker workspace。可以对
单个任务显式覆盖默认模型：

```powershell
node apps/cli/dist/main.js task start --repo C:\path\to\repository --model minimax-cn/MiniMax-M3 "Fix the failing test"
```

NoNeedWork 不会在 Qwen 与 MiniMax 之间自动 fallback，也不会自动替换 TaskRun 的绑定。
PI 自动重试在 v0.1 中关闭。凭据缺失、鉴权失败、限流、额度不足或临时不可用会生成脱敏
`modelBlock` 并在安全检查点暂停；恢复凭据或额度后，由用户显式 resume。协议错误与已有
部分输出后的未知结果需要人工检查，不能静默重放。

## 显式连接测试

下面的命令会消耗 Token Plan 额度。CLI 会再次要求确认；`--yes` 只适合用户已经明确
批准的自动化环境。

```powershell
node apps/cli/dist/main.js model test qwen-cn
```

探测只发送一个固定文本请求和一个固定的合成工具 schema，验证流式文本与 tool call
协议。它不打开项目、不创建 Docker、不创建 PI 可执行工具，也不会执行模型返回的工具
调用。

离线 provider 契约属于普通测试，真实探测默认跳过：

```powershell
npm run test:providers
$env:NONEEDWORK_LIVE_MODEL_TESTS = "1"
npm run test:providers
Remove-Item Env:NONEEDWORK_LIVE_MODEL_TESTS
```

启用真实测试仍只从 Windows Credential Manager 读取已配置凭据；仓库、命令参数、环境
变量和 CI secret 中都不保存 provider secret。

## 外部数据使用

模型请求在本机 Runtime 发出，并把任务提示、模型上下文及工具 schema 发送给所选供应
商；不要把不允许外发的数据放入任务。供应商的套餐、日志、保留和训练政策不由
NoNeedWork 控制，请在使用前阅读其最新文档：

- [阿里云百炼 Token Plan 概述](https://help.aliyun.com/zh/model-studio/token-plan-overview)
- [阿里云百炼编程工具接入](https://help.aliyun.com/zh/model-studio/more-tools)
- [MiniMax Token Plan 概要](https://platform.minimaxi.com/docs/token-plan/intro)
- [MiniMax 编程工具接入](https://platform.minimaxi.com/docs/token-plan/other-tools)

工具副作用与模型请求是不同边界：模型请求在 host Runtime；所有模型请求的文件和命令
副作用仍必须经过 Tool Gateway 与无网络 Docker sandbox。PI 内置 `bash`、`powershell`、
`edit` 和 `write` 永远不会暴露给 NoNeedWork 模型会话。
