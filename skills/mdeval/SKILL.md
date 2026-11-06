---
name: mdeval
description: Editing Markdown that contains `<!--mdeval` script blocks or value markers; adding computed values to Markdown, such as versions, counts, file contents, command output, or generated tables; running the `mdeval` CLI or `mdeval/loader`, or debugging their output.
---

# mdeval

This skill covers writing mdeval code in Markdown and running it. mdeval evaluates the code and writes each result into the file.

## Syntax

| Type | Syntax | Starts with |
| --- | --- | --- |
| Script block | `<!--mdeval\n...code...\n-->` | `<!--mdeval` + newline |
| Value marker | `<!--mdeval EXPR-->value<!--/mdeval-->` | `<!--mdeval` + space |

- All script blocks in a file form one ES module with full Node.js access and top-level `await`. Their imports and variables are visible to every marker in the file. Blocks are joined in order, so a block starting with `(`, `[`, or a template literal can continue the previous block's last statement unless it ends with a semicolon.
- `import.meta` refers to the Markdown file, so relative imports and paths resolve from it.
- Place script blocks at the top of the file. Their position relative to markers does not affect execution, but script blocks execute in their own order. Static imports from all blocks load before any block's code runs, so use dynamic `import()` when an earlier block must set up something an import reads at load time.
- Scripts and markers can use TypeScript syntax that Node.js strips: type annotations, `interface`, `type`, `as`, `satisfies`, and `!`. Do not use `enum`, `namespace` with values, or constructor parameter properties; they fail at runtime. Markdown under `node_modules` runs as plain JavaScript.

## Markers

A marker expression is anything valid after `const x =`. mdeval awaits it, converts the result to text, and replaces the value between `-->` and `<!--/mdeval-->`. An expression that appears in several markers is evaluated once.

| Result | Written as |
| --- | --- |
| `string` | As is |
| Object with `Symbol.toPrimitive`, such as zx output | `String(value)` |
| Other object or array | `JSON.stringify(value)` |
| `undefined` or `null` | Error |
| Anything else | `String(value)` |

Keep logic that one marker needs inside that marker. Markers can span lines, and an IIFE holds statements:

````markdown
<!--mdeval (() => {
  const n = 3;
  return n % 2 === 0 ? 'even' : 'odd';
})()-->odd<!--/mdeval-->
````

Use script blocks for imports and for values that several markers share.

## Helpers

| Helper | Use |
| --- | --- |
| `block(value)` | Puts the value on its own lines. Required for headings, lists, tables, and other block Markdown. |
| `$` | Runs a shell command with [zx](https://google.github.io/zx/): `` $`git branch --show-current` `` |

Both are globals in `.md` files at runtime and when type-checked, without imports. Their types are visible throughout the TypeScript program; if another global conflicts, use a separate tsconfig for Markdown whose import graph excludes the conflicting declaration. In `.js` and `.ts` files, import the helpers used: `import { block, $ } from 'mdeval'`.

## Patterns

Read `package.json`:

````markdown
<!--mdeval
import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
-->

Version: <!--mdeval pkg.version-->1.0.0<!--/mdeval-->
````

Shell output:

````markdown
Branch: <!--mdeval $`git branch --show-current`-->main<!--/mdeval-->
````

Typed data, which `tsc` can check:

````markdown
<!--mdeval
interface Release {
  version: string;
  date: string;
}

const releases = [
  { version: '1.1.0', date: '2026-11-01' },
  { version: '1.0.0', date: '2026-10-01' },
] satisfies Release[];
-->

Latest: <!--mdeval releases[0].version-->1.1.0<!--/mdeval-->
````

Generated Markdown with [md-pen](https://github.com/privatenumber/md-pen). It must be installed in the project:

````markdown
<!--mdeval
import { table } from 'md-pen';
-->

<!--mdeval block(table([
  { Package: 'cleye', Version: '^2.3.0' },
  { Package: 'md-pen', Version: '^0.0.2' },
]))-->
| Package | Version |
| - | - |
| cleye | ^2.3.0 |
| md-pen | ^0.0.2 |
<!--/mdeval-->
````

Data from another `.md` file. Importing a `.md` file runs only its script blocks:

````markdown
<!--mdeval
import { version } from './data.md';
-->

Version: <!--mdeval version-->1.0.0<!--/mdeval-->
````

If the imported file may not have mdeval code yet, use a namespace import. A named import of a missing export fails, but a missing namespace property is `undefined`:

````markdown
<!--mdeval
import * as data from './stub.md';
const version = data.version ?? 'tbd';
-->
````

## Gotchas

**Block Markdown needs `block()`.** Without it, a heading, list, or table stays on the marker's line and does not render.

**Script code cannot contain `-->` or `<!--mdeval` followed by a space or newline.** The first ends the HTML comment; the second makes mdeval report an unclosed script, even inside a string. Build the text instead, such as `'--' + '>'` or `'<!--' + 'mdeval '`. Rewrite `x-- > y` as `x -= 1; x > y`.

**Values cannot contain `<!--mdeval` followed by a space, a newline, or CRLF, or `<!--/mdeval-->`.** mdeval throws instead of writing them.

**A marker that starts a line turns off inline Markdown in its value.** When a marker opens a paragraph, list item, or blockquote, GitHub treats the line as raw HTML, so `` `code` ``, `**bold**`, and links in the value appear literally. Wrap the value in `block()` so it renders on its own lines:

````markdown
<!--mdeval
import { code } from 'md-pen';
-->

<!--mdeval block(code('value'))-->
`value`
<!--/mdeval-->
````

Markers inside headings, or after other text on a line, render inline Markdown normally.

**Markers do not work in link URLs or image alt text.** GitHub shows or encodes the comment there instead of hiding it. mdeval warns about markers in alt text.

**`<details>` needs blank lines around `</summary>`.** Without them, block Markdown inside it renders as text. md-pen's `details(summary, content)` writes the correct shape.

**Examples in code are safe.** mdeval ignores markers in fenced, indented, and inline code, so Markdown can document mdeval syntax.

**Do not create a `.md` file that only holds code.** mdeval warns about it. Put shared logic in a `.js` or `.ts` file and import it.

## CLI

```bash
mdeval README.md "docs/**/*.md"
```

- mdeval updates each file in place and prints the path of each file it changed.
- For CI, run `npx mdeval --check "**/*.md"` to report outdated files and exit 1 without rewriting; evaluation can still have side effects.
- For a Lefthook pre-commit hook, use a job with `run: npx mdeval --check "**/*.md"` and no `glob`, so changes to non-Markdown inputs are checked too. When it fails, run `npx mdeval "**/*.md"`, review and stage the updates, and commit again. Do not rewrite files in the hook (with `stage_fixed` or `fail_on_changes`) or parse mdeval's stdout to stage files: Lefthook's rollback can discard unstaged edits, `stage_fixed` misses dependent files, and scripts can print to stdout.
- Globs skip `node_modules` and hidden directories unless the pattern names them, such as `"node_modules/pkg/*.md"`.
- Warnings go to stderr. A `marker leaks into rendered ...` warning means a marker will show as text on GitHub. Fix it unless the marker is an intentional example.
- After editing mdeval code, run `mdeval` on the file and check the written values.

## References

- `references/type-checking.md`: setting up or running `tsc` on Markdown, or fixing a TypeScript error reported at a `.md` line. If the project's `tsconfig.json` lists mdeval in `contentMappers`, read it and run `tsc` after editing mdeval code.
- `references/node-loader.md`: a Node.js script, test, or tool imports a `.md` file, or runs one with `node`.

## Reporting problems

Report bugs in mdeval or in this skill to [privatenumber/mdeval](https://github.com/privatenumber/mdeval/issues) without waiting to be asked. This includes wrong behavior, confusing errors or warnings, wrong or missing guidance in this skill, and friction that cost time.

1. Search open and closed issues: `gh issue list -R privatenumber/mdeval --search "<terms>" --state all`.
2. Confirm the behavior on the latest mdeval release.
3. Write a minimal Markdown reproduction without the user's private content.
4. If your instructions allow filing issues for the user, run `gh issue create -R privatenumber/mdeval`. Otherwise, show the user the draft and file it only after they approve it.
