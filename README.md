# NoNeedWork

NoNeedWork is a local-first, open-source software engineering agent for Windows. It
embeds the [PI agent harness](https://github.com/earendil-works/pi) and adds durable task
execution, mandatory tool mediation, Docker isolation, traceable state, and reproducible
evaluations.

> Status: the durable single-agent golden path and locked Qwen/MiniMax Token Plan model
> adapters are implemented. The repository is still pre-release development software; do
> not use it to execute malicious or multi-tenant workloads.

## Product principles

- Local by default; no account is required.
- The real repository is not writable by the agent by default.
- Every side effect must pass policy, approval when required, sandbox, and trace.
- Unknown tool outcomes are verified or stopped; they are never silently replayed.

## Current development prerequisites

- Windows 10/11 x64
- Node.js 24 and npm 11
- Git
- Docker Desktop with WSL2 backend for sandbox integration tests
- Rust toolchain for the Tauri desktop application

Run the checks available on your machine:

```powershell
npm ci
npm run ci
```

## Run the CLI

Build the Runtime and CLI, prepare the pinned sandbox image, and check the local
prerequisites:

```powershell
npm run build
docker build -t noneedwork/sandbox:0.1 images/sandbox
node apps/cli/dist/main.js doctor --json
```

List the two locked provider profiles, store a credential interactively in Windows
Credential Manager, select a model, then start and watch a task:

```powershell
node apps/cli/dist/main.js model list
node apps/cli/dist/main.js model credential set qwen-cn
node apps/cli/dist/main.js model select qwen-cn qwen3.7-plus
node apps/cli/dist/main.js task start --repo C:\path\to\clean-repository "Fix the failing test" --json
node apps/cli/dist/main.js task watch <task-id>
node apps/cli/dist/main.js trace export <task-id> --output trace.json
```

The credential prompt requires an interactive terminal and does not echo input. Environment
variables, PI `auth.json`, and PI `models.json` are not credential or model sources. To use
MiniMax, substitute `minimax-cn` and `MiniMax-M3`. See
[`docs/model-providers.md`](docs/model-providers.md) for setup, testing, recovery, and data-use
details.

The agent changes a copied sandbox workspace and exports a patch artifact; it does not
write the selected host repository. Model requests run in the host Runtime, while every
model-requested tool side effect remains behind Tool Gateway and the offline sandbox.

The approved design and executable implementation plan are available in
[`docs/superpowers/specs/2026-08-28-noneedwork-system-design.md`](docs/superpowers/specs/2026-08-28-noneedwork-system-design.md)
and [`plan/architecture-noneedwork-v0.1.md`](plan/architecture-noneedwork-v0.1.md).

## Security

PI and Docker do not make arbitrary agent execution safe by themselves. Review
[`SECURITY.md`](SECURITY.md) before experimenting. Report vulnerabilities privately as
described there.

## License

MIT
