import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { block, $ } from './runtime.ts';

// Side-effect-only entry: seeds the helpers `.md` modules expect on
// `globalThis` and installs the Node ESM loader so `.md` files resolve as
// modules. Designed for `node --import mdeval/loader` so downstream scripts
// can use static `import` against `.md` files. Importing `mdeval` itself stays
// pure — it's just `{ block, $ }`.
Object.assign(globalThis, {
	block,
	$,
});

// Enable Node's source-map support so runtime stack traces from `.md` files
// remap to original lines without users needing `--enable-source-maps`. The
// loader is already side-effecting; carrying this here keeps the recipe to a
// single `--import mdeval/loader`.
process.setSourceMapsEnabled(true);

// Module customization hooks run on a dedicated worker thread, so the only way
// to surface what the loader sees to this thread is via MessagePort. cli.ts's
// watch mode reads `loadedFiles` to wire up file watchers for every transitive
// import the .md graph touches. The same channel also carries the
// "enable cache-bust" control message — when watch mode is on, the loader
// rewrites every project-owned file URL with a mtime suffix so the cache
// invalidates when the file changes.
const { port1, port2 } = new MessageChannel();

export const loadedFiles = new Set<string>();

port1.on('message', (message: string) => {
	loadedFiles.add(message);
});
port1.unref();

// Watch mode (cli.ts) calls this before its initial render. The control
// message reaches the loader thread asynchronously, but the initial render
// doesn't need cache-bust (no cache yet), so we don't have to synchronize.
// Subsequent renders are gated by chokidar events and run after the message
// has been processed.
export const enableCacheBust = () => {
	port1.postMessage({ enableCacheBust: true });
};

register('#md-loader', import.meta.url, {
	data: { port: port2 },
	transferList: [port2],
});
