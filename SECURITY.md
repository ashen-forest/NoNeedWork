# Security Policy

## Supported versions

No public release is supported yet. The `main` branch is development software.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Do not open a public issue
for sandbox escapes, credential exposure, policy bypasses, path traversal, or unintended host
side effects.

Include the affected commit, reproduction steps, expected boundary, actual behavior, and any
relevant redacted trace IDs. Never include live credentials.

## Current boundary

NoNeedWork isolates a copied task workspace in an offline, read-only-root Docker container
and records durable tool operations. PI built-in shell and file-write tools are excluded;
the model receives only NoNeedWork tools mediated by Tool Gateway. Qwen and MiniMax
credentials are stored only in Windows Credential Manager and are injected into a
task-scoped in-memory PI runtime. They are not read from environment variables, PI
`auth.json`, or PI `models.json`, and are never passed to Docker.

The broader v0.1 policy engine, one-shot approval workflow, and approved host patch
application are not complete. The current target is to reduce accidental local damage for a
single developer; it is not designed to execute malicious or multi-tenant code.

Deleting a provider credential prevents new provider requests and causes affected resumable
tasks to pause before sandbox creation. It does not revoke a request already accepted by an
external provider. Rotate a compromised credential with the provider as well as deleting it
from NoNeedWork.

Provider protocol probes consume external quota and send their fixed prompts and schemas to
the selected provider. They run only after an explicit `nw model test` confirmation or an
explicit live-test opt-in. No live provider secrets are stored in this repository or public
CI.
