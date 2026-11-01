# Module hook version boundaries

Verified 2026-11-01 against Node.js 26.13.0 documentation and runtime.

## Prefer synchronous hooks when available

Node.js documents `module.register()` as runtime-deprecated starting in 26.0.0. Its replacement, `module.registerHooks()`, runs hooks synchronously in the importing thread rather than in a separate loader thread. The decisive instruction is: "`module.register()` is deprecated. Use `module.registerHooks()` instead." See [DEP0205 at v26.13.0](https://github.com/nodejs/node/blob/v26.13.0/doc/api/deprecations.md#L4574-L4597).

The replacement is not available across every older supported runtime. Its version history lists Node.js 22.15.0 and 23.5.0 as the introduction points; it became release-candidate stability in 24.13.1 and 25.4.0. See [the v26.13.0 API history](https://github.com/nodejs/node/blob/v26.13.0/doc/api/module.md#L227-L241). Availability and stability are separate boundaries.

## Minimal runtime reproduction

On Node.js 26.13.0, run:

```sh
node --input-type=module -e 'import { register } from "node:module"; register("data:text/javascript,export {}");'
```

Observed stderr includes:

```text
[DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
```

The command succeeds, but the warning is observable output. A passing exit status alone does not demonstrate quiet CLI behavior. See [mdeval's loader decision](../mdeval/runtime-compatibility.md) for the compatibility fallback and regression coverage.
