# Type checking with a TypeScript content mapper

Verified 2026-11-02 with `typescript@7.1.0-beta`, `ts-content-mapper@0.1.0`, and `clean-pkg-json@2.1.0`, on Node.js 24.14.0. Node.js support and `ts-content-mapper@0.1.1` were re-verified 2026-11-05.

## The checker sees the same module that the loader runs

TypeScript 7.1 adds content mappers: a project registers a package for a file extension in `tsconfig.json`, and `tsc --runExternalCode` asks that package for a virtual file with regions that map back to the original ([TypeScript 7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers), [implementing PR](https://github.com/microsoft/typescript-go/pull/4712)). TypeScript finds the executable through the package's `typescript.contentMapper.exec` field in [`package.json`](../../package.json).

[`generate-module.ts`](../../src/generate-module.ts) is the only place that turns Markdown into a module. [The loader](../../src/md-loader.ts) feeds its chunks to a source-map builder, and [the content mapper](../../src/content-mapper.ts) feeds the same chunks to `ts-content-mapper`'s `MappedCodeBuilder`. A chunk with a `sourceOffset` is copied verbatim from the Markdown, so its type errors map back to the original position.

**Decision:** keep one generator. Script scope, imports between `.md` files, and evaluate-once deduplication of repeated marker expressions then cannot drift between what the checker sees and what runs. [The content-mapper spec](../../tests/specs/content-mapper.ts) locks these behaviors, including the rule that a repeated expression reports errors only at its first occurrence.

## Type-checked files import helpers

**Decision:** type-checked Markdown imports the helpers it uses from `mdeval`. The CLI and loader still assign `block` and `$` to `globalThis` at runtime, but the mapper does not declare them globally. The [content-mapper spec](../../tests/specs/content-mapper.ts) checks imports, local shadowing, an unimported helper, and an unrelated project global named `$`.

A global declaration affects every file in the TypeScript program, even files that never run through the loader. With `typescript@7.1.0-beta`, a Markdown file declaring the helper globally and a separate `declare global { var $: number }` produced TS2403 and made `$.toFixed()` report TS2339. The [loader](../../src/loader.ts) assigns `$` unconditionally when it runs, so a global helper type cannot also describe the unrelated project's `$`. Documenting that conflict would not prevent unrelated files from receiving incorrect types.

Module-local helper declarations avoid the program-wide conflict but conflict with a Markdown file's own `const block` or import. Conditionally omitting them requires complete binding analysis, including imports and destructuring. Wrapping the user module in a scope would need to preserve imports, exports, top-level await, and source mappings. Explicit imports avoid both transformations and work when the virtual output is JavaScript.

Other tools choose scopes that match their own formats: [MDX language service 0.6.4](https://github.com/mdx-js/mdx-analyzer/blob/%40mdx-js/language-server%400.6.4/packages/language-service/lib/virtual-code.js#L61-L83) creates a component map inside a generated function; [Astro compiler 4.0.0](https://github.com/withastro/compiler/blob/%40astrojs/compiler%404.0.0/internal/printer/print-to-tsx.go#L405-L420) emits a module-local declaration for its `Astro` global. Re-evaluate implicit helpers if TypeScript content mappers gain a per-file ambient environment that supports normal lexical shadowing.

The mapper still declares the reserved `__mdeval_guard` in module scope because generated marker expressions call it. The loader supplies the runtime value; its generic type preserves marker inference without modifying program globals.

On 2026-11-06, a generated project with 1,000 Markdown files, each importing both helpers and using markers, was checked with `typescript@7.1.0-beta` and Node.js 24.14.1 on macOS arm64. Across five interleaved `/usr/bin/time -l node <tsc> --noEmit --runExternalCode --pretty false` runs after a warmup, median wall time was 0.39 s both before and after removing the global declarations. The reported maximum resident set size was 210,878,464 bytes before and 207,601,664 bytes after. This is the maximum reported by `time` for a process, not the sum of the compiler and mapper processes.

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
