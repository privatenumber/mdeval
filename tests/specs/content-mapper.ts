import path from 'node:path';
import {
	describe, test, expect, skip,
} from 'manten';
import { createFixture, type FileTree } from 'fs-fixture';
import spawn, { SubprocessError } from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const compiler = path.join(projectRoot, 'node_modules/typescript7/bin/tsc');

const tsc = async (
	args: string[],
	cwd: string,
) => {
	try {
		const result = await spawn(process.execPath, [compiler, ...args], {
			cwd,
			// About 1s alone, but over 12s on Node.js 20 under full-suite load
			timeout: 60_000,
		});
		return {
			output: result.output,
			exitCode: 0,
		};
	} catch (error) {
		// A non-zero exit code means tsc reported errors; anything else is a spawn failure
		if (!(error instanceof SubprocessError) || error.exitCode === undefined) {
			throw error;
		}
		return {
			output: error.output,
			exitCode: error.exitCode,
		};
	}
};

const typecheckMdeval = async (files: FileTree) => {
	await using fixture = await createFixture({
		'package.json': JSON.stringify({ type: 'module' }),
		'tsconfig.json': JSON.stringify({
			compilerOptions: {
				module: 'nodenext',
				target: 'esnext',
				strict: true,
				erasableSyntaxOnly: true,
				// Only for the `.mjs` helper below. Markdown is checked as TypeScript
				allowJs: true,
				noEmit: true,
				types: [],
			},
			contentMappers: [{
				package: 'mdeval',
				extensions: ['.md'],
			}],
			include: ['**/*.md', '**/*.ts'],
		}),
		'node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
		...files,
	});
	// Await before `fixture` is disposed at scope exit
	return await tsc(['--runExternalCode', '--pretty', 'false'], fixture.path);
};

// Each test starts tsc and a mapper process; TypeScript gives the mapper 5 s to initialize
describe('content mapper', () => {
	test('checks overload declarations and implementations across script blocks', async () => {
		const result = await typecheckMdeval({
			'example.md': '<!--mdeval\nexport function f(x: string): string;\n-->\n<!--mdeval\nexport function f(x: string) { return x; }\n-->\n<!--mdeval f("a")-->old<!--/mdeval-->',
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('checks 1100 distinct marker expressions', async () => {
		const source = Array.from({ length: 1100 }, (_, index) => `<!--mdeval ${index}-->old<!--/mdeval-->`).join('\n');
		const result = await typecheckMdeval({ 'example.md': source });
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('preserves inferred marker literal types', async () => {
		const result = await typecheckMdeval({ 'example.md': '<!--mdeval 42-->old<!--/mdeval-->\n<!--mdeval __mdeval_0 satisfies 42-->old<!--/mdeval-->' });
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('reports original positions in scripts and markers, with Unicode and CRLF', async () => {
		const result = await typecheckMdeval({
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
		const result = await typecheckMdeval({
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

	test('checks TypeScript syntax', async () => {
		const result = await typecheckMdeval({
			'example.md': [
				'<!--mdeval',
				'type User = { name: string };',
				'const user: User = { name: "a" };',
				'const id: number = user.name;',
				'-->',
				'<!--mdeval (user satisfies User).name-->old<!--/mdeval-->',
			].join('\n'),
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "example.md(4,7): error TS2322: Type 'string' is not assignable to type 'number'.",
		});
	});

	test('checks the types of exports imported from Markdown', async () => {
		const result = await typecheckMdeval({
			'example.md': '<!--mdeval\nimport { answer } from "./data.md";\nanswer.trim();\n-->',
			'data.md': '<!--mdeval\nexport const answer = 42;\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "example.md(3,8): error TS2339: Property 'trim' does not exist on type '42'.",
		});
	});

	test('ignores literal examples in code fences and inline code', async () => {
		const result = await typecheckMdeval({
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
		const result = await typecheckMdeval({
			'imported.md': '<!--mdeval\nimport { block } from "mdeval";\nblock("hello").toFixed();\n-->',
			'helpers.md': [
				'<!--mdeval',
				'import { block, $ } from "mdeval";',
				'const output: string = (await $`echo`).stdout;',
				'-->',
				'<!--mdeval block("hello").toFixed()-->old<!--/mdeval-->',
			].join('\n'),
			'shadowed.md': '<!--mdeval\nconst block = 1;\nblock.toFixed();\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: [
				"helpers.md(5,27): error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?",
				"imported.md(3,16): error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?",
			].join('\n'),
		});
	});

	test('checks a project that imports helpers across files without errors', async () => {
		const result = await typecheckMdeval({
			'README.md': [
				'# Project',
				'<!--mdeval',
				'import { block, $ } from "mdeval";',
				'import { contacts } from "./docs/contacts.md";',
				'const branch: string = (await $`git branch --show-current`).stdout;',
				'-->',
				'<!--mdeval block(contacts.map(contact => contact.name).join(", "))-->old<!--/mdeval-->',
				'Branch: <!--mdeval branch-->old<!--/mdeval-->',
			].join('\n'),
			'docs/contacts.md': [
				'<!--mdeval',
				'import { block } from "mdeval";',
				'type Contact = { name: string };',
				'export const contacts: Contact[] = [{ name: "a" }];',
				'-->',
				'<!--mdeval block(contacts.length)-->old<!--/mdeval-->',
			].join('\n'),
			'consumer.ts': [
				'import { contacts } from "./docs/contacts.md";',
				'const names: string[] = contacts.map(contact => contact.name);',
				'export default names;',
			].join('\n'),
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('reports a conflicting project global', async () => {
		for (const skipLibraryCheck of [false, true]) {
			const result = await typecheckMdeval({
				'tsconfig.json': JSON.stringify({
					compilerOptions: {
						module: 'nodenext',
						target: 'esnext',
						noEmit: true,
						skipLibCheck: skipLibraryCheck,
						types: [],
					},
					contentMappers: [{
						package: 'mdeval',
						extensions: ['.md'],
					}],
					files: ['globals.d.ts', 'example.md'],
				}),
				'globals.d.ts': 'export {}; declare global { var block: (value: unknown) => number; }',
				'example.md': '<!--mdeval block(42).toFixed()-->old<!--/mdeval-->',
			});
			expect(result.exitCode).toBe(2);
			expect(result.output).toMatch(/error TS2403:/);
		}
	});

	test('checks unimported helpers', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					erasableSyntaxOnly: true,
					noEmit: true,
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				include: ['*.md', '*.ts'],
			}),
			'example.md': '<!--mdeval\nconst output: string = (await $`echo`).stdout;\n-->\n<!--mdeval block(42)-->42<!--/mdeval-->',
			'main.ts': 'const result: string = block(42); void result;',
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('checks unimported helper types', async () => {
		const result = await typecheckMdeval({
			'example.md': '<!--mdeval block(42).toFixed()-->old<!--/mdeval-->',
			'shell.md': '<!--mdeval (await $`echo`).stdout.toFixed()-->old<!--/mdeval-->',
		});
		expect(result.exitCode).toBe(2);
		expect(result.output).toMatch(/^example\.md\(1,22\): error TS2551:/);
		expect(result.output).toMatch(/shell\.md\(1,35\): error TS2551:/);
	});

	test('keeps the marker guard out of other modules', async () => {
		const result = await typecheckMdeval({
			'example.md': '<!--mdeval 42-->old<!--/mdeval-->',
			'main.ts': '__mdeval_guard(42);',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "main.ts(1,1): error TS2304: Cannot find name '__mdeval_guard'.",
		});
	});

	test('resolves helper types through paths for Markdown outside the project', async () => {
		await using fixture = await createFixture({
			'project/package.json': JSON.stringify({ type: 'module' }),
			'project/tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					noEmit: true,
					types: [],
					paths: { mdeval: ['./node_modules/mdeval/dist/runtime.d.mts'] },
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				include: ['../README.md'],
			}),
			'project/node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
			'README.md': '<!--mdeval block(42)-->42<!--/mdeval-->',
		});
		const result = await tsc(['--runExternalCode', '--pretty', 'false'], path.join(fixture.path, 'project'));
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('preserves evaluate-once control flow for repeated expressions', async () => {
		const result = await typecheckMdeval({
			'example.md': [
				'<!--mdeval',
				'let value: number | string = 0;',
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
		const result = await typecheckMdeval({
			'example.md': '# Heading\n\n<!--mdeval\nconst value = 42;\n',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: 'example.md(3,1): error mdeval1: mdeval: unclosed script block at offset 11 (missing `-->`)',
		});
	});

	test('rejects TypeScript syntax in node_modules Markdown', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					erasableSyntaxOnly: true,
					allowJs: true,
					noEmit: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				include: ['node_modules/example/data.md'],
			}),
			'node_modules/example/data.md': '<!--mdeval\nexport const n: number = 42;\n-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: 'node_modules/example/data.md(2,17): error TS8010: Type annotations can only be used in TypeScript files.',
		});
	});

	test('checks JavaScript node_modules Markdown and its exports', async () => {
		for (const checkJs of [false, true]) {
			const result = await typecheckMdeval({
				'tsconfig.json': JSON.stringify({
					compilerOptions: {
						module: 'nodenext',
						target: 'esnext',
						strict: true,
						checkJs,
						noEmit: true,
						types: [],
					},
					contentMappers: [{
						package: 'mdeval',
						extensions: ['.md'],
					}],
					include: ['node_modules/example/data.md', 'main.ts'],
				}),
				'node_modules/example/data.md': [
					'<!--mdeval',
					'import { block } from "mdeval";',
					'/** @param {number} value */',
					'export const f = value => value;',
					'/** @param {42} value */',
					'const literal = value => value;',
					'-->',
					'<!--mdeval 42-->42<!--/mdeval-->',
					'<!--mdeval block(literal(__mdeval_0))-->42<!--/mdeval-->',
				].join('\n'),
				'main.ts': 'import { f } from "./node_modules/example/data.md";\nf(42);\n// @ts-expect-error: f requires a number\nf("x");',
			});
			expect(result).toStrictEqual({
				exitCode: 0,
				output: '',
			});
		}
	});

	test('checks unimported helpers in JavaScript node_modules Markdown', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					erasableSyntaxOnly: true,
					noEmit: true,
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['node_modules/example/data.md'],
			}),
			'node_modules/example/data.md': '<!--mdeval\nconst output = (await $`echo`).stdout;\n-->\n<!--mdeval block(output)-->old<!--/mdeval-->\n<!--mdeval block(42).toFixed()-->old<!--/mdeval-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: "node_modules/example/data.md(5,22): error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?",
		});
	});

	test('reports a conflicting project global for JavaScript node_modules Markdown', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['globals.d.ts', 'node_modules/example/data.md'],
			}),
			'globals.d.ts': 'export {}; declare global { var block: (value: unknown) => number; }',
			'node_modules/example/data.md': '<!--mdeval block(42).toFixed()-->old<!--/mdeval-->',
		});
		expect(result.exitCode).toBe(2);
		expect(result.output).toMatch(/^node_modules\/example\/data\.md\(3,6\): error TS2403:/);
	});

	test('resolves helper types through paths for JavaScript Markdown outside the project', async () => {
		await using fixture = await createFixture({
			'project/package.json': JSON.stringify({ type: 'module' }),
			'project/tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					noEmit: true,
					types: [],
					paths: { mdeval: ['./node_modules/mdeval/dist/runtime.d.mts'] },
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['../node_modules/example/data.md'],
			}),
			'project/node_modules/mdeval': ({ symlink }) => symlink(projectRoot),
			'node_modules/example/data.md': '<!--mdeval block(42)-->42<!--/mdeval-->',
		});
		const result = await tsc(['--runExternalCode', '--pretty', 'false'], path.join(fixture.path, 'project'));
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('checks JavaScript marker expressions in node_modules by default', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					strict: true,
					noEmit: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['node_modules/example/data.md'],
			}),
			'node_modules/example/data.md': '<!--mdeval Promise.resolve<number>(1)-->old<!--/mdeval-->',
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: [
				"node_modules/example/data.md(1,12): error TS2365: Operator '>' cannot be applied to types 'boolean' and 'number'.",
				"node_modules/example/data.md(1,28): error TS2693: 'number' only refers to a type, but is being used as a value here.",
			].join('\n'),
		});
	});

	test('checks symlinks to node_modules as JavaScript', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					noEmit: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['docs/dep/data.md'],
			}),
			'node_modules/dep/data.md': '<!--mdeval\nexport const n: number = 42;\n-->',
			'docs/dep': ({ symlink, getPath }) => symlink(getPath('node_modules/dep')),
		});
		expect(result).toStrictEqual({
			exitCode: 2,
			output: 'docs/dep/data.md(2,17): error TS8010: Type annotations can only be used in TypeScript files.',
		});
	});

	test('checks workspace symlinks in node_modules as TypeScript', async () => {
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					noEmit: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['node_modules/dep/data.md'],
			}),
			'packages/dep/data.md': '<!--mdeval\nexport const n: number = 42;\n-->',
			'node_modules/dep': ({ symlink, getPath }) => symlink(getPath('packages/dep')),
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});

	test('checks a symlink target with literal backslashes as TypeScript', async () => {
		if (process.platform === 'win32') {
			skip('Backslashes are path separators on Windows');
		}
		const result = await typecheckMdeval({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					module: 'nodenext',
					target: 'esnext',
					noEmit: true,
					types: [],
				},
				contentMappers: [{
					package: 'mdeval',
					extensions: ['.md'],
				}],
				files: ['docs/dep/data.md'],
			}),
			'a\\node_modules\\pkg/data.md': '<!--mdeval\nexport const n: number = 42;\n-->',
			'docs/dep': ({ symlink, getPath }) => symlink(getPath(String.raw`a\node_modules\pkg`)),
		});
		expect(result).toStrictEqual({
			exitCode: 0,
			output: '',
		});
	});
}, { parallel: 'auto' });
