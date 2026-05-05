import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { block, $ } from './runtime.ts';

// Seeds the helpers `.md` modules expect on `globalThis` and installs the Node
// ESM loader so `.md` files resolve as modules.
//
// `cacheBust` is a watch-mode optimization: when on, the loader hook adds
// `?mtime=...` to every project-owned file URL so Node's URL-keyed ESM cache
// invalidates when any imported file changes, and posts each loaded URL back
// to this thread via MessagePort so cli.ts can filter chokidar events to
// "files actually in the .md import graph." cli.ts sets this true for
// `--watch`; the public `mdeval/loader` entry leaves it off and skips the
// MessagePort plumbing entirely.
export const setupLoader = ({ cacheBust = false } = {}): {
	loadedFiles: Set<string>;
} => {
	Object.assign(globalThis, {
		block,
		$,
	});
	process.setSourceMapsEnabled(true);

	const loadedFiles = new Set<string>();

	if (!cacheBust) {
		register('#md-loader', import.meta.url, {
			data: { cacheBust },
		});
		return { loadedFiles };
	}

	const { port1, port2 } = new MessageChannel();
	port1.on('message', (filePath: string) => {
		loadedFiles.add(filePath);
	});
	port1.unref();

	register('#md-loader', import.meta.url, {
		data: {
			cacheBust,
			port: port2,
		},
		transferList: [port2],
	});

	return { loadedFiles };
};
