# Importing `.md` files from Node.js

`.md` files with mdeval script blocks are ES modules. Run a script with the loader to import their exports:

```bash
node --import mdeval/loader ./script.js
```

```js
// script.js
import { todos } from './TODOS.md'

console.log(todos)
```

- `--import mdeval/loader` must come before the script, so the loader is registered before `.md` imports resolve. Without it, importing a `.md` file fails.
- The loader also defines the `block` and `$` globals that `.md` code uses.
- Importing a `.md` file runs only its script blocks. It does not evaluate markers or change the file.
- TypeScript scripts work the same way: `node --import mdeval/loader ./script.ts`.
- Run a `.md` file's script blocks directly: `node --import mdeval/loader ./TODOS.md`.
- Stack traces from `.md` code report the original Markdown lines.

In `.js` and `.ts` files, import the helpers instead of relying on globals: `import { block, $ } from 'mdeval'`. This import has no side effects. It does not define globals or register the loader.

In tests that spawn the script, pass the flag to the child process, for example `spawn(process.execPath, ['--import', 'mdeval/loader', scriptPath])`.
