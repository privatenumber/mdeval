import path from 'node:path';
import { describe, test, expect } from 'manten';
import { createFixture, type FileTree } from 'fs-fixture';
import spawn, { SubprocessError } from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const compiler = path.join(projectRoot, 'node_modules/typescript-mapper-tests/bin/tsc');

const checkMarkdown = async (files: FileTree) => {
	await using fixture = await createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		'tsconfig.json': JSON.stringify({
			compilerOptions: {
				module: 'nodenext',
				target: 'esnext',
				strict: true,
				allowJs: true,
				checkJs: true,
				noEmit: true,
				types: [],
			},
			contentMappers: [{
				package: 'mdeval',
				extensions: ['.md'],
			}],
			include: ['**/*.md'],
		}),
		'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
		...files,
	});
	try {
		const result = await spawn(process.execPath, [compiler, '--runExternalCode', '--pretty', 'false'], {
			cwd: fixture.path,
			timeout: 15_000,
		});
		return {
			output: result.output,
			exitCode: 0,
		};
	} catch (error) {
		if (!(error instanceof SubprocessError) || error.exitCode === undefined) {
			throw error;
		}
		return {
			output: error.output,
			exitCode: error.exitCode,
		};
	}
};

describe('content mapper', () => {
	test('reports original positions in scripts and markers, with Unicode and CRLF', async () => {
		const result = await checkMarkdown({
			'example.md': [
				'\uFEFF# 日本語 😀',
				'<!--mdeval',
				'const count = 42;',
				'count.trim();',
				'-->',
				'😀 <!--mdeval count.toUpperCase()-->old<!--/mdeval-->',
				'Again: <!--mdeval count.toUpperCase()-->old<!--/mdeval-->',
			].join('\r\n'),
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: [
				"example.md(4,7): error TS2339: Property 'trim' does not exist on type '42'.",
				"example.md(6,21): error TS2339: Property 'toUpperCase' does not exist on type '42'.",
			].join('\n'),
		});
	});

	test('checks imports and shared script scope without executing Markdown', async () => {
		const result = await checkMarkdown({
			'docs/example.md': [
				'<!--mdeval answer.toFixed()-->old<!--/mdeval-->',
				'<!--mdeval',
				'import { answer } from "../data.md";',
				'import { double } from "../helper.mjs";',
				'const result = double(answer);',
				'-->',
				'<!--mdeval',
				'const label = result.toFixed();',
				'throw new Error("Must not execute Markdown");',
				'-->',
				'<!--mdeval label-->old<!--/mdeval-->',
			].join('\n'),
			'data.md': '<!--mdeval\nexport const answer = 42;\n-->',
			'helper.mjs': '/** @param {number} value */\nexport const double = value => value * 2;',
			'empty.md': '# No code',
			'isolated.md': '<!--mdeval\nconst result = "separate module";\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('checks the types of exports imported from Markdown', async () => {
		const result = await checkMarkdown({
			'example.md': '<!--mdeval\nimport { answer } from "./data.md";\nanswer.trim();\n-->',
			'data.md': '<!--mdeval\nexport const answer = 42;\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "example.md(3,8): error TS2339: Property 'trim' does not exist on type '42'.",
		});
	});

	test('ignores literal examples in code fences and inline code', async () => {
		const result = await checkMarkdown({
			'example.md': [
				'```md',
				'<!--mdeval missing()-->old<!--/mdeval-->',
				'```',
				'`<!--mdeval missing()-->old<!--/mdeval-->`',
				'<!--mdeval 42-->old<!--/mdeval-->',
			].join('\n'),
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('uses published types for mdeval runtime helpers', async () => {
		const result = await checkMarkdown({
			'example.md': '<!--mdeval\nimport { block } from "mdeval";\nblock("hello").toFixed();\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "example.md(3,16): error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?",
		});
	});

	test('preserves evaluate-once control flow for repeated expressions', async () => {
		const result = await checkMarkdown({
			'example.md': [
				'<!--mdeval',
				'/** @type {number | string} */',
				'let value = 0;',
				'-->',
				'<!--mdeval value = "a"-->old<!--/mdeval-->',
				'<!--mdeval value = 1-->old<!--/mdeval-->',
				'<!--mdeval value = "a"-->old<!--/mdeval-->',
				'<!--mdeval value.toFixed()-->old<!--/mdeval-->',
			].join('\n'),
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('reports malformed comments as Markdown diagnostics', async () => {
		const result = await checkMarkdown({
			'example.md': '# Heading\n\n<!--mdeval\nconst value = 42;\n',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: 'example.md(3,1): error mdeval1: mdeval: unclosed script block at offset 11 (missing `-->`)',
		});
	});
});
