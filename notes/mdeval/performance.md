# Performance

## A file with an active marker is parsed four times

For a file with an active marker, the CLI parses the file with [`parseMarkdown`](../../src/parse-markdown.ts) in [`cli.ts`](../../src/cli.ts), again in [`processSource`](../../src/process-source.ts), and again in the loader through [`generateModule`](../../src/generate-module.ts). [`findRenderedLeaks`](../../src/validate-rendering/index.ts) then runs `fromMarkdown` on the output. Files without markers can take fast paths and skip some of these parses.

An earlier one-off measurement on 2026-11-06 used Node.js 24.14.0 on macOS and the built CLI on a 52.5 MB Markdown file with one marker and repeated plain text lines. It took 129 s and 5.1 GB maximum resident memory. This fixture and runtime differ from the benchmarks below.

## Reproducible step benchmarks

Measured 2026-11-07 on an Apple M2 Max, macOS arm64, Node.js 26.13.0, using the marker-heavy fixture. Each marker has the same expression and occurs about once per kilobyte. The source steps run from TypeScript; the built CLI writes the stale values to disk. See [`bench/README.md`](../../bench/README.md) for fixture definitions, sample counts, RSS semantics, and limitations. Times are milliseconds; RSS is MiB. Each case runs in its own process, but RSS includes all its samples and process initialization. CLI RSS comes from a separate invocation.

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
