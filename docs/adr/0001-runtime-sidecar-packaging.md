# ADR 0001: Package the PI runtime as a Tauri sidecar

- Status: Accepted for Phase 1
- Date: 2026-08-28

## Context

NoNeedWork must ship its Node.js Runtime, the PI SDK, and PI runtime resources without requiring an end user to install Node.js. Tauri requires one platform-suffixed executable for an `externalBin`. PI contains provider modules and non-code resources that must remain available after packaging.

## Decision

Use the Node 24 Single Executable Application facility for a small platform-native launcher and ship the compiled Runtime plus a lockfile-derived production dependency tree as a Tauri resource directory. The CommonJS launcher performs one dynamic import into the external ESM application. This preserves Node's normal package `exports`, dynamic imports, and PI resource lookup while removing the end-user Node installation requirement.

`packaging/runtime-sidecar/package-lock.json` pins the external resource dependency graph. `scripts/build-runtime-sidecar.mjs` creates the SEA executable and materializes the resource directory. `scripts/verify-sidecar.mjs` starts the produced executable, validates the authenticated startup handshake, calls `/v1/health`, and requires the response to report PI `0.84.3` with safe mode enabled.

The Tauri Rust host starts the sidecar and retains the bearer token. The WebView receives only an opaque, non-authorizing connection handle and public process metadata.

## Consequences

- A PI upgrade must pass both the Adapter Contract Suite and sidecar verification.
- CI must build a sidecar on Windows and Ubuntu; a JavaScript-only frontend build is not sufficient.
- The Rust host passes Tauri's resolved resource directory to the launcher, so bundle layout is not inferred from the current working directory.
- The external resource tree is larger than a JavaScript bundle, but it is inspectable, deterministic, and exercises the same module semantics used in development.

## Rejected approach

`@yao-pkg/pkg@6.22.0` produced a Windows executable, but the verification spike failed before startup with `ERR_PACKAGE_PATH_NOT_EXPORTED` while resolving `@earendil-works/pi-coding-agent`. Its snapshot loader did not preserve PI's ESM-only package boundary. Adding globbed scripts or assets would hide this semantic mismatch rather than make the artifact trustworthy, so the single-file snapshot approach is not used.
