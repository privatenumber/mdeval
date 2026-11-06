# Type checking with a TypeScript content mapper

Verified 2026-11-02 with `typescript@7.1.0-beta`, `ts-content-mapper@0.1.0`, and `clean-pkg-json@2.1.0`, on Node.js 24.14.0. Node.js support and `ts-content-mapper@0.1.1` were re-verified 2026-11-05.

## The checker sees the same module that the loader runs

TypeScript 7.1 adds content mappers: a project registers a package for a file extension in `tsconfig.json`, and `tsc --runExternalCode` asks that package for a virtual file with regions that map back to the original ([TypeScript 7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers), [implementing PR](https://github.com/microsoft/typescript-go/pull/4712)). TypeScript finds the executable through the package's `typescript.contentMapper.exec` field in [`package.json`](../../package.json).

[`generate-module.ts`](../../src/generate-module.ts) is the only place that turns Markdown into a module. [The loader](../../src/md-loader.ts) feeds its chunks to a source-map builder, and [the content mapper](../../src/content-mapper.ts) feeds the same chunks to `ts-content-mapper`'s `MappedCodeBuilder`. A chunk with a `sourceOffset` is copied verbatim from the Markdown, so its type errors map back to the original position.

**Decision:** keep one generator. Script scope, imports between `.md` files, and evaluate-once deduplication of repeated marker expressions then cannot drift between what the checker sees and what runs. [The content-mapper spec](../../tests/specs/content-mapper.ts) locks these behaviors, including the rule that a repeated expression reports errors only at its first occurrence.

## Global helper types

**Decision:** Markdown must type-check with `block` and `$` without imports. Each mapped module references the shared `mdeval/globals` declaration, whose types come from the runtime exports. Imports and local shadowing remain valid. Explicit imports were tried and rejected because they violate this requirement. The [content-mapper spec](../../tests/specs/content-mapper.ts) tests these cases and a conflicting global.

The declarations affect the entire TypeScript program, including files that do not run through the loader. A different global `block` or `$` can produce TS2403 or describe a different runtime value. Use a separate tsconfig for Markdown that excludes conflicting globals, as [Cypress recommends for conflicting test globals](https://docs.cypress.io/app/tooling/typescript-support). TypeScript has no per-file global environment: [#37053](https://github.com/microsoft/TypeScript/issues/37053) has been open since 2020 and is labeled Awaiting More Feedback; in [#60751](https://github.com/microsoft/TypeScript/issues/60751#issuecomment-2539658042), Ryan Cavanaugh explains why scoped types are not practical or well-defined.

The approach follows [svelte2tsx 0.7.63](https://github.com/sveltejs/language-tools/blob/svelte2tsx%400.7.63/packages/svelte2tsx/src/svelte2tsx/index.ts#L293) referencing [Svelte 5.57.3's global rune types](https://github.com/sveltejs/svelte/blob/svelte%405.57.3/packages/svelte/types/index.d.ts#L3341), [zx 8.8.5's global `$`](https://github.com/google/zx/blob/8.8.5/src/globals.ts#L15-L25), and [Vitest's globals configuration](https://vitest.dev/config/globals).

Module-local declarations would conflict with imports and local declarations unless the mapper performs binding analysis. [ts-content-mapper 0.1.1](https://github.com/sxzz/ts-content-mapper/blob/v0.1.1/src/protocol.ts#L46-L51) supplies source text and a filename, not a parser. Vue's language service instead uses TypeScript's parser and rewrites identifiers. [MDX 0.6.4](https://github.com/mdx-js/mdx-analyzer/blob/%40mdx-js/language-server%400.6.4/packages/language-service/lib/virtual-code.js#L61-L83) uses a function scope, incompatible with mdeval's module-level imports, exports, and top-level await. [Astro 4.0.0](https://github.com/withastro/compiler/blob/%40astrojs/compiler%404.0.0/internal/printer/print-to-tsx.go#L405-L420) uses a module-local declaration for the reserved `Astro` name; mdeval helpers can be shadowed. Revisit this decision if TypeScript adds scoped globals or conflicts are reported in practice.

The mapper still declares the reserved `__mdeval_guard` in module scope because generated marker expressions call it. The loader supplies the runtime value; its generic type preserves marker inference without modifying program globals.

On 2026-11-07, a generated project with 1,000 Markdown files, each using both unimported helpers, was checked with `typescript@7.1.0-beta` and Node.js 24.14.1 on macOS arm64. Five `/usr/bin/time -l node <tsc> --noEmit --runExternalCode --pretty false` runs after a warmup gave median 0.37 s and 200,261,632 bytes maximum RSS. This is the maximum reported by `time` for a process, not the sum of compiler and mapper processes. An earlier five-run comparison on 2026-11-06 with helper imports gave 0.39 s and 210,878,464 bytes with per-file globals, and 0.39 s and 207,601,664 bytes without them. The inputs and runs differ, so this is not a controlled comparison.

The installed `zx@8.8.5-lite` exports no `zx/globals`. On 2026-11-07, a temporary project installed full zx with `pnpm add zx@8.8.5 @types/node@26.6.6 @types/fs-extra@11.0.4`, symlinked `node_modules/mdeval` to the built project, and checked a Markdown marker using `$` with `types: ["zx/globals"]`. With TypeScript 7.1.0-beta and Node.js 24.14.1, `node <typescript7/bin/tsc> --noEmit --runExternalCode --pretty false` exited 2 with:

```text
node_modules/.pnpm/zx@8.8.5/node_modules/zx/build/globals.d.ts(7,9): error TS2403: Subsequent variable declarations must have the same type.  Variable '$' must be of type '$', but here has type '$'.
```

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
