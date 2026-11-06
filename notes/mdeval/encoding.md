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
