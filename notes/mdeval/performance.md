# Performance

## A file with an active marker is parsed four times

For a file with an active marker, the CLI parses the file with [`parseMarkdown`](../../src/parse-markdown.ts) in [`cli.ts`](../../src/cli.ts), again in [`processSource`](../../src/process-source.ts), and again in the loader through [`generateModule`](../../src/generate-module.ts). [`findRenderedLeaks`](../../src/validate-rendering/index.ts) then runs `fromMarkdown` on the output. Files without markers can take fast paths and skip some of these parses.

An earlier one-off measurement on 2026-11-06 used Node.js 24.14.0 on macOS and the built CLI on a 52.5 MB Markdown file with one marker and repeated plain text lines. It took 129 s and 5.1 GB maximum resident memory. This fixture and runtime differ from the benchmarks below.

## Reproducible step benchmarks

Measured 2026-11-06 on an Apple M2 Max, macOS arm64, Node.js 26.13.0, using the marker-heavy fixture. Each marker has the same expression and occurs about once per kilobyte. The source steps run from TypeScript; the CLI is built. See [`bench/README.md`](../../bench/README.md) for fixture definitions, sample counts, RSS semantics, and limitations. Times are milliseconds; RSS is MiB. Each case runs in its own process, but RSS includes all its samples and process initialization. CLI RSS comes from a separate invocation.

```sh
pnpm bench
pnpm bench --shape markers --size 1m --size 10m
```

Each cell is avg ms / p75 ms / peak RSS MiB.

| Step | 10,010 bytes | 100,100 bytes | 1,001,000 bytes | 10,000,991 bytes |
| --- | ---: | ---: | ---: | ---: |
| `parseMarkdown` | 2.309 / 2.614 / 131.7 | 13.931 / 12.676 / 171.6 | 123.962 / 124.697 / 235.8 | 1,178.989 / 1,173.932 / 688.9 |
| `generateModule` | 2.267 / 2.525 / 130.7 | 14.333 / 13.841 / 173.8 | 120.035 / 121.677 / 235.2 | 1,181.984 / 1,181.157 / 848.0 |
| `findRenderedLeaks` | 2.245 / 2.300 / 129.7 | 25.111 / 26.007 / 177.8 | 139.811 / 140.958 / 264.1 | 2,102.300 / 1,388.101 / 958.5 |
| `processSource` | 3.291 / 3.265 / 137.1 | 31.424 / 35.391 / 195.3 | 231.029 / 232.653 / 302.6 | 2,467.887 / 2,466.593 / 996.6 |
| CLI | 139.504 / 137.862 / 107.2 | 209.608 / 207.579 / 139.0 | 659.887 / 662.396 / 230.4 | 5,264.847 / 5,280.869 / 735.0 |

The 10 kB and 100 kB rows are from the default sweep; the 1 MB and 10 MB rows are from the second command. `generate` and `process` include parsing; step times must not be summed. The earlier measurements use a different fixture and Node version and are not directly comparable.

From 1 MB to 10 MB, average time per MB changes from 124 to 118 ms for parsing, 120 to 118 ms for generation, 140 to 210 ms for leak detection, 231 to 247 ms for processing, and 659 to 526 ms for the CLI. Leak detection shows a possible superlinear increase, but its 10 MB average is affected by an outlier: p75 is 1,388 ms versus a 2,102 ms average. Four samples do not establish asymptotic complexity or the cause. The other steps are consistent with approximately linear scaling over these two sizes, with startup overhead affecting the CLI. Repeat measurements and profile before drawing a stronger conclusion.
