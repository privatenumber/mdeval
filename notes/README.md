# Engineering research notes

Tracked maintainer references for the tools and contracts that shape mdeval.

## Ownership

Each upstream folder owns that tool's behavior, implementation, configuration, and version boundaries. The mdeval folder owns project policy, integration, and cross-tool synthesis, and links to upstream evidence.

## Index

| Folder | Owns |
| --- | --- |
| [node/](./node/README.md) | Module-hook API boundaries and deprecation behavior |
| [pnpm/](./pnpm/README.md) | Dependency skill linking and package-manager lockfile state |
| [typescript/](./typescript/README.md) | Compiler API compatibility across the native compiler transition |
| [mdeval/](./mdeval/README.md) | Loader compatibility, dependency integration, and upgrade verification |

## Evidence

Cite upstream facts beside the claim using primary sources accessible to the intended readers, preferably pinned releases or commits. Ground project behavior in repository source or tests, and label decisions with their rationale. Distinguish documented and observed behavior from inference. Keep executable contracts in the test suite.

## Maintenance

When upstream evidence changes, update the notes and identify affected project decisions and tests. Make implementation or packaging changes only when they are within the requested scope.
