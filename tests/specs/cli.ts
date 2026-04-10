import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn, { type Options } from 'nano-spawn';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

const mdeval = (
	arguments_: string[],
	options?: Options,
) => spawn(process.execPath, [cliPath, ...arguments_], options);

describe('cli', () => {
	test('updates file in-place', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->',
		});
		await mdeval([fixture.getPath('test.md')]);

		const content = await fixture.readFile('test.md', 'utf8');
		expect(content).toBe('<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->2<!--/mdeval-->');
	});

	test('--help shows usage', async () => {
		const result = await mdeval(['--help']);
		expect(result.stdout).toContain('mdeval');
	});

	test('exits 1 on script error', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nthrow new Error("boom");\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		});
		const error = await mdeval([fixture.getPath('test.md')]).catch((error_: unknown) => error_);
		expect((error as { exitCode: number }).exitCode).toBe(1);
	});

	test('nonexistent file path exits 1', async () => {
		const error = await mdeval(['/nonexistent/path/file.md']).catch((error_: unknown) => error_);
		expect((error as { exitCode: number }).exitCode).toBe(1);
	});

	test('multiple files are all processed', async () => {
		const aMd = '<!--mdeval\nconst a = "hello";\n-->\n\n<!--mdeval a-->old<!--/mdeval-->';
		const bMd = '<!--mdeval\nconst b = "world";\n-->\n\n<!--mdeval b-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': aMd,
			'b.md': bMd,
		});
		await mdeval([fixture.getPath('a.md'), fixture.getPath('b.md')]);

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
		const result = await mdeval([fixture.getPath('a.md'), fixture.getPath('b.md')]);

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('b.md', 'utf8');
		expect(contentA).toBe(aMd.replace('old', '2.0.0'));
		expect(contentB).toBe(bMd.replace('old', '2.0.0'));

		const executions = result.stdout.split('a.md executed').length - 1;
		expect(executions).toBe(1);
	});

	test('does not write file when content unchanged', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->2<!--/mdeval-->',
		});
		const filePath = fixture.getPath('test.md');
		const statBefore = await fs.stat(filePath);
		await setTimeout(100);
		await mdeval([filePath]);
		const statAfter = await fs.stat(filePath);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
	});

	test('glob pattern expands to matching files', async () => {
		const aMd = '<!--mdeval\nconst a = "hello";\n-->\n\n<!--mdeval a-->old<!--/mdeval-->';
		const bMd = '<!--mdeval\nconst b = "world";\n-->\n\n<!--mdeval b-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'docs/a.md': aMd,
			'docs/b.md': bMd,
		});
		await mdeval(['docs/*.md'], { cwd: fixture.path });

		const contentA = await fixture.readFile('docs/a.md', 'utf8');
		const contentB = await fixture.readFile('docs/b.md', 'utf8');
		expect(contentA).toBe(aMd.replace('old', 'hello'));
		expect(contentB).toBe(bMd.replace('old', 'world'));
	});

	test('recursive glob pattern', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': md,
			'docs/b.md': md,
			'docs/sub/c.md': md,
		});
		await mdeval(['**/*.md'], { cwd: fixture.path });

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('docs/b.md', 'utf8');
		const contentC = await fixture.readFile('docs/sub/c.md', 'utf8');
		const expected = md.replace('old', 'found');
		expect(contentA).toBe(expected);
		expect(contentB).toBe(expected);
		expect(contentC).toBe(expected);
	});

	test('negation pattern excludes files', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': md,
			'docs/b.md': md,
		});
		await mdeval(['**/*.md', '!docs/**'], { cwd: fixture.path });

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('docs/b.md', 'utf8');
		expect(contentA).toBe(md.replace('old', 'found'));
		expect(contentB).toBe(md);
	});

	test('brace expansion pattern', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'a.md': md,
			'b.md': md,
			'c.md': md,
		});
		await mdeval(['{a,b}.md'], { cwd: fixture.path });

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('b.md', 'utf8');
		const contentC = await fixture.readFile('c.md', 'utf8');
		const expected = md.replace('old', 'found');
		expect(contentA).toBe(expected);
		expect(contentB).toBe(expected);
		expect(contentC).toBe(md);
	});

	test('ignores node_modules by default', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'README.md': md,
			'node_modules/pkg/README.md': md,
		});
		await mdeval(['**/*.md'], { cwd: fixture.path });

		const content = await fixture.readFile('README.md', 'utf8');
		const nmContent = await fixture.readFile('node_modules/pkg/README.md', 'utf8');
		expect(content).toBe(md.replace('old', 'found'));
		expect(nmContent).toBe(md);
	});

	test('explicit node_modules path opts in', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'node_modules/pkg/README.md': md,
		});
		await mdeval(['node_modules/pkg/README.md'], { cwd: fixture.path });

		const content = await fixture.readFile('node_modules/pkg/README.md', 'utf8');
		expect(content).toBe(md.replace('old', 'found'));
	});

	test('glob targeting node_modules opts in', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'node_modules/pkg/README.md': md,
		});
		await mdeval(['**/node_modules/pkg/*.md'], { cwd: fixture.path });

		const content = await fixture.readFile('node_modules/pkg/README.md', 'utf8');
		expect(content).toBe(md.replace('old', 'found'));
	});

	test('no matches exits 1', async () => {
		const error = await mdeval(['*.nonexistent']).catch((error_: unknown) => error_);
		expect((error as { exitCode: number }).exitCode).toBe(1);
	});

	test('file with no mdeval content exits 0', async () => {
		await using fixture = await createFixture({
			'test.md': '# Just a normal markdown file\n\nHello world.',
		});
		await mdeval([fixture.getPath('test.md')]);
	});

	test('warns when file has only mdeval blocks and no markdown content', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval x-->1<!--/mdeval-->',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).toContain('no markdown content');
	});

	test('no warning when file has markdown content alongside mdeval blocks', async () => {
		await using fixture = await createFixture({
			'test.md': '# Title\n\n<!--mdeval\nconst x = 1;\n-->\n\nSome text <!--mdeval x-->1<!--/mdeval-->',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).toBe('');
	});

	test('no warning for mdeval syntax inside code blocks', async () => {
		await using fixture = await createFixture({
			'test.md': '```\n<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval x-->1<!--/mdeval-->\n```',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).toBe('');
	});
});
