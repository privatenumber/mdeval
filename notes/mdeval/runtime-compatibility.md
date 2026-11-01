# Runtime compatibility

Verified 2026-11-01 on Node.js 26.13.0, 22.14.0, and 20.19.0.

## Development runtime and consumer minimum serve different purposes

[`.nvmrc`](../../.nvmrc) selects the development runtime, and both [test](../../.github/workflows/test.yml) and [release](../../.github/workflows/release.yml) workflows read it. Raising it also changes the runtime that builds release artifacts. [`engines.node`](../../package.json) is the consumer contract at `>=20.19`; changing the development pin does not justify raising it.

## Loader selection preserves older consumers

Node.js 26 deprecates `module.register()` at runtime: "`module.register()` is deprecated. Use `module.registerHooks()` instead." ([DEP0205 at v26.13.0](https://github.com/nodejs/node/blob/v26.13.0/doc/api/deprecations.md#L4574-L4597)). Every process that calls it prints a `DeprecationWarning` to stderr, which breaks mdeval's quiet CLI output. The replacement, `module.registerHooks()`, exists only from Node.js 22.15.0 and 23.5.0 ([history at v26.13.0](https://github.com/nodejs/node/blob/v26.13.0/doc/api/module.md#L227-L241)).

[The loader](../../src/loader.ts) selects the API by capability. It uses synchronous hooks when `module.registerHooks` exists and otherwise registers `#md-loader` through `module.register()`. [`md-loader.ts`](../../src/md-loader.ts) exports a hook for each API around one shared transform: `loadSync` reads with `readFileSync` for `registerHooks()`, and `load` reads with `fs.promises.readFile` for `module.register()`.

**Performance:** `loader.ts` imports `loadSync` dynamically, inside the `registerHooks` branch. On the fallback path the hooks run on the loader thread, so a top-level import would load the Markdown parser on the main thread for nothing. The fallback also keeps an async read, because the loader thread can overlap reads across concurrent imports. Measured with 50 interleaved fresh processes per build, importing 200 `.md` files (median ms):

| Node.js | Before (`register()` only) | Sync hook, top-level import | Current |
| --- | --- | --- | --- |
| 26.13.0 | 116 | 86 | 87 |
| 22.14.0 | 122 | 177 | 120 |
| 20.19.0 | 174 | 256 | 175 |

Importing a single `.md` file showed the same direction: the top-level import alone added about 15-20 ms per process on Node.js 22.14 and 20.19.

**Decision:** keep the `module.register()` fallback while `engines.node` includes Node.js 20 and Node.js 22 releases before 22.15. Selecting by the development runtime alone would break those consumers. Remove the fallback when the consumer minimum reaches 22.15.

## Verification

The [quiet-output CLI test](../../tests/specs/cli.ts) asserts empty stderr, so it is the regression test for this warning. With `pnpm test` on Node.js 26.13.0:

| Loader | Result |
| --- | --- |
| `module.register()` only (before the fix) | `204 passed`, `1 failed`: stderr received `[DEP0205] DeprecationWarning` |
| Capability selection (current) | `205 passed` |

The test suite cannot run on the versions that use the fallback: Node.js 20 cannot strip types, and Node.js 22.14 cannot parse `await using`. Instead, [`tests/fallback-smoke.mjs`](../../tests/fallback-smoke.mjs) checks the built artifacts with Node.js built-ins only. It imports a synthetic `.md` file through `dist/loader.mjs`, runs `dist/cli.mjs` on it, and requires empty stderr and the rewritten marker. The [test workflow](../../.github/workflows/test.yml) runs it on Node.js 20.19.0 and 22.14.0 after the main suite. To run it locally, build first, then run `node tests/fallback-smoke.mjs` with the target Node.js version selected.

The script passed on Node.js 20.19.0, 22.14.0, and 26.13.0. With the capability check disabled so that Node.js 26.13.0 used `module.register()`, it failed on the `[DEP0205]` stderr output, so the check also catches this regression.
