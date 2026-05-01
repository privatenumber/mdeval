import { register } from 'node:module';
import { $ } from 'zx';

export const block = (value: unknown): string => `\n${String(value)}\n`;
export { $ };

// Sets up the side effects an mdeval consumer needs before importing a `.md`
// file: seeds `block` / `$` on `globalThis` (which `.md` modules expect to find
// there), then registers the Node ESM loader so `.md` resolves as a module.
export const registerMdevalLoader = (): void => {
	Object.assign(globalThis, {
		block,
		$,
	});
	register(new URL('md-loader.mjs', import.meta.url));
};
