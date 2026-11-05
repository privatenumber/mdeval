# cleye

Verified 2026-11-01 against cleye 2.3.0 and 2.7.0.

**Decision:** keep the cleye minimum at `^2.3.0`. Raising it to `^2.7.0` would make `--help` ignore `TERM=dumb` for every install. Re-evaluate when a cleye release depends on ansis `^4.4.0` or newer instead of an exact 4.2.0.

## Help and warnings use different color detection

mdeval prints warnings with Node's [`util.styleText()`](https://nodejs.org/api/util.html#utilstyletextformat-text-options), checked against `process.stderr`, while [cleye](https://github.com/privatenumber/cleye) renders `--help` with its own color handling. See [Warning colors](#warning-colors-follow-stderr). [cleye 2.7.0 pins ansis to exactly 4.2.0](https://github.com/privatenumber/cleye/blob/v2.7.0/package.json#L74-L78), so mdeval cannot dedupe it to a newer version. [ansis 4.4.0](https://github.com/webdiscus/ansis/releases/tag/v4.4.0) is the first release where `TERM=dumb` disables color even when `COLORTERM` or a CI variable is set.

Observed with the built CLI on Node.js 24.14.0, piped output, and ansis 4.4.0 for warnings, before warnings moved to `util.styleText()`. The table counts output lines that contain ANSI escape sequences:

| Environment | Warnings | Help, cleye 2.3.0 | Help, cleye 2.7.0 |
| --- | --- | --- | --- |
| `NO_COLOR=1` | 0 | 0 | 0 |
| `FORCE_COLOR=1` | 1 | 2 | 2 |
| `TERM=dumb COLORTERM=truecolor CI=true` | 0 | 0 | 2 |

cleye 2.3.0 already respected `NO_COLOR` and `FORCE_COLOR` for mdeval's help, with and without a TTY. So the cleye 2.7.0 fix "respect NO_COLOR / FORCE_COLOR" changes nothing for mdeval.

A fresh install of mdeval still resolves cleye 2.7.0 through `^2.3.0`. The decision only avoids forcing that version on projects whose lockfiles hold an older one.

## Warning colors follow stderr

**Decision:** color warnings with `styleText('yellow', 'Warning:', { stream: process.stderr })` in [`cli.ts`](../../src/cli.ts), not with ansis. Verified 2026-11-06 on Node.js 24.14.0.

ansis detects color support from `process.stdout`, but mdeval writes warnings to stderr. With `COLORTERM=truecolor`, ansis 4.4.0 and 4.5.0 both gave wrong results:

| Case | ansis 4.4.0 | ansis 4.5.0 | `styleText` on stderr |
| --- | --- | --- | --- |
| stdout on a TTY, stderr redirected to a file | Colored | Colored | Plain |
| stdout captured, stderr on a TTY (the README's Lefthook hook) | Colored | Plain | Colored |
| Both streams piped | Colored | Plain | Plain |
| Both streams piped, `CI=true` | Colored | Colored | Plain |

`styleText()` checks the given stream's `isTTY` and color depth, which respects `NO_COLOR` and `TERM=dumb`. A `FORCE_COLOR` variable overrides the stream check, even when it is empty ([`colors.js` at v22.21.1](https://github.com/nodejs/node/blob/v22.21.1/lib/internal/util/colors.js)). The `stream` option exists from Node.js 22.13.0, below `engines.node`. [The CLI spec](../../tests/specs/cli.ts) covers piped and forced output. The TTY cases need a pseudo-terminal, so they were checked by hand with `script -q /dev/null`.

## Reproduce

Build, then compare the output of each command with and without `TERM=dumb COLORTERM=truecolor CI=true`, with `FORCE_COLOR` and `NO_COLOR` unset. `warning.md` is a disposable file whose only content is an mdeval block, so the CLI warns about it:

```sh
node dist/cli.mjs --help | grep -c $'\e\['
node dist/cli.mjs warning.md 2>&1 | grep -c $'\e\['
```

Check `pnpm why ansis` too: the copy under cleye is the one that renders help.
