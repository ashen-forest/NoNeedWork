# Repository Instructions

- Follow `docs/superpowers/specs/2026-08-28-noneedwork-system-design.md` and
  `plan/architecture-noneedwork-v0.1.md`.
- Only `packages/pi-adapter` may import PI packages.
- Keep runtime code in the modular monolith under `apps/runtime/src/modules`.
- Never expose PI built-in `bash`, `edit`, or `write` to NoNeedWork model sessions.
- Never call Docker directly from a model tool; route through Tool Gateway and SandboxProvider.
- Persist intent before side effects and result artifacts before returning observations to PI.
- Use Zod at process and persistence boundaries.
- Add tests for every state transition, policy rule, recovery behavior, and security boundary.
- Do not add cloud, authentication, recursive agents, long-term memory, RAG, or host shell scope
  to v0.1.
