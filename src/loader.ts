import { register } from 'node:module';
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

register('#md-loader', import.meta.url);
