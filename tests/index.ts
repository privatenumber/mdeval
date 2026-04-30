import { describe } from 'manten';

describe('mdeval', () => {
	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
});
