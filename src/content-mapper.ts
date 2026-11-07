import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MappedCodeBuilder, runContentMapper } from 'ts-content-mapper';
import { generateModule } from './generate-module.ts';
import { MarkdownParseError, COMMENT_TAG } from './parse-markdown.ts';
import { nodeModulesPattern } from './node-modules.ts';

const globalDeclarations = [
	'declare global {',
	'\tvar block: typeof import(\'mdeval\').block;',
	'\tvar $: typeof import(\'mdeval\').$;',
	'}',
].join('\n');

// The CLI and loader seed the helpers on `globalThis`. Declaring them as
// globals, not module bindings, lets an explicit import or a local
// `block` shadow them, the same as at runtime. With `skipLibCheck`, the
// first declaration determines the type and later .d.ts conflicts can be skipped.
// The guard's type declaration is module-local; its runtime value is global.
const typescriptFormat = {
	extension: '.mts' as const,
	preamble: '',
	declarations: [globalDeclarations, 'declare const __mdeval_guard: <T>(value: T) => T;'],
	supplemental: undefined,
};

// Node runs Markdown under node_modules as JavaScript. `// @ts-check` enables semantic
// checks without `checkJs`, and JavaScript cannot contain `declare global`, so a virtual
// .mts file carries the helper declarations.
const javascriptFormat = {
	extension: '.mjs' as const,
	preamble: '// @ts-check\n',
	declarations: ['/** @type {<T>(value: T) => T} */ const __mdeval_guard = value => value;'],
	supplemental: [{
		text: `export {};\n${globalDeclarations}\n`,
		extension: '.mts' as const,
	}],
};

// Unless run with --preserve-symlinks (imports) or --preserve-symlinks-main (entry point),
// Node resolves symlinks before loading
const resolveRealPath = (fileName: string) => {
	try {
		return fs.realpathSync(fileName);
	} catch {
		// Virtual files may not exist on disk
		return fileName;
	}
};

runContentMapper<Record<string, unknown>, boolean>({
	diagnosticSource: 'mdeval',
	positionEncoding: 'utf-16',
	openProject: ({ compilerOptions }) => ({
		project: compilerOptions.preserveSymlinks === true,
	}),
	transform: ({ content, fileName }, { project: preserveSymlinks }) => {
		// Match the loader's URL representation, but the filename has no query or fragment.
		const path = preserveSymlinks ? fileName : resolveRealPath(fileName);
		const format = nodeModulesPattern.test(pathToFileURL(path).href)
			? javascriptFormat
			: typescriptFormat;
		let chunks;
		try {
			chunks = generateModule(content);
		} catch (error) {
			if (!(error instanceof MarkdownParseError)) {
				throw error;
			}
			return {
				text: `${format.preamble}export {};\n`,
				extension: format.extension,
				diagnostics: [{
					messageText: error.message,
					start: error.offset,
					length: COMMENT_TAG.length,
					code: 1,
				}],
			};
		}

		const out = new MappedCodeBuilder(content);
		out.append(format.preamble);
		for (const { text, sourceOffset } of chunks) {
			if (sourceOffset === undefined) {
				out.append(text);
			} else {
				out.appendVerbatim(sourceOffset, sourceOffset + text.length);
			}
		}
		out.append(['', 'export {};', ...format.declarations, ''].join('\n'));
		return {
			...out.build(format.extension),
			supplemental: format.supplemental,
		};
	},
});
