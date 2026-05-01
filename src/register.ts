import { register } from 'node:module';
import { block, $ } from './runtime.ts';

// Side-effect-only entry: seeds the helpers `.md` modules expect on
// `globalThis` and installs the Node ESM loader so `.md` files resolve as
// modules. Designed for `node --import mdeval/register` so downstream scripts
// can use static `import` against `.md` files. Importing `mdeval` itself stays
// pure — it's just `{ block, $ }`.
Object.assign(globalThis, { block, $ });
register(new URL(
	import.meta.url.endsWith('.ts') ? 'md-loader.ts' : 'md-loader.mjs',
	import.meta.url,
));
