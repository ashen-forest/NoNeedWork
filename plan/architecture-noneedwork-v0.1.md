---
goal: Build and release NoNeedWork v0.1 as a local-first, PI-based software engineering agent for Windows
version: 1.0
date_created: 2026-08-28
last_updated: 2026-08-28
owner: ashen-forest
status: 'Planned'
tags: [architecture, agent, pi, sandbox, evaluation, multi-agent, tauri, windows]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements the approved NoNeedWork v0.1 system specification as an npm-workspaces monorepo. The release will provide one Node.js runtime, one CLI, one Tauri desktop client, Docker-based task isolation, durable task execution, mandatory tool mediation, bounded sub-agents, normalized traces, and a reproducible evaluation harness. Every phase ends with automated acceptance criteria and produces a runnable increment.

## 1. Requirements & Constraints

- **REQ-001**: The v0.1 golden path MUST read a Git repository, create a plan, modify an isolated workspace, run tests, verify results, export a patch, and apply that patch only after explicit approval.
- **REQ-002**: `apps/cli` and `apps/desktop` MUST use the same `apps/runtime` Local API and MUST NOT contain independent agent business logic.
- **REQ-003**: `packages/pi-adapter` MUST be the only package that imports `@earendil-works/pi-coding-agent@0.84.3`.
- **REQ-004**: Runtime state MUST persist in SQLite and MUST recover or stop safely after process interruption.
- **REQ-005**: Every side-effecting capability MUST pass through schema validation, resource canonicalization, policy evaluation, approval when required, budget enforcement, sandbox dispatch, and trace recording.
- **REQ-006**: The default execution profile MUST use an isolated Docker workspace and MUST NOT write directly to the selected host repository.
- **REQ-007**: The model provider credential MUST remain in the host runtime and MUST NOT enter task containers, logs, traces, or SQLite.
- **REQ-008**: The Supervisor MAY create Explorer, Implementer, and Verifier workers through `delegate_task`; worker depth MUST equal one and concurrent workers MUST NOT exceed three.
- **REQ-009**: One task workspace MUST have at most one active writer lease.
- **REQ-010**: NoNeedWorkBench MUST contain 30 versioned repository cases before v0.1 release.
- **REQ-011**: The release MUST include CLI, Workbench, Windows installer, threat model, SBOM, and reproducible CI workflows.
- **SEC-001**: PI built-in `bash`, `edit`, and `write` tools MUST NOT be exposed to model sessions.
- **SEC-002**: User-global and project PI extensions MUST NOT be auto-loaded in safe mode.
- **SEC-003**: Sandbox containers MUST run non-root with all Linux capabilities dropped, `no-new-privileges`, read-only root filesystem, default seccomp, no Docker socket, and explicit CPU, memory, PID, disk, and time limits.
- **SEC-004**: Sandbox networking MUST default to disabled. Any network profile MUST require approval and route through an allow-listing egress proxy.
- **SEC-005**: Approval tokens MUST be one-shot, expiring, and bound to task ID, step ID, capability, canonical resource, and parameter or patch hash.
- **SEC-006**: A sub-agent capability set MUST be the intersection of the parent grant, role policy, and current step budget.
- **SEC-007**: Local API MUST bind loopback only, require a per-launch bearer token, validate Origin, and version its wire protocol.
- **SEC-008**: Unauthorized host side effects MUST remain zero in all release security cases.
- **CON-001**: v0.1 MUST target Windows 10/11 x64 with Docker Desktop WSL2 backend.
- **CON-002**: v0.1 MUST remain local-only and MUST NOT implement accounts, cloud sync, billing, teams, or remote jobs.
- **CON-003**: Runtime MUST use Node.js 24 LTS and TypeScript strict mode.
- **CON-004**: Storage MUST use `node:sqlite` with prepared SQL and forward-only migrations; an ORM MUST NOT be introduced.
- **CON-005**: The repository MUST use npm workspaces and commit `package-lock.json`.
- **CON-006**: The implementation MUST remain a modular monolith; runtime modules MUST NOT be split into microservices.
- **CON-007**: Workbench MUST use React, Vite, and Tauri 2.
- **CON-008**: Arbitrary shell effects cannot be made exactly-once. Unknown outcomes MUST be verified or require user intervention and MUST NOT be silently replayed.
- **GUD-001**: Prefer deterministic graders over LLM-as-Judge. An LLM judge MUST NOT override a deterministic failure.
- **GUD-002**: Store large payloads in the content-addressed artifact store and keep only hashes, metadata, and references in normalized traces.
- **GUD-003**: Add a benchmark or fault case with every new runtime, policy, sandbox, or recovery capability.
- **PAT-001**: External dependencies MUST be wrapped behind narrow adapters and pinned to exact versions.
- **PAT-002**: State transitions MUST use compare-and-swap on `state_version` and append a corresponding `run_events` record in the same transaction.
- **PAT-003**: Side effects MUST use the sequence `INTENT -> POLICY_DECISION -> APPROVAL -> OPERATION_STARTED -> OPERATION_FINISHED -> CHECKPOINT`.

## 2. Implementation Steps

### Implementation Phase 1: Repository Foundation and Packaging Risk Spikes

- GOAL-001: Produce a buildable monorepo where a packaged Windows runtime embeds PI, starts through Tauri as a sidecar, and executes a read-only custom tool inside Docker without exposing host credentials.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create root `package.json`, `package-lock.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `biome.json`, `.editorconfig`, `.npmrc`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `AGENTS.md`. Define npm workspaces for `apps/*` and `packages/*`; set Node engine to `>=24.9 <25`; add `build`, `check`, `test`, `test:integration`, and `ci` scripts. | | |
| TASK-002 | Create `packages/protocol/src/index.ts` and schemas in `packages/protocol/src/{ids,errors,events,tasks,approvals,artifacts}.ts`. Export protocol version `1`, UUIDv7-branded identifiers, error envelopes, task snapshots, and cursor-based event envelopes. Add `packages/protocol/src/*.test.ts` round-trip and invalid-input tests. Depends on TASK-001. | | |
| TASK-003 | Create `packages/pi-adapter/src/index.ts`, `create-session.ts`, `pi-events.ts`, `resource-loader.ts`, and `types.ts`. Implement `createNoNeedWorkSession()` using only bundled resource factories, accept an explicit custom-tool list, disable implicit extension discovery, normalize PI events, and expose session create/resume/subscribe/prompt/steer/cancel operations. Add Adapter Contract tests with a fake model and assert that built-in `bash`, `edit`, and `write` are absent. Depends on TASK-001. | | |
| TASK-004 | Create `apps/runtime/src/main.ts`, `app.ts`, `config.ts`, `api/health.ts`, `api/handshake.ts`, and `security/local-auth.ts`. Start Fastify on loopback random port, generate a 256-bit launch token, emit a one-line JSON startup handshake, enforce bearer token and Origin policy, and expose `/v1/health`. Depends on TASK-002. | | |
| TASK-005 | Create `apps/runtime/src/modules/sandbox/docker-client.ts`, `docker-provider.ts`, `sandbox-profile.ts`, and `path-mapper.ts`; create `images/sandbox/Dockerfile`, `images/sandbox/entrypoint.sh`, and `images/sandbox/image-lock.json`. Implement Docker health detection, an offline non-root read-only sandbox profile, copied fixture workspace creation, read/list command execution, resource limits, and artifact download. Depends on TASK-001. | | |
| TASK-006 | Create `apps/runtime/src/modules/tools/tool-gateway.ts`, `tool-context.ts`, `tool-result.ts`, and bundled read-only tools in `apps/runtime/src/modules/tools/builtin/{read-file,list-files,search-text}.ts`. Route every tool through a typed dispatcher and DockerProvider; reject host paths after canonicalization. Add Docker integration tests proving reads occur from the copied workspace. Depends on TASK-003 and TASK-005. | | |
| TASK-007 | Create `apps/cli/src/main.ts`, `commands/doctor.ts`, `commands/runtime.ts`, and `client/runtime-discovery.ts`. Implement `nw doctor` checks for Node, Git, Docker Desktop, WSL2, sandbox image, writable app data, and model credential availability; output both human and `--json` formats. Depends on TASK-004 and TASK-005. | | |
| TASK-008 | Create `apps/desktop` with React/Vite/Tauri 2, `src-tauri/src/lib.rs`, `src-tauri/capabilities/main.json`, and `src-tauri/tauri.conf.json`. Grant the WebView only the sidecar launch and window/event permissions required by the app. Launch `nw-runtime` as `externalBin`, parse the handshake in Rust, and pass an opaque connection handle to the WebView. Depends on TASK-004. | | |
| TASK-009 | Create `scripts/build-runtime-sidecar.mjs` and `scripts/verify-sidecar.mjs`. Package the compiled runtime plus PI resources into a self-contained Windows sidecar. If single-file packaging fails Adapter Contract tests, implement the approved fallback that bundles Node runtime and compiled resources as a Tauri resource directory. Record the decision in `docs/adr/0001-runtime-sidecar-packaging.md`. Depends on TASK-003, TASK-004, and TASK-008. | | |
| TASK-010 | Create `.github/workflows/ci.yml`, `.github/workflows/security.yml`, and `.github/dependabot.yml`. CI MUST run install with lockfile, typecheck, Biome, unit tests, protocol tests, build, and non-Docker smoke on Windows and Ubuntu. Security workflow MUST run CodeQL, dependency review, secret scan, and SBOM generation. Depends on TASK-001. | | |

Phase 1 completion criteria: `npm run ci` passes; `nw doctor --json` reports actionable states; Tauri starts the packaged runtime; a fake-model PI session calls only NoNeedWork read-only tools; a Docker integration test reads a fixture repository; model credentials are absent from container inspection output.

### Implementation Phase 2: Durable Single-Agent Golden Path

- GOAL-002: Implement the complete CLI golden path with durable TaskRun state, isolated code changes, verification, patch artifact production, and restart recovery.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Create forward-only SQL migrations under `apps/runtime/src/modules/storage/migrations/` for `schema_meta`, `projects`, `tasks`, `task_runs`, `plan_steps`, `run_events`, `tool_operations`, `approvals`, `sandboxes`, `worker_runs`, `artifacts`, `eval_runs`, and `eval_results`. Create `database.ts`, `migrator.ts`, and `backup.ts`; enable WAL, foreign keys, defensive mode, and busy timeout. Add migration/rollback-refusal/backup tests. Depends on TASK-001. | | |
| TASK-012 | Create repositories in `apps/runtime/src/modules/storage/repositories/` for every core table. Implement UUIDv7 generation, UTC timestamps, Zod parsing for JSON columns, compare-and-swap TaskRun transitions, monotonically increasing event sequence, and transaction-scoped event append. Depends on TASK-002 and TASK-011. | | |
| TASK-013 | Create `apps/runtime/src/modules/tasks/task-state-machine.ts`, `step-state-machine.ts`, `task-service.ts`, `run-lease.ts`, `checkpoint-service.ts`, and `recovery-service.ts`. Implement approved states, budgets, lease acquisition/renewal, stable checkpoints, startup scan, expired-lease recovery, and idempotent cancellation. Add exhaustive transition-table tests. Depends on TASK-012. | | |
| TASK-014 | Create `apps/runtime/src/modules/artifacts/artifact-store.ts`, `artifact-repository.ts`, `hash.ts`, and `gc.ts`. Store bytes under `%LOCALAPPDATA%/NoNeedWork/artifacts/sha256/<prefix>/<hash>`, fsync before metadata commit, validate hashes on read, and delay GC until all references are removed. Depends on TASK-012. | | |
| TASK-015 | Create `apps/runtime/src/modules/planning/plan-schema.ts`, `plan-parser.ts`, `plan-service.ts`, and `step-verifier.ts`. Require the Planner to return a structured acyclic plan with objectives, dependencies, acceptance criteria, allowed paths, write requirement, and verification commands. Reject cyclic, empty, or over-budget plans before execution. Depends on TASK-003 and TASK-013. | | |
| TASK-016 | Add sandbox write and command tools in `apps/runtime/src/modules/tools/builtin/{write-file,apply-edit,run-command,git-diff}.ts`. All tools MUST operate inside the task workspace, enforce output limits and command timeouts, and persist operation intent/result artifacts before returning observations to PI. Depends on TASK-006, TASK-013, and TASK-014. | | |
| TASK-017 | Create `apps/runtime/src/modules/tasks/task-orchestrator.ts` with `prepareRun()`, `planRun()`, `executeReadyStep()`, `verifyRun()`, `replanRun()`, and `finishRun()`. Enforce at most two replans and produce `changes.patch`, `test-results.json`, `trace-summary.json`, and unresolved-items artifacts. Depends on TASK-013, TASK-015, and TASK-016. | | |
| TASK-018 | Create Runtime endpoints in `apps/runtime/src/api/{projects,tasks,events,artifacts}.ts`: open project, create task, get snapshot, pause/resume/cancel, stream events with cursor, download artifact, and replay from snapshot when cursor expires. Generate typed client methods in `packages/client-sdk/src/`. Depends on TASK-002 and TASK-017. | | |
| TASK-019 | Implement CLI commands in `apps/cli/src/commands/{project,task,artifact,trace}.ts`: `nw task start/watch/pause/resume/cancel`, `nw artifact get`, and redacted `nw trace export`. CLI MUST start or discover the runtime and never instantiate PI directly. Depends on TASK-018. | | |
| TASK-020 | Add five golden fixtures under `benchmarks/fixtures/` and cases under `benchmarks/cases/golden-*`. Add `apps/runtime/test/golden-path.integration.test.ts` that runs a deterministic fake model through plan, edit, test, patch export, process restart, session resume, and finish. Depends on TASK-017 and TASK-019. | | |

Phase 2 completion criteria: a clean Windows checkout completes one fixture through CLI; process termination after a stable checkpoint resumes without duplicate writes; output patch applies to a fresh fixture and tests pass; all five deterministic golden cases pass.

### Implementation Phase 3: Policy, Approval, Credential, and Sandbox Hardening

- GOAL-003: Ensure no side effect bypasses policy, no unapproved patch reaches the host repository, and injected failures recover or stop safely.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Create `apps/runtime/src/modules/policy/{policy-schema,policy-loader,policy-engine,policy-explanation,default-policy}.ts`. Implement versioned JSON rules, deny-overrides, principal/role/capability/resource/phase/risk matching, canonical resource inputs, and deterministic explanations. Add policy decision-table and mutation tests. Depends on TASK-002. | | |
| TASK-022 | Create `apps/runtime/src/modules/approvals/{approval-service,approval-token,approval-expiry}.ts` and API `apps/runtime/src/api/approvals.ts`. Implement one-shot tokens bound to task, step, capability, resource hash, params hash, expiry, nonce, and consumed timestamp. Parameter changes MUST invalidate existing approval. Depends on TASK-012 and TASK-021. | | |
| TASK-023 | Refactor `tool-gateway.ts` so no dispatcher path can call DockerProvider before schema validation, canonicalization, policy, approval, and budget checks. Persist every decision and operation state. Add tests that monkey-patch tool implementations and prove mediation cannot be skipped. Depends on TASK-016, TASK-021, and TASK-022. | | |
| TASK-024 | Create `apps/runtime/src/modules/credentials/keyring.ts` using `@napi-rs/keyring@1.3.0`, `model-credentials.ts`, and CLI `apps/cli/src/commands/model.ts`. Store provider secrets in Windows Credential Manager, return secrets only to PI ModelRuntime in memory, and provide set/list/delete operations that never echo secret values. Add fake-keyring tests and container inspection tests. Depends on TASK-003. | | |
| TASK-025 | Harden `sandbox-profile.ts` with non-root UID/GID, `cap-drop ALL`, no-new-privileges, read-only rootfs, tmpfs, default seccomp, no Docker socket, no host namespaces, 2 CPU, 4 GiB RAM, 256 PID, 10 GiB workspace quota, and command/task deadlines. Add `apps/runtime/test/sandbox-hardening.integration.test.ts` that inspects the container and attempts prohibited operations. Depends on TASK-005. | | |
| TASK-026 | Create `apps/runtime/src/modules/sandbox/egress/{proxy,allowlist,network-profile}.ts` and `images/egress-proxy/`. Implement an opt-in approved network profile that only permits configured DNS names through a CONNECT-aware proxy and rejects direct IP egress. Keep offline as the default. Add integration tests using permitted and denied endpoints. Depends on TASK-022 and TASK-025. | | |
| TASK-027 | Create `apps/runtime/src/modules/workspace/{workspace-copy,patch-export,patch-apply,host-repository}.ts`. Copy/clone without hardlinks, reject symlink/junction escapes, export deterministic unified patches, and require approval bound to patch hash before host application. Verify host clean-state precondition and use `git apply --check` before applying. Depends on TASK-014, TASK-022, and TASK-025. | | |
| TASK-028 | Create `apps/runtime/src/modules/tasks/fault-injector.ts` behind test-only configuration. Add 30 deterministic injection points across intent, approval, operation start, operation finish, PI observation, artifact persist, checkpoint, and lease renewal. Verify recovery or safe terminal state and no silent operation replay. Depends on TASK-013, TASK-023, and TASK-027. | | |
| TASK-029 | Add 10 benchmark cases under `benchmarks/cases/`, including three security cases for traversal, prompt-injected host write, and unauthorized network. Create `benchmarks/graders/security-audit.ts` that fails on any unauthorized host effect or missing policy/operation trace link. Depends on TASK-023 and TASK-027. | | |
| TASK-030 | Implement CLI approval commands `nw approval show/approve/deny` and extend Workbench protocol events for approval requested/resolved/expired. Add integration tests for approval timeout, replay, changed parameters, patch-hash mismatch, and sub-agent self-approval rejection. Depends on TASK-018 and TASK-022. | | |

Phase 3 completion criteria: security suite reports zero unauthorized host effects; all sandbox hardening assertions pass; 30 fault points recover or stop safely; host patch application always requires a matching unconsumed approval token.

### Implementation Phase 4: Bounded Multi-Agent Coordination and Normalized Trace

- GOAL-004: Implement auditable depth-one delegation with capability narrowing, a global single-writer lease, independent verification, and complete trace correlation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Create `apps/runtime/src/modules/agents/{delegate-schema,worker-result,role-policy}.ts` with exact Explorer, Implementer, and Verifier contracts. Validate objective, artifact inputs, allowed paths, acceptance criteria, dependencies, turns, tokens, and deadline before submission. Depends on TASK-002 and TASK-021. | | |
| TASK-032 | Create `apps/runtime/src/modules/agents/subagent-coordinator.ts` with `submitWorker()`, `startWorker()`, `joinWorker()`, `cancelWorker()`, and `cascadeCancel()`. Create a new PI AgentSession per Worker with a minimal context and no `delegate_task`; enforce depth one, three concurrent workers, and parent-child persistence. Depends on TASK-003, TASK-012, and TASK-031. | | |
| TASK-033 | Create `apps/runtime/src/modules/agents/writer-lease.ts`. Require Implementer and Supervisor writes to acquire one workspace lease, queue extra writers, renew leases, and fail closed on ownership mismatch. Add concurrent-race tests with at least 100 interleavings. Depends on TASK-013 and TASK-032. | | |
| TASK-034 | Register `delegate_task` as a Supervisor-only custom PI tool in `apps/runtime/src/modules/agents/delegate-tool.ts`. Compute child capabilities as parent grant intersection role policy intersection step budget. Worker `NEEDS_APPROVAL` MUST return to Supervisor and MUST NOT invoke approval UI directly. Depends on TASK-023 and TASK-032. | | |
| TASK-035 | Create `apps/runtime/src/modules/agents/verifier.ts`. Feed only objective, patch, acceptance criteria, test entrypoints, and relevant artifacts; run deterministic tests before LLM review; prohibit source edits; return structured evidence and unresolved items. Depends on TASK-032 and TASK-033. | | |
| TASK-036 | Create `apps/runtime/src/modules/telemetry/{trace-schema,trace-writer,trace-redactor,otel-exporter,pi-trace-adapter}.ts`. Emit correlated spans/events for task, plan step, PI agent, model inference, tool, policy, approval, sandbox operation, sub-agent, artifact, and grade. Keep payloads in artifacts and record only hashes/references in trace. Depends on TASK-003, TASK-014, and TASK-023. | | |
| TASK-037 | Add APIs `apps/runtime/src/api/workers.ts` and `apps/runtime/src/api/traces.ts`; add client SDK methods and CLI `nw trace export --redacted`. Ensure cursor reconnect reconstructs worker and trace state from Ledger. Depends on TASK-018, TASK-032, and TASK-036. | | |
| TASK-038 | Add 10 more benchmark cases, including read-only parallel exploration, one-writer implementation, independent verification failure, worker timeout, parent cancel, capability narrowing, and no-recursion attacks. Add graders for worker topology and trace completeness. Depends on TASK-035 and TASK-036. | | |

Phase 4 completion criteria: one golden task uses Explorer, Implementer, and Verifier; no child session has `delegate_task`; three-worker concurrency and single-writer rules hold under stress; all worker actions correlate to task/step/session/operation IDs in trace.

### Implementation Phase 5: Evaluation Harness and Regression Gates

- GOAL-005: Provide a deterministic 30-case evaluation system with reproducible configuration hashes, isolated graders, baseline comparison, cost metrics, and CI release gates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-039 | Create `apps/runtime/src/modules/evals/{case-schema,suite-loader,config-hash,eval-runner}.ts`. Load versioned case YAML, build immutable fixture sandboxes, run agent tasks with fixed config, export patch and trace artifacts, and invoke graders in a fresh container not visible to the agent. Depends on TASK-017, TASK-025, and TASK-036. | | |
| TASK-040 | Create deterministic graders in `benchmarks/graders/{patch-apply,hidden-tests,forbidden-paths,policy-audit,recovery-audit,worker-audit}.ts`. A case succeeds only if patch applies, hidden tests pass, forbidden paths remain unchanged, and no unauthorized effect occurred. Depends on TASK-039. | | |
| TASK-041 | Create `apps/runtime/src/modules/evals/{metrics,baseline-compare,reporter,llm-judge}.ts`. Record task success, tokens, estimated cost, wall time, turns, tool calls, replans, approvals, patch size, and workers. Restrict LLM judge to soft rubric scores and prevent it from changing primary verdict. Depends on TASK-039 and TASK-040. | | |
| TASK-042 | Implement CLI `apps/cli/src/commands/eval.ts` commands `nw eval run`, `compare`, and `report`; support suite, model, repeat count, concurrency, JSON, and HTML report options. Depends on TASK-041. | | |
| TASK-043 | Add the final 10 cases to reach the approved 30-case composition: 10 bug fix, 6 feature, 4 refactor, 4 tool failure, 3 crash recovery, and 3 security. Add suite manifests `benchmarks/suites/{smoke,nightly,stability,security}.yaml`. Depends on TASK-038 and TASK-040. | | |
| TASK-044 | Add `.github/workflows/eval-smoke.yml`, `eval-nightly.yml`, and `eval-weekly.yml`. Smoke runs six cases on dispatch/authorized PR; Nightly runs 30 once; Weekly runs 30 three times. Store redacted reports as artifacts and compare against the main baseline. Depends on TASK-042 and TASK-043. | | |
| TASK-045 | Implement release gate script `scripts/check-release-gates.mjs` enforcing zero unauthorized host effects, golden success >=80%, full success >=70%, fault recovery/safe stop >=95%, Tool Contract success >=98%, and median token/cost regression <=20%. Add unit tests for threshold boundaries. Depends on TASK-041 and TASK-043. | | |
| TASK-046 | Create optional `tools/swebench-adapter/` with a documented fixed 20-case SWE-bench Verified manifest and prediction exporter. Keep it out of daily CI and make failure non-blocking for v0.1. Depends on TASK-042. | | |

Phase 5 completion criteria: all 30 cases validate; smoke/nightly/weekly workflows are runnable; repeated runs include immutable config hashes; release gate script correctly blocks functional, safety, recovery, tool-contract, and cost regressions.

### Implementation Phase 6: Workbench, Release Hardening, and Public v0.1

- GOAL-006: Deliver a secure Task-first Workbench, signed/versioned Windows artifacts, complete operator documentation, and a public GitHub v0.1 release that passes CI and evaluation gates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-047 | Implement Workbench routes/components in `apps/desktop/src/`: `projects/ProjectSidebar.tsx`, `tasks/TaskHeader.tsx`, `tasks/PlanView.tsx`, `tasks/EventTimeline.tsx`, `approvals/ApprovalCard.tsx`, `workers/WorkerList.tsx`, `artifacts/ArtifactList.tsx`, `trace/TraceInspector.tsx`, `sandbox/SandboxStatus.tsx`, and `composer/SteeringComposer.tsx`. Use only `client-sdk`; reconnect from snapshot plus cursor. Depends on TASK-018, TASK-030, and TASK-037. | | |
| TASK-048 | Implement setup and preflight screens in `apps/desktop/src/setup/` for repository selection, Git state, model credential, Docker/WSL status, sandbox image, budget, and privacy. Disable task start until mandatory checks pass; offer read-only mode when Docker is unavailable. Depends on TASK-007 and TASK-024. | | |
| TASK-049 | Implement final delivery screens in `apps/desktop/src/delivery/` showing patch diff, tests, unresolved items, cost, security events, and exact patch-hash approval. Add virtualized trace/event rendering and accessible keyboard navigation. Depends on TASK-027, TASK-036, and TASK-047. | | |
| TASK-050 | Add Playwright smoke tests under `apps/desktop/e2e/` for setup, task start, plan, live events, approval, cancel/resume, process restart, final diff, patch apply, and error recovery using deterministic fake runtime fixtures. Depends on TASK-047 through TASK-049. | | |
| TASK-051 | Create `docs/threat-model.md`, `docs/data-and-privacy.md`, `docs/troubleshooting.md`, `docs/evaluation.md`, `docs/architecture.md`, and `docs/contributing-benchmarks.md`. Update README with install, BYOK, Docker, golden task, local data paths, deletion, security boundary, and demo instructions. Depends on all prior phase outputs. | | |
| TASK-052 | Create `scripts/build-windows-release.mjs`, `scripts/generate-sbom.mjs`, `.github/workflows/release.yml`, and Tauri updater metadata. Build sidecar, CLI, desktop installer, checksums, SBOM, and source archive from a version tag. Verify installation in a clean Windows CI VM. Depends on TASK-009, TASK-010, and TASK-050. | | |
| TASK-053 | Run all unit, integration, security, fault, Workbench, 30-case nightly, and three-repeat stability suites; store redacted reports under the GitHub Actions run; execute `scripts/check-release-gates.mjs`; fix all blocking failures. Depends on TASK-045, TASK-050, and TASK-052. | | |
| TASK-054 | Update plan status and task completion dates, commit the final implementation, push `main`, create signed tag `v0.1.0`, trigger release workflow, verify uploaded artifacts and checksums, and publish GitHub Release notes containing limitations and security boundaries. Depends on TASK-051 through TASK-053. | | |

Phase 6 completion criteria: clean Windows installation completes the golden path; Workbench and CLI behavior match; all release gates pass; GitHub release contains installer, CLI/runtime artifacts, checksums, SBOM, source archive, documentation, and explicit v0.1 limitations.

## 3. Alternatives

- **ALT-001**: Build a Python/FastAPI runtime from scratch. Rejected because PI already provides mature AgentSession, provider, compaction, retry, and extension practices, while the 12-week scope requires safety and evaluation work.
- **ALT-002**: Fork PI. Rejected because the public SDK supports embedding and a fork would add continuous upstream merge cost.
- **ALT-003**: Use OpenCode as the product engine. Rejected because it reduces control over the durable Task, policy, sandbox, and evaluation domains that distinguish NoNeedWork.
- **ALT-004**: Split policy, sandbox, agent, and evaluation into microservices. Rejected because v0.1 is a single-user local application; module boundaries and provider interfaces provide sufficient isolation without distributed-system overhead.
- **ALT-005**: Bind-mount the real repository writable into Docker. Rejected because a model or compromised tool could change host files before user review.
- **ALT-006**: Use an ORM for SQLite. Rejected because prepared SQL and narrow repositories make transition transactions, compare-and-swap, and migrations explicit and auditable.
- **ALT-007**: Use only SWE-bench as the evaluation suite. Rejected because SWE-bench validates patch behavior but does not cover NoNeedWork policy, approval, sandbox, recovery, or sub-agent invariants.

## 4. Dependencies

- **DEP-001**: Node.js 24 LTS and npm with lockfile support.
- **DEP-002**: `@earendil-works/pi-coding-agent@0.84.3`, imported only by `packages/pi-adapter`.
- **DEP-003**: Fastify, `@fastify/websocket`, and Zod for Local API and wire contracts.
- **DEP-004**: Built-in `node:sqlite` for durable storage and backups.
- **DEP-005**: Docker Desktop with WSL2 backend and Docker Engine API access.
- **DEP-006**: `@napi-rs/keyring@1.3.0` for Windows Credential Manager integration.
- **DEP-007**: React, Vite, Tauri 2, and Rust toolchain for Workbench.
- **DEP-008**: OpenTelemetry JavaScript SDK for optional trace export.
- **DEP-009**: Vitest, Playwright, and Docker integration test infrastructure.
- **DEP-010**: Git and GitHub CLI for repository, CI, release, and public contribution workflow.

## 5. Files

- **FILE-001**: `/package.json`, `/package-lock.json`, `/tsconfig.base.json`, `/vitest.workspace.ts`, `/biome.json` — monorepo build and quality configuration.
- **FILE-002**: `/packages/protocol/src/` — versioned API, event, ID, error, task, approval, and artifact schemas.
- **FILE-003**: `/packages/pi-adapter/src/` — the only PI SDK integration boundary.
- **FILE-004**: `/packages/client-sdk/src/` — Local API client shared by CLI and desktop.
- **FILE-005**: `/apps/runtime/src/modules/tasks/` — state machine, leases, checkpoints, orchestrator, recovery, cancellation.
- **FILE-006**: `/apps/runtime/src/modules/storage/` — SQLite database, migrations, repositories, and backups.
- **FILE-007**: `/apps/runtime/src/modules/policy/` and `/approvals/` — policy decisions and one-shot approval tokens.
- **FILE-008**: `/apps/runtime/src/modules/tools/` — mandatory mediation and built-in sandbox tools.
- **FILE-009**: `/apps/runtime/src/modules/sandbox/` and `/images/` — Docker provider, security profile, egress proxy, and images.
- **FILE-010**: `/apps/runtime/src/modules/agents/` — bounded worker roles, coordinator, delegate tool, verifier, single-writer lease.
- **FILE-011**: `/apps/runtime/src/modules/telemetry/` — internal trace schema, PI adapter, redaction, and OTel export.
- **FILE-012**: `/apps/runtime/src/modules/evals/` and `/benchmarks/` — cases, fixtures, graders, suites, baselines, reports.
- **FILE-013**: `/apps/runtime/src/api/` — authenticated loopback HTTP/WebSocket endpoints.
- **FILE-014**: `/apps/cli/src/` — doctor, runtime, project, task, approval, artifact, trace, model, and eval commands.
- **FILE-015**: `/apps/desktop/src/` and `/apps/desktop/src-tauri/` — Task-first Workbench and constrained Tauri shell.
- **FILE-016**: `/.github/workflows/` — CI, security, eval, and release automation.
- **FILE-017**: `/docs/` — architecture, threat model, privacy, troubleshooting, evaluation, and contributor documentation.
- **FILE-018**: `/scripts/` — sidecar, release, SBOM, and release-gate automation.

## 6. Testing

- **TEST-001**: Protocol round-trip and invalid payload tests for every Zod wire schema.
- **TEST-002**: PI Adapter Contract Suite verifying session lifecycle, event normalization, resume, cancellation, bundled resources, and absence of dangerous PI built-ins.
- **TEST-003**: Exhaustive TaskRun and PlanStep transition-table tests, including compare-and-swap conflicts.
- **TEST-004**: SQLite migration, backup, schema version, foreign key, transaction, and event sequence tests.
- **TEST-005**: Artifact hash, atomic persist, corruption detection, reference count, and delayed GC tests.
- **TEST-006**: Tool Gateway tests proving validation, canonicalization, policy, approval, budget, sandbox, and trace cannot be bypassed.
- **TEST-007**: Sandbox integration tests for non-root, capabilities, namespaces, filesystem, Docker socket, resource limits, timeout, and offline network.
- **TEST-008**: Egress allowlist tests for allowed host, denied host, direct IP, DNS rebinding, and approval expiry.
- **TEST-009**: Patch export/apply tests for symlinks, junctions, dirty host repository, path traversal, hash mismatch, and approval replay.
- **TEST-010**: Fault injection at 100 selected boundaries, requiring recovery or safe stop and no silent replay.
- **TEST-011**: Multi-agent tests for depth one, concurrency three, capability narrowing, no self-approval, single writer, worker timeout, and cascade cancellation.
- **TEST-012**: Trace tests for complete correlation, payload references, redaction, and cursor replay.
- **TEST-013**: NoNeedWorkBench deterministic grader tests and 30-case agent evaluations.
- **TEST-014**: Release threshold unit tests and baseline comparison tests.
- **TEST-015**: Workbench Playwright tests for setup, task flow, live updates, approval, recovery, final diff, and errors.
- **TEST-016**: Windows clean-install smoke that completes the golden task through packaged CLI and Workbench.
- **TEST-017**: Supply-chain CI for dependency review, CodeQL, secret scan, exact direct dependency pins, SBOM, checksums, and release artifact verification.

## 7. Risks & Assumptions

- **RISK-001**: PI SDK changes may break embedding. Mitigation: exact pin, single Adapter package, contract tests, and isolated upgrade branches.
- **RISK-002**: PI dynamic resources or native dependencies may fail single-file sidecar packaging. Mitigation: complete the spike in Phase 1 and use the approved bundled Node runtime plus resource-directory fallback.
- **RISK-003**: Windows/WSL path semantics may enable traversal or corrupt mapping. Mitigation: canonicalization contract tests and container-internal paths at the Broker boundary.
- **RISK-004**: Docker Desktop availability and configuration may block users. Mitigation: `nw doctor`, guided setup, diagnostics export, and read-only mode without Docker.
- **RISK-005**: A local Docker container is not a malicious multi-tenant security boundary. Mitigation: state the boundary explicitly and require stronger providers for future cloud execution.
- **RISK-006**: Model nondeterminism may hide regressions. Mitigation: immutable config hashes, per-case baselines, deterministic graders, and repeated weekly runs.
- **RISK-007**: Thirty benchmark cases may consume more schedule than expected. Mitigation: add cases continuously from Phase 2 and require capability PRs to add corresponding cases.
- **RISK-008**: Network allowlisting can be bypassed through proxy or DNS mistakes. Mitigation: keep offline default, reject direct IP egress, test rebinding, and treat network profile as the first feature cut if schedule slips.
- **RISK-009**: Credential native bindings may complicate packaging. Mitigation: include keyring in the Phase 1 packaging contract and keep provider credentials injectable through process memory for test environments only.
- **ASSUMPTION-001**: The developer machine has Windows 10/11 x64, Git, Node 24, Rust, Docker Desktop, WSL2, and authenticated GitHub CLI.
- **ASSUMPTION-002**: Users provide their own supported model credentials.
- **ASSUMPTION-003**: v0.1 repositories are Git repositories small enough to copy into a local task workspace.
- **ASSUMPTION-004**: Initial release artifacts can be unsigned if a Windows code-signing certificate is unavailable, but checksums and provenance MUST still be published and the unsigned status MUST be documented.

## 8. Related Specifications / Further Reading

- [NoNeedWork v0.1 System Design](../docs/superpowers/specs/2026-08-28-noneedwork-system-design.md)
- [PI SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [PI Containerization](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)
- [PI Sub-Agent Example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts)
- [Tauri Node Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [OpenTelemetry GenAI Agent Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [SWE-bench Evaluation Harness](https://github.com/SWE-bench/SWE-bench/blob/main/docs/reference/harness.md)
