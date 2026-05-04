import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { cli } from 'cleye';
import chokidar from 'chokidar';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { enableCacheBust, loadedFiles } from './loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';

const argv = cli({
	name: 'mdeval',
	flags: {
		watch: {
			type: Boolean,
			alias: 'w',
			description: 'Re-render on file changes; tracks transitive imports automatically',
		},
	},
	parameters: ['<files...>'],
});

const patterns = argv._.files;
const targetsNodeModules = patterns.some(pattern => pattern.includes('node_modules'));
const globIgnore = targetsNodeModules ? [] : ['**/node_modules/**'];

const expandPatterns = () => glob(patterns, { ignore: globIgnore });

const initialFiles = await expandPatterns();

if (initialFiles.length === 0) {
	console.error('No files matched the given patterns');
	process.exit(1);
}

// Watch mode opts the loader hook into mtime-based cache-busting on every
// transitive import so changed files re-evaluate on the next render. The
// control message is fire-and-forget — the initial render doesn't need
// cache-bust (cache is empty) and subsequent renders run after the message
// has been processed by the loader thread.
if (argv.flags.watch) {
	enableCacheBust();
}

// Track files we're currently writing and the mtime of the last write so the
// watcher can ignore the chokidar events caused by our own writes. Without
// this, every render that mutates a file kicks off another render iteration.
const writingFiles = new Set<string>();
const lastWriteMtimes = new Map<string, number>();

// Render a single .md file. `cacheBust` busts Node's ESM module cache so
// re-imports see updated content during watch mode. The `writingFiles` /
// `lastWriteMtimes` bookkeeping covers both the in-flight window (chokidar
// fires events while we're still writing) and the post-write window (events
// fire after we've finished but the mtime matches what we wrote).
const renderFile = async (
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
			writingFiles.add(resolvedPath);
			try {
				await fs.writeFile(resolvedPath, output, 'utf8');
				const stat = await fs.stat(resolvedPath);
				lastWriteMtimes.set(resolvedPath, stat.mtimeMs);
			} finally {
				writingFiles.delete(resolvedPath);
			}
			console.log(file);
		}
	} catch (error) {
		console.error(`Error processing ${file}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
};

if (argv.flags.watch) {
	// Loader-hook messages travel from the customization-thread MessagePort to
	// this thread's listener via the event loop. After awaiting the imports we
	// still need to drain any pending messages before reading `loadedFiles`,
	// otherwise transitive imports surfaced by this render won't be in the set
	// when we go to add them to the watcher.
	const flushLoaderMessages = () => new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

	const renderAll = async () => {
		// One cache-bust value per render pass: every `.md` import gets the
		// same `?mtime=...` so the entry modules re-evaluate on this pass and
		// freshly resolve their transitive imports (which the loader-hook
		// resolve step then mtime-busts based on each file's actual mtime).
		const cacheBust = Date.now();
		const files = await expandPatterns();
		await Promise.all(files.map(file => renderFile(file, cacheBust)));
		await flushLoaderMessages();
	};

	// Match the user's input patterns against new chokidar events to decide
	// whether a path should be rendered as a target. picomatch handles `**`,
	// `{a,b}`, and `!` negation the same way tinyglobby does.
	const isInputMatch = picomatch(patterns, { dot: false });

	// Watch from cwd recursively so newly-created files matching the input
	// pattern get picked up — chokidar's `add` event is what makes item 3 work.
	// The ignored callback mirrors the glob's node_modules / dotdir filters.
	const ignored = (eventPath: string): boolean => {
		const relative = path.relative(process.cwd(), eventPath);
		if (!relative || relative.startsWith('..')) {
			return false;
		}
		const segments = relative.split(path.sep);
		for (const segment of segments) {
			if (segment === 'node_modules' && !targetsNodeModules) {
				return true;
			}
			if (segment.startsWith('.') && segment !== '.' && segment !== '..') {
				return true;
			}
		}
		return false;
	};

	// Polling avoids reliability quirks of macOS FSEvents (some tmpdir-style
	// paths don't deliver events) at the cost of a small constant CPU baseline.
	// 200ms is well below human-perceptible latency for save → re-render and
	// keeps total CPU under a few percent for typical project sizes.
	const watcher = chokidar.watch('.', {
		ignored,
		ignoreInitial: true,
		persistent: true,
		usePolling: true,
		interval: 200,
	});

	// Start chokidar before the initial render so that any chokidar events
	// caused by our own initial-render writes are seen (and filtered through
	// `writingFiles` / `lastWriteMtimes`). If we deferred until after the
	// initial render, edits that race with the watcher's setup window would
	// be missed entirely.
	await once(watcher, 'ready');

	await renderAll();

	// Transitive imports (helper.ts, helper.json, etc.) live anywhere under the
	// project root and aren't necessarily matched by the input pattern. Add
	// each one chokidar would otherwise have skipped so edits trigger a
	// re-render. `loadedFiles` is populated by the loader hook via MessagePort.
	for (const file of loadedFiles) {
		watcher.add(file);
	}

	// Coalesce bursts of file events into a single render pass — file editors
	// often emit several events per save (write + atime touch + temp swap).
	// Without debounce we'd render N times for one Ctrl-S.
	let pendingRender: Promise<void> | undefined;
	let renderRequested = false;

	const scheduleRender = () => {
		renderRequested = true;
		if (pendingRender) {
			return;
		}
		pendingRender = (async () => {
			try {
				while (renderRequested) {
					renderRequested = false;
					await delay(50);
					if (renderRequested) {
						continue;
					}
					const before = loadedFiles.size;
					await renderAll();
					if (loadedFiles.size > before) {
						// New transitive imports surfaced from this render — wire
						// the watcher up to them so the next change is detected.
						for (const file of loadedFiles) {
							watcher.add(file);
						}
					}
				}
			} finally {
				pendingRender = undefined;
			}
		})();
	};

	const onEvent = async (eventPath: string) => {
		const absolute = path.resolve(eventPath);

		// Skip self-writes. Two windows: events that arrive while we're still
		// writing (covered by `writingFiles`) and events that arrive after the
		// write but match the recorded mtime (covered by `lastWriteMtimes`).
		if (writingFiles.has(absolute)) {
			return;
		}

		const isMatch = isInputMatch(eventPath);
		const isTransitive = loadedFiles.has(absolute);
		if (!isMatch && !isTransitive) {
			return;
		}

		try {
			const stat = await fs.stat(absolute);
			if (lastWriteMtimes.get(absolute) === stat.mtimeMs) {
				return;
			}
		} catch {
			// File may have been deleted between event and stat — fall through.
		}

		scheduleRender();
	};

	watcher.on('add', onEvent);
	watcher.on('change', onEvent);

	const shutdown = async () => {
		await watcher.close();
		if (pendingRender) {
			await pendingRender;
		}
		process.exit(process.exitCode ?? 0);
	};

	process.on('SIGINT', () => {
		shutdown().catch(() => undefined);
	});
	process.on('SIGTERM', () => {
		shutdown().catch(() => undefined);
	});
} else {
	await Promise.all(initialFiles.map(file => renderFile(file)));
}
