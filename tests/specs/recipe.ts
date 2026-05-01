import path from 'node:path';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn from 'nano-spawn';

// Project root acts as the `mdeval` package (its package.json has
// `name: "mdeval"`). Symlinking `node_modules/mdeval` → project root inside
// each fixture lets the consumer resolve `import 'mdeval'` as a plain bare
// specifier — exactly the recipe external users follow after `npm i mdeval`.
const projectRoot = path.resolve(import.meta.dirname, '../..');

const consumerScript = (mdPath: string) => `
import { registerMdevalLoader } from 'mdeval';

registerMdevalLoader();

const mod = await import(${JSON.stringify(mdPath)});
process.stdout.write(JSON.stringify(mod));
`;

const buildFixture = (dataMd: string) => createFixture({
	'data.md': dataMd,
	'consumer.mjs': ({ fixturePath }) => consumerScript(path.join(fixturePath, 'data.md')),
	'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
});

describe('recipe', () => {
	test('external script imports plain .md exports', async () => {
		await using fixture = await buildFixture(
			'# Data\n\n<!--mdeval\nexport const todos = ["write", "test", "ship"];\nexport const count = 3;\n-->\n',
		);

		const result = await spawn(process.execPath, [fixture.getPath('consumer.mjs')]);

		const exported = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(exported.todos).toStrictEqual(['write', 'test', 'ship']);
		expect(exported.count).toBe(3);
	});

	test('block() global resolves inside an imported .md marker', async () => {
		await using fixture = await buildFixture([
			'<!--mdeval',
			'export const heading = block("# Hello");',
			'-->',
			'',
			'<!--mdeval heading-->placeholder<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await spawn(process.execPath, [fixture.getPath('consumer.mjs')]);

		const exported = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(exported.heading).toBe('\n# Hello\n');
	});

	test('$ shell helper resolves inside an imported .md script', async () => {
		await using fixture = await buildFixture([
			'<!--mdeval',
			'const result = await $`echo recipe-ok`;',
			'export const greeting = String(result);',
			'-->',
			'',
			'<!--mdeval greeting-->placeholder<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await spawn(process.execPath, [fixture.getPath('consumer.mjs')]);

		const exported = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(exported.greeting).toBe('recipe-ok');
	});
});
