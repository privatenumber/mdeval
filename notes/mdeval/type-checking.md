# Type checking with a TypeScript content mapper

Verified 2026-11-02 with `typescript@7.1.0-beta`, `ts-content-mapper@0.1.0`, and `clean-pkg-json@2.1.0`, on Node.js 24.14.0. Node.js support and `ts-content-mapper@0.1.1` were re-verified 2026-11-05.

## The checker sees the same module that the loader runs

TypeScript 7.1 adds content mappers: a project registers a package for a file extension in `tsconfig.json`, and `tsc --runExternalCode` asks that package for a virtual file with regions that map back to the original ([TypeScript 7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers), [implementing PR](https://github.com/microsoft/typescript-go/pull/4712)). TypeScript finds the executable through the package's `typescript.contentMapper.exec` field in [`package.json`](../../package.json).

[`generate-module.ts`](../../src/generate-module.ts) is the only place that turns Markdown into a module. [The loader](../../src/md-loader.ts) feeds its chunks to a source-map builder, and [the content mapper](../../src/content-mapper.ts) feeds the same chunks to `ts-content-mapper`'s `MappedCodeBuilder`. A chunk with a `sourceOffset` is copied verbatim from the Markdown, so its type errors map back to the original position.

**Decision:** keep one generator. Script scope, imports between `.md` files, and evaluate-once deduplication of repeated marker expressions then cannot drift between what the checker sees and what runs. [The content-mapper spec](../../tests/specs/content-mapper.ts) locks these behaviors, including the rule that a repeated expression reports errors only at its first occurrence.

## Helper globals are declared with `declare global`

The CLI and `mdeval/loader` put `block` and `$` on `globalThis`, so `.md` files call them without an import. The checker cannot see that assignment. Without a declaration, it reported `Cannot find name 'block'` for every file that used a helper (observed 2026-11-05 with `typescript@7.1.0-beta`).

**Decision:** [the content mapper](../../src/content-mapper.ts) appends `declare global { var block: typeof import('mdeval').block; var $: typeof import('mdeval').$; }` to each virtual file. The types come from the published `mdeval` entry, so they cannot drift from the runtime.

- **Global, not a module binding:** an injected `import { block } from 'mdeval'` or `declare const block` would conflict with a user's own import or `const block`. A global is shadowed by those declarations, the same as at runtime. [The content-mapper spec](../../tests/specs/content-mapper.ts) locks the global, imported, and shadowed cases.
- **Repeated declarations are allowed:** every `.md` file declares the same `var`s, and TypeScript merges `var` declarations with identical types.
- **The cost is about 3 KB of memory per file, and no measurable time.** Measured 2026-11-05 with `typescript@7.1.0-beta` on Node.js 24.14.0, macOS arm64. Each file imported the helpers explicitly, so the same files checked cleanly with and without the declaration. Medians of 5 interleaved `tsc --runExternalCode --extendedDiagnostics` runs after a warmup:

  | `.md` files | Total time without / with | Memory without / with |
  | --- | --- | --- |
  | 1 | 0.212 s / 0.211 s | 112.2 MB / 112.5 MB |
  | 1,000 | 0.304 s / 0.309 s | 121.9 MB / 125.0 MB |
  | 10,000 | 1.292 s / 1.316 s | 219.8 MB / 245.6 MB |

  The time differences are within run-to-run noise: a second 1,000-file run measured 0.322 s without and 0.316 s with. If memory matters for very large projects, one shared declaration file would replace the per-file copies.
- **Accepted trade-off:** the augmentation is visible to every file in the program, including `.ts` files. Those files see the globals only when the loader runs them, and [Node.js usage](../../docs/node.md#helpers-without-the-loader) recommends the explicit import there.

## Packaging requirements

The published mapper depends on each of these package settings.

- **`--export-condition=node` in `build`:** `vscode-jsonrpc` (a dependency of `ts-content-mapper`) exports `./node` only under the `node` condition (`"./node": { "types": ..., "node": "./lib/node/main.js" }` in `vscode-jsonrpc@9.0.3/package.json`). pkgroll bundles devDependencies, so it must resolve that condition. Without the flag, `pkgroll --minify` warns `"vscode-jsonrpc/node" ... could not be resolved – treating it as an external dependency.` The published mapper would then import a package that consumers do not install. **Decision:** keep `ts-content-mapper` a bundled devDependency. Moving it to `dependencies` would avoid the flag, but every mdeval install would then pull in `ts-content-mapper` and `vscode-jsonrpc`, even for projects that never type-check. The bundle adds about 72 KB to `dist/`.
- **`clean-pkg-json@^2.1.0` in `prepack`:** `clean-pkg-json` removes fields outside its allowlist. Version 2.0.0 removed the `typescript.contentMapper` registration unless `--keep typescript` was passed. [Version 2.1.0 adds `typescript` to the default allowlist](https://github.com/privatenumber/clean-pkg-json/blob/v2.1.0/src/default-keep-properties.ts#L93-L94), and `npx clean-pkg-json --dry` prints the field without the flag.
- **`#content-mapper` in `imports`:** this gives pkgroll a build entry for `dist/content-mapper.mjs`.
- **`types` condition on the `.` export:** checked Markdown that imports `block` or `$` from `mdeval` needs `dist/runtime.d.mts`.
- **`@types/fs-extra` in `dependencies`:** `zx@8.8.5-lite` does not depend on `@types/fs-extra`, but `node_modules/zx/build/core.d.ts` starts with `/// <reference types="fs-extra" />`. `runtime.d.mts` re-exports `$` from `zx`, so consumers need the package. Observed with the package removed, in a project whose `.md` file imports from `mdeval`, without `skipLibCheck`:

  ```text
  .../zx@8.8.5-lite/node_modules/zx/build/core.d.ts(2,23): error TS2688: Cannot find type definition file for 'fs-extra'.
  ```

  Remove the dependency when zx-lite ships or depends on these types.

## Two TypeScript versions in development

The repository type-checks its own source with `typescript@^6` ([why it stays on 6.x](./typescript.md)). The content-mapper spec needs the 7.1 beta compiler, so it is installed under the alias `typescript7` (`npm:typescript@7.1.0-beta`). Both packages provide a `tsc` bin, and pnpm links `node_modules/.bin/tsc` to the 7.1 beta (`cmd-shim-target=../.pnpm/typescript@7.1.0-beta/...`). For this reason, the `type-check` script runs `node node_modules/typescript/bin/tsc` explicitly.

**Decision:** pin exactly `7.1.0-beta` for tests and in [the type-checking docs](../../docs/type-checking.md). The beta is a prerelease, and the announcement plans a release candidate about a month after 2026-10-20. Re-evaluate the pin, the alias, and the README version when 7.1 is stable. Drop the alias when the repository moves its own type check to TypeScript 7.

## Node.js support

mdeval's `engines.node` covers `ts-content-mapper@0.1.1`'s `^22.18.0 || >=24.11.0`, and excludes Node.js versions where `tsc` cannot start a content mapper at all. [Runtime compatibility](./runtime-compatibility.md#why-enginesnode-is-22211--24110) explains both bounds.

TypeScript starts the mapper with the `node` on `PATH`. In the [test workflow](../../.github/workflows/test.yml), `pnpm dlx node@<version>` puts that binary on `PATH` for child processes (`execSync('node -v')` under it prints that version), so the jobs for the `engines.node` minimums run the mapper on those versions.

## Evidence gaps

- `ts-content-mapper` was used without a comparison against writing the JSON-RPC protocol directly.
- Editor integration, the language service, and watch or incremental builds are not verified.
