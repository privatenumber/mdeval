# TypeScript syntax in mdeval blocks

Verified 2026-11-05 on macOS arm64 with Node.js 20.19.0, 22.13.0, 22.14.0, 22.15.0, 22.17.0, 22.18.0, 23.6.0, 24.0.0, 24.11.0, 24.12.0, 25.0.0, and 26.13.0, `typescript@7.1.0-beta`, and Node.js source at `v26.13.0`. Experiments patched a built copy of mdeval at [`18041d3`](https://github.com/privatenumber/mdeval/commit/18041d3).

**Status:** research for a proposed feature. The recommended design below is not implemented. Today, blocks must be JavaScript: [the loader](../../src/md-loader.ts) returns `format: 'module'`, and [the content mapper](../../src/content-mapper.ts) returns an `.mjs` virtual file. A block with `const n: number = 1` fails at runtime with `SyntaxError: Missing initializer in const declaration`.

## Recommendation: every mdeval file is TypeScript

TypeScript's erasable syntax is a superset of JavaScript, so one rule can cover both languages:

1. **Runtime:** the load hook returns `format: 'module-typescript'`, and Node.js strips the types. It falls back to `'module'` when `process.features.typescript` is falsy or the file is under `node_modules`.
2. **Checker:** the content mapper always returns `.mts`.
3. **Docs:** recommend `erasableSyntaxOnly`. Projects no longer need `allowJs` and `checkJs`.

The runtime and the checker then parse every file with the same grammar, and nothing has to decide the language of a file: no detection, and no new syntax. The cost is that JSDoc types stop being checked and every process loads Node's TypeScript parser. The sections below give the evidence, and [Alternatives](#alternatives) explains why the other designs were rejected.

## Runtime: Node.js strips types for a hook that returns `module-typescript`

**Source:** a load hook can return TypeScript source with an explicit format ([`module.md` format table](https://github.com/nodejs/node/blob/v26.13.0/doc/api/module.md#L1060), supported since v22.6.0). The [`module-typescript` translator](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/modules/esm/translators.js#L684-L690) calls [`stripTypeScriptModuleTypes()`](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/modules/typescript.js#L152-L182), which runs amaro, Node's bundled SWC build, in `strip-only` mode. That mode replaces types with whitespace, so offsets do not change, and mdeval's existing source map stays valid.

- **No CLI flag needed.** The translator checks only that Node.js bundles amaro ([`assertTypeScript()`](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/util.js#L245-L250)). `--no-strip-types` disables extension-based detection, not an explicit format. Observed: with the format patched in, `.md` files with TypeScript syntax ran under `--no-strip-types` on 26.13.0 and `--no-experimental-strip-types` on 22.18.0.
- **`node_modules` is refused for every file, including plain JavaScript.** [`isUnderNodeModules()`](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/util.js#L541) matches `/[\\/]node_modules[\\/]/`. Observed on 26.13.0 for a JavaScript-only `.md` file: `Stripping types is currently unsupported for files under node_modules`.
- **Unsupported syntax fails clearly.** `enum` throws `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode`. See [Compile-time errors report generated lines](#compile-time-errors-report-generated-lines) for its location.
- **Imports keep working.** A `.md` file that imports `$` from `mdeval` and a TypeScript function from another `.md` file rendered `hi x` on 22.18.0 and 26.13.0.

### Version boundaries

Observed by running a TypeScript `.md` file with `MDEVAL_FORMAT=module-typescript` (the patch in [Reproduce](#reproduce)):

| Node.js | `process.features.typescript` | `module-typescript` result |
| --- | --- | --- |
| 20.19.0 | `undefined` | Every file fails: `Unknown module format: module-typescript` |
| 22.13.0, 22.14.0, 22.15.0, 22.17.0 | `false` | Runs, prints `ExperimentalWarning: Type Stripping is an experimental feature` |
| 22.18.0 | `'strip'` | Runs quietly |
| 23.6.0, 24.0.0 | `'strip'` | Runs, prints the warning |
| 24.11.0, 24.12.0, 25.0.0, 26.13.0 | `'strip'` | Runs quietly |

`process.features.typescript` was added in v22.10.0 and v23.0.0 and is `false` under `--no-strip-types` ([`process.md`](https://github.com/nodejs/node/blob/v26.13.0/doc/api/process.md#L2018-L2040)).

The warning comes from `emitExperimentalWarning('Type Stripping')` in `stripTypeScriptModuleTypes()`. `git show <tag>:lib/internal/modules/typescript.js` contains it at v22.17.1, v23.6.0, v23.11.0, v24.0.0, and v24.2.0, and not at v22.18.0, v24.3.0, or v25.0.0. Main removed it in [nodejs/node#58643](https://github.com/nodejs/node/pull/58643).

**Consequence:** a `process.features.typescript` gate avoids the failure on 20.19 and the warning on 22.13 through 22.17, but not the warning on 24.0 through 24.2. An earlier assumption that this gate prevents every warning was wrong.

### Cost

The parser loads once per process, and each file then costs a little more. Median of 30 interleaved fresh processes after 3 warmups ([method](#reproduce)):

| Case | 22.18.0 | 26.13.0 |
| --- | --- | --- |
| `node -e 0` | 18.9 ms | 22.8 ms |
| Load amaro only (`stripTypeScriptTypes("")`) | 35.3 ms | 35.7 ms |
| 1 JavaScript `.md` file, `module` | 48.1 ms | 46.6 ms |
| 1 JavaScript `.md` file, `module-typescript` | 66.4 ms | 61.5 ms |
| 200 JavaScript `.md` files, `module` | 80.6 ms | 71.5 ms |
| 200 JavaScript `.md` files, `module-typescript` | 113.4 ms | 100.3 ms |
| 200 files, `module-typescript`, `NODE_COMPILE_CACHE` warm | 116.2 ms | 77.1 ms |

- Loading amaro costs about 15 to 18 ms per process (the 1-file difference), and stripping costs about 0.07 ms per additional file. Plain JavaScript pays the same cost, because the format is chosen before the content is known.
- Node.js 24 and later cache stripped output in the compile cache, keyed by source and filename ([`typescript.js#L157-L165`](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/modules/typescript.js#L157-L165), added in [nodejs/node#56629](https://github.com/nodejs/node/pull/56629), first released in v24.0.0, absent at v22.23.4). A cache hit skips amaro: with a warm cache on 26.13.0, 200 files took 77.6 ms against 72.8 ms for `module` with its own warm cache. Node.js 22 has no such cache. Enabling the compile cache is the user's choice, so mdeval should not depend on it.

## Checker: the virtual file extension decides the language

The mapper's extension decides how TypeScript parses and checks the file. The same plain-JavaScript code, checked with `strict`, `allowJs`, and `checkJs`:

```js
export const add = (a, b) => a + b

/** @type {string} */
export const n = 1

/** @param {number} x */
export const sq = x => x * x

sq('s')

export const o = {}
o.a = 1
```

| Diagnostic | As `.mjs` | As `.mts` |
| --- | --- | --- |
| `a`, `b` implicitly `any` (TS7006) | Reported | Reported |
| `o.a = 1` (TS2339) | Allowed (expando) | Reported |
| `@type {string}` on `1` (TS2322) | Reported | Ignored |
| `sq("s")` against `@param {number}` (TS2345) | Reported | Ignored, and `x` becomes TS7006 |

Observed through the mapper with `.mjs` patched to `.mts`, using `tsc --runExternalCode` with the 7.1 beta:

- TypeScript syntax reports at the Markdown position: `docs/a.md(10,7): error TS2322: Type 'string' is not assignable to type 'number'.` With `.mjs`, the same file reports TS8006 and TS8010 ("can only be used in TypeScript files"), and tsc then skips semantic checks.
- `import { $ } from 'mdeval'` and imports between `.md` files resolve from an `.mts` virtual file.
- With `erasableSyntaxOnly`, `enum` reports at its Markdown line: `docs/e.md(6,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.`
- `.mts` needs neither `allowJs` nor `checkJs`. This removes a setup trap: with `.mjs` and no `checkJs`, `tsc` passes silently.

## Alternatives

| Design | Verdict | Evidence |
| --- | --- | --- |
| **Every file is TypeScript** (recommended) | Simplest: one runtime gate and a constant extension | Above |
| **Detect per file in the mapper:** strip with `module.stripTypeScriptTypes()`, return `.mts` if the text changed, otherwise `.mjs` | Rejected. It keeps JSDoc checking, but adds a detection step that depends on a Stability 1.2 API. That API emits `ExperimentalWarning: stripTypeScriptTypes` on every call on 26.13.0 ([`typescript.js#L92`](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/modules/typescript.js#L92)), visible only with `TS_CONTENT_MAPPER_DEBUG=1`. It also requires Node.js 22.13 or later in the mapper, which [runs on 20.19 today](./type-checking.md#nodejs-support). The runtime would still use `module-typescript` for every file, so it saves no runtime cost. | `typeof stripTypeScriptTypes` is `undefined` on 20.19.0 |
| **Explicit opt-in per file**, for example a `lang` marker | Viable. Plain JavaScript files keep `module`, `.mjs`, JSDoc, and no parser cost. The cost is new syntax that both the loader and the mapper must parse. All blocks in a file form one module, so they need one language. Vue enforces the same rule: `<script> and <script setup> must have the same language type` ([`compileScript.ts` at v3.5.44](https://github.com/vuejs/core/blob/v3.5.44/packages/compiler-sfc/src/compileScript.ts#L188-L193)). | |
| **Strip in mdeval** with `stripTypeScriptTypes()` and return `module` | Rejected. It has the same parser cost, prints the warning above at runtime, and loses the compile cache integration. | |
| **`module-typescript` for every file without a gate** | Rejected. On 20.19 every `.md` file fails, and JavaScript files under `node_modules` fail. | [Version boundaries](#version-boundaries) |
| **Bundle a transpiler**, such as esbuild or sucrase | Rejected. It adds a dependency for every install, and full transforms move offsets, so the source map would need a second mapping step. | |

## Trade-offs the recommendation accepts

- **JSDoc types are not checked.** Authors write TypeScript annotations instead. Type checking is unreleased (npm `latest` is 1.6.0, and no tag contains `18041d3`), so no released contract depends on JSDoc.
- **JavaScript leniency is lost in the checker,** such as expando properties on `{}`.
- **A few JavaScript expressions change meaning.** `a < b > (c)` is a comparison in JavaScript and a generic call in TypeScript. Observed on 26.13.0: `module` rendered `false`, and `module-typescript` failed with `a is not a function`. The checker parses it the same way as the runtime, so `tsc` reports the problem too. Node.js has the same rule for `.ts` files.
- **On Node.js 20.19 and 22.13 to 22.17, TypeScript syntax fails as a JavaScript `SyntaxError`.** Plain JavaScript keeps working. The docs should name the supported range: Node.js 22.18 or later, or 24.3 or later.
- **Node.js 24.0 to 24.2 print an `ExperimentalWarning`.**

## Compile-time errors report generated lines

Errors raised before V8 runs the module report lines of the generated module, not of the Markdown file, because the source map applies only to stack frames. This already affects JavaScript syntax errors.

- `enum` on Markdown line 7 reported `file:///.../w.md:2`, the line in the generated module.
- On 20.19.0, `interface User { name: string }` on Markdown line 8 reported `run.md:3` with `SyntaxError: Unexpected strict mode reserved word`.

The checker reports both at the right Markdown lines, so it is the better place to catch them. A fix at runtime would mean generating the module with Markdown line numbers preserved, which is a separate change.

## Re-evaluate when

- **`engines.node` rises to `^22.18.0 || >=24.3.0`.** Node.js 20 reached end of life on 2026-04-30 ([endoflife.date](https://endoflife.date/nodejs)). At that minimum, the `process.features.typescript` gate only respects `--no-strip-types`, and the [`module.register()` fallback](./runtime-compatibility.md) can go too. Raising `engines` is a breaking release.
- **Users depend on JSDoc checking,** or the parser cost matters. Explicit opt-in then becomes the better trade.
- **Node.js allows stripping under `node_modules`,** which would remove the path check.

## Reproduce

Patch a built copy of mdeval so the format and extension come from environment variables:

```sh
sed -i '' 's/format:"module"/format:process.env.MDEVAL_FORMAT||"module"/' dist/md-loader.mjs
sed -i '' 's/build("\.mjs")/build(process.env.MDEVAL_EXT||".mjs")/' dist/content-mapper.mjs
```

- Runtime: `MDEVAL_FORMAT=module-typescript node dist/cli.mjs file.md`, with each Node.js version from `pnpm dlx node@<version> -p process.execPath`.
- Checker: `MDEVAL_EXT=.mts node node_modules/typescript7/bin/tsc --noEmit --runExternalCode`, in a project whose `contentMappers` registers the patched package for `.md`.
- Cost: spawn each case in turn from a Node.js script with `spawnSync`, discard 3 warmup rounds, and take the median of 30 rounds. `many.mjs` imports 200 generated `.md` files, each with two marker expressions.
