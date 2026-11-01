# Native compiler compatibility

Verified 2026-11-01 against the TypeScript 7.0 announcement and the mdeval dependency integration at TypeScript 6.0.3.

## TypeScript 7 is not a drop-in compiler API upgrade

The [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0) states: "TypeScript 7.0 is here, it does not ship with an API." Its native `tsc` executable can type-check a project, but tools importing the TypeScript 6 compiler API need a separate compatibility arrangement. The announcement names typescript-eslint as an example.

The documented side-by-side arrangement uses `@typescript/typescript6` for the old API and another alias for TypeScript 7's executable. This is an integration change, not just a version-number update. API availability in a future release must be checked again; a planned release is not evidence that compatibility has shipped.

## mdeval decision

Keep the direct compiler dependency on TypeScript 6.0.3 until the API consumers can move together, or a side-by-side compiler setup has a concrete benefit. The repository uses TypeScript for [type checking](../../package.json) and [lintroll](../../package.json) for linting; both gates must remain functional. This decision does not establish that every possible TypeScript 7 arrangement fails. No side-by-side TypeScript 7 installation was tested during this upgrade.

The 6.0.2 to 6.0.3 interval contains class-initializer handling and automatic type-acquisition package-name hardening, rather than a new API required by mdeval. See [the tagged comparison](https://github.com/microsoft/TypeScript/compare/v6.0.2...v6.0.3). The upgrade is maintenance here, not a new user-facing capability.

Re-evaluate when the relevant compiler API consumers support the native compiler, or when measured type-checking cost justifies maintaining two compiler packages. Validate `pnpm type-check`, `pnpm lint`, and `pnpm build` together rather than treating a successful `tsc` invocation as sufficient evidence.
