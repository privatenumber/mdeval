# Performance

## Parsing an active file

The CLI parses each input with [`parseMarkdown`](../../src/parse-markdown.ts) and passes the result to [`processSource`](../../src/process-source.ts). When that processing loads the file, the loader reuses the result only if its strict UTF-8 read matches the original source; it parses again if the file changed. An earlier import from another Markdown file can still parse the target separately. [`findRenderedLeaks`](../../src/validate-rendering/index.ts) separately parses the text the CLI holds in memory with `fromMarkdown`: the rewritten output, or the original source with `--check`. It does not reread the file. Files without markers can take fast paths and skip some of these parses.

### Hand-off design

[`parsed-handoff.ts`](../../src/parsed-handoff.ts) holds a `Map` from a file's real path to `{ source, parsed }`. `processSource` adds the entry right before `import()`. The first load of that file takes and deletes it, which can happen before a module with top-level await settles. If no load takes it, for example because the module is already cached, `processSource` deletes it when the import settles, unless an overlapping call for the same file replaced it. The entry references the same source string and parse result that `processSource` holds, so it keeps no extra copy; its own cost is one small object and a path key. Reuse is best-effort: another import of the same file can take the entry first, and the loader then parses as before. The source comparison keeps the output correct in every case. These decisions were checked on 2026-11-07 with Node.js 22.21.1 and 26.13.0:

- **The channel is a module-level `Map`.** Import attributes cannot carry the hand-off: `import(url, { with: { handoff: '1' } })` throws `ERR_IMPORT_ATTRIBUTE_UNSUPPORTED` on both versions. A query string would make a separate module instance with a different `import.meta.url`. The load hook runs in the same thread (`module.registerHooks()` in [`loader.ts`](../../src/loader.ts)), so the `Map` is visible to it.
- **The key is the real filesystem path, without the URL's query or fragment.** On macOS, `/var` resolves to `/private/var`. A resolve hook can also add a query, such as `?v=1`, to the same file. Keying by URL missed the hand-off in both cases and parsed again. The source comparison keeps reuse correct whichever URL loads the file.
- **No `import.meta.resolve()`.** It invokes registered resolve hooks once more before the import, which changed what a stateful hook loaded. [`tests/specs/process-source.ts`](../../tests/specs/process-source.ts) covers this.
- **`processSource` awaits `import()` directly.** Every extra promise reaction between module evaluation and marker evaluation lets more un-awaited work in a script block finish first. With a script block that sets `x = 1` after an N-step `.then()` chain, the marker read `1` for N ≤ 6 and `0` for N ≥ 7 on develop. `import(url).finally(...)` moved the threshold by three steps and changed the output. `try`/`finally` around `await import(url)` matches develop for every N from 0 to 10 on both versions. An async helper would add steps for the same reason. The source does not use `using`, because Node.js 22.21.1 cannot parse it.
- **No test counts parse calls.** Reuse changes only speed, which the benchmarks below measure. A test would have to observe internal calls, not output.

Stress test, 2026-11-07, Node.js 26.13.0, built CLI on `*.md` with every file rewritten, five interleaved runs each, load average 4 to 12:

| Files | develop median | hand-off median | Peak RSS, both |
| --- | ---: | ---: | --- |
| 1,000 × 10 kB marker fixture | 4.71 s | 2.61 s | 250 to 261 MiB |
| 100 × 100 kB marker fixture | 4.62 s | 2.58 s | 246 to 351 MiB |
| 10,000 one-marker files | 2.64 s | 2.28 s | 317 to 324 MiB |

The CLI starts all imports concurrently, so many entries can exist at once, and each Markdown load calls `realpathSync.native` once while any entry exists. That cost does not show at 10,000 files. Standalone `mdeval/loader` use skips the lookup when the `Map` is empty.

## Rejected: enabling Node's compile cache by default

On 2026-11-07, calling [`module.enableCompileCache()`](https://nodejs.org/download/release/v22.21.1/docs/api/module.html#moduleenablecompilecachecachedir) in a minimal CLI entry, before importing the rest, saved about 3 to 6 ms per warm run on the default CLI fixtures with Node.js 26.13.0. On the README it saved 0 to 8 ms, depending on machine load. mdeval does not enable it, because the cache is process-wide and has these costs:

- **It copies user code outside the workspace.** Node caches the type-stripped source of the loader's `module-typescript` output by filename, so Markdown script blocks and marker expressions persist in the temporary cache, also with `--check`. See the [type-stripping cache lookup](https://github.com/nodejs/node/blob/v24.14.1/lib/internal/modules/typescript.js#L192-L216).
- **A shared temporary directory allows cache poisoning.** The default cache is `os.tmpdir()/node-compile-cache`. Node creates it with `MKDirpSync` and accepts an existing directory (`UV_EEXIST`) without an ownership check, and cache entries carry only checksums. On a multi-user Linux machine with a shared `/tmp`, another user can create the directory first and plant code that runs as the mdeval user. See the [directory creation](https://github.com/nodejs/node/blob/v24.14.1/src/compile_cache.cc#L575-L587).
- **It reduces V8 coverage precision** for jobs that run mdeval under coverage, which Node's documentation warns about.

Users can opt in for their own runs with `NODE_COMPILE_CACHE=<dir>`. Evaluate again if Node scopes the default cache to a per-user, owner-checked directory and if the API can exclude user modules.

An earlier one-off measurement on 2026-11-06 used Node.js 24.14.0 on macOS and the built CLI on a 52.5 MB Markdown file with one marker and repeated plain text lines. It took 129 s and 5.1 GB maximum resident memory. This fixture and runtime differ from the benchmarks below.

## Reproducible step benchmarks

With the parse hand-off, an interleaved comparison on 2026-11-07 used Node.js 26.13.0 and the same 10 MB marker fixture. The median of four samples fell from 5,141.7 ms to 2,708.2 ms for the built CLI and from 2,375.7 ms to 1,194.9 ms for `processSource`. The corresponding peak RSS readings were 920.1 to 481.7 MiB for the CLI and 1,027.5 to 826.5 MiB for `processSource`. These single peak readings vary with garbage collection. The benchmark prints only the average and p75, so this comparison calculated the median from mitata's `stats.samples`. `bench/worker.ts` does not print them; reproducing the medians needs a local change that does.

Measured before the parse hand-off, 2026-11-07 on an Apple M2 Max, macOS arm64, Node.js 26.13.0, using the marker-heavy fixture. Each marker has the same expression and occurs about once per kilobyte. The source steps run from TypeScript; the built CLI writes the stale values to disk. See [`bench/README.md`](../../bench/README.md) for fixture definitions, sample counts, RSS semantics, and limitations. Times are milliseconds; RSS is MiB. Each case runs in its own process, but RSS includes all its samples and process initialization. CLI RSS comes from a separate invocation.

```sh
pnpm bench
pnpm bench --shape markers --size 1m --size 10m
```

Each cell is avg ms / p75 ms / peak RSS MiB.

| Step | 10,010 bytes | 100,100 bytes | 1,001,000 bytes | 10,000,991 bytes |
| --- | ---: | ---: | ---: | ---: |
| `parseMarkdown` | 1.044 / 1.050 / 146.7 | 11.163 / 11.416 / 241.6 | 117.964 / 117.982 / 302.9 | 1,163.194 / 1,180.832 / 908.3 |
| `generateModule` | 1.057 / 1.068 / 146.2 | 11.104 / 11.352 / 253.3 | 115.908 / 117.796 / 302.2 | 1,193.797 / 1,204.154 / 1,048.9 |
| `findRenderedLeaks` | 1.213 / 1.231 / 156.1 | 12.853 / 13.002 / 272.6 | 133.293 / 134.483 / 321.2 | 1,362.248 / 1,389.916 / 1,097.4 |
| `processSource` | 3.151 / 3.119 / 136.7 | 26.393 / 25.726 / 196.2 | 233.775 / 234.824 / 339.4 | 2,355.337 / 2,394.785 / 992.7 |
| CLI | 137.513 / 139.220 / 111.3 | 190.000 / 189.597 / 142.2 | 647.540 / 643.503 / 281.0 | 5,287.628 / 5,116.910 / 849.4 |

The 10 kB and 100 kB rows are from the default sweep; the 1 MB and 10 MB rows are from the second command. `generate` and `process` include parsing; step times must not be summed. The earlier measurements use a different fixture and Node version and are not directly comparable.

From 1 MB to 10 MB, average time per MB changes from 118 to 116 ms for parsing, 116 to 119 ms for generation, 133 to 136 ms for leak detection, 234 to 236 ms for processing, and 647 to 529 ms for the CLI. These measurements are consistent with approximately linear scaling over these two sizes, with startup overhead affecting the CLI. They do not establish asymptotic complexity. Processing and CLI cases have only four samples; repeat measurements and profile before drawing a stronger conclusion.
