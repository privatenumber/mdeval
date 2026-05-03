import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
	'consumer.mjs': ({ fixturePath }) => `await import(${JSON.stringify(pathToFileURL(path.join(fixturePath, 'data.md')).href)});\n`,
	'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
});

const buildFixtureWithPath = (
	dataPath: string,
	dataMd: string,
) => createFixture({
	[dataPath]: dataMd,
	'consumer.mjs': ({ fixturePath }) => `await import(${JSON.stringify(pathToFileURL(path.join(fixturePath, dataPath)).href)});\n`,
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

	test('runtime error in a marker expression remaps to original .md line and column', async () => {
		// Line 1: <!--mdeval
		// Line 2: const value = 1;
		// Line 3: -->
		// Line 4: (blank)
		// Line 5: Result: <!--mdeval missingFn(value)-->old<!--/mdeval-->
		//                            ^ `missingFn` starts at column 20 (1-indexed)
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
		expect(stderr).toMatch(/data\.md:5:20/);
	});

	test('error inside a multi-line marker IIFE maps to its own line', async () => {
		// Line 1: Result: <!--mdeval (() => {
		// Line 2:   const a = 1;
		// Line 3:   badThing();                ← error here
		// Line 4:   return a;
		// Line 5: })()-->old<!--/mdeval-->
		await using fixture = await buildFixture([
			'Result: <!--mdeval (() => {',
			'  const a = 1;',
			'  badThing();',
			'  return a;',
			'})()-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: badThing is not defined');
		expect(stderr).toMatch(/data\.md:3:\d+/);
	});

	test('error in second of multiple script blocks maps to its line', async () => {
		// Line 1: <!--mdeval
		// Line 2: const a = 1;
		// Line 3: -->
		// Line 4: (blank)
		// Line 5: <!--mdeval
		// Line 6: badThing();                  ← error here
		// Line 7: -->
		// Line 8: (blank)
		// Line 9: <!--mdeval a-->old<!--/mdeval-->
		await using fixture = await buildFixture([
			'<!--mdeval',
			'const a = 1;',
			'-->',
			'',
			'<!--mdeval',
			'badThing();',
			'-->',
			'',
			'<!--mdeval a-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: badThing is not defined');
		expect(stderr).toMatch(/data\.md:6:\d+/);
	});

	test('runtime error in a CRLF script block remaps to original .md line and column', async () => {
		await using fixture = await buildFixture([
			'# Header',
			'',
			'<!--mdeval',
			'\tconst value = missingFromCrlf();',
			'-->',
			'',
			'<!--mdeval value-->old<!--/mdeval-->',
			'',
		].join('\r\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: missingFromCrlf is not defined');
		expect(stderr).toMatch(/data\.md:4:16/);
	});

	test('syntax error in a script block reports the generated location before source-map remapping', async () => {
		await using fixture = await buildFixture([
			'# Header',
			'',
			'<!--mdeval',
			'const value = {;',
			'-->',
			'',
			'<!--mdeval value-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('SyntaxError: Unexpected token');
		expect(stderr).toMatch(/data\.md:1/);
		expect(stderr).not.toMatch(/data\.md:4:16/);
	});

	test('marker expression error after the first token remaps to the V8-reported expression start', async () => {
		await using fixture = await buildFixture([
			'<!--mdeval',
			'const value = 1;',
			'-->',
			'',
			'Result: <!--mdeval value + missingLater()-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: missingLater is not defined');
		expect(stderr).toMatch(/data\.md:5:20/);
	});

	test('multi-line marker expression error remaps to its V8-reported statement start', async () => {
		await using fixture = await buildFixture([
			'Result: <!--mdeval (() => {',
			'  const a = 1;',
			'  return missingNested() + a;',
			'})()-->old<!--/mdeval-->',
			'',
		].join('\n'));

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: missingNested is not defined');
		expect(stderr).toMatch(/data\.md:3:3/);
	});

	test('file path with spaces and URL characters still remaps', async () => {
		await using fixture = await buildFixtureWithPath(
			'dir with spaces/data #1.md',
			[
				'# Header',
				'',
				'<!--mdeval',
				'const value = missingFromSpecialPath();',
				'-->',
				'',
				'<!--mdeval value-->old<!--/mdeval-->',
				'',
			].join('\n'),
		);

		const result = await runConsumer(fixture.path);
		const stderr = result.stderr ?? '';

		expect(stderr).toContain('ReferenceError: missingFromSpecialPath is not defined');
		expect(stderr).toContain('dir with spaces/data #1.md:4:15');
	});
});
