import path from 'node:path';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { node, projectRoot } from '../utils/binaries.ts';

// Consumer uses static `import` against the `.md` file. This only works if
// the loader is registered before the linker resolves consumer's imports —
// hence `--import mdeval/loader` (the side-effect-only entry) at spawn time.
const consumerScript = (mdPath: string) => `
import * as mod from ${JSON.stringify(mdPath)};
process.stdout.write(JSON.stringify({ ...mod }));
`;

const buildFixture = (dataMd: string) => createFixture({
	'data.md': dataMd,
	'consumer.mjs': ({ fixturePath }) => consumerScript(path.join(fixturePath, 'data.md')),
	'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
});

const runConsumer = async (fixturePath: string) => node(
	['--import', 'mdeval/loader', path.join(fixturePath, 'consumer.mjs')],
	{ cwd: fixturePath },
);

describe('recipe', () => {
	test('external script imports plain .md exports via --import mdeval', async () => {
		await using fixture = await buildFixture(
			'# Data\n\n<!--mdeval\nexport const todos = ["write", "test", "ship"];\nexport const count = 3;\n-->\n',
		);

		const result = await runConsumer(fixture.path);

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

		const result = await runConsumer(fixture.path);

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

		const result = await runConsumer(fixture.path);

		const exported = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(exported.greeting).toBe('recipe-ok');
	});
});
