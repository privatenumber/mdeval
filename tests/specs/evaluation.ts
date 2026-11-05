import path from 'node:path';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn from 'nano-spawn';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

describe('marker evaluation', () => {
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
