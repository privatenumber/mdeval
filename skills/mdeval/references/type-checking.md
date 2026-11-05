# Type checking mdeval code

TypeScript 7.1 checks the code in script blocks and markers through a content mapper, and reports errors at the original Markdown lines. Checking does not run the code.

## Set up

Install the TypeScript 7.1 beta:

```bash
npm install --save-dev typescript@7.1.0-beta
```

Register mdeval for `.md` files in `tsconfig.json`, and include the Markdown files to check:

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

Ask the user before adding this to a project. It requires a beta compiler.

## Run

```bash
npx tsc --noEmit --runExternalCode
```

`--runExternalCode` lets `tsc` start mdeval's mapper. Without it, `tsc` fails with `TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.`

## What is checked

- Each `.md` file is a TypeScript module. Annotate with TypeScript syntax, such as `const count: number = 42`. JSDoc types are not checked.
- `erasableSyntaxOnly` reports syntax that fails at runtime, such as `enum`, at its Markdown line.
- The `block` and `$` globals are typed. Do not add an import only to satisfy `tsc`.
- A repeated marker expression is checked once, and its errors point to the first occurrence.
- Fenced code, inline code, and rendered marker values are not checked.
- A `.ts` file that imports a `.md` file is checked against the `.md` exports' types when the `.ts` file is in `include`.

## Fix errors

Fix a reported error in the script block or marker at that Markdown line, then run `tsc` again.

A namespace import of a `.md` file without exports, such as `import * as data from './stub.md'`, reports `Property 'version' does not exist` for `data.version`, even though the value is `undefined` at runtime. Give the imported file the export, or cast the namespace to the expected shape:

```ts
import * as stub from './stub.md'

const data = stub as { version?: string }
```
