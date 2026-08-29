---
goal: Implement secure Qwen and MiniMax Token Plan provider adapters on the PI runtime
version: 1.0
date_created: 2026-08-29
last_updated: 2026-08-29
owner: NoNeedWork maintainers
status: 'Planned'
tags: [feature, providers, credentials, security, pi, qwen, minimax]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements the approved Qwen Token Plan CN and MiniMax Token Plan CN design on
top of `main@269377d`. It adds stable NoNeedWork model profiles, Windows Credential
Manager storage, immutable TaskRun model bindings, task-scoped PI model runtimes, local
model-management APIs and CLI commands, deterministic provider error handling, offline
contracts, opt-in live probes, and native-sidecar packaging validation. The implementation
MUST remain operable without real provider credentials; live tests remain skipped until the
user explicitly connects credentials after all offline and Docker gates pass.

## 1. Requirements & Constraints

- **REQ-001**: Expose exactly two v0.1 product profiles: `qwen-cn` and `minimax-cn`.
- **REQ-002**: Map `qwen-cn` to PI provider `qwen-token-plan-cn` with default model
  `qwen3.7-plus`, and map `minimax-cn` to PI provider `minimax-cn` with default model
  `MiniMax-M3`.
- **REQ-003**: Use only the static catalog shipped by
  `@earendil-works/pi-ai@0.84.3`; set PI model-network refresh off and reject models absent
  from the selected built-in provider.
- **REQ-004**: Resolve and persist an immutable model binding in the same transaction that
  creates a TaskRun, before `PREPARING`, provider requests, or Docker workspace creation.
- **REQ-005**: Persist `profileId`, `piProviderId`, `modelId`, `piSdkVersion`, and
  `selectionSource` for every newly created TaskRun.
- **REQ-006**: Preserve existing terminal TaskRuns created before migration with a nullable
  model binding; pause non-terminal unbound legacy runs instead of guessing a provider.
- **REQ-007**: Provide local Runtime API and typed client operations for profile listing,
  default selection, credential status/set/delete, and explicit provider probe.
- **REQ-008**: Provide CLI commands `nw model list`, `credential set|list|delete`, `select`,
  and `test`, plus `task start --model <profile-id>/<model-id>`.
- **REQ-009**: Extend `nw doctor` to report default-model resolution and secret-free
  Credential Manager status; environment variables MUST NOT count as production model
  credentials.
- **REQ-010**: Use a task-scoped PI `ModelRuntime`; remove its runtime API-key override and
  release its references whenever the driver is disposed.
- **REQ-011**: Convert provider failures into the approved model block reasons and pause
  recoverable TaskRuns with a structured `modelBlock` checkpoint.
- **REQ-012**: Keep automatic retry disabled for real provider sessions in v0.1 because PI
  `0.84.3` removes an error assistant message and continues without proving that the error
  message contained no partial output. Treat retryable errors as explicit resumable pauses.
- **REQ-013**: `nw model test` MUST perform bounded text and synthetic-tool-schema protocol
  probes without opening a project, creating Docker resources, creating a PI ToolDefinition,
  or executing a tool call.
- **REQ-014**: Add `npm run test:providers`; offline contracts run in normal CI, while real
  provider tests run only when `NONEEDWORK_LIVE_MODEL_TESTS=1` and otherwise report skipped.
- **SEC-001**: Only `packages/pi-adapter` may import `@earendil-works/pi-ai` or
  `@earendil-works/pi-coding-agent`.
- **SEC-002**: Never expose PI built-ins `bash`, `powershell`, `edit`, or `write` to a
  NoNeedWork model session.
- **SEC-003**: Store the versioned credential envelope only in Windows Credential Manager;
  never persist its secret in SQLite, PI sessions, events, logs, traces, artifacts, process
  arguments, environment variables, Docker configuration, or GitHub Actions.
- **SEC-004**: Do not expose arbitrary provider IDs, Base URLs, headers, protocols, model
  metadata, or proxies in v0.1.
- **SEC-005**: Disable request-body logging on the credential write endpoint and emit only
  constant, redacted public error messages for keyring and provider failures.
- **SEC-006**: Preserve the existing Tool Gateway and SandboxProvider boundary. Model tools
  MUST NOT call Docker or the host shell directly.
- **SEC-007**: Validate all process and persistence boundaries with Zod, including the
  write-only credential request and the credential envelope read from the OS keyring.
- **SEC-008**: Add sentinel-secret scans for SQLite, PI session files, events, artifacts,
  traces, API responses, CLI output, and Docker inspect output.
- **CON-001**: Follow
  `docs/superpowers/specs/2026-08-28-noneedwork-system-design.md`,
  `docs/superpowers/specs/2026-08-29-qwen-minimax-token-plan-design.md`, and
  `plan/architecture-noneedwork-v0.1.md`.
- **CON-002**: Keep Runtime implementation inside the modular monolith under
  `apps/runtime/src/modules`.
- **CON-003**: Use `@napi-rs/keyring@1.3.0` exactly and update both the root lockfile and
  `packaging/runtime-sidecar/package-lock.json`.
- **CON-004**: Keep Node.js `24.9.0`, npm 11, PI `0.84.3`, Zod 4, TypeScript 7, and current
  Fastify/client conventions unchanged.
- **CON-005**: Do not add cloud accounts, product authentication, recursive agents,
  long-term memory, RAG, or writable host-shell scope.
- **CON-006**: No task in this plan may require a real Qwen or MiniMax secret to pass CI.
- **CON-007**: When dependency download fails, retry the same npm command only after setting
  `HTTPS_PROXY=http://127.0.0.1:10909` and `HTTP_PROXY=http://127.0.0.1:10909` in that
  terminal; clear both variables after installation.
- **PAT-001**: Write a failing test first, run the targeted test to observe the expected
  failure, implement the minimum behavior, rerun the targeted test, then run
  `npm run check:types` before completing each task.
- **PAT-002**: Persist state intent before provider or sandbox side effects, and persist
  result/checkpoint metadata before returning observations to PI.
- **PAT-003**: Use dependency injection for keyring entries, clocks, secret input, probe
  transport, and fake model handles; unit tests MUST NOT touch a developer's real keyring.
- **GUD-001**: Preserve unrelated user changes and use `apply_patch` for source edits.
- **GUD-002**: Use constant provider/profile identifiers exported from one module; do not
  duplicate string mappings across Runtime, CLI, and tests.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Define the public model contract and durable TaskRun model identity.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `packages/protocol/src/models.ts` and export it from `packages/protocol/src/index.ts`. First add failing cases to `packages/protocol/src/protocol.test.ts`. Implement these exact Zod contracts and inferred types: `ModelProfileId` is `qwen-cn` or `minimax-cn`; `ModelSelection` is `{profileId,modelId}`; `ModelProfile` is `{profileId,displayName,defaultModelId,modelIds,capabilities:{text,thinking,toolCalls,images}}`; `ModelProfileList` is `{profiles}`; `ModelCredentialStatus` is `{profileId,configured,updatedAt: ISO timestamp or null}`; `ModelCredentialStatusList` is `{credentials}`; write-only `ModelCredentialSetRequest` is `{secret: trimmed string length 16..16384}`; `ModelProbeResult` is `{profileId,modelId,success,latencyMs,checks:{text,toolCall},errorCode?: ModelBlockReason}`; `ModelBlock` is `{reason,profileId,modelId,recoverable,retryAfterMs?,action}`; and `TaskModelBinding` is `{runId,profileId,piProviderId,modelId,piSdkVersion:'0.84.3',selectionSource,createdAt}`. Fix block reasons to `MODEL_BINDING_MISSING`, `MODEL_CREDENTIAL_MISSING`, `MODEL_AUTH_REJECTED`, `MODEL_QUOTA_EXHAUSTED`, `MODEL_RATE_LIMITED`, `MODEL_TEMPORARILY_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `MODEL_PROTOCOL_ERROR`, and `UNKNOWN_MODEL_OUTCOME`; fix `selectionSource` to `default` or `task_override`; bound latency/retry values to nonnegative 32-bit integers. Assert every response schema rejects an injected `secret` field. Run `npx vitest run packages/protocol/src/protocol.test.ts`; expected result after implementation: all protocol tests pass. | | |
| TASK-002 | Depends on TASK-001. Add `apps/runtime/src/modules/storage/migrations/002-model-provider-bindings.ts` with STRICT tables `model_preferences(id CHECK id = 'default', profile_id, model_id, updated_at)` and `task_run_models(run_id PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE, profile_id, pi_provider_id, model_id, pi_sdk_version, selection_source CHECK IN ('default','task_override'), created_at)`. Register version 2 in `apps/runtime/src/modules/storage/migrations/index.ts`. Create `apps/runtime/src/modules/models/model-binding-repository.ts` with `insert(binding)`, `get(runId)`, and an insert-time assertion that the TaskRun status is `CREATED`; create `apps/runtime/src/modules/models/model-preference-repository.ts` with `get()` and idempotent `set(selection)`. Add row Zod schemas in the two repository files. Add migration, round-trip, cascade, immutable-after-CREATED, and migration-from-version-1 tests to `apps/runtime/src/modules/models/model-storage.test.ts` and `apps/runtime/src/modules/storage/storage.test.ts`. Run `npx vitest run apps/runtime/src/modules/models/model-storage.test.ts apps/runtime/src/modules/storage/storage.test.ts`; expected result: schema version 2 and all model storage cases pass. | | |
| TASK-003 | Depends on TASK-001 and TASK-002. Extend `packages/protocol/src/tasks.ts`: add optional `model` to `createTaskRequestSchema` and nullable `model` to `taskDetailsSchema`, without placing model data inside `taskRunSchema`. Update `apps/runtime/src/modules/storage/repositories/task-repository.ts` so `create(request, config, binding)` inserts the TaskRun and `task_run_models` row in one `RuntimeDatabase.transaction`; make `binding` mandatory for new tasks. Add `models` as a `ModelBindingRepository` property and include its value in `details()`. Update direct `TaskRepository.create` callers in `apps/runtime/src/modules/storage/storage.test.ts`, `apps/runtime/src/modules/tasks/task-lifecycle.test.ts`, `apps/runtime/test/api.integration.test.ts`, and `apps/runtime/test/golden-path.integration.test.ts` to pass a deterministic Qwen test binding from a shared test helper `apps/runtime/test/helpers/model-binding.ts`. Add a rollback assertion proving neither task nor run remains if binding insertion fails. Run `npx vitest run apps/runtime/src/modules/storage/storage.test.ts apps/runtime/src/modules/tasks/task-lifecycle.test.ts apps/runtime/test/api.integration.test.ts apps/runtime/test/golden-path.integration.test.ts`; expected result: all existing and new task persistence tests pass. | | |

Completion criteria: protocol schemas expose no secret-bearing response, database schema version is
2, every new TaskRun has one immutable binding, and pre-migration terminal TaskRuns remain readable
with `model: null`.

### Implementation Phase 2

- GOAL-002: Add a testable Windows Credential Manager boundary with no plaintext fallback.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Add exact dependency `@napi-rs/keyring@1.3.0` to `apps/runtime/package.json` and `packaging/runtime-sidecar/package.json`. Update `package-lock.json` and `packaging/runtime-sidecar/package-lock.json` with npm 11; do not hand-edit integrity fields. Run `npm install --workspace @noneedwork/runtime --save-exact @napi-rs/keyring@1.3.0`, then run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` from `packaging/runtime-sidecar`. If download fails, apply CON-007 and retry once. Run `npm ci --ignore-scripts` at the repository root and `npm ci --ignore-scripts --no-audit --no-fund` in `packaging/runtime-sidecar`; expected result: both locked installs succeed and `npm ls @napi-rs/keyring` resolves only `1.3.0`. | | |
| TASK-005 | Depends on TASK-001. Create `apps/runtime/src/modules/credentials/credential-vault.ts`, `model-credentials.ts`, and `fake-credential-vault.ts`. Define `CredentialVault` methods `get(profileId)`, `status(profileId)`, `listStatus()`, `set(profileId, secret)`, and `delete(profileId)`; define a version-1 Zod envelope `{schemaVersion: 1, secret: trimmed string length 16..16384, updatedAt: ISO timestamp}`. Use service `NoNeedWork/model-provider` and account names equal to profile IDs. `FakeCredentialVault` must support injected read/write/delete failures and record operations without exposing values through inspection methods. Add `apps/runtime/src/modules/credentials/credential-vault.test.ts` covering envelope validation, overwrite, missing entry, idempotent delete, fake failures, and status serialization. Run `npx vitest run apps/runtime/src/modules/credentials/credential-vault.test.ts`; expected result: all cases pass and `JSON.stringify(listStatus())` excludes the sentinel secret. | | |
| TASK-006 | Depends on TASK-004 and TASK-005. Create `apps/runtime/src/modules/credentials/keyring.ts` with `KeyringCredentialVault`. Inject an `EntryFactory` in tests; the production factory creates `new Entry('NoNeedWork/model-provider', profileId)`. Use synchronous `setPassword`, `getPassword`, and `deletePassword`; parse every retrieved value with the envelope schema; translate only the binding's explicit missing-entry error code to `undefined`, and convert all other native errors to constant `CredentialVaultError` codes without appending native messages. Create `apps/runtime/src/modules/credentials/secret-redactor.ts` with `redactSecrets(value, secrets)` for exact string replacement in Error messages and JSON-compatible values. Add `apps/runtime/src/modules/credentials/keyring.test.ts` and `secret-redactor.test.ts` using fake entries; cover missing, corrupt envelope, native denial, delete failure, and sentinel replacement. Run `npx vitest run apps/runtime/src/modules/credentials/keyring.test.ts apps/runtime/src/modules/credentials/secret-redactor.test.ts`; expected result: all native error messages and sentinel values are absent from public results. | | |

Completion criteria: credentials round-trip through an injected Entry implementation, public status
contains only profile/configured/updatedAt metadata, and no environment/file fallback exists.

### Implementation Phase 3

- GOAL-003: Build the PI-only provider profile, task-scoped model runtime, and protocol probe seam.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Depends on TASK-001. Create `packages/pi-adapter/src/provider-profiles.ts`. Define the only mapping table: `{profileId:'qwen-cn', piProviderId:'qwen-token-plan-cn', defaultModelId:'qwen3.7-plus', api:'openai-completions'}` and `{profileId:'minimax-cn', piProviderId:'minimax-cn', defaultModelId:'MiniMax-M3', api:'anthropic-messages'}`. Build public profile model lists from PI `getBuiltinModels(piProviderId)` and return only `ModelProfile` fields validated by `@noneedwork/protocol`; add `@noneedwork/protocol` as an exact workspace dependency of `packages/pi-adapter`. Reject empty catalogs, missing defaults, cross-provider model IDs, and any requested profile outside the two-entry table. Export `listNoNeedWorkModelProfiles()` and `resolveNoNeedWorkModelIdentity(selection)`. Add `packages/pi-adapter/src/provider-profiles.test.ts` asserting exact provider/protocol/default mapping, the two default models, static catalog membership, and no exposed Base URL or credential metadata. Run `npx vitest run packages/pi-adapter/src/provider-profiles.test.ts`; expected result: both locked PI providers resolve. | | |
| TASK-008 | Depends on TASK-005 and TASK-007. Create `packages/pi-adapter/src/model-runtime.ts`. Define opaque `NoNeedWorkModelHandle` containing only `identity`, `createSessionModelOptions()` for internal adapter use, and asynchronous idempotent `dispose()`. Implement `createNoNeedWorkModelHandle({selection, credential})`: validate identity; create PI `InMemoryCredentialStore`; call `ModelRuntime.create({credentials, modelsPath:null, allowModelNetwork:false, refreshOnCreate:false})`; call `setRuntimeApiKey(piProviderId, credential)`; resolve `getModel(piProviderId, modelId)`; clean the runtime override on every failure; and make `dispose()` await `removeRuntimeApiKey`. Never include credential text in thrown errors. Update `packages/pi-adapter/src/types.ts` and `index.ts` to expose only the opaque handle and NoNeedWork identity/error types, not `ModelRuntime`, PI `Model`, or credential store types. Add `packages/pi-adapter/src/model-runtime.test.ts` with injected/fake runtime creation to assert option values, one-provider key injection, unknown model cleanup, idempotent disposal, and secret-free errors. Run `npx vitest run packages/pi-adapter/src/model-runtime.test.ts`; expected result: all handle lifecycle tests pass. | | |
| TASK-009 | Depends on TASK-008. Refactor `packages/pi-adapter/src/create-session.ts`, `types.ts`, `testing.ts`, and `adapter.contract.test.ts` so `createNoNeedWorkSession` requires a `NoNeedWorkModelHandle` instead of accepting public `model` and `modelRuntime` fields. `createFauxModelHarness()` must return a fake handle implementing the same opaque contract. Set PI settings to `retry: {enabled:false,maxRetries:0}` for product and faux sessions; keep compaction enabled. Preserve `noTools:'builtin'`, the exact allowed custom-tool list, and `excludeTools` containing `bash`, `powershell`, `edit`, and `write`. Make session `dispose()` asynchronous so it disposes AgentSession before the model handle. Update Runtime tests that consume the faux harness. Add contract assertions that `auth.json` is never created under `agentDir`, `models.json` is not read, no ambient `QWEN_TOKEN_PLAN_CN_API_KEY` or `MINIMAX_CN_API_KEY` is used, retry events are never emitted, and forbidden PI tools remain absent. Run `npx vitest run packages/pi-adapter/src/adapter.contract.test.ts apps/runtime/test/golden-path.integration.test.ts`; expected result: all sessions use the explicit handle and closed tool set. | | |
| TASK-010 | Depends on TASK-008. Create `packages/pi-adapter/src/provider-probe.ts` with `probeNoNeedWorkModel({handle, timeoutMs:15000})`. Issue two direct, bounded `ModelRuntime.streamSimple` calls through the handle: text prompt `Respond with exactly OK.` with `maxTokens:32`; then a request with one synthetic JSON-schema tool named `noneedwork_probe` and instruction to call it with `{value:'OK'}`. Validate stream completion, exact text/tool structure, latency, and provider/model identity; never construct or execute a PI ToolDefinition. Abort both calls on timeout and dispose the handle in the caller. Export only a `ModelProbeResult`. Add `packages/pi-adapter/src/provider-probe.test.ts` with faux text, valid tool call, malformed call, timeout, and secret-free error cases. Run `npx vitest run packages/pi-adapter/src/provider-probe.test.ts`; expected result: probe tests pass without Docker or filesystem access. | | |

Completion criteria: Runtime code can list and select both profiles through NoNeedWork types, create a
credential-in-memory PI handle, run bounded protocol probes, and cannot enable PI built-in tools or
automatic retry.

### Implementation Phase 4

- GOAL-004: Integrate model selection, preflight, blocking errors, and recovery into the durable task lifecycle.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Depends on TASK-002, TASK-006, TASK-007, TASK-008, and TASK-010. Create `apps/runtime/src/modules/models/model-profile.ts`, `model-selection.ts`, `model-errors.ts`, and `model-service.ts`. `ModelService` owns the static profiles, `ModelPreferenceRepository`, `ModelBindingRepository`, and `CredentialVault`. Implement `listProfiles`, `getDefaultSelection` with static fallback `qwen-cn/qwen3.7-plus`, `setDefaultSelection`, `resolveTaskSelection(rawOptionalSelection)`, `listCredentialStatus`, `setCredential`, `deleteCredential`, `preflight(binding)`, `createHandle(binding)`, and `probe(profileId)`. `preflight` must check binding/provider/PI version/catalog and credential presence without network or Docker; `createHandle` retrieves the secret once and immediately passes it to the Adapter. Add `apps/runtime/src/modules/models/model-service.test.ts` covering default/override source, invalid cross-profile model, key missing, PI-version mismatch, no network preflight, credential rotation affecting only subsequent handles, and probe disposal. Run `npx vitest run apps/runtime/src/modules/models/model-service.test.ts`; expected result: all domain tests pass. | | |
| TASK-012 | Depends on TASK-003 and TASK-011. Inject `ModelService` into `apps/runtime/src/modules/tasks/task-service.ts` and `apps/runtime/src/services.ts`. In `TaskService.create`, resolve the effective selection before repository writes, construct the complete `TaskModelBinding`, and pass it to `TaskRepository.create`; keep `selectionSource` based on whether the raw request supplied `model`. Add `credentialVault`, `modelService`, and optional `modelHandleFactory` test overrides to `RuntimeServiceOverrides`. Update task creation tests to prove explicit MiniMax override, Qwen default, transactional binding, and rejection before a task row exists. Run `npx vitest run apps/runtime/src/modules/tasks/task-lifecycle.test.ts apps/runtime/test/api.integration.test.ts`; expected result: all new tasks expose their non-null binding. | | |
| TASK-013 | Depends on TASK-009, TASK-011, and TASK-012. Add optional `preflight(): Promise<void>` and async `dispose(): Promise<void>` to `TaskDriver` in `apps/runtime/src/modules/tasks/task-orchestrator.ts`; update `TaskRunner` to await disposal in `finally`. Refactor `apps/runtime/src/modules/tasks/pi-task-driver.ts`: accept the persisted binding and a `prepareModelHandle` closure, create exactly one handle in `preflight`, require preflight before `#ensureSession`, and await both session and handle disposal. In `createRuntimeServices`, the driver factory loads the TaskRun binding and passes `() => modelService.createHandle(binding)`; it MUST NOT read the keyring inside `PiTaskDriver`. Reorder the CREATED path in `TaskOrchestrator.run`: transition to `PREPARING`, run driver preflight, then call `prepareRun` to create the Docker workspace. Make `prepareRun` accept an already-PREPARING run and never create a sandbox before successful preflight. Add lifecycle tests asserting missing key/model creates zero sandboxes, successful preflight creates one, concurrent `TaskRunner.run` calls share one handle, and disposal clears it once. Run `npx vitest run apps/runtime/src/modules/tasks/task-lifecycle.test.ts apps/runtime/test/golden-path.integration.test.ts`; expected result: preflight ordering and existing golden recovery pass. | | |
| TASK-014 | Depends on TASK-011 and TASK-013. Implement structured blocking in `apps/runtime/src/modules/models/model-errors.ts`, `apps/runtime/src/modules/tasks/task-orchestrator.ts`, `task-state-machine.ts`, `task-service.ts`, and `recovery-service.ts`. Add `PREPARING -> PAUSED`, `PAUSED -> PREPARING`, and `PREPARING` to the safe resume set. On a recoverable `ModelBlockedError`, first checkpoint `{boundary:'MODEL_BLOCKED',resumeStatus,current modelBlock,recordedAt}`, then transition to `PAUSED` with a DIAGNOSTIC payload containing the same secret-free `modelBlock`; do not throw into `TaskRunner.recordStartFailure`. Map protocol errors to `FAILED`. During recovery, pause any non-terminal TaskRun with `model:null` using reason `MODEL_BINDING_MISSING`; do not mutate terminal legacy runs. Add every new transition, missing-key resume, quota/rate pause, protocol failure, legacy binding, and concurrent pause/resume case to `apps/runtime/src/modules/tasks/state-machines.test.ts`, `task-lifecycle.test.ts`, and `apps/runtime/src/modules/tasks/model-recovery.test.ts`. Run `npx vitest run apps/runtime/src/modules/tasks/state-machines.test.ts apps/runtime/src/modules/tasks/task-lifecycle.test.ts apps/runtime/src/modules/tasks/model-recovery.test.ts`; expected result: all model state transitions and recovery cases pass. | | |

Completion criteria: no Docker side effect occurs before model preflight, recoverable provider errors are
durably paused with an actionable checkpoint, resume repeats preflight with the same immutable model,
and protocol errors terminate without secret leakage.

### Implementation Phase 5

- GOAL-005: Expose secure local APIs, SDK methods, CLI commands, and diagnostics.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | Depends on TASK-011 and TASK-014. Create `apps/runtime/src/api/models.ts` and register it in `apps/runtime/src/app.ts`. Implement authenticated loopback routes exactly as specified in the approved design: `GET /v1/models/profiles`, `GET/PUT /v1/models/selection`, `GET /v1/models/credentials`, `PUT/DELETE /v1/models/credentials/:profileId`, and `POST /v1/models/probe/:profileId`. Validate params/body/response with Zod. Set credential route request-body schema locally as write-only and ensure Fastify logger serializers never include it. Normalize `CredentialVaultError`, validation, missing profile, and model block errors into `ErrorEnvelope` with constant messages and correct HTTP status; update `apps/runtime/src/app.ts` so every unrecognized 500 response uses the constant message `Internal Runtime error` and never forwards `error.message`, raw provider/native errors, headers, request bodies, or Runtime objects. Add API tests in `apps/runtime/src/api/models.test.ts` for auth, all status codes, invalid profile/model, secret set/list/delete, no reflected secret, generic-error suppression, and probe response. Run `npx vitest run apps/runtime/src/api/models.test.ts apps/runtime/src/app.test.ts`; expected result: all responses validate and contain no sentinel. | | |
| TASK-016 | Depends on TASK-015. Extend `packages/client-sdk/src/runtime-client.ts` and `runtime-client.test.ts` with methods `listModelProfiles`, `getModelSelection`, `setModelSelection`, `listModelCredentials`, `setModelCredential`, `deleteModelCredential`, and `probeModel`. Encode profile IDs with `encodeURIComponent`, validate every response, and never store the credential argument on the client instance or attach it to a thrown `RuntimeClientError.body`. Add a private request option that discards the request body after `fetch` returns. Run `npx vitest run packages/client-sdk/src/runtime-client.test.ts`; expected result: all paths/auth headers/schema validations pass and serialized client/errors exclude the sentinel secret. | | |
| TASK-017 | Depends on TASK-016. Create `apps/cli/src/io/secret-reader.ts`, `secret-reader.test.ts`, `apps/cli/src/commands/model.ts`, and `model.test.ts`; register `registerModelCommand` in `apps/cli/src/main.ts`. `readSecret` must require interactive TTY input/output, enable raw mode only for the prompt, render no characters, restore raw mode in `finally`, reject empty/cancelled input, and accept an injected reader in command tests. Implement `model list`, `credential set|list|delete`, `select`, and `test`; support `--json` on non-secret outputs. `model test` prints a quota warning and requires interactive `y` confirmation unless `--yes` is supplied. It must never accept a secret argument, option, environment variable, or redirected stdin. Extend `apps/cli/src/commands/task.ts` with `--model <profile-id/model-id>` and parse the exact single-slash form through `modelSelectionSchema`. Run `npx vitest run apps/cli/src/io/secret-reader.test.ts apps/cli/src/commands/model.test.ts apps/cli/test/runtime-cli.integration.test.ts`; expected result: CLI tests pass and captured stdout/stderr/history fixtures contain no sentinel. | | |
| TASK-018 | Depends on TASK-015 and TASK-016. Refactor `apps/cli/src/commands/doctor.ts` and `doctor.test.ts`: add an injected `modelStatus()` dependency whose production implementation uses `discoverRuntime()` and the new client methods. Replace environment-variable credential detection with two secret-free checks: `default-model` passes only when the Runtime resolves its selection; `model-credential` passes when the selected profile is configured, warns when not configured, and warns when Runtime is not running. Preserve Docker/WSL/image checks and remediation `docker build -t noneedwork/sandbox:0.1 images/sandbox`. Run `npx vitest run apps/cli/src/commands/doctor.test.ts`; expected result: existing machine checks plus all model status cases pass without environment-secret access. | | |

Completion criteria: authenticated API, SDK, and CLI operations manage both profiles end to end; secret
input is masked and write-only; doctor reports actionable provider and sandbox state without inspecting
provider environment variables.

### Implementation Phase 6

- GOAL-006: Lock provider compatibility, error semantics, and credential isolation with offline tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Depends on TASK-008 and TASK-009. Add `packages/pi-adapter/src/provider-runtime.contract.test.ts` and fixtures under `packages/pi-adapter/test/fixtures/qwen/`. Use a loopback fake HTTP server and a test-only provider override of the built-in Qwen Base URL; production exports MUST NOT expose the override. Assert OpenAI-compatible chat request auth, model ID, streamed text/thinking normalization, fragmented `tool_calls` reconstruction, usage, cancellation, and request-body absence of forbidden PI tool names. Run `npx vitest run packages/pi-adapter/src/provider-runtime.contract.test.ts -t qwen`; expected result: Qwen contract cases pass with no external network. | | |
| TASK-020 | Depends on TASK-008 and TASK-009. Add MiniMax fixtures under `packages/pi-adapter/test/fixtures/minimax/` and cases to `provider-runtime.contract.test.ts`. Use the same loopback server pattern with a test-only MiniMax Base URL override. Assert Anthropic Messages auth, `MiniMax-M3`, streamed text/thinking normalization, `tool_use` reconstruction, usage, cancellation, prompt-cache-compatible request shape, and absence of forbidden PI tool names. Run `npx vitest run packages/pi-adapter/src/provider-runtime.contract.test.ts -t minimax`; expected result: MiniMax contract cases pass with no external network. | | |
| TASK-021 | Depends on TASK-009, TASK-014, TASK-019, and TASK-020. Extend `provider-runtime.contract.test.ts` and `apps/runtime/src/modules/tasks/model-recovery.test.ts` with 401, 403, 402/explicit insufficient-quota code, 404, 429 with `Retry-After`, 408, 5xx, malformed SSE, timeout before output, and disconnect after text/thinking/tool-call deltas. Classification rules are deterministic: 401/403 auth rejected; 402 or allowlisted `insufficient_quota` quota exhausted; 404 model unavailable; 429 rate limited; 408/5xx/transport-before-output temporarily unavailable; invalid protocol before output protocol error; any failure after output unknown outcome. Assert PI auto retry remains disabled and every fake server sees exactly one request. Run `npx vitest run packages/pi-adapter/src/provider-runtime.contract.test.ts apps/runtime/src/modules/tasks/model-recovery.test.ts`; expected result: error reasons and one-request invariant pass. | | |
| TASK-022 | Depends on TASK-006, TASK-013, TASK-014, and TASK-021. Create `apps/runtime/test/provider-credential-isolation.integration.test.ts`. Generate a random sentinel, run a Qwen-profile TaskRun with fake vault and fake model handle through preflight/session/pause/dispose/restart, then recursively inspect the temporary app-data directory, SQLite text/blob values, run events, PI session, artifacts, trace exports, API/CLI captured output, and fake Docker create options. Under `NONEEDWORK_DOCKER_TESTS=1`, also build/use `noneedwork/sandbox:0.1` and inspect the real container JSON for the sentinel and provider environment-variable names. Run `npx vitest run apps/runtime/test/provider-credential-isolation.integration.test.ts`; expected local default: non-Docker cases pass and Docker case is explicitly skipped. Run again with `NONEEDWORK_DOCKER_TESTS=1`; expected result: all cases pass. | | |
| TASK-023 | Depends on TASK-015 through TASK-022. Extend `apps/runtime/test/api.integration.test.ts`, `apps/cli/test/runtime-cli.integration.test.ts`, and `packages/client-sdk/src/runtime-client.test.ts` with the complete fake-vault flow: list profiles, set MiniMax credential, select MiniMax, create task, observe immutable binding, delete credential, verify a new task pauses before Docker, restore credential, resume, and complete with a faux model handle. Assert the existing bearer token and origin checks protect every new route. Run `npx vitest run apps/runtime/test/api.integration.test.ts apps/cli/test/runtime-cli.integration.test.ts packages/client-sdk/src/runtime-client.test.ts`; expected result: end-to-end local control-plane cases pass. | | |

Completion criteria: both wire protocols and every approved provider failure are covered offline, retry
count is exactly zero after the first request, the complete local control plane passes, and sentinel
credentials are absent from all durable and sandbox surfaces.

### Implementation Phase 7

- GOAL-007: Add opt-in live tests and prove native keyring packaging without CI secrets.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Depends on TASK-010, TASK-011, TASK-019, and TASK-020. Create `apps/runtime/test/model-provider.live.test.ts` and root script `test:providers` that runs `packages/pi-adapter/src/provider-runtime.contract.test.ts` plus the live file. The live suite reads only Credential Manager through `ModelService`, runs `probe` for configured profiles, enforces 30-second per-profile timeout and bounded output, emits a secret-free JSON result, and uses `describe.skip` with an explicit skip message unless `NONEEDWORK_LIVE_MODEL_TESTS === '1'`. Do not add provider secrets to `.github/workflows/*.yml`. Run `npm run test:providers` without the flag; expected result: offline contracts pass and live cases report skipped. | | |
| TASK-025 | Depends on TASK-004, TASK-015, and TASK-024. Update `scripts/build-runtime-sidecar.mjs`, `scripts/verify-sidecar.mjs`, `packaging/runtime-sidecar/package.json`, and its lockfile so the platform-specific `@napi-rs/keyring` binary is copied into `nw-runtime-resources`. Extend sidecar verification to call `GET /v1/models/profiles` and assert both default models, which forces Runtime and native keyring module loading without reading a credential. Add a build-time check that exactly one compatible keyring native binary exists for the host target. Create `apps/runtime/test/keyring-native.integration.test.ts`; run it only on Windows with `NONEEDWORK_KEYRING_TESTS=1`, use service `NoNeedWork/test/<random-uuid>` and account `smoke`, round-trip a random non-provider value, and delete it in `finally`. Run `npm run sidecar:build && npm run sidecar:verify` and `$env:NONEEDWORK_KEYRING_TESTS='1'; npx vitest run apps/runtime/test/keyring-native.integration.test.ts` on Windows, then clear the variable; expected result: authenticated Runtime startup, PI `0.84.3`, both profiles, native entry round-trip, and cleanup pass. | | |
| TASK-026 | Depends on TASK-022 and TASK-025. Update `.github/workflows/ci.yml`: keep public quality jobs provider-credential-free; run offline `npm run test:providers` in quality; set `NONEEDWORK_KEYRING_TESTS=1` only for the Windows native-keyring smoke using its unique temporary entry; retain the Windows sidecar build/verify; and extend the Docker sandbox job to run `provider-credential-isolation.integration.test.ts` with `NONEEDWORK_DOCKER_TESTS=1`. Do not add live-test environment variables or provider secrets. Validate workflow syntax with the repository's existing tooling, then run `npm run ci`; expected result: type/lint/unit/build passes on the local Windows checkout. | | |

Completion criteria: live tests are impossible to run accidentally, the Windows sidecar loads the
native keyring package and exposes both profiles, and public CI exercises every offline/Docker boundary
without provider credentials.

### Implementation Phase 8

- GOAL-008: Document setup, execute full gates, and commit a reviewable implementation.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Depends on TASK-017, TASK-018, and TASK-024. Update `README.md`, `SECURITY.md`, and create `docs/model-providers.md`. Document Qwen Token Plan CN and MiniMax Token Plan CN profile/model mapping, keyring-only setup commands, `nw model test` quota warning, model binding/recovery behavior, no automatic fallback/retry, live-test opt-in, data-use links, credential deletion semantics, and sandbox build command. Explicitly state that old Alibaba Coding Plan endpoints are unsupported. Show only the interactive command, never an example key or credential-shaped string. Run `rg -n "sk-[A-Za-z0-9_-]{8,}" README.md SECURITY.md docs plan` and verify it returns no credential-like example. | | |
| TASK-028 | Depends on all prior tasks. Build the local sandbox image with `docker build -t noneedwork/sandbox:0.1 images/sandbox`. Run, in order: `npm ci --ignore-scripts`; `npm run check`; `npm run test:providers`; `npm test`; `$env:NONEEDWORK_DOCKER_TESTS='1'; npm run test:integration`; remove `NONEEDWORK_DOCKER_TESTS`; `npm run build`; `npm run sidecar:build`; `npm run sidecar:verify`; and `npm run ci`. Expected result: all offline, Docker, build, and packaging gates pass; live provider cases remain skipped because `NONEEDWORK_LIVE_MODEL_TESTS` is unset. Run `git diff --check` and `git status --short`; only intended feature files may be modified. Commit in dependency-ordered commits or one final commit with message `feat: add qwen and minimax token plan providers`, push only after the local gates pass, and wait for both CI and Security workflows to complete successfully. Do not run real Qwen/MiniMax probes until the user later stores credentials and explicitly requests them. | | |

Completion criteria: documentation matches shipped behavior, Docker Desktop executes the isolation suite,
all local gates pass, the repository contains no provider secret, and remote CI/Security are green.

## 3. Alternatives

- **ALT-001**: Let Runtime use PI provider/model types directly. Rejected because database, API,
  CLI, and evaluation contracts would become coupled to PI internals and catalog naming.
- **ALT-002**: Implement custom OpenAI-compatible and Anthropic-compatible transports. Rejected
  because PI `0.84.3` already supplies both providers and mature streaming/tool conversions.
- **ALT-003**: Configure providers through PI `models.json` and credentials through `auth.json`.
  Rejected because arbitrary endpoint configuration enables credential exfiltration and `auth.json`
  creates a second plaintext credential store.
- **ALT-004**: Use environment variables for development and Credential Manager for production.
  Rejected because provider secrets could leak through process inheritance, Docker configuration,
  diagnostics, or CI; tests use dependency-injected fake vaults instead.
- **ALT-005**: Automatically fail over from Qwen to MiniMax. Rejected because it changes model
  behavior and invalidates TaskRun recovery/evaluation reproducibility.
- **ALT-006**: Enable PI `0.84.3` automatic retry. Rejected for v0.1 because its retry path removes
  the error assistant message and continues without a product-level proof that no partial output or
  tool call was observed.
- **ALT-007**: Execute a live no-op PI tool during `nw model test`. Rejected because every executed
  model tool must remain behind Tool Gateway and SandboxProvider; the probe validates only the
  returned tool-call schema.

## 4. Dependencies

- **DEP-001**: `@earendil-works/pi-ai@0.84.3` provides built-in `qwen-token-plan-cn` and
  `minimax-cn` providers, static model catalogs, `InMemoryCredentialStore`, and stream APIs.
- **DEP-002**: `@earendil-works/pi-coding-agent@0.84.3` provides `ModelRuntime` and
  `AgentSession`; its product auto-retry is disabled by this feature.
- **DEP-003**: `@napi-rs/keyring@1.3.0` provides synchronous native `Entry`, `setPassword`,
  `getPassword`, and `deletePassword` APIs.
- **DEP-004**: `@noneedwork/protocol` provides all Zod process DTOs and the immutable model
  binding contract.
- **DEP-005**: Node.js `24.9.0` built-in SQLite provides STRICT tables, transactions, and WAL.
- **DEP-006**: Docker Desktop with WSL2 and image `noneedwork/sandbox:0.1` provide the existing
  isolated workspace and credential-leak inspection target.
- **DEP-007**: Existing Runtime local-auth, RuntimeClient, Commander CLI, sidecar packaging, and
  GitHub CI/Security workflows remain the control-plane and release surfaces.

## 5. Files

- **FILE-001**: `packages/protocol/src/models.ts` — model/profile/credential-status/probe/block schemas.
- **FILE-002**: `packages/protocol/src/tasks.ts` — optional task selection and nullable TaskDetails binding.
- **FILE-003**: `packages/protocol/src/index.ts` and `protocol.test.ts` — exports and boundary tests.
- **FILE-004**: `apps/runtime/src/modules/storage/migrations/002-model-provider-bindings.ts` — schema v2.
- **FILE-005**: `apps/runtime/src/modules/storage/migrations/index.ts` and storage tests — migration registration/verification.
- **FILE-006**: `apps/runtime/src/modules/models/model-binding-repository.ts` — immutable TaskRun binding.
- **FILE-007**: `apps/runtime/src/modules/models/model-preference-repository.ts` — local default selection.
- **FILE-008**: `apps/runtime/src/modules/models/model-profile.ts`, `model-selection.ts`, `model-errors.ts`, and `model-service.ts` — Runtime model domain.
- **FILE-009**: `apps/runtime/src/modules/credentials/credential-vault.ts`, `model-credentials.ts`, `fake-credential-vault.ts`, `keyring.ts`, and `secret-redactor.ts` — credential boundary.
- **FILE-010**: `apps/runtime/src/modules/storage/repositories/task-repository.ts` — atomic task/binding creation and details join.
- **FILE-011**: `packages/pi-adapter/src/provider-profiles.ts` — only product-to-PI mapping table.
- **FILE-012**: `packages/pi-adapter/src/model-runtime.ts` — task-scoped PI handle.
- **FILE-013**: `packages/pi-adapter/src/provider-probe.ts` — bounded non-executing protocol probe.
- **FILE-014**: `packages/pi-adapter/src/create-session.ts`, `types.ts`, `testing.ts`, and `index.ts` — opaque-handle session API and disabled retry.
- **FILE-015**: `apps/runtime/src/modules/tasks/pi-task-driver.ts` — handle preflight/session/disposal.
- **FILE-016**: `apps/runtime/src/modules/tasks/task-orchestrator.ts`, `task-runner.ts`, `task-service.ts`, `task-state-machine.ts`, and `recovery-service.ts` — durable model lifecycle.
- **FILE-017**: `apps/runtime/src/services.ts` — model/credential service composition and test overrides.
- **FILE-018**: `apps/runtime/src/api/models.ts` and `app.ts` — authenticated model endpoints and safe error handling.
- **FILE-019**: `packages/client-sdk/src/runtime-client.ts` and tests — typed model control plane.
- **FILE-020**: `apps/cli/src/io/secret-reader.ts` and tests — masked interactive secret input.
- **FILE-021**: `apps/cli/src/commands/model.ts`, `task.ts`, `doctor.ts`, `main.ts`, and tests — provider CLI UX.
- **FILE-022**: `packages/pi-adapter/test/fixtures/qwen/*` and `minimax/*` — offline protocol streams.
- **FILE-023**: `packages/pi-adapter/src/provider-runtime.contract.test.ts` — Qwen/MiniMax wire and failure contracts.
- **FILE-024**: `apps/runtime/test/model-provider.live.test.ts` — explicit live probes.
- **FILE-025**: `apps/runtime/test/provider-credential-isolation.integration.test.ts` — cross-surface leak test.
- **FILE-026**: `apps/runtime/test/keyring-native.integration.test.ts` — opt-in native Windows keyring smoke.
- **FILE-027**: `apps/runtime/test/helpers/model-binding.ts` and existing Runtime/golden/API tests — deterministic bindings.
- **FILE-028**: `apps/runtime/package.json`, `packages/pi-adapter/package.json`, root `package.json`, and `package-lock.json` — dependencies/scripts.
- **FILE-029**: `packaging/runtime-sidecar/package.json` and `package-lock.json` — native sidecar resources.
- **FILE-030**: `scripts/build-runtime-sidecar.mjs` and `verify-sidecar.mjs` — native addon packaging proof.
- **FILE-031**: `.github/workflows/ci.yml` — credential-free offline/Docker provider gates.
- **FILE-032**: `README.md`, `SECURITY.md`, and `docs/model-providers.md` — user/security documentation.

## 6. Testing

- **TEST-001**: Protocol schemas accept only two profiles, approved block reasons, and secret-free responses.
- **TEST-002**: Schema v2 migrates from v1; preference and TaskRun binding rows validate and cascade.
- **TEST-003**: Task and immutable model binding commit or roll back in one SQLite transaction.
- **TEST-004**: Fake and native-entry keyring adapters handle set/get/list/delete/failure without revealing secrets.
- **TEST-005**: Exact secret redaction removes sentinel values from strings, Errors, objects, and arrays.
- **TEST-006**: PI profile catalog resolves locked Qwen and MiniMax defaults without network refresh.
- **TEST-007**: PI runtime handle injects one in-memory key and cleans it on error/disposal.
- **TEST-008**: AgentSession exposes only NoNeedWork custom tools, creates no `auth.json`, and emits no auto-retry.
- **TEST-009**: Probe validates text and tool-call structures without executing a tool or creating Docker resources.
- **TEST-010**: Task preflight occurs after durable PREPARING intent and before sandbox creation.
- **TEST-011**: Missing credentials, auth, quota, rate, unavailable model/provider, protocol, and unknown outcomes map to exact states.
- **TEST-012**: Resume uses the immutable binding and re-runs preflight without changing provider/model.
- **TEST-013**: Legacy non-terminal unbound runs pause; terminal unbound runs remain readable.
- **TEST-014**: Runtime model APIs require bearer auth, validate all DTOs, and never reflect secret input.
- **TEST-015**: RuntimeClient and CLI implement all model operations and masked input with no retained secret.
- **TEST-016**: Doctor reports Runtime model/keyring status and does not inspect provider environment variables.
- **TEST-017**: Qwen OpenAI-compatible streamed text/thinking/tool calls normalize through PI.
- **TEST-018**: MiniMax Anthropic Messages streamed text/thinking/tool calls normalize through PI.
- **TEST-019**: Each retryable/partial failure produces exactly one provider request and the expected pause/failure reason.
- **TEST-020**: Sentinel secret is absent from SQLite, files, sessions, events, artifacts, traces, API/CLI output, and Docker inspect.
- **TEST-021**: End-to-end fake-vault flow selects MiniMax, persists binding, pauses on delete, resumes on restore, and completes.
- **TEST-022**: Live suite skips without explicit flag and runs bounded probes only with user-connected keyring credentials.
- **TEST-023**: Windows sidecar includes and loads the correct keyring native binary.
- **TEST-024**: Opt-in Windows native keyring smoke round-trips and deletes a unique temporary entry.
- **TEST-025**: Full `npm run ci`, Docker integration, sidecar verification, CI, and Security workflows pass.

## 7. Risks & Assumptions

- **RISK-001**: PI's static catalog can drift from current provider documentation. Mitigation: lock PI
  `0.84.3`, reject network refresh, assert defaults, and require a deliberate PI upgrade.
- **RISK-002**: A native keyring addon can fail in SEA/Tauri packaging. Mitigation: duplicate the
  exact dependency in sidecar resources, assert one host binary, and run Windows sidecar smoke.
- **RISK-003**: Native keyring error codes can differ across OS credential stores. Mitigation: product
  support targets Windows; wrap codes in one adapter and test native Windows behavior before release.
- **RISK-004**: Credential Manager and SQLite cannot participate in one transaction. Mitigation:
  credential writes are independent user actions; status is derived from the versioned keyring
  envelope, while tasks persist only non-secret bindings.
- **RISK-005**: Loopback HTTP carries secret input without TLS. Mitigation: bind only 127.0.0.1,
  require the 256-bit launch token, disallow untrusted origins, and disable body/error logging.
- **RISK-006**: A provider can return a partial error response that looks retryable. Mitigation:
  product auto-retry remains disabled and errors become explicit pauses.
- **RISK-007**: Model probes consume subscription quota. Mitigation: require an explicit CLI command,
  warn/confirm, cap tokens and timeout, and never run live probes in public CI.
- **RISK-008**: Key deletion does not revoke a credential already copied into an active TaskRun.
  Mitigation: document cancel-then-delete for immediate revocation and clear runtime keys on disposal.
- **RISK-009**: Existing Phase 2 data lacks model identity. Mitigation: keep terminal data readable and
  pause non-terminal legacy runs rather than inventing a binding.
- **ASSUMPTION-001**: The user will later obtain valid Qwen Token Plan CN and/or MiniMax Token Plan CN credentials.
- **ASSUMPTION-002**: Docker Desktop remains configured with the WSL2 Linux engine.
- **ASSUMPTION-003**: Windows Credential Manager is available to the packaged process under the same user account.
- **ASSUMPTION-004**: Qwen `qwen3.7-plus` and MiniMax `MiniMax-M3` remain present in PI `0.84.3` static catalogs throughout this implementation.
- **ASSUMPTION-005**: Public CI must remain fully deterministic and credential-free.

## 8. Related Specifications / Further Reading

- [NoNeedWork system design](../docs/superpowers/specs/2026-08-28-noneedwork-system-design.md)
- [Qwen and MiniMax Token Plan adapter design](../docs/superpowers/specs/2026-08-29-qwen-minimax-token-plan-design.md)
- [NoNeedWork v0.1 architecture plan](architecture-noneedwork-v0.1.md)
- [Alibaba Cloud Model Studio: connect more coding tools](https://help.aliyun.com/zh/model-studio/more-tools)
- [Alibaba Cloud Model Studio: Token Plan](https://help.aliyun.com/zh/model-studio/token-plan-overview)
- [MiniMax Token Plan](https://platform.minimaxi.com/docs/token-plan/intro)
- [MiniMax other coding tools](https://platform.minimaxi.com/docs/token-plan/other-tools)
- [PI repository](https://github.com/earendil-works/pi)
- [`@napi-rs/keyring@1.3.0`](https://www.npmjs.com/package/@napi-rs/keyring/v/1.3.0)
