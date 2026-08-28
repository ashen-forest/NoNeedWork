# NoNeedWork

NoNeedWork is a local-first, open-source software engineering agent for Windows. It
embeds the [PI agent harness](https://github.com/earendil-works/pi) and adds durable task
execution, mandatory tool mediation, Docker isolation, bounded sub-agents, traceable
approvals, and reproducible evaluations.

> Status: architecture and Phase 1 foundation are in progress. Do not use this repository
> to execute untrusted code yet.

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

The approved design and executable implementation plan are available in
[`docs/superpowers/specs/2026-08-28-noneedwork-system-design.md`](docs/superpowers/specs/2026-08-28-noneedwork-system-design.md)
and [`plan/architecture-noneedwork-v0.1.md`](plan/architecture-noneedwork-v0.1.md).

## Security

PI and Docker do not make arbitrary agent execution safe by themselves. Review
[`SECURITY.md`](SECURITY.md) before experimenting. Report vulnerabilities privately as
described there.

## License

MIT
