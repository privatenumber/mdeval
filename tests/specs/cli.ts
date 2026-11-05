import fs from 'node:fs/promises';
import { spawn as spawnChild } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
	describe, test, expect, skip,
} from 'manten';
import { createFixture } from 'fs-fixture';
import spawn, { type Options } from 'nano-spawn';

const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.mjs');

const mdeval = (
	arguments_: string[],
	options?: Options,
) => spawn(process.execPath, [cliPath, ...arguments_], options);

describe('cli', () => {
	const source = '# Test\n\n<!--mdeval\nconst x = 2;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';

	test('excludes symlinks into node_modules unless explicitly targeted', async () => {
		await using fixture = await createFixture({
			'root.md': source,
			'node_modules/pkg/a.md': source,
		});
		await fs.symlink('node_modules/pkg', fixture.getPath('docs'), 'dir');
		await mdeval(['**/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
		await mdeval(['node_modules/pkg/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source.replace('old', '2'));
	});

	test('processes a literal symlink into node_modules but excludes it from globs', async () => {
		await using fixture = await createFixture({
			'root.md': source,
			'node_modules/pkg/a.md': source,
		});
		await fs.symlink('node_modules/pkg', fixture.getPath('docs'), 'dir');
		await mdeval(['**/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
		const result = await mdeval(['docs/a.md', 'node_modules/pkg/a.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('docs/a.md');
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source.replace('old', '2'));
	});

	test('node_modules substrings do not opt into dependencies', async () => {
		await using fixture = await createFixture({
			'docs_node_modules/a.md': source,
			'docs_node_modules/node_modules/pkg/a.md': source,
		});
		await mdeval(['docs_node_modules/**/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('docs_node_modules/a.md', 'utf8')).toBe(source.replace('old', '2'));
		expect(await fixture.readFile('docs_node_modules/node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('batches overlapping and repeated glob crawls', async () => {
		await using fixture = await createFixture({
			'a.md': '# Test',
			'sub/a.md': '# Test',
			'count.cjs': 'const fs = require("node:fs"); const { syncBuiltinESMExports } = require("node:module"); let count = 0; const readdir = fs.readdir; fs.readdir = (...args) => { count++; return readdir(...args); }; syncBuiltinESMExports(); process.on("exit", () => console.error(`count=${count}`));',
		});
		const run = (patterns: string[]) => spawn(process.execPath, ['--import', fixture.getPath('count.cjs'), cliPath, ...patterns], { cwd: fixture.path });
		const single = await run(['**/*.md']);
		const repeated = await run(['**/*.md', '**/a*.md', '**/*.md']);
		expect(single.stderr).toMatch(/count=[1-9]\d*/);
		expect(repeated.stderr).toBe(single.stderr);
	});

	test('uses literal file spelling on case-insensitive filesystems', async () => {
		await using fixture = await createFixture({
			'REAdme.md': source,
			'other.md': source,
		});
		if (!await fixture.exists('readme.md')) {
			skip('Requires a case-insensitive filesystem');
		}
		const result = await mdeval(['readme.md', 'other.md'], { cwd: fixture.path });
		expect(result.stdout.split('\n').sort()).toStrictEqual(['other.md', 'readme.md']);
		expect(await fixture.readFile('REAdme.md', 'utf8')).toBe(source.replace('old', '2'));
	});

	test('deduplicates symlink aliases and retains the first spelling', async () => {
		await using fixture = await createFixture({ 'real/a.md': source });
		await fs.symlink('real', fixture.getPath('alias'), 'dir');
		const result = await mdeval(['alias/a.md', 'real/a.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('alias/a.md');
	});

	test('negative patterns exclude explicitly named files', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'docs/b.md': source,
		});
		const result = await mdeval(['a.md', 'docs/b.md', '!docs/**'], { cwd: fixture.path });
		expect(result.stdout).toBe('a.md');
		expect(await fixture.readFile('docs/b.md', 'utf8')).toBe(source);
	});

	test('expands negative extglobs as positive patterns', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'b.md': source,
			'node_modules/pkg/a.md': source,
		});
		const result = await mdeval(['!(b).md'], { cwd: fixture.path });
		expect(result.stdout).toBe('a.md');
		expect(await fixture.readFile('b.md', 'utf8')).toBe(source);
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('expands directory arguments to visible markdown files', async () => {
		await using fixture = await createFixture({
			'docs/a.md': source,
			'docs/sub/b.md': source,
			'docs/note.txt': source,
			'docs/.hidden/a.md': source,
			'docs/node_modules/pkg/a.md': source,
		});
		const result = await mdeval(['docs'], { cwd: fixture.path });
		expect(result.stdout.split('\n').sort()).toStrictEqual(['docs/a.md', 'docs/sub/b.md']);
		expect(await fixture.readFile('docs/note.txt', 'utf8')).toBe(source);
		expect(await fixture.readFile('docs/.hidden/a.md', 'utf8')).toBe(source);
		expect(await fixture.readFile('docs/node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('reports full mapped paths containing parentheses', async () => {
		await using fixture = await createFixture({ 'notes (2).md': '# Test\n\n<!--mdeval\nthrow new Error("boom");\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->' });
		const error = await mdeval(['notes (2).md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as { stderr: string };
		expect(error.stderr).toContain('Error processing notes (2).md:4:7: boom');
	});

	test('flushes all missing-file errors to a slow stderr pipe', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		const missing = Array.from({ length: 3200 }, (_, index) => `x${index}`);
		const child = spawnChild(process.execPath, [cliPath, 'a.md', ...missing], { cwd: fixture.path });
		const exit = once(child, 'close');
		await setTimeout(1000);
		let stderr = '';
		for await (const chunk of child.stderr) {
			stderr += chunk;
		}
		const [code] = await exit;
		expect(code).toBe(1);
		expect(stderr.trim().split('\n')).toHaveLength(missing.length);
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
	});

	test('rejects unknown flags without rewriting', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		for (const flag of ['--check', '--dry-run']) {
			const error = await mdeval([flag, 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
				exitCode: number;
				stderr: string;
			};
			expect(error.exitCode).toBe(1);
			expect(error.stderr).toContain(`Unknown flag: ${flag}`);
			expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
		}
	});

	test('prints the package version', async () => {
		const packageJson = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string };
		const result = await mdeval(['--version']);
		expect(result.stdout).toBe(packageJson.version);
	});

	test('reports all missing literal paths before processing', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		const error = await mdeval(['a.md', 'missing.md', 'other.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('missing.md');
		expect(error.stderr).toContain('other.md');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
	});

	test('treats existing glob-shaped filenames literally', async () => {
		await using fixture = await createFixture({
			'[a].md': source,
			'a.md': source,
		});
		await mdeval(['[a].md'], { cwd: fixture.path });
		expect(await fixture.readFile('[a].md', 'utf8')).toBe(source.replace('old', '2'));
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
	});

	test('limits node_modules opt-in to its own pattern and deduplicates', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'node_modules/a/a.md': source,
			'node_modules/b/b.md': source,
		});
		const result = await mdeval(['**/*.md', 'node_modules/a/*.md', 'node_modules/a/*.md'], { cwd: fixture.path });
		expect(result.stdout.split('\n').sort()).toStrictEqual(['a.md', 'node_modules/a/a.md']);
		expect(await fixture.readFile('node_modules/b/b.md', 'utf8')).toBe(source);
	});

	test('rejects invalid UTF-8 without changing bytes and continues', async () => {
		const invalid = Buffer.concat([Buffer.from(source), Buffer.from([0xE9])]);
		await using fixture = await createFixture({
			'bad.md': invalid,
			'good.md': source,
		});
		const error = await mdeval(['bad.md', 'good.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('Error processing bad.md: not valid UTF-8');
		expect(await fixture.readFile('bad.md')).toStrictEqual(invalid);
		expect(await fixture.readFile('good.md', 'utf8')).toBe(source.replace('old', '2'));
	});

	test('reports mapped markdown location for script errors', async () => {
		await using fixture = await createFixture({ 'err.md': '# Test\n\n<!--mdeval\nconst x = null;\nx.value;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->' });
		const error = await mdeval(['err.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('err.md:5:3: Cannot read properties of null');
	});

	test('reports the location in an imported markdown file', async () => {
		await using fixture = await createFixture({
			'a.md': '# Test\n\n<!--mdeval\nimport "./other file.md";\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->',
			'other file.md': '# Other\n\n<!--mdeval\nthrow new Error("boom");\n-->',
		});
		const error = await mdeval(['a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('Error processing other file.md:4:7: boom');
	});

	test('preserves a UTF-8 byte order mark when rewriting', async () => {
		await using fixture = await createFixture({ 'bom.md': `\uFEFF${source}` });
		await mdeval(['bom.md'], { cwd: fixture.path });
		expect(await fixture.readFile('bom.md', 'utf8')).toBe(`\uFEFF${source.replace('old', '2')}`);
	});

	test('allows an unmatched glob when another pattern matches', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		await mdeval(['a.md', 'missing/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source.replace('old', '2'));
	});

	test('rejects named and matched non-markdown files clearly', async () => {
		await using fixture = await createFixture({ 'notes.markdown': source });
		for (const argument of ['notes.markdown', '*.markdown']) {
			const error = await mdeval([argument], { cwd: fixture.path })
				.catch((error_: unknown) => error_) as {
				exitCode: number;
				stderr: string;
			};
			expect(error.exitCode).toBe(1);
			expect(error.stderr).toContain('notes.markdown: mdeval only processes .md files');
			expect(await fixture.readFile('notes.markdown', 'utf8')).toBe(source);
		}
	});
	test('updates file in-place', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->',
		});
		const filePath = fixture.getPath('test.md');
		const result = await mdeval([filePath]);

		const content = await fixture.readFile('test.md', 'utf8');
		expect(content).toBe('<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->2<!--/mdeval-->');
		expect(result.stdout).not.toContain('Updated:');
		expect(path.resolve(result.stdout.trim())).toBe(filePath);
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
		const pathA = fixture.getPath('a.md');
		const pathB = fixture.getPath('b.md');
		const result = await mdeval([pathA, pathB]);

		const contentA = await fixture.readFile('a.md', 'utf8');
		const contentB = await fixture.readFile('b.md', 'utf8');
		expect(contentA).toBe(aMd.replace('old', 'hello'));
		expect(contentB).toBe(bMd.replace('old', 'world'));

		expect(result.stdout).not.toContain('Updated:');
		const lines = result.stdout
			.split('\n')
			.filter(Boolean)
			.map(line => path.resolve(line))
			.sort();
		expect(lines).toStrictEqual([pathA, pathB].sort());
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
		const result = await mdeval([filePath]);
		const statAfter = await fs.stat(filePath);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
		expect(result.stdout).toBe('');
	});

	test('mix of changed and unchanged files only prints changed paths', async () => {
		const changedMd = '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->old<!--/mdeval-->';
		const unchangedMd = '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->2<!--/mdeval-->';
		await using fixture = await createFixture({
			'changed.md': changedMd,
			'unchanged.md': unchangedMd,
		});
		const changedPath = fixture.getPath('changed.md');
		const unchangedPath = fixture.getPath('unchanged.md');
		const result = await mdeval([changedPath, unchangedPath]);

		expect(result.stdout).not.toContain('Updated:');
		expect(path.resolve(result.stdout.trim())).toBe(changedPath);
		const lines = result.stdout.split('\n').filter(Boolean).map(line => path.resolve(line));
		expect(lines).toStrictEqual([changedPath]);
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

	test('ignores hidden directories by default', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'README.md': md,
			'.hidden/README.md': md,
		});
		await mdeval(['**/*.md'], { cwd: fixture.path });

		const content = await fixture.readFile('README.md', 'utf8');
		const hiddenContent = await fixture.readFile('.hidden/README.md', 'utf8');
		expect(content).toBe(md.replace('old', 'found'));
		expect(hiddenContent).toBe(md);
	});

	test('glob targeting a hidden directory opts in', async () => {
		const md = '<!--mdeval\nconst x = "found";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'.hidden/README.md': md,
		});
		await mdeval(['.hidden/**/*.md'], { cwd: fixture.path });

		const content = await fixture.readFile('.hidden/README.md', 'utf8');
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

	test('colors warnings only when stderr supports color', async () => {
		await using fixture = await createFixture({
			'test.md': '<!--mdeval\nconst x = 1;\n-->',
		});
		// Variables that make color libraries enable color without a TTY.
		// `undefined` removes an inherited variable from the child environment.
		const colorEnvironment = {
			COLORTERM: 'truecolor',
			TERM: 'xterm-256color',
			CI: 'true',
			FORCE_COLOR: undefined,
			NO_COLOR: undefined,
		};

		const piped = await mdeval(['test.md'], {
			cwd: fixture.path,
			env: colorEnvironment,
		});
		expect(piped.stderr).toBe('Warning: test.md has no markdown content outside of mdeval blocks');

		const forced = await mdeval(['test.md'], {
			cwd: fixture.path,
			env: {
				...colorEnvironment,
				FORCE_COLOR: '1',
			},
		});
		expect(forced.stderr).toContain('\u001B[33mWarning:\u001B[39m');
	});

	test('no warning when file has markdown content alongside mdeval blocks', async () => {
		await using fixture = await createFixture({
			'test.md': '# Title\n\n<!--mdeval\nconst x = 1;\n-->\n\nSome text <!--mdeval x-->1<!--/mdeval-->',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).toBe('');
	});

	test('warns about leaks but not isOnlyMdeval when markers live in code blocks', async () => {
		// A README that only documents mdeval syntax (no real markers
		// outside code blocks) should not trigger the "no markdown content"
		// warning, since the code-block prose is the content. It should
		// still trigger leak warnings, one per opening marker visible in
		// the rendered output.
		await using fixture = await createFixture({
			'test.md': '```\n<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval x-->1<!--/mdeval-->\n```',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).not.toContain('no markdown content');
		expect(result.stderr).toContain('leaks into rendered code block');
	});

	test('does not warn when markers are outside any code construct', async () => {
		await using fixture = await createFixture({
			'test.md': '# Title\n\n<!--mdeval\nconst x = 42;\n-->\n\nValue: <!--mdeval x-->old<!--/mdeval-->',
		});
		const result = await mdeval([fixture.getPath('test.md')]);
		expect(result.stderr).not.toContain('leaks');
	});

	test('leak warning includes file path and line:column', async () => {
		await using fixture = await createFixture({
			'test.md': 'Line one.\nLine two: `<!--mdeval x-->old<!--/mdeval-->`',
		});
		const filePath = fixture.getPath('test.md');
		const result = await mdeval([filePath]);
		expect(result.stderr).toMatch(/test\.md:2:12 mdeval marker leaks into rendered inline code/);
	});
});
