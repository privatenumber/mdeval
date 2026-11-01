# Dependency upgrades

Verified 2026-11-01. Each section records what an upgrade delivers to mdeval users, because mdeval is a published package and its lockfile does not ship.

## Markdown parser fixes can live in transitive packages

The [micromark 4.0.3 release](https://github.com/micromark/micromark/releases/tag/4.0.3) lists "fix attention flanking next to others", but the fix is in [micromark-core-commonmark 2.0.4](https://github.com/micromark/micromark/releases/tag/micromark-core-commonmark%402.0.4). micromark 4.0.3 accepts that package through `^2.0.0`, so raising mdeval's micromark minimum does not deliver the fix.

Observed: after `pnpm add micromark@^4.0.3`, `pnpm why micromark-core-commonmark` still reported 2.0.3. `pnpm update micromark-core-commonmark` moved the lockfile to 2.0.4. That refresh affects only development and tests. Users get 2.0.4 through their own resolution of `^2.0.0`, with or without an mdeval release.

**Decision:** the micromark, micromark-extension-gfm-table, mdast-util-from-markdown, and unist-util-visit-parents minimums were raised as maintenance, not as a fix. Their intervals contain performance work and APIs mdeval does not call.

## Help and warnings use different ansis instances

mdeval prints warnings with its own ansis dependency, while [cleye](https://github.com/privatenumber/cleye) renders `--help` with a separate copy. [cleye 2.7.0 pins ansis to exactly 4.2.0](https://github.com/privatenumber/cleye/blob/v2.7.0/package.json#L74-L78). [ansis 4.4.0](https://github.com/webdiscus/ansis/releases/tag/v4.4.0) is the first release where `TERM=dumb` disables color even when `COLORTERM` or a CI variable is set.

Observed with the built CLI on Node.js 24.14.0, piped output, and ansis 4.4.0 for warnings. The table counts output lines that contain ANSI escape sequences:

| Environment | Warnings | Help, cleye 2.3.0 | Help, cleye 2.7.0 |
| --- | --- | --- | --- |
| `NO_COLOR=1` | 0 | 0 | 0 |
| `FORCE_COLOR=1` | 1 | 2 | 2 |
| `TERM=dumb COLORTERM=truecolor CI=true` | 0 | 0 | 2 |

cleye 2.3.0 already respected `NO_COLOR` and `FORCE_COLOR` for mdeval's help, with and without a TTY. So the cleye 2.7.0 fix "respect NO_COLOR / FORCE_COLOR" changes nothing for mdeval, and its exact ansis pin brings back color under `TERM=dumb`.

To reproduce, build, then compare the output of each command with and without `TERM=dumb COLORTERM=truecolor CI=true`, with `FORCE_COLOR` and `NO_COLOR` unset. `warning.md` is a disposable file whose only content is an mdeval block, so the CLI warns about it:

```sh
node dist/cli.mjs --help | grep -c $'\e\['
node dist/cli.mjs warning.md 2>&1 | grep -c $'\e\['
```

**Decision:** keep the cleye minimum at `^2.3.0`. Fresh installs still resolve cleye 2.7.0, so the fix belongs in cleye: depend on ansis `^4.4.0` instead of an exact 4.2.0. Re-evaluate the minimum when a cleye release does that.

## TypeScript stays on 6.x

[TypeScript 7.0 does not ship a compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0). mdeval's lint step uses the API through lintroll, which loads `@typescript-eslint/parser` with the project's `typescript` package. pkgroll accepts TypeScript 7 or `@typescript/typescript6` through optional peer dependencies, so it does not block an upgrade.

**Decision:** stay on `typescript@^6.0.3`. Re-evaluate when a TypeScript 7.x release ships a compiler API that `@typescript-eslint/parser` supports. Verify `pnpm type-check`, `pnpm lint`, and `pnpm build` together, because lint and build reach the compiler through the API.
