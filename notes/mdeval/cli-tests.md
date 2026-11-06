# CLI tests

Verified 2026-11-06 on Node.js 24.14.0 (libuv 1.51.0) and nano-spawn 2.1.0, on macOS and in the `node:24.14.0-slim` Linux image.

## Stderr flushing needs a kernel pipe

**Decision:** the test "flushes all missing-file errors to a slow stderr pipe" in [the CLI spec](../../tests/specs/cli.ts) runs the CLI through `sh`, with stderr piped into a reader that reads the first line, sleeps, and then counts the rest:

```sh
"$0" "$@" 2>&1 >/dev/null | { read -r _; sleep 1; wc -l; }
```

The test guards against calling `process.exit()` while stderr writes are still pending, such as right after printing the argument errors. The CLI sets `process.exitCode` instead.

### Why the bug needs a full pipe

- Node.js documents stdio writes to pipes and sockets as "_synchronous_ on Windows, _asynchronous_ on POSIX" ([`process.md` at v24.14.0](https://github.com/nodejs/node/blob/v24.14.0/doc/api/process.md#a-note-on-process-io)). The kernel accepts writes until its buffer is full. After that, Node queues them, and `process.exit()` drops the queue.
- With 6,000 missing paths, the CLI writes 160,890 bytes of errors. That is more than a kernel pipe holds.
- The reader is `sh`, not the test process. The kernel keeps the data until `wc` reads it, and nano-spawn only buffers the output of `wc`, which is small.
- The sleep starts after the first line arrives, not when the CLI spawns. POSIX `read` takes one line from a pipe without reading ahead. The CLI then prints the remaining errors in one loop and fills the pipe within milliseconds.

The first version slept right away (`{ sleep 1; wc -l; }`). In isolation it caught the regression, but in the full suite the regressed build passed. Under the load of concurrent tests, the CLI took longer than the sleep to start, so `wc` read each line as it arrived. Starting the sleep at the first line fixed this.

### Why the test does not read the child's stderr in Node

An earlier version spawned the CLI with `node:child_process`, waited 1 second, and then read `child.stderr`. It did not detect the bug, and it failed in isolation:

- Node gives the child a Unix socketpair, not a pipe. libuv creates it with `uv_socketpair` and sets 64 KB send and receive buffers ([`process.c` at v1.51.0](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/process.c#L196-L213)). Measured on both platforms, a child that writes 128 KB without a reader exits without blocking, and a child that writes 512 KB blocks. The CLI's output for 3,200 paths (85 KB) fits, so the child never blocks and `process.exit()` loses nothing.
- When a child exits, Node resumes every stdio stream that nobody reads, which discards its data ([`child_process.js` at v24.14.0](https://github.com/nodejs/node/blob/v24.14.0/lib/internal/child_process.js#L300-L303)). The CLI exits in about 130 ms, before the 1-second wait ends, so the delayed read got an empty string for both the correct and the regressed build.

That version still passed in the full suite. The cause was not identified.

### Why not nano-spawn's own streams

nano-spawn attaches a `data` listener to the child's stdout and stderr as soon as it spawns, unless iteration has already started ([`spawn.js` at v2.1.0](https://github.com/sindresorhus/nano-spawn/blob/v2.1.0/source/spawn.js#L48-L58)). Starting to iterate later throws "The subprocess must be iterated right away" ([`iterable.js` at v2.1.0](https://github.com/sindresorhus/nano-spawn/blob/v2.1.0/source/iterable.js#L6-L11)). Both paths read the stream at once, so the buffer never fills. In a test that iterated right away and then stalled for 1 second, 3,199 of 3,200 lines arrived.

A `buffer: false` option, like execa's, was considered as a feature request and not filed. nano-spawn's maintainers discussed a boolean option in [#33](https://github.com/sindresorhus/nano-spawn/issues/33) and chose to stop buffering when iteration starts instead.

### Results

"Regressed" is the CLI with `process.exit(1)` added after the argument errors are printed. Every row gave the same result on every run:

| Harness | Runs | Correct build | Regressed build |
| --- | --- | --- | --- |
| Test in the full suite, macOS | 3 | 5999/5999 | 2468/5999 |
| `{ read -r _; sleep 1; wc -l; }` alone, macOS | 3, plus 12 concurrently | 5999/5999 | 2468/5999 |
| `{ sleep 1; wc -l; }` alone, macOS | 5, plus 12 concurrently | 6000/6000 | 2468/6000 |
| `{ sleep 1; wc -l; }` alone, Linux | 5 | 6000/6000 | 2458/6000 |
| `{ sleep 1; wc -l; }` in the full suite, macOS | 1 | not run | 6000/6000 (missed) |
| `node:child_process`, 1-second delay, 3,200 paths, macOS | 3 | 0/3200 | 0/3200 |
| `node:child_process`, read after 0 to 100 ms, 3,200 paths, macOS | 4 | 3200/3200 | 3200/3200 |

The `read -r _` version has not been run against the regressed build on Linux. CI runs it against the correct build.

The test is skipped on Windows, which has no `sh` and where pipe writes are synchronous. CI runs on Linux only.

**Re-evaluate** if the test runs on Windows, if Node.js makes POSIX pipe writes synchronous, or if nano-spawn adds an option to leave output unread.

## Reproduce

Build, then add `process.exit(1);` after the loop that prints the argument errors in `src/cli.ts` and build again. Run `node tests/index.ts` without rebuilding. The correct build passes, and the regressed build fails this test with fewer than 5,999 lines.
