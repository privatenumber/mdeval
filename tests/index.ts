import { describe } from 'manten';

describe('mdeval', async () => {
	// Run serially first — this spec mutates globalThis to verify the loader
	// injects helpers via ESM rather than relying on global seeding. Other
	// concurrent specs would race with the delete/restore otherwise.
	await import('./specs/self-contained-modules.ts');

	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
});
