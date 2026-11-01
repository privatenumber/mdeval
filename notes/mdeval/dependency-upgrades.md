# Dependency upgrade lessons

Verified 2026-11-01 against implementation commit `53f1b1dc241ad6adc5b1769eadbafaceac4e0ec9` and its lockfile.

## Check where an upstream fix actually lives

Upgrading a direct dependency does not necessarily refresh a previously locked transitive dependency. The [micromark 4.0.3 manifest](https://github.com/micromark/micromark/blob/4.0.3/packages/micromark/package.json#L63-L75) accepts `micromark-core-commonmark` through `^2.0.0`. The [4.0.3 release notes](https://github.com/micromark/micromark/releases/tag/4.0.3) mention an attention-flanking fix, but the implementation is in [micromark-core-commonmark 2.0.4](https://github.com/micromark/micromark/releases/tag/micromark-core-commonmark%402.0.4).

Observed: after the direct micromark upgrade, `pnpm why micromark-core-commonmark` still reported `2.0.3`. The fix reached the installed graph only after explicitly refreshing that transitive package:

```sh
pnpm update micromark-core-commonmark --no-save
pnpm why micromark-core-commonmark
```

The resulting graph reported `micromark-core-commonmark@2.0.4`. The Markdown and CLI suite then passed all 205 tests. The [parser](../../src/parse-markdown.ts) and [rendering validator](../../src/validate-rendering/index.ts) consume this graph. Do not claim an upstream fix is delivered based on the direct package version alone.

## A direct color-library upgrade does not fix every caller

The CLI uses ansis directly for warnings, while cleye renders help with its own dependency. [Cleye 2.7.0 pins ansis to exactly 4.2.0](https://github.com/privatenumber/cleye/blob/v2.7.0/package.json#L74-L78). [Ansis 4.4.0](https://github.com/webdiscus/ansis/releases/tag/v4.4.0) fixes auto-detection so `TERM=dumb` wins over `COLORTERM` and CI hints, unless color is explicitly forced.

Observed with the built CLI on Node.js 26.13.0:

| Environment | Warning output | Help output |
| --- | --- | --- |
| `NO_COLOR=1` | No ANSI color | No ANSI color |
| `FORCE_COLOR=1` | ANSI color | ANSI color |
| `TERM=dumb COLORTERM=truecolor CI=true`, without force-color variables | No ANSI color | ANSI styling remains |

The third row is a known upstream dependency limitation, not proof that the direct ansis upgrade failed. `pnpm why ansis` showed both 4.2.0 under cleye and 4.4.0 directly under mdeval. Recheck both help and warnings when cleye changes its dependency. No override was introduced during this upgrade.

To reproduce the third row, save the following synthetic input as `warning.md` in a disposable directory:

```markdown
<!--mdeval
const value = 1;
-->
```

From the repository root, substitute that file's path below. Capture stdout and stderr rather than judging only how the terminal displays them:

```sh
env -u FORCE_COLOR -u NO_COLOR TERM=dumb COLORTERM=truecolor CI=true node ./dist/cli.mjs --help
env -u FORCE_COLOR -u NO_COLOR TERM=dumb COLORTERM=truecolor CI=true node ./dist/cli.mjs /path/to/warning.md
```

The help output contains ANSI sequences; the warning output does not. The original check captured both streams through a subprocess, not a terminal.

## Preserve installation policy rather than approving new scripts implicitly

[The pnpm configuration](../../pnpm-workspace.yaml) allows esbuild's build script and explicitly denies unrs-resolver's. The earlier installation reported `Ignored build scripts: unrs-resolver`, while the baseline tests, type check, and lint passed. Denial preserves that behavior; approval would run additional installation code. The [pnpm installation note](../pnpm/installation-contracts.md) covers separate dependency skill permissions.

## Inspect packages without rewriting the manifest

The [prepack script](../../package.json) builds and runs clean-pkg-json, which normally rewrites `package.json`. For package-content inspection during maintenance, use a dry run and do not accidentally invoke a real pack in the working tree:

```sh
pnpm build
pnpm exec clean-pkg-json --dry
npm pack --dry-run --ignore-scripts
```

The published `files` allowlist contains `dist` and `skills`, not `notes`. Inspect the package file list rather than assuming all repository documentation is shipped. [Clean-pkg-json 1.4.2](https://github.com/privatenumber/clean-pkg-json/releases/tag/v1.4.2) also added npm dry-run detection; the explicit `--dry` command makes the intended non-writing behavior clear.
