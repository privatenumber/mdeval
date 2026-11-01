# Installation contracts

Verified 2026-11-01 against pnpm 12.16.1 and its release-tagged documentation.

## Dependency skill linking requires approval

pnpm records dependency skill approvals under `permissions`. A pending approval does not fail installation. Approved skills are linked as `pnpm-<package>-<skill>`, and pnpm writes a `pnpm-*` ignore rule inside each destination directory. `skills.dirs` selects destinations explicitly. See [approval behavior](https://github.com/pnpm/pnpm/blob/v12.16.1/pnpm/docs/agent-skills.md#L24-L42) and [destination and link behavior](https://github.com/pnpm/pnpm/blob/v12.16.1/pnpm/docs/agent-skills.md#L44-L64).

Project integration should account for both the links and the generated `.gitignore`. mdeval configures only `.agents/skills` and ignores that whole generated directory; see [the project configuration](../../pnpm-workspace.yaml) and [root ignore rules](../../.gitignore).

Observed on the upgrade's dependency graph: frozen installs in a fresh checkout passed both with `CI` unset and with `CI=true`, with no agent environment variables and no pre-existing skill directories. `git ls-files --others --exclude-standard` returned no paths. This checks a boundary that a warm installation with existing directories cannot establish.

## The extra lockfile document is expected

pnpm 12 can prepend a boot document containing `packageManagerDependencies`, followed by the ordinary dependency graph. Both documents use the same `lockfileVersion`; see [the document layout](https://github.com/pnpm/pnpm/blob/v12.16.1/pnpm/docs/lockfile.md#L5-L17).

This applies to the legacy `packageManager` field when it pins pnpm 12 or newer, not only to `devEngines.packageManager`. The source states: "pins pnpm 12 or newer through the legacy `packageManager` field." A frozen install does not rewrite this block. See [the version-pinning contract](https://github.com/pnpm/pnpm/blob/v12.16.1/pnpm/docs/lockfile.md#L164-L177).

Keep the manifest pin and boot document together. Do not remove the first YAML document as apparent duplication or manually rewrite the lockfile. After a pin update, use pnpm to update generated state and verify:

```sh
CI=true pnpm install --frozen-lockfile
```

Observed with mdeval's pnpm 12.16.1 pin:

```text
Lockfile is up to date, resolution step is skipped
```
