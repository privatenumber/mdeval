import { describe } from 'manten';
import { $ } from 'zx';

globalThis.block = (value: unknown) => `\n${String(value)}\n`;
globalThis.$ = $;

describe('mdeval', () => {
	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
});
