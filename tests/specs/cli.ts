import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

describe('cli', () => {
	test('updates file in-place', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->',
		});
		const filePath = fixture.getPath('test.md');
		const result = spawnSync(process.execPath, [cliPath, filePath]);
		expect(result.status).toBe(0);

		const content = await fixture.readFile('test.md', 'utf8');
		expect(content).toBe('<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->2<!--/mdeval-->');
	});

	test('--help shows usage', () => {
		const result = spawnSync(process.execPath, [cliPath, '--help']);
		const output = result.stdout.toString();
		expect(output).toContain('mdeval');
	});

	test('exits 1 on script error', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nthrow new Error("boom");\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		});
		const result = spawnSync(process.execPath, [cliPath, fixture.getPath('test.md')]);
		expect(result.status).toBe(1);
	});

	test('nonexistent file path exits 1', () => {
		const result = spawnSync(process.execPath, [cliPath, '/nonexistent/path/file.md']);
		expect(result.status).toBe(1);
	});

	test('multiple files are all processed', async () => {
		const aMd = '<!--mdeval\nconst a = "hello";\n-->\n\n<!--mdeval a-->old<!--/mdeval-->';
		const bMd = '<!--mdeval\nconst b = "world";\n-->\n\n<!--mdeval b-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': aMd,
			'b.md': bMd,
		});
		const result = spawnSync(process.execPath, [cliPath, fixture.getPath('a.md'), fixture.getPath('b.md')]);
		expect(result.status).toBe(0);

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('b.md', 'utf8');
		expect(contentA).toBe(aMd.replace('old', 'hello'));
		expect(contentB).toBe(bMd.replace('old', 'world'));
	});

	test('imported .md script only executes once across files', async () => {
		const aMd = '<!--mdeval\nconsole.log("a.md executed");\nexport const version = "2.0.0";\n-->\n\n<!--mdeval version-->old<!--/mdeval-->';
		const bMd = '<!--mdeval\nimport { version } from \'./a.md\';\n-->\n\n<!--mdeval version-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': aMd,
			'b.md': bMd,
		});
		const result = spawnSync(process.execPath, [cliPath, fixture.getPath('a.md'), fixture.getPath('b.md')]);
		expect(result.status).toBe(0);

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('b.md', 'utf8');
		expect(contentA).toBe(aMd.replace('old', '2.0.0'));
		expect(contentB).toBe(bMd.replace('old', '2.0.0'));

		const stdout = result.stdout.toString();
		const executions = stdout.split('a.md executed').length - 1;
		expect(executions).toBe(1);
	});

	test('does not write file when content unchanged', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->2<!--/mdeval-->',
		});
		const filePath = fixture.getPath('test.md');
		const statBefore = await fs.stat(filePath);
		await setTimeout(100);
		spawnSync(process.execPath, [cliPath, filePath]);
		const statAfter = await fs.stat(filePath);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
	});

	test('file with no mdeval content exits 0', async () => {
		await using fixture = await createFixture({
			'test.md': '# Just a normal markdown file\n\nHello world.',
		});
		const result = spawnSync(process.execPath, [cliPath, fixture.getPath('test.md')]);
		expect(result.status).toBe(0);
	});
});
