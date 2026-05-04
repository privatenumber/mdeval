import { register } from 'node:module';
import { block, $ } from './runtime.ts';

// Seeds the helpers `.md` modules expect on `globalThis` and installs the Node
// ESM loader so `.md` files resolve as modules.
//
// `cacheBust` is a watch-mode optimization: when on, the loader hook adds
// `?mtime=...` to every project-owned file URL so Node's URL-keyed ESM cache
// invalidates when any imported file changes. cli.ts sets this true for
// `--watch`; the public `mdeval/loader` entry leaves it off.
export const setupLoader = ({ cacheBust = false } = {}) => {
	Object.assign(globalThis, {
		block,
		$,
	});
	process.setSourceMapsEnabled(true);
	register('#md-loader', import.meta.url, {
		data: { cacheBust },
	});
};
