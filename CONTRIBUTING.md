# Contributing

NoNeedWork is in its foundation phase. Before opening a change:

1. Read the approved system design and implementation plan.
2. Keep PI imports inside `packages/pi-adapter`.
3. Route every capability through the Tool Gateway.
4. Add deterministic tests and a benchmark or fault case for runtime behavior changes.
5. Run `npm run ci` and the relevant Docker integration tests.

Use focused commits and describe security-boundary changes explicitly in the pull request.
