import { describe } from 'manten';
import { block, $ } from '../src/runtime.ts';

// Mirror the CLI's globalThis seeding so specs that drive processSource
// directly (bypassing the CLI) find `block` and `$` in `.md` modules.
Object.assign(globalThis, {
	block,
	$,
});

describe('mdeval', () => {
	import('./specs/runtime.ts');
	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
	import('./specs/recipe.ts');
});
