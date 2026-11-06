import { MappedCodeBuilder, runContentMapper } from 'ts-content-mapper';
import { generateModule } from './generate-module.ts';
import { MarkdownParseError, COMMENT_TAG } from './parse-markdown.ts';

runContentMapper({
	diagnosticSource: 'mdeval',
	positionEncoding: 'utf-16',
	transform: ({ content }) => {
		let chunks;
		try {
			chunks = generateModule(content);
		} catch (error) {
			if (!(error instanceof MarkdownParseError)) {
				throw error;
			}
			return {
				text: 'export {};\n',
				extension: '.mts',
				diagnostics: [{
					messageText: error.message,
					start: error.offset,
					length: COMMENT_TAG.length,
					code: 1,
				}],
			};
		}

		const out = new MappedCodeBuilder(content);
		for (const { text, sourceOffset } of chunks) {
			if (sourceOffset === undefined) {
				out.append(text);
			} else {
				out.appendVerbatim(sourceOffset, sourceOffset + text.length);
			}
		}
		// The loader runs Markdown as TypeScript ESM, including script-only files.
		// The CLI and loader seed the helpers on `globalThis`. Declaring them as
		// globals, not module bindings, lets an explicit import or a local
		// `block` shadow them, the same as at runtime. With `skipLibCheck`, the
		// first declaration determines the type and later .d.ts conflicts can be skipped.
		// The guard's type declaration is module-local; its runtime value is global.
		out.append([
			'',
			'export {};',
			'declare global {',
			'\tvar block: typeof import(\'mdeval\').block;',
			'\tvar $: typeof import(\'mdeval\').$;',
			'}',
			'declare const __mdeval_guard: <T>(value: T) => T;',
			'',
		].join('\n'));
		return out.build('.mts');
	},
});
