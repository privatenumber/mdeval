import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { cli } from 'cleye';
import chokidar from 'chokidar';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { setupLoader } from './setup-loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';

const argv = cli({
	name: 'mdeval',
	flags: {
		watch: {
			type: Boolean,
			alias: 'w',
			description: 'Re-render on file changes',
		},
	},
	parameters: ['<files...>'],
});

const { loadedFiles } = setupLoader({ cacheBust: argv.flags.watch });

const patterns = argv._.files;
const targetsNodeModules = patterns.some(pattern => pattern.includes('node_modules'));
const globIgnore = targetsNodeModules ? [] : ['**/node_modules/**'];

const expandPatterns = () => glob(patterns, { ignore: globIgnore });

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
	// Drain any in-flight loader-hook port messages so `loadedFiles` reflects
	// what was actually imported during the just-finished render. Without this,
	// the `loadedFiles.clear()` at the next render's start would race the late
	// arrivals of the previous render's posts and lose tracking entries.
	const flushLoaderMessages = () => new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

	// Re-glob on every render so newly-added files matching the input pattern
	// are picked up automatically. Each pass shares one `Date.now()` cache-bust
	// so entry .md files re-evaluate fresh; the loader-hook resolve step
	// mtime-busts every transitive import so changed helpers also reload.
	// Reset the exit code each iteration — a previous render's failure
	// shouldn't carry over once a recovered render runs cleanly. Clearing
	// `loadedFiles` first means files no longer in the import graph (e.g. a
	// helper.ts whose import was removed) drop out of the precision filter.
	//
	// Known limitation: transitive imports that resolve outside cwd (e.g.
	// `import "../shared/util.ts"` when cwd is a subdirectory) are not watched.
	// chokidar's recursive watch only covers cwd, and watcher.add() on
	// outside-cwd paths is unreliable across platforms with polling enabled.
	// Run mdeval from a higher cwd so all imports stay inside the watch root.
	const renderAll = async () => {
		process.exitCode = 0;
		loadedFiles.clear();
		const cacheBust = Date.now();
		const files = await expandPatterns();
		await Promise.all(files.map(file => renderFile(file, cacheBust)));
		await flushLoaderMessages();
	};

	// Match candidate event paths against the user's input glob. Used to
	// recognize new files appearing under cwd (chokidar `add` event) before
	// they've been imported and registered in `loadedFiles`. picomatch handles
	// `**`, `{a,b}`, and `!` negation the same way tinyglobby does.
	const isInputMatch = picomatch(patterns, { dot: false });

	// Watch from cwd recursively. Any non-ignored add/change schedules a
	// render — `renderAll` itself decides which files match the user's input
	// pattern by re-globbing. Renders are idempotent (no write when the output
	// matches the input) so events on unrelated files cost only the render
	// pass, never produce spurious rewrites.
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

	// Surface watcher errors instead of silently leaving the process alive
	// with a dead watcher. Most failures here are unrecoverable (lost watch
	// handles, perms changes); exit non-zero so a supervising process can
	// restart.
	watcher.on('error', (error) => {
		console.error('mdeval watch error:', error instanceof Error ? error.message : error);
		process.exit(1);
	});

	// Wait for chokidar's initial scan to complete before the initial render
	// so that the polling watch is actually active when our writes (and the
	// user's first edit) fire. Without this, an edit that races the watcher's
	// setup window would be missed.
	await once(watcher, 'ready');

	await renderAll();

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
					await renderAll();
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

		// Precision filter: only render for files in the .md import graph (any
		// previously-loaded file, reported by the loader hook) or for new files
		// matching the input glob (so `add` events for not-yet-imported targets
		// trigger a render). Everything else — random `.txt` edits, package.json
		// saves — is ignored to avoid wasted render passes.
		if (!loadedFiles.has(absolute) && !isInputMatch(eventPath)) {
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
	const initialFiles = await expandPatterns();
	if (initialFiles.length === 0) {
		console.error('No files matched the given patterns');
		process.exit(1);
	}
	await Promise.all(initialFiles.map(file => renderFile(file)));
}
