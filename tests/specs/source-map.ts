import path from 'node:path';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn, { type SubprocessError } from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// Throws a runtime error inside a script block whose `.md` source line is
// known. The synthesized module places the offending line somewhere different;
// without a source map, Node reports the synthesized line. With source-map
// support (and a correct map emitted by the loader), the stack trace should
// remap to the original `.md` line.
const buildFixture = (dataMd: string) => createFixture({
	'data.md': dataMd,
	'consumer.mjs': ({ fixturePath }) => `await import(${JSON.stringify(path.join(fixturePath, 'data.md'))});\n`,
	'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
});

const runConsumer = async (fixturePath: string) => spawn(
	process.execPath,
	[
		'--enable-source-maps',
		'--import',
		'mdeval/loader',
		path.join(fixturePath, 'consumer.mjs'),
	],
	{ cwd: fixturePath },
).catch((error: SubprocessError) => error);

describe('source map', () => {
	test('runtime error in a script block remaps to original .md line', async () => {
		// Line 1: # Header
		// Line 2: (blank)
		// Line 3: Some prose.
		// Line 4: (blank)
		// Line 5: <!--mdeval
		// Line 6: const x = nonexistentFunction();   ← this is the offending line
		// Line 7: -->
		// Line 8: (blank)
		// Line 9: <!--mdeval x-->old<!--/mdeval-->
		await using fixture = await buildFixture([
			'# Header',
			'',
			'Some prose.',
			'',
			'<!--mdeval',
			'const x = nonexistentFunction();',
			'-->',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: nonexistentFunction is not defined');
		expect(stderr).toMatch(/data\.md:6:\d+/);
	});

	test('runtime error in a marker expression remaps to original .md line', async () => {
		// Line 1: <!--mdeval
		// Line 2: const value = 1;
		// Line 3: -->
		// Line 4: (blank)
		// Line 5: Result: <!--mdeval missingFn(value)-->old<!--/mdeval-->   ← marker line
		await using fixture = await buildFixture([
			'<!--mdeval',
			'const value = 1;',
			'-->',
			'',
			'Result: <!--mdeval missingFn(value)-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: missingFn is not defined');
		expect(stderr).toMatch(/data\.md:5:\d+/);
	});
});
