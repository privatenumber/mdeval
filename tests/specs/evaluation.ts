import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn from 'nano-spawn';
import { processSource } from '../../src/process-source.ts';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

describe('marker evaluation', () => {
	test('the loader exposes a non-enumerable guard global', async () => {
		const result = await spawn(process.execPath, ['--import', 'mdeval/loader', '--input-type=module', '-e', 'const d = Object.getOwnPropertyDescriptor(globalThis, "__mdeval_guard"); console.log(JSON.stringify([typeof d.value, d.enumerable, d.writable, d.configurable]));']);
		expect(JSON.parse(result.stdout)).toStrictEqual(['function', false, true, true]);
	});

	test('a cross-realm rejected promise does not stop other files', async () => {
		const a = '<!--mdeval\nimport vm from "node:vm";\nconst p = vm.runInNewContext(\'Promise.reject(new Error("realm failure"))\');\n-->\n<!--mdeval p-->old<!--/mdeval-->\n<!--mdeval await new Promise(r => setTimeout(() => r(2), 100))-->old<!--/mdeval-->';
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
		expect(error.stderr).toContain('realm failure');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(a);
		expect(await fixture.readFile('b.md', 'utf8')).toBe(b.replace('old', '3'));
	});

	test('does not inspect a proxy prototype during marker evaluation', async () => {
		const source = '<!--mdeval\nconst x = new Proxy({ value: 1 }, { getPrototypeOf() { throw new Error("prototype trap"); } });\n-->\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '{"value":1}'));
	});

	test('a fulfilled promise value can gain a throwing then getter', async () => {
		const source = '<!--mdeval\nconst x = {}; const p = Promise.resolve(x);\n-->\n<!--mdeval p-->old<!--/mdeval-->\n<!--mdeval (Object.defineProperty(x, "then", { get() { throw new Error("then getter"); } }), 1)-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		await spawn(process.execPath, [cliPath, fixture.getPath('a.md')]);
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source.replace('old', '{}').replace('old', '1'));
	});

	test('assimilates thenables only after all marker expressions run', async () => {
		const source = '<!--mdeval\nlet n = 0; const x = { then(resolve) { n = 1; resolve(7); } };\n-->\n<!--mdeval x-->old<!--/mdeval-->\n<!--mdeval await Promise.resolve(2)-->old<!--/mdeval-->\n<!--mdeval n-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '7').replace('old', '2').replace('old', '0'));
	});

	test('a script binding named globalThis does not shadow promise handling', async () => {
		const source = '<!--mdeval\nconst globalThis = "script value";\n-->\n<!--mdeval globalThis-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', 'script value'));
	});

	test('a rejected promise with an overridden catch does not crash the CLI', async () => {
		const a = '<!--mdeval\nconst p = Promise.reject(new Error("failed")); p.catch = () => {};\n-->\n<!--mdeval p-->old<!--/mdeval-->\n<!--mdeval await new Promise(r => setTimeout(() => r(2), 100))-->old<!--/mdeval-->';
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

	test('assimilates a marker thenable once', async () => {
		const source = '<!--mdeval\nlet n = 0; const x = { then(resolve) { resolve(++n); } };\n-->\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', '1'));
	});

	test('uses the global Promise when a script declares its own Promise', async () => {
		const source = '<!--mdeval\nconst Promise = "script value";\n-->\n<!--mdeval Promise-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': source });
		expect(await processSource(source, fixture.getPath('a.md'))).toBe(source.replace('old', 'script value'));
	});

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

	test('imports Markdown URLs with query strings and fragments', async () => {
		await using fixture = await createFixture({
			'data #1.md': '<!--mdeval\nexport const url = import.meta.url;\n-->\n',
			'consumer.mjs': 'import { url as a } from "./data%20%231.md?version=1"; import { url as b } from "./data%20%231.md#version=2"; console.log(JSON.stringify([a, b]));',
		});
		const result = await spawn(process.execPath, ['--import', 'mdeval/loader', fixture.getPath('consumer.mjs')]);
		const urls = JSON.parse(result.stdout) as string[];
		expect(urls.map(url => new URL(url).search + new URL(url).hash)).toStrictEqual(['?version=1', '#version=2']);
	});

	test('imports a Markdown URL with node_modules in its query', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nexport const n = 42;\n-->',
			'consumer.mjs': [
				'import { n } from "./data.md?source=/node_modules/pkg/file.md";',
				String.raw`import { n as m } from "./data.md?source=\\node_modules\\pkg";`,
				'console.log(n, m);',
			].join('\n'),
		});
		const result = await spawn(process.execPath, ['--import', 'mdeval/loader', fixture.getPath('consumer.mjs')]);
		expect(result.stdout.trim()).toBe('42 42');
	});

	test('does not rewrite a file importing invalid UTF-8 Markdown', async () => {
		const source = '<!--mdeval\nimport { value } from "./data.md";\n-->\n<!--mdeval value-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': source,
			'data.md': Buffer.concat([Buffer.from('<!--mdeval\nexport const value = "'), Buffer.from([0xE9]), Buffer.from('";\n-->')]),
		});
		const error = await spawn(process.execPath, [cliPath, fixture.getPath('a.md')]).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain(`${fixture.getPath('data.md')}: not valid UTF-8`);
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
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
