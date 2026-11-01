# TypeScript

Verified 2026-11-01 against TypeScript 6.0.3 and the TypeScript 7.0 announcement.

**Decision:** stay on `typescript@^6.0.3`. Re-evaluate when a TypeScript 7.x release ships a compiler API that `@typescript-eslint/parser` supports.

## Lint needs the compiler API

[TypeScript 7.0 does not ship a compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0). mdeval's lint step uses the API through lintroll, which loads `@typescript-eslint/parser` with the project's `typescript` package. pkgroll accepts TypeScript 7 or `@typescript/typescript6` through optional peer dependencies, so it does not block an upgrade.

The announcement's side-by-side setup, which aliases `typescript` to `@typescript/typescript6` and installs 7.0 under another name, was not tried. It would add a second compiler to maintain for little gain: `pnpm exec tsc` took 1.3-2.9 s on TypeScript 6.0.3.

## Verify an upgrade

Run `pnpm type-check`, `pnpm lint`, and `pnpm build` together. A passing `tsc` does not show that lint or the build still work, because they reach the compiler through the API.
