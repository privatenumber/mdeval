import fs from 'node:fs/promises';
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

	for (const check of [true, false]) {
		test(`fails when a file exits before ${check ? 'check' : 'normal'} processing completes`, async () => {
			const fast = '# Fast\n\n<!--mdeval\nprocess.exit(0);\n-->\n\n<!--mdeval 1-->1<!--/mdeval-->';
			const slow = '# Slow\n\n<!--mdeval\nawait new Promise(resolve => setTimeout(resolve, 400));\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->';
			await using fixture = await createFixture({
				'a.md': fast,
				'b.md': slow,
			});
			const error = await mdeval([...check ? ['--check'] : [], 'a.md', 'b.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as { exitCode: number };
			expect(error.exitCode).toBe(1);
			expect(await fixture.readFile('b.md', 'utf8')).toBe(slow);
		});
	}

	for (const check of [true, false]) {
		test(`preserves ${check ? 'check' : 'file error'} failure when a slower file exits`, async () => {
			const slow = '# Test\n\n<!--mdeval\nawait new Promise(resolve => setTimeout(resolve, 400));\nprocess.exit(0);\n-->\n\n<!--mdeval 1-->1<!--/mdeval-->';
			await using fixture = await createFixture({
				'a.md': check ? source : Buffer.from([0xE9]),
				'b.md': slow,
			});
			const error = await mdeval([...check ? ['--check'] : [], 'a.md', 'b.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
				exitCode: number;
				stdout: string;
				stderr: string;
			};
			expect(error.exitCode).toBe(1);
			if (check) {
				expect(error.stdout).toBe('a.md');
			} else {
				expect(error.stderr).toContain('not valid UTF-8');
			}
		});
	}

	test('--check preserves failure when a timer resets the exit code', async () => {
		const markdown = '# Test\n\n<!--mdeval\nsetTimeout(() => { process.exitCode = 0; }, 100);\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': markdown });
		const error = await mdeval(['--check', 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stdout: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stdout).toBe('a.md');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(markdown);
	});

	test('preserves file errors when a timer resets the exit code', async () => {
		const markdown = '# Test\n\n<!--mdeval\nsetTimeout(() => { process.exitCode = 0; }, 100);\nthrow new Error("boom");\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': markdown });
		const error = await mdeval(['a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('boom');
	});

	test('--check reports outdated files without writing', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		const before = await fs.stat(fixture.getPath('a.md'));
		await setTimeout(100);
		const error = await mdeval(['--check', 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stdout: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stdout).toBe('a.md');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
		const after = await fs.stat(fixture.getPath('a.md'));
		expect(after.mtimeMs).toBe(before.mtimeMs);
	});

	test('preserves failures when a slower file resets process.exitCode', async () => {
		const slow = '# Test\n\n<!--mdeval\nawait new Promise(resolve => setTimeout(resolve, 300));\nprocess.exitCode = 0;\n-->\n\n<!--mdeval 1-->1<!--/mdeval-->';
		for (const check of [true, false]) {
			await using fixture = await createFixture({
				'a.md': check ? source : Buffer.from([0xE9]),
				'b.md': slow,
			});
			const error = await mdeval([...check ? ['--check'] : [], 'a.md', 'b.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
				exitCode: number;
				stdout: string;
				stderr: string;
			};
			expect(error.exitCode).toBe(1);
			if (check) {
				expect(error.stdout).toBe('a.md');
			} else {
				expect(error.stderr).toContain('not valid UTF-8');
			}
		}
	});

	test('--check reports leak locations in the unchanged file', async () => {
		const markdown = '# Test\n\n<!--mdeval [1,2,3].join("\\n")-->old<!--/mdeval-->\n\n`<!--mdeval x-->old<!--/mdeval-->`';
		await using fixture = await createFixture({ 'a.md': markdown });
		const error = await mdeval(['--check', 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('a.md:5:2 mdeval marker leaks into rendered inline code');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(markdown);
	});

	test('--check succeeds silently for current files', async () => {
		const current = source.replace('old', '2');
		await using fixture = await createFixture({ 'a.md': current });
		const result = await mdeval(['--check', 'a.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(current);
	});

	test('--check reports file errors', async () => {
		await using fixture = await createFixture({ 'a.md': '# Test\n\n<!--mdeval\nthrow new Error("boom");\n-->\n\n<!--mdeval 1-->1<!--/mdeval-->' });
		const error = await mdeval(['--check', 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('boom');
	});

	test('--check still reports rendering leak warnings', async () => {
		await using fixture = await createFixture({ 'a.md': '# Test\n\n`<!--mdeval x-->old<!--/mdeval-->`' });
		const result = await mdeval(['--check', 'a.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('a.md:3:2 mdeval marker leaks into rendered inline code');
	});

	test('reports original errors when the stack is not a string', async () => {
		const markdown = '# Test\n\n<!--mdeval\nError.prepareStackTrace = () => [];\nthrow new Error("boom");\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': markdown });
		const error = await mdeval(['a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('Error processing a.md: boom');
	});

	test('reports full mapped paths containing parentheses', async () => {
		await using fixture = await createFixture({ 'notes (2).md': '# Test\n\n<!--mdeval\nthrow new Error("boom");\n-->\n\n<!--mdeval 1-->old<!--/mdeval-->' });
		const error = await mdeval(['notes (2).md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as { stderr: string };
		expect(error.stderr).toContain('Error processing notes (2).md:4:7: boom');
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
		expect(error.stderr).toMatch(/Error processing bad\.md: .*bad\.md: not valid UTF-8/);
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

	test('a node_modules directory opts in and exclusions apply to both groups', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'skip.md': source,
			'node_modules/pkg/a.md': source,
			'node_modules/pkg/skip.md': source,
		});
		const result = await mdeval(['*.md', 'node_modules/pkg', '!**/skip.md'], { cwd: fixture.path });
		expect(result.stdout.split('\n').sort()).toStrictEqual(['a.md', 'node_modules/pkg/a.md']);
		expect(await fixture.readFile('skip.md', 'utf8')).toBe(source);
		expect(await fixture.readFile('node_modules/pkg/skip.md', 'utf8')).toBe(source);
	});

	test('brace alternatives do not opt into node_modules', async () => {
		await using fixture = await createFixture({
			'docs/a.md': source,
			'node_modules/pkg/a.md': source,
		});
		const result = await mdeval(['{docs,node_modules/pkg}/**/*.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('docs/a.md');
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('comma in a directory name does not opt into node_modules', async () => {
		await using fixture = await createFixture({
			'docs,node_modules/a.md': source,
			'docs,node_modules/node_modules/pkg/a.md': source,
		});
		await mdeval(['docs,node_modules/**/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('docs,node_modules/a.md', 'utf8')).toBe(source.replace('old', '2'));
		expect(await fixture.readFile('docs,node_modules/node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('extglob alternatives do not opt into node_modules', async () => {
		await using fixture = await createFixture({
			'docs/a.md': source,
			'node_modules/pkg/a.md': source,
		});
		await mdeval(['@(node_modules|docs)/**/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('docs/a.md', 'utf8')).toBe(source.replace('old', '2'));
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
	});

	test('node_modules after a glob segment does not opt in', async () => {
		await using fixture = await createFixture({
			'root.md': source,
			'node_modules/pkg/a.md': source,
		});
		await mdeval(['root.md', '**/node_modules/pkg/*.md'], { cwd: fixture.path });
		expect(await fixture.readFile('node_modules/pkg/a.md', 'utf8')).toBe(source);
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

	test('exclusions only narrow globs, not named files', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'b.md': source,
		});
		const result = await mdeval(['a.md', '*.md', '!a.md'], { cwd: fixture.path });
		expect(result.stdout.split('\n').sort()).toStrictEqual(['a.md', 'b.md']);
	});

	test('deduplicates resolved paths and keeps the first spelling', async () => {
		await using fixture = await createFixture({ 'a.md': source });
		const result = await mdeval(['./a.md', 'a.md'], { cwd: fixture.path });
		expect(result.stdout).toBe('./a.md');
	});

	test('reports stat errors and later missing paths without processing', async () => {
		await using fixture = await createFixture({
			'a.md': source,
			'preload.cjs': 'const fs = require("node:fs/promises"); const stat = fs.stat; fs.stat = (...args) => args[0] === "denied.md" ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })) : stat(...args);',
		});
		const error = await spawn(process.execPath, ['--import', fixture.getPath('preload.cjs'), cliPath, 'a.md', 'denied.md', 'missing.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
			exitCode: number;
			stderr: string;
		};
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toContain('denied.md: EACCES');
		expect(error.stderr).toContain('missing.md: file does not exist');
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
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

	test('flushes all missing-file errors to a slow stderr pipe', async () => {
		if (process.platform === 'win32') {
			skip('Requires sh; Windows pipe writes are synchronous');
		}
		await using fixture = await createFixture({ 'a.md': source });
		const missing = Array.from({ length: 6000 }, (_, index) => `x${index}`);
		// The reader stalls after the first line, so the kernel pipe fills and an exit with
		// writes pending loses lines. See notes/mdeval/cli-tests.md
		const result = await spawn('sh', [
			'-c',
			'"$0" "$@" 2>&1 >/dev/null | { read -r _; sleep 1; wc -l; }',
			process.execPath,
			cliPath,
			'a.md',
			...missing,
		], { cwd: fixture.path });
		expect(result.stdout.trim()).toBe(String(missing.length - 1));
		expect(await fixture.readFile('a.md', 'utf8')).toBe(source);
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

	test('rejects unknown flags without rewriting', async () => {
		const markdown = '<!--mdeval\nconst x = 1 + 1;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({ 'a.md': markdown });
		for (const flag of ['--unknown', '--dry-run']) {
			const error = await mdeval([flag, 'a.md'], { cwd: fixture.path }).catch((error_: unknown) => error_) as {
				exitCode: number;
				stderr: string;
			};
			expect(error.exitCode).toBe(1);
			expect(error.stderr).toContain(`Unknown flag: ${flag}`);
			expect(await fixture.readFile('a.md', 'utf8')).toBe(markdown);
		}
	});

	test('prints the package version', async () => {
		const packageJson = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string };
		const result = await mdeval(['--version']);
		expect(result.stdout).toBe(packageJson.version);
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
		expect(result.stdout).toContain('--check');
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
		await mdeval(['node_modules/pkg/*.md'], { cwd: fixture.path });

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
