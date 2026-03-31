<p align="center">
	<img width="160" src=".github/logo.webp">
</p>
<h1 align="center">mdeval</h1>

Ever wanted dynamic values in your Markdown — package versions, star counts, computed tables — without a separate generation script that's easy to forget about?

mdeval embeds JavaScript directly in your Markdown using HTML comments. The logic lives right next to the content it produces, and the file renders normally everywhere — GitHub, editors, any Markdown viewer — because HTML comments are invisible.

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

Full Node.js, ESM imports, and top-level `await` are supported.

A **value marker** is where the result appears. It starts with `<!--mdeval ` (with a space) followed by a JavaScript expression:

```markdown
Version: <!--mdeval pkg.version-->1.0.0<!--/mdeval-->
```

The `1.0.0` between `-->` and `<!--/mdeval-->` is the current value — it gets overwritten with the result of `pkg.version` every time you run mdeval:

```bash
mdeval README.md
```

The file is updated in-place. You can pass multiple files at once: `mdeval README.md docs/*.md`

## Notes

- A file can have **multiple script blocks** — they're merged into one module, so variables and imports are shared. We recommend placing them at the top to signal the file has generated content.

- Markers can be **self-contained** — no script block needed:

  ```markdown
  <!--mdeval (() => 2 + 2)()-->4<!--/mdeval-->
  ```

  In large documents, this IIFE pattern lets you keep logic next to the marker it serves instead of in a distant script block.

- If your value starts with a heading, list, or other block element, wrap it with **`block()`** so it renders on its own line. `block()` is a global helper that adds newlines before and after the value.

- You can **import from other `.md` files**. Only the script blocks are executed — no markers are processed:

  ```markdown
  <!--mdeval
  import { version } from './data.md';
  -->
  ```

  This lets you share constants and logic across multiple markdown files.

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

## Agent Skills

This package ships with a built-in [agent skill](./skills/mdeval/SKILL.md) for AI coding assistants. Set up [`skills-npm`](https://github.com/antfu/skills-npm) to automatically discover it.
