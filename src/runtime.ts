import { register } from 'node:module';
import { $ } from 'zx';

export const block = (value: unknown): string => `\n${String(value)}\n`;
export { $ };

// Importing this module is the opt-in for side effects: seeding the helpers
// `.md` modules expect on `globalThis`, then installing the Node ESM loader so
// `.md` files resolve as modules. Designed for `node --import mdeval` so
// downstream scripts can use static `import` against `.md` files.
Object.assign(globalThis, {
	block,
	$,
});
register(new URL(
	import.meta.url.endsWith('.ts') ? 'md-loader.ts' : 'md-loader.mjs',
	import.meta.url,
));
