# Type checking

TypeScript 7.1 can check the code inside mdeval comments and report errors at their original Markdown lines. Checking does not run the code.

- Script blocks in a file share one module scope, and imports resolve relative to the Markdown file.
- A marker expression that appears more than once is checked once, and its errors point to the first occurrence.
- Import the helpers used in each checked file: `import { block, $ } from 'mdeval'`.
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

mdeval checks each Markdown file as a TypeScript module, so JSDoc type annotations are not checked. `erasableSyntaxOnly` reports syntax that fails at runtime, such as `enum`, at its Markdown line.

Marker expressions are checked inside a function, so TypeScript does not narrow a script-block `let` reassigned by another function. For example, after `let x: string | number = 0; const set = () => { x = "a"; };`, a marker containing `(set(), x.toFixed())` is still checked against `string | number`. Names beginning with `__mdeval_` are reserved for generated code.

A `.ts` file that imports a `.md` file is checked against the types of its exports when the `.ts` file is in `include`. See [Node.js usage](./node.md).

A namespace import of a `.md` file without exports, such as `import * as data from './stub.md'`, reports `data.version` as missing, even though it is `undefined` at runtime. Cast the namespace to the shape you expect: `const data = stub as { version?: string }`.

## Limitations

If the project declares its own global `block` or `$`, an unimported use in Markdown resolves to that global and is not reported; import the helpers explicitly.

The content mapper API in TypeScript 7.1 is experimental. This integration is tested with `typescript@7.1.0-beta`. Whether an editor checks Markdown depends on its TypeScript integration; the configuration above enables command-line checking.
