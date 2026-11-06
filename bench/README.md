# Processing benchmarks

Run `pnpm bench` to build the CLI and measure the 10 kB and 100 kB fixtures and the repository README. The larger inputs are opt-in because multiple samples can take minutes and use substantial memory:

```sh
pnpm bench --shape markers --size 1m --size 10m
pnpm bench --shape gfm --size 1m --step leaks
```

Repeat `--shape`, `--size`, or `--step` to select multiple values. Shapes are `prose`, `markers`, `scripts`, `gfm`, and `readme`; sizes are `10k`, `100k`, `1m`, and `10m`; steps are `parse`, `generate`, `leaks`, `process`, and `cli`. Sizes are approximate decimal bytes. The README is measured once regardless of size selections.

The benchmark scripts and the first four steps run TypeScript directly using Node's type stripping, as the tests do. The CLI step uses the built executable and includes process startup and file I/O. These steps overlap: for example, `generateModule` also calls `parseMarkdown`, and `processSource` also parses and invokes the loader. They are not additive components of CLI time.

Mitata uses adaptive sampling for parsing, generation, and leak detection. The expensive or stateful `processSource` and CLI cases use four samples. None forces garbage collection. Each case runs in a separate process. Each `processSource` sample with an active marker uses a freshly written file path prepared outside the timed interval, so the loader cannot return a cached module. Each CLI sample runs in a fresh process on a fresh copy with stale generated values, so it measures rewriting the file. Results show average and p75 wall time and peak RSS. RSS is the peak for the whole case process, including initialization and all samples; for the CLI it is from a separate invocation of the CLI with a small measurement hook. It is not an allocation delta. Compare results only on the same machine and Node version. Four samples are useful for a baseline, not precise tail-latency estimates.
