# mdeval integration references

- [Runtime compatibility](./runtime-compatibility.md): development runtime versus consumer support, why `engines.node` has its bounds, and how CI tests them.
- [CLI tests](./cli-tests.md): why the stderr-flushing test pipes the CLI through `sh` instead of reading the child's stderr with `node:child_process` or nano-spawn.
- [cleye](./cleye.md): why the cleye minimum stays at `^2.3.0`, the separate ansis copy that renders `--help`, and why warnings detect color on stderr with `util.styleText()`.
- [TypeScript](./typescript.md): why TypeScript stays on 6.x while lint needs the compiler API.
- [Type checking](./type-checking.md): the TypeScript content mapper, its packaging requirements, the pinned 7.1 beta, and Node.js support.
- [TypeScript syntax](./typescript-syntax.md): why every Markdown file runs and is checked as TypeScript, with Node.js type-stripping behavior, costs, and evaluated alternatives.
