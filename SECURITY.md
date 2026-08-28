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

The Phase 1 code is not a security boundary. The v0.1 target is to reduce accidental local
damage for a single developer; it is not designed to execute malicious multi-tenant code.
