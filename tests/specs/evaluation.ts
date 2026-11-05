import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn from 'nano-spawn';
import { processSource } from '../../src/process-source.ts';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

describe('marker evaluation', () => {
	test('an explicit await delays evaluation of later markers', async () => {
		const source = '<!--mdeval\nlet state = 0;\n-->\n<!--mdeval (await Promise.resolve(), state = 42, 1)-->old<!--/mdeval-->\n<!--mdeval state-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '1').replace('old', '42'));
	});

	test('a synchronous marker throw stops later expressions', async () => {
		const source = '<!--mdeval\nexport const state = { count: 0 };\n-->\n<!--mdeval JSON.parse("{")-->old<!--/mdeval-->\n<!--mdeval ++state.count-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		const filePath = fixture.getPath('a.md');
		await expect(processSource(source, filePath)).rejects.toThrow(SyntaxError);
		const module = await import(pathToFileURL(filePath).href);
		expect(module.state.count).toBe(0);
	});

	test('processing one cached module twice evaluates markers once', async () => {
		const source = '<!--mdeval\nlet count = 0;\n-->\n<!--mdeval ++count-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		const filePath = fixture.getPath('a.md');
		const outputs = await Promise.all([
			processSource(source, filePath),
			processSource(source, filePath),
		]);
		expect(outputs).toStrictEqual([source.replace('old', '1'), source.replace('old', '1')]);
	});

	test('returned promises do not delay evaluation of later markers', async () => {
		const source = '<!--mdeval\nlet state = 0;\n-->\n<!--mdeval Promise.resolve().then(() => { state = 42; return 1; })-->old<!--/mdeval-->\n<!--mdeval state-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '1').replace('old', '0'));
	});

	test('marker expressions can access similarly named script bindings', async () => {
		const source = '<!--mdeval\nconst values = 1, result = 2;\n-->\n<!--mdeval values-->old<!--/mdeval-->\n<!--mdeval result-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '1').replace('old', '2'));
	});

	test('importing markdown runs script blocks but not markers', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nexport const value = 42;\n-->\n<!--mdeval console.log("marker ran")-->old<!--/mdeval-->',
			'consumer.mjs': 'import { value } from "./data.md"; console.log(value);',
		});
		const result = await spawn(process.execPath, ['--import', 'mdeval/loader', fixture.getPath('consumer.mjs')]);
		expect(result.stdout.trim()).toBe('42');
	});

	test('a rejected marker does not stop other files from being written', async () => {
		const a = '<!--mdeval Promise.reject(new Error("failed"))-->old<!--/mdeval-->\n<!--mdeval await new Promise(r => setTimeout(() => r(2), 100))-->old<!--/mdeval-->';
		const b = '<!--mdeval await new Promise(r => setTimeout(() => r(3), 250))-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': a,
			'b.md': b,
		});
		const error = await spawn(process.execPath, [cliPath, fixture.getPath('a.md'), fixture.getPath('b.md')]).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('failed');
		expect(error.stderr).not.toContain('triggerUncaughtException');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(a);
		expect(await fixture.readFile('b.md', 'utf8')).toBe(b.replace('old', '3'));
	});

	test('evaluates an expression ending in a line comment', async () => {
		const source = '<!--mdeval 2 // comment-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		await spawn(process.execPath, [cliPath, fixture.getPath('a.md')]);
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source.replace('old', '2'));
	});
});
