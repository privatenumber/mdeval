# Performance

## Parsing an active file

The CLI parses each input with [`parseMarkdown`](../../src/parse-markdown.ts) and passes the result to [`processSource`](../../src/process-source.ts). When that processing loads the file, the loader reuses the result only if its strict UTF-8 read matches the original source; it parses again if the file changed. An earlier import from another Markdown file can still parse the target separately. [`findRenderedLeaks`](../../src/validate-rendering/index.ts) separately parses the content on disk with `fromMarkdown`: the rewritten output, or the unchanged source with `--check`. Files without markers can take fast paths and skip some of these parses.

The loader hand-off keys file URLs by real path. On macOS, for example, `/var` can resolve to `/private/var`; using the original file URL misses the hand-off. It does not call `import.meta.resolve()`: that would invoke registered resolve hooks before the import and could change what a stateful hook loads. Cached modules and imports of other Markdown files work without a hand-off.

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
