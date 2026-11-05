# Runtime compatibility

Verified 2026-11-05 on macOS arm64 with Node.js 22.15.0, 22.18.0, 22.21.0, 22.21.1, 24.9.0, 24.10.0, 24.11.0, and 26.13.0, `typescript@7.1.0-beta`, and Node.js source at the tags named below.

## Development runtime and consumer minimum serve different purposes

[`.nvmrc`](../../.nvmrc) selects the development runtime, and both [test](../../.github/workflows/test.yml) and [release](../../.github/workflows/release.yml) workflows read it. Raising it also changes the runtime that builds release artifacts. [`engines.node`](../../package.json) is the consumer contract; changing the development pin does not justify raising it.

## Why `engines.node` is `^22.21.1 || >=24.11.0`

**Decision:** support only versions where every mdeval feature works: the loader, the CLI's quiet output, and type checking through the content mapper. Each bound comes from a specific failure below it.

### `module.registerHooks()` is the only loader API

[The loader](../../src/loader.ts) installs the synchronous load hook in [`md-loader.ts`](../../src/md-loader.ts) with `module.registerHooks()`. That API exists from Node.js 22.15.0 and 23.5.0 ([history at v26.13.0](https://github.com/nodejs/node/blob/v26.13.0/doc/api/module.md#L227-L241)).

The older `module.register()` is not an option. Node.js 26 deprecates it at runtime: "`module.register()` is deprecated. Use `module.registerHooks()` instead." ([DEP0205 at v26.13.0](https://github.com/nodejs/node/blob/v26.13.0/doc/api/deprecations.md#L4574-L4597)). Every process that calls it prints a `DeprecationWarning` to stderr, which breaks mdeval's quiet CLI output. The [quiet-output CLI test](../../tests/specs/cli.ts) asserts empty stderr, and with `module.register()` it failed on Node.js 26.13.0: `204 passed`, `1 failed`, stderr received `[DEP0205] DeprecationWarning`.

### `tsc` cannot start content mappers on Node.js 22.15 to 22.21.0 and 24.0 to 24.9

TypeScript 7's `bin/tsc` replaces the Node.js process with the native compiler through `process.execve(exe, [exe, ...process.argv.slice(2)])`, passing no environment (`node_modules/typescript7/lib/tsc.js` in `typescript@7.1.0-beta`). In these Node.js versions, `process.execve()` has no default for `env`, so the compiler starts with an empty environment and no `PATH`:

| Tag | `lib/internal/process/per_thread.js` |
| --- | --- |
| v22.15.0, v22.21.0, v24.0.0, v24.9.0 | `function execve(execPath, args, env) {` |
| v22.21.1, v24.10.0, v26.13.0 | `function execve(execPath, args = [], env = process.env) {` |

The fix is [nodejs/node#60029](https://github.com/nodejs/node/pull/60029), first released in v25.0.0. Checking every 22.x and 24.x tag, the fixed line first appears in v22.21.1 and v24.10.0. Before 22.15, `process.execve` does not exist and `tsc` falls back to `execFileSync`, which keeps the environment.

Observed: `node node_modules/typescript7/bin/tsc --runExternalCode` in a project that maps `.md` to mdeval:

```text
# Node.js 22.15.0, 22.21.0, 24.9.0 (exit code 2)
error TS18099: The content mapper 'mdeval' could not be initialized.
  The content mapper command 'node' could not be started: exec: "node": executable file not found in $PATH

# Node.js 22.21.1, 24.10.0, 24.11.0, 26.13.0 (exit code 0)
```

This is a TypeScript and Node.js interaction, not mdeval behavior, but it breaks mdeval's type checking. Re-evaluate the 22.x bound if TypeScript passes `process.env` to `process.execve()`.

### The 24.x bound matches `ts-content-mapper`

`ts-content-mapper@0.1.0`, which mdeval bundles into `dist/content-mapper.mjs`, declares `engines.node` as `^22.18.0 || >=24.11.0`. On 24.x, mdeval uses the same bound, so it does not declare wider support than its bundled mapper. On 22.x, mdeval's bound is higher, for the `execve` reason above.

## Verification

The [test workflow](../../.github/workflows/test.yml) runs the suite on the development runtime and on the minimum of each `engines.node` range:

```sh
pnpm dlx node@22.21.1 --import tsx tests/index.ts
pnpm dlx node@24.11.0 tests/index.ts
```

Node.js 22 cannot parse `await using` in the test suite (`SyntaxError: Unexpected identifier 'fixture'` on 22.18.0), so [tsx](https://tsx.is) runs it there. `pnpm dlx node@<version>` also puts that binary first on `PATH` for child processes, so the CLI, recipe, source-map, and content-mapper specs run the real loader and mapper on that version. Each run reported `214 passed`.

The `process-source` fixtures that import a relative `.js` or `.ts` module include `{"type": "module"}`. Without it, tsx on Node.js 22.x releases through 22.22 parses an ESM `.js` file in a directory without a package type as CommonJS, while Node.js itself detects it as ESM ([privatenumber/tsx#867](https://github.com/privatenumber/tsx/issues/867)). Remove the field from those fixtures when tsx fixes that issue.
