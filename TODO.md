# TODO

User-feedback items, re-ranked after follow-up.

**Project context (informs prioritization).** mdeval is being used as the data layer of an
agent-readable knowledge corpus — `.md` files cross-import as typed-data modules
(`import { person } from '../people/<slug>.md'` is the primary control flow, not
nice-rendering). The repo is maintained primarily by AI agents writing migration scripts,
validation, and ad-hoc tooling against those exports. That makes "`.md` is a real ESM
module that anything can import" structural, not cosmetic.

## Status

- ✓ Loader fallback for `.md` without mdeval content — shipped in [#2](https://github.com/privatenumber/mdeval/pull/2)
- ✓ Print modified paths to stdout (was "`--print-modified` flag", landed flagless) — shipped in [#3](https://github.com/privatenumber/mdeval/pull/3)
- ✓ Throw on unclosed mdeval block (marker + script) — shipped in [#4](https://github.com/privatenumber/mdeval/pull/4)
- ✓ Expose runtime so `.md` helpers (`block`, `$`) work outside the CLI — shipped in [#5](https://github.com/privatenumber/mdeval/pull/5). Closed the TypeScript-types follow-up as a side effect.
- ✓ Recipe doc: importing `.md` exports from a Node script — shipped alongside the public `mdeval/loader` export.

## Priority tiers

**Mid tier.**

1. `--check` / `--dry-run` mode
2. Error breadcrumb in generated source

**Docs / low-effort polish.**

3. Promote top-level `await` visibility
4. Document a watch-mode pattern
5. md-pen `link(url, text)` argument-order note


---

## 1. `--check` / `--dry-run` mode

### Problem

There is no way today to verify in CI that all `.md` files in a workspace are
"render-clean" — i.e., running mdeval would not produce any changes. Useful for: lint
pre-merge gates, periodic drift checks, agent self-validation.

### Solution ideas

- Add `--check` (or `--dry-run`). Same processing pipeline, but skip the file write and
  exit non-zero if any file would have changed. Print the would-change paths to stderr.
- Doc snippet for CI:
  ```yaml
  - run: npx mdeval --check "**/*.md"
  ```

## 2. Error breadcrumb in generated source

### Problem

When a script block has a syntax or runtime error, Node's stack trace points at a line in
the synthesized module, not the `.md`. Mapping back requires mentally replaying the
loader's append order across multiple script blocks plus the trailing
`export const __mdeval_N = ...` lines.

### Solution ideas

- Quick win only — full source maps are overkill for the actual reported friction. Prepend
  a comment header before each appended block in the generated source:
  ```js
  // from /abs/path/foo.md (script block at line 13)
  ```
- Same idea for the trailing marker-expression exports: include the marker's source line.
- Defer source-map generation until someone reports a confusing case the breadcrumb
  doesn't solve.

## 3. Promote top-level `await` visibility

### Problem

The README mentions top-level `await` support, but it's buried inside a paragraph: "Full
Node.js, ESM imports, top-level `await`, and shell commands via `$` are supported." A user
in this round didn't notice and worried it might not work.

### Solution ideas

- Lift the supported-features sentence into a bullet list in Quick Start.
- Add a single-line `fetch()` example so async usage is visible at a glance:
  ```markdown
  Status: <!--mdeval (await fetch('https://api.github.com/repos/privatenumber/mdeval')).status-->200<!--/mdeval-->
  ```
- No code change.

## 4. Document a watch-mode pattern

### Problem

Iterating on a render helper or imported `.ts` / `.json` requires manually re-running
`mdeval` on every save.

### Solution ideas

- Document, do not build. README "Dev loop" section pointing at `chokidar-cli`:
  ```sh
  chokidar "**/*.{md,ts,js,json}" -c 'mdeval "**/*.md"'
  ```
- Skip a native `--watch` flag for now. Revisit only if external requests pile up.

## 5. md-pen `link(url, text)` argument-order note

### Problem

mdeval's README and SKILL push md-pen heavily. md-pen's `link(url, text)` is the inverse
of Markdown's `[text](url)`. Reported user wrote `link(handle, url)` thinking it matched
Markdown convention and shipped a broken render before noticing — bit them three or more
times.

### Solution ideas

- This is md-pen's API — flipping it is a separate library's call. No change in mdeval.
- Add a one-line note next to the first md-pen example in the README and SKILL: "Note:
  `link(url, text)` — argument order matches HTML's `<a href="url">text</a>`, not
  Markdown's `[text](url)`."

