# Type checking

TypeScript 7.1 can check the code inside mdeval comments and report errors at their original Markdown lines. Checking does not run the code.

- Script blocks in a file share one module scope, and imports resolve relative to the Markdown file.
- A marker expression that appears more than once is checked once, and its errors point to the first occurrence.
- The `block` and `$` helpers are available without imports. Explicit imports also work.
- Fenced code blocks, inline code, and the rendered values between markers are not checked.

## Setup

Install the TypeScript 7.1 beta:

```sh
npm install --save-dev typescript@7.1.0-beta
```

Register mdeval as the content mapper for `.md` files in `tsconfig.json`, and include the Markdown files to check:

```json
{
    "compilerOptions": {
        "module": "nodenext",
        "target": "esnext",
        "strict": true,
        "erasableSyntaxOnly": true,
        "noEmit": true
    },
    "contentMappers": [
        {
            "package": "mdeval",
            "extensions": [
                ".md"
            ]
        }
    ],
    "include": [
        "README.md",
        "docs/**/*.md"
    ]
}
```

Run the compiler. `--runExternalCode` allows `tsc` to start mdeval's mapper:

```sh
npx tsc --noEmit --runExternalCode
```

For example, this reports an error on `toUpperCase`, because `count` is a number:

```markdown
<!--mdeval
const count: number = 42;
-->

Count: <!--mdeval count.toUpperCase()-->42<!--/mdeval-->
```

## TypeScript rules

mdeval checks Markdown outside `node_modules` as a TypeScript module, so JSDoc type annotations there are not checked. Markdown under `node_modules` is checked as JavaScript because Node runs it as JavaScript. `erasableSyntaxOnly` reports syntax that fails at runtime, such as `enum`, at its Markdown line.

Marker expressions are checked inside a function, so TypeScript does not narrow a script-block `let` reassigned by another function. For example, after `let x: string | number = 0; const set = () => { x = "a"; };`, a marker containing `(set(), x.toFixed())` is still checked against `string | number`. Names beginning with `__mdeval_` are reserved for generated code.

A `.ts` file that imports a `.md` file is checked against the types of its exports when the `.ts` file is in `include`. See [Node.js usage](./node.md).

A namespace import of a `.md` file without exports, such as `import * as data from './stub.md'`, reports `data.version` as missing, even though it is `undefined` at runtime. Cast the namespace to the shape you expect: `const data = stub as { version?: string }`.

## Limitations

With Node's `--preserve-symlinks` or `--preserve-symlinks-main`, the loader can use the symlink path while the checker still classifies the real target. The mapper does not honor TypeScript's `preserveSymlinks` option. Requesting that option through the content mapper manifest's `compilerOptions` and honoring it in the mapper would fix this mismatch, but is not implemented.

The helper types are visible throughout the TypeScript program, including `.ts` and `.js` files outside Markdown. This matches runtime: the CLI and `mdeval/loader` assign the helpers to `globalThis`, so every module in that process can use them, including `.ts` files your Markdown imports. The types are too permissive only for code that also runs without the loader, where `block` and `$` are `undefined`. Import the helpers in such code, or check Markdown under its own tsconfig so the rest of the project does not see these globals. A conflicting global `block` or `$`, including full zx's globals, can cause TS2403. With `skipLibCheck`, the first declaration TypeScript checks determines the type, and a conflicting later `.d.ts` declaration can be skipped. For example, with `a.md`, `globals.d.ts`, and `b.md` in that order, the first Markdown declaration establishes the type and no TS2403 is reported for the skipped `.d.ts` conflict. Check Markdown with a separate `tsconfig.json` that excludes the conflicting declaration from all loaded files, including root files, the import graph, and `compilerOptions.types`, even when inherited through `extends` (for example, `zx/globals`).

The content mapper API in TypeScript 7.1 is experimental. This integration is tested with `typescript@7.1.0-beta`. Whether an editor checks Markdown depends on its TypeScript integration; the configuration above enables command-line checking.
