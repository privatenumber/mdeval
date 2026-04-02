import { register } from 'node:module';
import { describe } from 'manten';
import { $ } from 'zx';

register('#md-loader', import.meta.url);

globalThis.block = (value: unknown) => `\n${String(value)}\n`;
globalThis.$ = $;

describe('mdeval', () => {
	import('./specs/coerce-value.ts');
	import('./specs/parse-markdown.ts');
	import('./specs/process-source.ts');
	import('./specs/cli.ts');
});
