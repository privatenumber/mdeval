# Error reporting

Verified 2026-11-06 on Node.js 24.14.0, macOS.

The CLI prints `Error processing <file>:<line>:<column>: <message>` when a script error's stack has a frame in a `.md` file. [`error-location.ts`](../../src/cli/error-location.ts) finds the first such frame. The loader's source maps make the frame point at the Markdown line.

## The formatter must not throw

**Decision:** `formatErrorLocation` wraps its body in `try`/`catch` and falls back to the file name.

It runs in the CLI's per-file `catch`. If it throws, that callback rejects, `Promise.all` rejects, and the rejected top-level `await` ends the process while other files may still be written. A file whose `fs.writeFile` is in flight is then left truncated. Reproduced with a 200 MB `writeFile` racing a rejection in the same `Promise.all` at the top level: the target file had 0 bytes after each of 3 runs.

Errors come from user code, so any property access can fail. Observed cases that the `catch` handles:

- `Error.prepareStackTrace = () => []` makes `error.stack` an array (covered by the CLI spec "reports original errors when the stack is not a string").
- A thrown error whose `toString()` throws.
- `throw null`.

In a run with each of these, another file in the same run was still rewritten.

## Only the frames are scanned

**Decision:** the regular expression runs on the stack after the `Name: message` header that V8 puts first, which equals `String(error)`.

The pattern has two lazy groups, so a long line that starts with `at ` takes quadratic time. A message is part of the stack and can contain such a line. Measured with the pattern alone, on a line of `at ` followed by repeated `a (/`:

| Line length | Time |
| --- | --- |
| 10,000 | 8 ms |
| 20,000 | 31 ms |
| 40,000 | 123 ms |

After the header is skipped, the CLI reports a script error whose message has a 400,000-character line of that shape in 0.12 s in total. Frames are bounded by `Error.stackTraceLimit` (10 by default). Skipping the header also keeps a frame-like line inside a message from being reported as the location. If the message changed after the error was created, the header does not match, and the whole stack is scanned.
