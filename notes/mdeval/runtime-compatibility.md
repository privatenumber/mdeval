# Runtime compatibility

Verified 2026-11-01 against implementation commit `53f1b1dc241ad6adc5b1769eadbafaceac4e0ec9`, Node.js 26.13.0, and a Node.js 20.19.0 consumer smoke check.

## Development runtime and consumer minimum serve different purposes

[`.nvmrc`](../../.nvmrc) selects the development runtime, and both [test](../../.github/workflows/test.yml) and [release](../../.github/workflows/release.yml) workflows read it. Raising this version also changes the runtime used to build release artifacts. [`engines.node`](../../package.json) remains the consumer contract at `>=20.19`; changing the development pin does not justify raising that minimum.

## Loader selection preserves older consumers

[The loader](../../src/loader.ts) seeds the Markdown helpers, enables source maps, and selects the registration API by capability. It uses synchronous hooks when `module.registerHooks` exists and otherwise registers `#md-loader` through the older API. The shared [load hook](../../src/md-loader.ts) reads Markdown synchronously, so it satisfies the synchronous API while remaining callable by the older loader.

**Decision:** retain the older registration path while the consumer contract includes Node.js 20.19 and Node.js 22 releases before 22.15. The [upstream API boundaries](../node/module-hooks.md) explain why selecting only by the development runtime would break supported consumers. Re-evaluate the fallback when the consumer minimum changes.

**Observed regression:** before the hook migration, `pnpm test` on Node.js 26.13.0 reported `204 passed` and `1 failed`. The failing [quiet-output CLI test](../../tests/specs/cli.ts) expected empty stderr but received DEP0205. After the migration, the same suite reported `205 passed`. The assertion was retained; no warning filter was added.

## Verification boundaries

On Node.js 26.13.0, the following checks passed:

```sh
pnpm test
pnpm type-check
pnpm lint
```

The suite covers static Markdown imports through the [consumer recipe](../../tests/specs/recipe.ts), [source-map remapping](../../tests/specs/source-map.ts), and CLI output. Lint retained six pre-existing warnings and reported no errors.

On Node.js 20.19.0, a separate smoke check used a synthetic `data.md` exporting `value = 42`, a consumer importing that value through `--import ./dist/loader.mjs`, and the built CLI rewriting `<!--mdeval value-->old<!--/mdeval-->`. The imported value was 42, the rewritten marker contained 42, and CLI stderr was empty. This establishes those built-artifact paths, not full-suite coverage on Node.js 20.19. The TypeScript test entry point was not run on that runtime.

For a manual consumer check, use this Markdown input:

```markdown
# Data

<!--mdeval
export const value = 42;
-->

<!--mdeval value-->old<!--/mdeval-->
```

Save it as `data.md` in a disposable directory. With the desired Node version selected, run the built loader and CLI from the repository root:

```sh
node --import ./dist/loader.mjs --input-type=module -e 'import assert from "node:assert/strict"; const { value } = await import("./data.md"); assert.equal(value, 42);'
node ./dist/cli.mjs ./data.md
```

Adjust the input path if the disposable directory is not the repository root. Inspect stderr as well as the exit status. Do not use a real document for a rewrite smoke check.
