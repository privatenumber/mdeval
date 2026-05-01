<p align="center">
	<img width="160" src=".github/logo.webp">
</p>
<h1 align="center">mdeval</h1>

Ever wanted dynamic values in your Markdown — package versions, star counts, computed tables — without a separate generation script that's easy to forget about?

mdeval embeds JavaScript directly in your Markdown using HTML comments. The logic lives right next to the content it produces, and the file renders normally everywhere — GitHub, editors, any Markdown viewer — because HTML comments are invisible.

Any value that matters — a dependency count, a version string, a benchmark result — is computed, not typed. Whether written by a person or an AI agent, the expression shows the work and anyone can verify it. Re-run `mdeval` and every value updates.

> [!TIP]
> Particularly useful for **knowledge bases** — contact lists, project trackers, changelogs, or any Markdown that functions as a source of truth. Values stay accurate on every run, so nothing drifts. AI agents reading the files also benefit: pre-computed values mean they don't need to re-process raw data across multiple documents, cutting token usage significantly.

## Install

```bash
npm i mdeval
```

## Quick start

mdeval adds two types of HTML comments to your Markdown:

A **script block** is where you write JavaScript. It starts with `<!--mdeval` followed by a newline:

```markdown
<!--mdeval
import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
-->
```

Full Node.js, ESM imports, top-level `await`, and shell commands via [`$`](https://google.github.io/zx/) are supported.

A **value marker** is where the result appears. It starts with `<!--mdeval ` (with a space) followed by a JavaScript expression:

```markdown
Version: <!--mdeval pkg.version-->1.0.0<!--/mdeval-->
```

The `1.0.0` between `-->` and `<!--/mdeval-->` is the current value — it gets overwritten with the result of `pkg.version` every time you run mdeval:

```bash
mdeval README.md
```

The file is updated in-place. You can pass multiple files or glob patterns: `mdeval README.md "docs/**/*.md"`.

`node_modules` and hidden directories are automatically excluded from glob expansion.

## Example

**`CONTACTS.md`** — a contact list stored as data, rendered as a table when viewed:

````markdown
<!--mdeval
import { table, link } from 'md-pen';

export const contacts = [
  {
    name: 'Alice Martin',
    linkedin: 'https://linkedin.com/in/alice-martin',
    notes: 'Met at JSConf 2023',
  },
  {
    name: 'Bob Tanaka',
    linkedin: 'https://linkedin.com/in/bob-tanaka',
    notes: 'Former colleague at Acme Co.',
  },
];

export const findContact = name => contacts.find(c => c.name === name);

const contactsTable = table(
  contacts.map(({ name, linkedin, notes }) => ({ Name: link(linkedin, name), Notes: notes })),
);
-->

<!--mdeval block(contactsTable)-->
| Name | Notes |
| - | - |
| [Alice Martin](https://linkedin.com/in/alice-martin) | Met at JSConf 2023 |
| [Bob Tanaka](https://linkedin.com/in/bob-tanaka) | Former colleague at Acme Co. |
<!--/mdeval-->
````

**`TIMELINE.md`** — imports contacts and links them by LinkedIn:

````markdown
<!--mdeval
import { link, ul, bold } from 'md-pen';

// Imports from the mdeval block!
import { findContact } from './CONTACTS.md';

const events = [
  { date: '2023-10-15', description: 'Attended JSConf 2023' },
  { date: '2024-03-01', description: `Coffee with ${link(findContact('Alice Martin').linkedin, 'Alice Martin')}` },
  { date: '2024-11-08', description: 'Started new open-source project' },
];

const list = ul(events.map(({ date, description }) => `${bold(date)} — ${description}`));
-->

<!--mdeval block(list)-->
- __2023-10-15__ — Attended JSConf 2023
- __2024-03-01__ — Coffee with [Alice Martin](https://linkedin.com/in/alice-martin)
- __2024-11-08__ — Started new open-source project
<!--/mdeval-->
````

The source of truth for contacts live in `CONTACTS.md`. If contact info changes, run `mdeval **/*.md` and all files get re-rendered with the latest data.

## Helpers

mdeval ships two helpers used in markers:

| Helper | Description |
|--------|-------------|
| `block(value)` | Wraps the value with surrounding newlines so block-level Markdown (headings, lists, tables) renders correctly |
| `$` | [zx](https://google.github.io/zx/) shell — run commands via tagged templates |

How you access them depends on the file extension:

| File | Access |
|------|--------|
| `.md` | Available as globals — call directly: `block(x)` or `` $`cmd` `` |
| `.js`, `.ts`, anything else | Import explicitly: `import { block, $ } from 'mdeval'` |

The `.md` case works because the CLI seeds the helpers on `globalThis` at startup. Modules imported transitively from a `.md` see them too, but in non-`.md` files prefer the explicit import for clarity and portability. `import { block, $ } from 'mdeval'` is itself side-effect-free — nothing on `globalThis` is touched.

## Using `.md` exports from a script

`.md` files with mdeval script blocks are real ESM modules — anything they `export` can be imported from a Node script. Useful for validation tools, migration scripts, or any code that needs to read structured data out of a Markdown knowledge base.

```js
import { registerMdevalLoader } from 'mdeval'

registerMdevalLoader()

const { todos } = await import('./TODOS.md')
console.log(todos)
```

`registerMdevalLoader()` does two things: it seeds `block` and `$` on `globalThis` (so `.md` modules find the helpers they expect), and it registers a Node ESM loader so `.md` files resolve as modules.

The `.md` import has to be **dynamic** (`await import(...)`). Static `import` declarations are resolved before any top-level code runs, so they execute before `registerMdevalLoader()` — the loader isn't installed yet and Node can't handle `.md`.

## Notes

- A file can have **multiple script blocks** — they're merged into one module, so variables and imports are shared. We recommend placing them at the top to signal the file has generated content.

- Markers can be **self-contained** — no script block needed:

  ```markdown
  <!--mdeval (() => {
    const n = 3;
    if (n % 2 === 0) { return 'even' }
    return 'odd'
  })()-->odd<!--/mdeval-->
  ```

  In large documents, this IIFE pattern lets you keep logic next to the marker it serves instead of in a distant script block.

- Marker expressions are **auto-awaited** — promises resolve automatically, so you can use `fetch()` or any async API directly in a marker without wrapping it in a script block.

- You can **import from other `.md` files**. Only the script blocks are executed — no markers are processed:

  ```markdown
  <!--mdeval
  import { version } from './data.md';
  -->
  ```

  This lets you share constants and logic across multiple markdown files.

  If the imported file might not yet have mdeval content (e.g. a stub being filled in over time), use a **namespace import** so missing exports resolve to `undefined` instead of crashing Node's ESM linker:

  ```markdown
  <!--mdeval
  import * as data from './stub.md';
  const version = data.version ?? 'tbd';
  -->
  ```

- When processing multiple files (`mdeval a.md b.md`), all files **share the same Node.js runtime** — including the module cache, `globalThis`, and `process.env`. This is the same behavior as any Node.js program using `import()`.

## Caveats

- Script code **cannot contain `-->`** — it closes the HTML comment. Rewrite `x-- > y` as `x -= 1; x > y`.
- Scripts are **JavaScript only** — no TypeScript.
- Values **cannot contain `<!--mdeval `** or **`<!--/mdeval-->`** — mdeval will throw to prevent document corruption.

## Tip: md-pen

[md-pen](https://github.com/privatenumber/md-pen) provides typed utilities for generating tables, lists, and other Markdown structures — useful when markers need to produce formatted output:

```markdown
<!--mdeval
import { table, bold, link } from 'md-pen';
const deps = [
  ['cleye', '^2.3.0'],
  ['md-pen', '^0.0.2'],
];
const depsTable = table(deps.map(([name, version]) => [
  link(`https://npm.im/${name}`, bold(name)),
  version,
]));
-->

<!--mdeval block(depsTable)-->
| Package | Version |
| - | - |
| [__cleye__](https://npm.im/cleye) | ^2.3.0 |
| [__md-pen__](https://npm.im/md-pen) | ^0.0.2 |
<!--/mdeval-->
```

## Git hook

Run mdeval automatically before every commit so values never go stale. [Lefthook](https://github.com/evilmartians/lefthook) makes this easy:

```sh
npm install lefthook --save-dev
```

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

`glob` makes the hook a no-op when no Markdown files are staged. mdeval prints the path of each file it rewrites to stdout, so `git add $files` re-stages only the files it actually updated. Note: `$files` relies on shell word-splitting, so this assumes `.md` paths without spaces.

## Agent Skills

This package ships with a built-in [agent skill](./skills/mdeval/SKILL.md) for AI coding assistants. Set up [`skills-npm`](https://github.com/antfu/skills-npm) to automatically discover it.

## Related

- [comment-mark](https://github.com/privatenumber/comment-mark) — Same idea of using HTML comment placeholders, but you write the script externally and pass values in via a JavaScript API. Useful when you want to keep the logic separate from the Markdown.
