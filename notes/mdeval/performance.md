# Performance

Measured 2026-11-06 on Node.js 24.14.0, macOS, with the built CLI on one Markdown file that has one marker and repeated plain text lines.

## Each file is parsed four times

The CLI parses a file with [`parseMarkdown`](../../src/parse-markdown.ts) in [`cli.ts`](../../src/cli.ts), again in [`processSource`](../../src/process-source.ts), and again in the loader through [`generateModule`](../../src/generate-module.ts). [`findRenderedLeaks`](../../src/validate-rendering/index.ts) then runs `fromMarkdown` on the output. A CPU profile of the 10 MB case spends most of its time in micromark tokenizing and in garbage collection (2.8 s).

| File size | Time |
| --- | --- |
| 2.6 MB | 3.8 s |
| 5.3 MB | 7.5 s |
| 10.5 MB | 14.5 s |
| 52.5 MB | 129 s, 5.1 GB maximum resident memory |

Time grows linearly up to 10 MB, at about 1.4 s per MB. The 50 MB case is slower per MB, which matches memory pressure. Documentation files are far smaller, so this has not been optimized. Reusing one parse result across these steps is the first thing to try if large files matter.
