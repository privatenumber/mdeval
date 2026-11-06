import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { measure, do_not_optimize } from 'mitata';
import spawn from 'nano-spawn';
import { parseMarkdown } from '../src/parse-markdown.ts';
import { generateModule } from '../src/generate-module.ts';
import { processSource } from '../src/process-source.ts';
import { findRenderedLeaks } from '../src/validate-rendering/index.ts';
import { fixture } from './fixtures.ts';

const [step, shape, size] = process.argv.slice(2);
const source = await fixture(shape, size);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mdeval-bench-'));
const input = path.join(directory, 'input.md');
fs.writeFileSync(input, source);
let counter = 0;
try {
	const operations: Record<string, (file: string) => unknown> = {
		parse: () => do_not_optimize(parseMarkdown(source)),
		generate: () => do_not_optimize(generateModule(source)),
		leaks: () => do_not_optimize(findRenderedLeaks(source)),
		process: file => processSource(source, file).then(do_not_optimize),
		cli: () => spawn(process.execPath, ['dist/cli.mjs', input], { stdio: 'ignore' }),
	};
	const operation = operations[step];
	const hasMarkers = step === 'process' && parseMarkdown(source).markers.length > 0;
	// Each iteration gets a different path before timing: import() caches module URLs,
	// and a query string cannot replace a fresh file for the Markdown loader.
	// Mitata's types omit its supported computed-parameter object yields.
	const benchmark = function* () {
		yield {
			0: () => {
				if (step !== 'process' || !hasMarkers) {
					return input;
				}
				const file = path.join(directory, `${counter += 1}.md`);
				fs.writeFileSync(file, source);
				return file;
			},
			bench: operation,
		};
	};
	const stats = await measure(benchmark as unknown as () => Generator<() => unknown>, {
		min_samples: 4,
		max_samples: 4,
		min_cpu_time: 0,
		batch_threshold: 0,
		warmup_threshold: 0,
		gc: false,
	});
	let rss = process.resourceUsage().maxRSS / 1024;
	if (step === 'cli') {
		const result = await spawn(process.execPath, ['--import', './bench/cli-memory.ts', 'dist/cli.mjs', input]);
		rss = Number(result.stderr.split('\n').at(-1)) / 1024;
	}
	console.log([step, shape, size, Buffer.byteLength(source), (stats.avg / 1e6).toFixed(3), (stats.p75 / 1e6).toFixed(3), rss.toFixed(1)].join('\t'));
} finally {
	fs.rmSync(directory, {
		recursive: true,
		force: true,
	});
}
