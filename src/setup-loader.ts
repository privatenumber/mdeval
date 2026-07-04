import { registerHooks } from 'node:module';
import { block, $ } from './runtime.ts';
import { createMdLoaderHooks } from './md-loader.ts';

// Seeds the helpers `.md` modules expect on `globalThis` and installs the Node
// loader hooks so `.md` files resolve as modules.
//
// `cacheBust` is a watch-mode optimization: when on, the resolve hook adds
// `?mtime=...` to every project-owned file URL so Node's URL-keyed ESM cache
// invalidates when any imported file changes, and records loaded paths so
// cli.ts can filter file events to "files actually in the .md import graph."
export const setupLoader = ({ cacheBust = false } = {}): {
	loadedFiles: Set<string>;
} => {
	Object.assign(globalThis, {
		block,
		$,
	});
	process.setSourceMapsEnabled(true);

	const loadedFiles = new Set<string>();
	registerHooks(createMdLoaderHooks({
		cacheBust,
		onLoad: filePath => loadedFiles.add(filePath),
	}));

	return { loadedFiles };
};
