# cleye

Verified 2026-11-01 against cleye 2.3.0 and 2.7.0.

**Decision:** keep the cleye minimum at `^2.3.0`. Raising it to `^2.7.0` would make `--help` ignore `TERM=dumb` for every install. Re-evaluate when a cleye release depends on ansis `^4.4.0` or newer instead of an exact 4.2.0.

## Help and warnings use different ansis instances

mdeval prints warnings with its own ansis dependency, while [cleye](https://github.com/privatenumber/cleye) renders `--help` with a separate copy. [cleye 2.7.0 pins ansis to exactly 4.2.0](https://github.com/privatenumber/cleye/blob/v2.7.0/package.json#L74-L78), so mdeval cannot dedupe it to a newer version. [ansis 4.4.0](https://github.com/webdiscus/ansis/releases/tag/v4.4.0) is the first release where `TERM=dumb` disables color even when `COLORTERM` or a CI variable is set.

Observed with the built CLI on Node.js 24.14.0, piped output, and ansis 4.4.0 for warnings. The table counts output lines that contain ANSI escape sequences:

| Environment | Warnings | Help, cleye 2.3.0 | Help, cleye 2.7.0 |
| --- | --- | --- | --- |
| `NO_COLOR=1` | 0 | 0 | 0 |
| `FORCE_COLOR=1` | 1 | 2 | 2 |
| `TERM=dumb COLORTERM=truecolor CI=true` | 0 | 0 | 2 |

cleye 2.3.0 already respected `NO_COLOR` and `FORCE_COLOR` for mdeval's help, with and without a TTY. So the cleye 2.7.0 fix "respect NO_COLOR / FORCE_COLOR" changes nothing for mdeval.

A fresh install of mdeval still resolves cleye 2.7.0 through `^2.3.0`. The decision only avoids forcing that version on projects whose lockfiles hold an older one.

## Reproduce

Build, then compare the output of each command with and without `TERM=dumb COLORTERM=truecolor CI=true`, with `FORCE_COLOR` and `NO_COLOR` unset. `warning.md` is a disposable file whose only content is an mdeval block, so the CLI warns about it:

```sh
node dist/cli.mjs --help | grep -c $'\e\['
node dist/cli.mjs warning.md 2>&1 | grep -c $'\e\['
```

Check `pnpm why ansis` too: the copy under cleye is the one that renders help.
