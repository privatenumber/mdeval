import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { cli } from 'cleye';
import chokidar from 'chokidar';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { setupLoader } from './setup-loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';

// Tracks files we just wrote so chokidar events caused by our own writes
// don't trigger another iteration. Two windows are covered: `writing` for the
// in-flight write/stat, `mtimes` for events arriving after the write completes
// (the recorded mtime matches the stat result).
const createSelfWriteTracker = () => {
	const writing = new Set<string>();
	const mtimes = new Map<string, number>();
	return {
		async track(filePath: string, write: () => Promise<void>) {
			writing.add(filePath);
			try {
				await write();
				mtimes.set(filePath, (await fs.stat(filePath)).mtimeMs);
			} finally {
				writing.delete(filePath);
			}
		},
		async isSelfWrite(filePath: string): Promise<boolean> {
			if (writing.has(filePath)) return true;
			try {
				return mtimes.get(filePath) === (await fs.stat(filePath)).mtimeMs;
			} catch {
				return false;
			}
		},
	};
};

// Coalesces bursts of calls into one invocation: each call requests a run;
// after `intervalMs` of quiet, the action runs. Calls during a run queue
// another after, so events that arrive mid-run aren't lost.
const createDebounced = (intervalMs: number, action: () => Promise<void>) => {
	let pending: Promise<void> | undefined;
	let requested = false;
	return () => {
		requested = true;
		if (pending) return;
		pending = (async () => {
			try {
				while (requested) {
					requested = false;
					await setTimeout(intervalMs);
					if (requested) continue;
					await action();
				}
			} finally {
				pending = undefined;
			}
		})();
	};
};

const argv = cli({
	name: 'mdeval',
	flags: {
		watch: {
			type: Boolean,
			alias: 'w',
			description: 'Re-evaluate on file changes',
		},
	},
	parameters: ['<files...>'],
});

const { loadedFiles } = setupLoader({ cacheBust: argv.flags.watch });

const patterns = argv._.files;
const targetsNodeModules = patterns.some(pattern => pattern.includes('node_modules'));
const globIgnore = targetsNodeModules ? [] : ['**/node_modules/**'];

const expandPatterns = () => glob(patterns, { ignore: globIgnore });

const selfWrites = createSelfWriteTracker();

const processFile = async (
	file: string,
	cacheBust?: number,
): Promise<void> => {
	try {
		const resolvedPath = path.resolve(file);
		const source = await fs.readFile(resolvedPath, 'utf8');
		const parsed = parseMarkdown(source);

		if (isOnlyMdeval(source, parsed)) {
			console.warn(`Warning: ${file} has no markdown content outside of mdeval blocks`);
		}

		const output = await processSource(source, resolvedPath, cacheBust);

		if (output !== source) {
			await selfWrites.track(resolvedPath, () => fs.writeFile(resolvedPath, output, 'utf8'));
			console.log(file);
		}
	} catch (error) {
		console.error(`Error processing ${file}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
};

if (argv.flags.watch) {
	const processAll = async () => {
		// Reset the exit code so a previous failed pass doesn't latch on.
		process.exitCode = 0;
		// Rebuild the import-graph index so files no longer in the graph drop
		// out of the precision filter on subsequent events.
		loadedFiles.clear();
		const cacheBust = Date.now();
		const files = await expandPatterns();
		await Promise.all(files.map(file => processFile(file, cacheBust)));
		// Drain any in-flight loader-hook port messages so loadedFiles reflects
		// what was actually imported during this pass.
		await setImmediate();
	};

	const isInputMatch = picomatch(patterns, { dot: false });

	const ignored = (eventPath: string): boolean => {
		const segments = path.relative(process.cwd(), eventPath).split(path.sep);
		return segments.some(segment => (
			segment.startsWith('.')
			|| (segment === 'node_modules' && !targetsNodeModules)
		));
	};

	// Polling sidesteps macOS FSEvents quirks for tmpdir-style paths at a
	// small constant CPU cost. 200ms is below human-perceptible save → eval
	// latency.
	const watcher = chokidar.watch('.', {
		ignored,
		ignoreInitial: true,
		persistent: true,
		usePolling: true,
		interval: 200,
	});

	watcher.on('error', (error) => {
		console.error('mdeval watch error:', error instanceof Error ? error.message : error);
		process.exit(1);
	});

	// Wait for chokidar's initial scan so the watch is active before our
	// initial-pass writes (and the user's first edit) land.
	await once(watcher, 'ready');

	await processAll();

	const debouncedProcess = createDebounced(50, processAll);

	const onEvent = async (eventPath: string) => {
		const absolute = path.resolve(eventPath);

		if (await selfWrites.isSelfWrite(absolute)) return;

		// Precision filter: react only to files in the .md import graph or
		// new files matching the input pattern. Everything else is ignored.
		if (!loadedFiles.has(absolute) && !isInputMatch(eventPath)) return;

		debouncedProcess();
	};

	watcher.on('add', onEvent);
	watcher.on('change', onEvent);

	const shutdown = async () => {
		await watcher.close();
		process.exit(process.exitCode ?? 0);
	};

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			shutdown().catch(() => undefined);
		});
	}
} else {
	const initialFiles = await expandPatterns();
	if (initialFiles.length === 0) {
		console.error('No files matched the given patterns');
		process.exit(1);
	}
	await Promise.all(initialFiles.map(file => processFile(file)));
}
