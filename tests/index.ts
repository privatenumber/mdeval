import { describe } from 'manten';

describe('mdeval', () => {
	import('./specs/runtime.ts');
	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
	import('./specs/recipe.ts');
	import('./specs/source-map.ts');
	import('./specs/watch.ts');
});
