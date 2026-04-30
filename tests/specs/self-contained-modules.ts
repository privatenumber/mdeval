import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { processSource } from '../../src/process-source.ts';

const processMarkdown = async (source: string) => {
	await using fixture = await createFixture({ 'test.md': source });
	return await processSource(source, fixture.getPath('test.md'));
};

await describe('self-contained generated modules', () => {
	test('block() works without globalThis.block seeded', async () => {
		const savedBlock = (globalThis as Record<string, unknown>).block;
		delete (globalThis as Record<string, unknown>).block;
		try {
			const source = '<!--mdeval\nconst heading = "# Title";\n-->\n\n<!--mdeval block(heading)-->old<!--/mdeval-->';
			const output = await processMarkdown(source);
			expect(output).toBe(source.replace('old', '\n# Title\n'));
		} finally {
			(globalThis as Record<string, unknown>).block = savedBlock;
		}
	});

	test('$ works without globalThis.$ seeded', async () => {
		const savedDollar = (globalThis as Record<string, unknown>).$;
		delete (globalThis as Record<string, unknown>).$;
		try {
			const source = '<!--mdeval\nconst result = $`echo hello`;\n-->\n\n<!--mdeval result-->old<!--/mdeval-->';
			const output = await processMarkdown(source);
			expect(output).toBe(source.replace('old', 'hello'));
		} finally {
			(globalThis as Record<string, unknown>).$ = savedDollar;
		}
	});
}, { parallel: false });
