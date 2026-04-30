---
name: mdeval
description: Evaluates JavaScript in markdown HTML comments and interpolates results in-place. Use when editing markdown files that contain mdeval script blocks or value markers, when the user wants computed/dynamic values in markdown, or when maintaining README badges, version numbers, or stats.
---

# mdeval

## When to use

- Markdown contains values derived from code, files, APIs, or shell commands
- README stats, version numbers, dependency counts, or computed tables
- Any value where accuracy matters — counts, sizes, dates, calculations
- Auditable content — the expression proves the value is correct, not just asserted

## Syntax

Two types of HTML comments — invisible when rendered:

| Type | Syntax | Purpose |
|------|--------|---------|
| Script block | `<!--mdeval\n...\n-->` | Define variables, imports, logic. Starts with `<!--mdeval` + newline |
| Value marker | `<!--mdeval EXPR-->value<!--/mdeval-->` | Interpolate expression result. Starts with `<!--mdeval ` + space |

Script blocks run as ESM with full Node.js access and top-level `await`. All blocks in a file merge into one module — imports and variables are shared across blocks and markers. `import.meta` points to the markdown file. Marker expressions are auto-awaited, so promises resolve automatically.

## Marker Expressions

Any JavaScript expression valid on the right side of `const x =`:

| Expression | Example |
|------------|---------|
| Variable | `<!--mdeval name-->value<!--/mdeval-->` |
| Property access | `<!--mdeval data.version-->value<!--/mdeval-->` |
| Computation | `<!--mdeval items.length + " items"-->value<!--/mdeval-->` |
| IIFE | `<!--mdeval (() => { const x = 1 + 1; return x; })()-->value<!--/mdeval-->` |

Duplicate expressions across markers are evaluated once and reused.

## Value Coercion

| Type | Result |
|------|--------|
| `string` | As-is |
| `number`, `boolean`, `bigint` | `String(value)` |
| `object`, `array` | `JSON.stringify(value)` |
| object with `Symbol.toPrimitive` | `String(value)` (e.g. zx `ProcessOutput`) |
| `Promise` | Auto-awaited, then coerced |
| `undefined`, `null` | Error |

## Available in markers

| Helper | Description |
|--------|-------------|
| `block(value)` | Wraps value with newlines for block-level rendering |
| `$` | [zx](https://google.github.io/zx/) shell — run commands via tagged templates: `` $`git branch` `` |

Both helpers are also exported from `mdeval/runtime` for use in regular scripts: `import { block, $ } from 'mdeval/runtime'`. Importing the runtime also seeds them on `globalThis`, which is what makes them available to `.md` files loaded outside the CLI.

## CLI

```bash
mdeval README.md                    # single file
mdeval README.md docs/guide.md      # multiple files
mdeval "docs/**/*.md"               # glob pattern
mdeval "**/*.md"                    # recursive — node_modules and dotdirs auto-excluded
```

Supports full glob syntax including `**` recursive, `{a,b}` brace expansion, and `!` negation.

`node_modules` and hidden directories (`.git`, `.next`, etc.) are automatically excluded from glob expansion. No need to manually negate them. To explicitly include `node_modules`, reference it in the pattern: `mdeval "node_modules/pkg/*.md"`.

## Patterns

### Shell commands

````markdown
<!--mdeval $`git branch --show-current`-->main<!--/mdeval-->
````

### Read package.json

````markdown
<!--mdeval
import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
-->

Version: <!--mdeval pkg.version-->0.0.0<!--/mdeval-->
````

### Import from other .md files

Only script blocks are executed — markers are not processed:

````markdown
<!--mdeval
import { version } from './data.md';
-->

<!--mdeval version-->1.0.0<!--/mdeval-->
````

If the imported `.md` may not yet have mdeval content (stubs filled in over time), use a **namespace import** — named imports against an empty module are rejected by Node's ESM linker, but missing properties on a namespace resolve to `undefined`:

````markdown
<!--mdeval
import * as data from './stub.md';
const version = data.version ?? 'tbd';
-->
````

### Generate Markdown with md-pen

Use [md-pen](https://github.com/privatenumber/md-pen) for formatted output (tables, lists, headings):

````markdown
<!--mdeval
import { table, bold, link } from 'md-pen';
const deps = [['cleye', '^2.3.0'], ['md-pen', '^0.0.2']];
const depsTable = table(deps.map(([name, v]) => [link(`https://npm.im/${name}`, bold(name)), v]));
-->

<!--mdeval block(depsTable)-->
| Package | Version |
| - | - |
| [__cleye__](https://npm.im/cleye) | ^2.3.0 |
<!--/mdeval-->
````

## Gotchas

**Block-level values need `block()`.** Without it, block elements don't render:

````markdown
<!-- ❌ Heading stays on same line as comment, won't render -->
<!--mdeval heading-->### Title<!--/mdeval-->

<!-- ✅ block() adds newlines so the heading renders correctly -->
<!--mdeval block(heading)-->
### Title
<!--/mdeval-->
````

**Script code cannot contain `-->`** — it closes the HTML comment:

````markdown
<!-- ❌ --> in the string literal closes the comment prematurely -->
<!--mdeval
const x = "<!--/mdeval-->";
-->

<!-- ✅ Build the string without --> -->
<!--mdeval
const x = String.fromCharCode(45, 45, 62);
-->
````

**Values cannot contain mdeval syntax.** Producing `<!--mdeval ` or `<!--/mdeval-->` in a value throws an error to prevent document corruption on re-parse.

**Place scripts at the top.** Order doesn't affect execution — scripts can appear after the markers that reference them — but top placement signals the file contains generated content.

**Use IIFEs to co-locate logic.** In large docs, keep marker-specific computation inline instead of in a distant script block: `<!--mdeval (() => { ... })()-->`.

**Standalone markers suppress inline markdown in the value.** When a marker opens a line — standalone paragraph, list item, or blockquote — GitHub treats the entire line as a raw HTML block. Inline markdown in the value (`` `code` ``, `**bold**`, `[link](url)`) is not processed and appears literally.

````markdown
<!-- ❌ backtick shows literally — line is an HTML block, not inline markdown -->
<!--mdeval expr-->`value`<!--/mdeval-->
````

Use a multi-line marker so the value occupies its own lines, which are processed as normal markdown. Use [md-pen](https://github.com/privatenumber/md-pen) to generate formatted values:

````markdown
<!--mdeval
import { code, bold, link } from 'md-pen';
-->

<!--mdeval code('asdf')-->
`asdf`
<!--/mdeval-->
````

Markers inside headings are always inline — markdown in the value always renders there.

**Comments don't work in link URLs or image alt text.** GitHub escapes comment syntax in these positions:

````markdown
<!-- ❌ comment is URL-encoded as href -->
[text](<!-- comment -->)

<!-- ❌ comment appears as visible alt text -->
![<!-- comment -->](image.png)
````

**Set up a git hook so values never go stale.** Use [Lefthook](https://github.com/evilmartians/lefthook) with this config:

```yaml
# lefthook.yml
pre-commit:
  jobs:
    - name: mdeval
      # lefthook's default `gobwas` matcher requires `**` to span 1+ dirs,
      # so `**/*.md` alone misses root-level files like README.md
      glob: ["*.md", "**/*.md"]
      run: |
        files=$(npx mdeval "**/*.md")
        [ -n "$files" ] && git add $files
```

`git add $files` re-stages only the files mdeval actually rewrote. Assumes `.md` paths without spaces.

**Markers in code blocks are safe.** Fenced, indented, and inline code won't be touched — safe to document mdeval syntax in your own README.

**Never create a .md file with only a script block and no real content.** Markdown files must contain actual prose/documentation. For shared logic or utilities, create a `.js` or `.ts` file and import it from your markdown instead.
