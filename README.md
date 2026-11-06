<p align="center">
	<img width="160" src=".github/logo.webp">
</p>
<h1 align="center">mdeval</h1>

mdeval runs JavaScript or TypeScript written in HTML comments inside your Markdown, and writes the results back into the file. The code sits next to the content it produces. The file renders normally on GitHub and in any editor, because HTML comments are invisible.

Values such as a version string, a dependency count, or a benchmark result are computed, not typed by hand, so anyone can check where they came from. Run `mdeval` again and every value updates. This also works well for Markdown knowledge bases, such as contact lists or project trackers, where files share data.

## Install

```bash
npm i mdeval
```

## Quick start

A **script block** holds code. It starts with `<!--mdeval` followed by a newline:

```markdown
<!--mdeval
import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
-->
```

Script blocks are ES modules with full Node.js access: imports, top-level `await`, and any installed package.

A **value marker** shows a result. It starts with `<!--mdeval ` (with a space) followed by an expression. The text between `-->` and `<!--/mdeval-->` is the current value:

```markdown
Version: <!--mdeval pkg.version-->1.0.0<!--/mdeval-->
```

Run mdeval to replace each value with the result of its expression:

```bash
mdeval README.md
```

## Example

**`CONTACTS.md`** stores contacts as data and renders them as a table, using [md-pen](https://github.com/privatenumber/md-pen) to generate Markdown:

````markdown
<!--mdeval
import { table, link } from 'md-pen';

type Contact = {
  name: string;
  linkedin: string;
};

export const contacts: Contact[] = [
  { name: 'Alice Martin', linkedin: 'https://linkedin.com/in/alice-martin' },
  { name: 'Bob Tanaka', linkedin: 'https://linkedin.com/in/bob-tanaka' },
];
-->

<!--mdeval block(table(contacts.map(({ name, linkedin }) => ({ Name: link(linkedin, name) }))))-->
| Name |
| - |
| [Alice Martin](https://linkedin.com/in/alice-martin) |
| [Bob Tanaka](https://linkedin.com/in/bob-tanaka) |
<!--/mdeval-->
````

**`TIMELINE.md`** imports the contacts from `CONTACTS.md`:

````markdown
<!--mdeval
import { link } from 'md-pen';
import { contacts } from './CONTACTS.md';

const alice = contacts.find(contact => contact.name === 'Alice Martin')!;
-->

- 2024-03-01: Coffee with <!--mdeval link(alice.linkedin, alice.name)-->[Alice Martin](https://linkedin.com/in/alice-martin)<!--/mdeval-->
````

When a contact changes, run `mdeval "**/*.md"` and both files update.

## Writing mdeval code

### Helpers

Two helpers are available as globals in `.md` files:

| Helper | Description |
| --- | --- |
| `block(value)` | Puts the value on its own lines, so block-level Markdown such as headings, lists, and tables renders |
| `$` | Runs shell commands with [zx](https://google.github.io/zx/): `` $`git branch --show-current` `` |

In `.js` and `.ts` files, import them instead: `import { block, $ } from 'mdeval'`. The import has no side effects.

### Markers

- **Marker expressions are awaited**, so a promise resolves before its value is written:

  ```markdown
  Status: <!--mdeval fetch('https://api.github.com/repos/privatenumber/mdeval').then(response => response.status)-->200<!--/mdeval-->
  ```

- **Markers can span lines.** Keep logic that one marker needs inside the marker, and wrap statements in an IIFE:

  ```markdown
  <!--mdeval (() => {
    const n = 3;
    return n % 2 === 0 ? 'even' : 'odd';
  })()-->odd<!--/mdeval-->
  ```

- **Script blocks share one module.** Variables and imports from every block in a file are visible to all of its markers. Blocks are joined in order, so a block starting with `(`, `[`, or a template literal can continue the previous block's last statement unless that statement ends with a semicolon. Use script blocks for imports and values that several markers share, and place them at the top of the file.

### Importing other `.md` files

A script block can import the exports of another `.md` file, as `TIMELINE.md` does above. mdeval runs only the script blocks of an imported file, not its markers.

If the imported file might not have mdeval code yet, use a namespace import. A missing export is then `undefined`, while a named import of a missing export fails:

```markdown
<!--mdeval
import * as data from './stub.md';
const version = data.version ?? 'tbd';
-->
```

### TypeScript

Scripts and markers can use TypeScript syntax that Node.js can remove without changing the code, such as type annotations, `interface`, `as`, and `satisfies`. Syntax that generates code, such as `enum`, `namespace` with values, and constructor parameter properties, fails ([Node.js docs](https://nodejs.org/api/typescript.html#type-stripping)). Markdown files under `node_modules` run as JavaScript, because Node.js does not strip types there.

TypeScript 7.1 can also type-check mdeval code at its Markdown lines. See [Type checking](./docs/type-checking.md).

### Caveats

- **Script code cannot contain `-->`**, because it closes the HTML comment, or `<!--mdeval` followed by a space or newline, because mdeval treats it as an unclosed script. Build the text instead, such as `'<!--' + 'mdeval '`. Rewrite `x-- > y` as `x -= 1; x > y`.
- **Values cannot contain `<!--mdeval` followed by a space, a newline, or CRLF, or `<!--/mdeval-->`.** mdeval throws instead of writing them, so the file stays parseable.
- **Files processed together share one Node.js process,** including the module cache, `globalThis`, and `process.env`.

## CLI

```bash
mdeval README.md "docs/**/*.md"
```

mdeval accepts files and glob patterns, and updates each file in place. It prints the path of every file it changes.

Globs skip `node_modules` and hidden directories. To include them, start the pattern with their path, such as `"node_modules/pkg/*.md"` or `".github/**/*.md"`.

To check values in CI without rewriting files, run:

```bash
npx mdeval --check "**/*.md"
```

This prints paths that would change and exits with code 1 if any are outdated or a file fails. It still evaluates the Markdown code, which can have side effects.

### Git hook

To catch stale values before they are committed, run the check in a pre-commit hook. With [Lefthook](https://github.com/evilmartians/lefthook):

```yaml
# lefthook.yml
pre-commit:
  jobs:
    - name: mdeval
      run: npx mdeval --check "**/*.md"
```

When the check fails, the commit stops. mdeval itself writes and stages nothing, but the Markdown scripts still run with full access and can change files. Run `npx mdeval "**/*.md"`, review and stage the updates, and commit again.

Lefthook hides unstaged hunks in partially staged files while the job runs, so the hook checks their staged versions. If the check fails because of such a file, stage it fully or stash its unstaged hunks before running `npx mdeval` and committing again.

The job runs on every commit that stages files, so a change to a non-Markdown input, such as `package.json`, is checked too. The hook checks your working tree, so a staged file can still differ from what it checked; the CI check on the committed files is the reliable one.

## Importing `.md` files from scripts

`.md` files are ES modules, so a Node.js script can import their exports. Register the loader with `--import`:

```bash
node --import mdeval/loader ./script.js
```

```js
// script.js
import { contacts } from './CONTACTS.md'

console.log(contacts)
```

See [Node.js usage](./docs/node.md) for TypeScript scripts, running a `.md` file directly, and stack traces.

## Agent skill

mdeval ships an [agent skill](./skills/mdeval/SKILL.md) that teaches AI coding assistants to write mdeval code.

## Related

- [comment-mark](https://github.com/privatenumber/comment-mark): also fills HTML comment placeholders, but values come from a script outside the Markdown through a JavaScript API.
