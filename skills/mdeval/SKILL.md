---
name: mdeval
description: Evaluates JavaScript in markdown HTML comments and interpolates results in-place. Use when editing markdown files that contain mdeval script blocks or value markers, when the user wants computed/dynamic values in markdown, or when maintaining README badges, version numbers, or stats.
---

# mdeval

## Syntax

Two types of HTML comments — invisible when rendered:

| Type | Syntax | Purpose |
|------|--------|---------|
| Script block | `<!--mdeval\n...\n-->` | Define variables, imports, logic. Starts with `<!--mdeval` + newline |
| Value marker | `<!--mdeval EXPR-->value<!--/mdeval-->` | Interpolate expression result. Starts with `<!--mdeval ` + space |

Script blocks run as ESM with full Node.js access and top-level `await`. All blocks in a file merge into one module — imports and variables are shared across blocks and markers. `import.meta` points to the markdown file.

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
| `undefined`, `null` | Error |

## Patterns

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

**Markers in code blocks are safe.** Fenced, indented, and inline code won't be touched — safe to document mdeval syntax in your own README.
