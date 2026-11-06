# Encoding

Verified 2026-11-06 on Node.js 24.14.0, macOS, at the head of the PR that added this note.

**Decision:** the Markdown loader owns strict UTF-8 decoding. The CLI reads target files with `fs.readFile(file, 'utf8')`, which replaces invalid bytes with U+FFFD, and does not decode them a second time. Re-evaluate if the CLI ever writes a file without evaluating it first.

## Why the CLI does not need its own strict decoder

[`md-loader.ts`](../../src/md-loader.ts) decodes every `.md` module with `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })` and throws `<path>: not valid UTF-8`. The CLI's lenient copy of the source never reaches the disk, for two reasons:

- A file with markers is evaluated. [`processSource`](../../src/process-source.ts) imports it, the loader reads the bytes from disk again and throws, and the CLI reports the error before its write.
- A file without markers is returned unchanged, so the CLI's `output !== source` check skips the write.

An earlier version of the CLI-safety work added a shared strict reader to the CLI, with an error class so the loader could tell decode errors from read errors. It predated the loader's strict decoder, which landed in #35, and it was removed because nothing reached a write without the loader.

Each of these files kept its exact bytes (checked with `shasum`) when passed to the CLI together:

| File | Result |
| --- | --- |
| Invalid byte outside markers, no markers | No error, not written |
| Markers but no script block, invalid byte | `not valid UTF-8`, not written |
| Invalid byte inside a marker's old value | `not valid UTF-8`, not written |
| Two files that both import an invalid file | Both report the imported file's path, neither written |
| A file with script blocks but no markers, invalid byte | No error, not written |

The CLI spec covers the main case ("rejects invalid UTF-8 without changing bytes and continues"), and the marker-evaluation spec covers an invalid imported file.

**Consequence:** an invalid file that mdeval would not evaluate is not reported. mdeval reports problems only in what it runs or rewrites.

## Byte order marks

Node's `'utf8'` decoding keeps a leading U+FEFF, so a rewritten file keeps its BOM. `TextDecoder` strips it unless `ignoreBOM: true` is set, which is why the loader sets it. The CLI spec "preserves a UTF-8 byte order mark when rewriting" catches a change to a stripping decoder.

## Line endings

Verified 2026-11-07 on Node.js 26.13.0.

**Decision:** [`processSource`](../../src/process-source.ts) counts LF, CRLF, and lone CR only outside marker values, including marker comments and script blocks. It rewrites every line break in generated values to the most common ending. Ties favor LF, then CRLF; a document with no endings outside values uses LF. Text outside marker values is never changed.

- **Why every value, not only `block()`:** CommonMark treats LF, CR, and CRLF as line endings. `block()` returns a plain string, so `processSource` cannot tell its wrapper newlines from newlines in the value.
- **Why exclude marker values:** counting the whole document is not idempotent. With two LF endings outside a stale value and four CRLF endings inside it, the old rule selected CRLF; replacing the value with `block("x")` left two CRLF endings, producing a tie and selecting LF on the next run. Text outside values is unchanged, so its count stays stable across runs.
- **Why convert lone CR too:** under the old rule, converting CRLF to LF in `a\r\r\nb` produced `a\r\nb`. The remaining CR combined with the replacement LF, collapsing two line breaks into one. Converting all three forms in a single pass preserves the number of breaks.
- **Precedent:** [VS Code 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts#L27-L40) also chooses by count, though it counts a lone CR with CRLF.
- **Alternatives:** [Prettier's `endOfLine: "auto"`](https://prettier.io/docs/options#end-of-line) documents the first line's ending, and its [3.6.2 implementation](https://github.com/prettier/prettier/blob/3.6.2/src/common/end-of-line.js#L1-L7) looks for the first CR. [embedme 1.22.1](https://github.com/zakhenry/embedme/blob/v1.22.1/src/embedme.lib.ts) picks CRLF if any CRLF occurs.

The count is linear in the source length. The earlier whole-document implementation measured 1,822 ms before and 1,823 ms after on a 10 MB CRLF document with 10,000 repeated markers, and 1,882 ms and 1,910 ms with 10,000 distinct expressions, over five fresh processes each. These measurements do not cover the outside-values implementation.
