# NoNeedWork

NoNeedWork is a local-first, open-source software engineering agent for Windows. It
embeds the [PI agent harness](https://github.com/earendil-works/pi) and adds durable task
execution, mandatory tool mediation, Docker isolation, bounded sub-agents, traceable
approvals, and reproducible evaluations.

> Status: Phase 2's durable single-agent golden path is implemented. The CLI can drive a
> real PI `AgentSession` through planning, isolated edits, verification, restart recovery,
> and patch/trace artifact export. Phase 3 policy, approval, credential, and sandbox
> hardening is not implemented; do not use this repository to execute untrusted code yet.

## Product principles

- Local by default; no account is required.
- The real repository is not writable by the agent by default.
- Every side effect must pass policy, approval when required, sandbox, and trace.
- Unknown tool outcomes are verified or stopped; they are never silently replayed.
- Sub-agents are depth-one, budgeted, and cannot expand their permissions.

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

## Run the Phase 2 CLI

Build the Runtime and CLI, prepare the pinned sandbox image, and check the local
prerequisites:

```powershell
npm run build
docker build -t noneedwork/sandbox:0.1 images/sandbox
node apps/cli/dist/main.js doctor --json
```

Set one supported provider credential in the same terminal, then start and watch a task:

```powershell
$env:ANTHROPIC_API_KEY = "<your-key>"
node apps/cli/dist/main.js task start --repo C:\path\to\clean-repository "Fix the failing test" --json
node apps/cli/dist/main.js task watch <task-id>
node apps/cli/dist/main.js trace export <task-id> --output trace.json
```

The agent changes a copied sandbox workspace and exports a patch artifact; it does not
write the selected host repository. Phase 3 will add Windows Credential Manager storage,
policy decisions, one-shot approvals, and approved host patch application.

The approved design and executable implementation plan are available in
[`docs/superpowers/specs/2026-08-28-noneedwork-system-design.md`](docs/superpowers/specs/2026-08-28-noneedwork-system-design.md)
and [`plan/architecture-noneedwork-v0.1.md`](plan/architecture-noneedwork-v0.1.md).

## Security

PI and Docker do not make arbitrary agent execution safe by themselves. Review
[`SECURITY.md`](SECURITY.md) before experimenting. Report vulnerabilities privately as
described there.

## License

MIT
