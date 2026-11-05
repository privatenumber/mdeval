# Node.js usage

`.md` files with mdeval script blocks are ES modules. A Node.js script can import their exports, which is useful for validation tools, migrations, or any code that reads data from a Markdown knowledge base.

## Import `.md` files

Run the script with the mdeval loader:

```bash
node --import mdeval/loader ./script.js
```

The script can then use ordinary static imports of `.md` files:

```js
// script.js
import { contacts } from './CONTACTS.md'

console.log(contacts)
```

`--import mdeval/loader` registers the loader before the script's imports are resolved, so static imports of `.md` files work. Without it, Node.js cannot load `.md` files. The loader also defines the `block` and `$` helpers as globals, which mdeval code in `.md` files expects.

Importing a `.md` file runs only its script blocks, not its markers, and does not change the file.

## TypeScript scripts

The script can be TypeScript, because Node.js strips types from `.ts` files:

```bash
node --import mdeval/loader ./script.ts
```

With [type checking](./type-checking.md) set up and the script in `include`, `tsc` checks the script against the types of the `.md` exports.

## Run a `.md` file directly

The loader can also run a `.md` file's script blocks:

```bash
node --import mdeval/loader ./TODOS.md
```

## Helpers without the loader

`import { block, $ } from 'mdeval'` returns the helpers without side effects: it neither defines globals nor registers the loader. In `.js` and `.ts` files, prefer this import over the globals, which exist only when the loader or the CLI defined them.

## Stack traces

The loader enables source maps, so runtime errors from a `.md` file report its original lines and columns.
