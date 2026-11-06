import { MappedCodeBuilder, runContentMapper } from 'ts-content-mapper';
import { generateModule } from './generate-module.ts';
import { MarkdownParseError, COMMENT_TAG } from './parse-markdown.ts';

const globalsReference = '/// <reference types="mdeval/globals" />\n';

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
				text: `${globalsReference}export {};\n`,
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
		out.append(globalsReference);
		for (const { text, sourceOffset } of chunks) {
			if (sourceOffset === undefined) {
				out.append(text);
			} else {
				out.appendVerbatim(sourceOffset, sourceOffset + text.length);
			}
		}
		// The loader runs Markdown as TypeScript ESM, including script-only files.
		// The generated marker code uses this reserved runtime guard.
		out.append([
			'',
			'export {};',
			'declare const __mdeval_guard: <T>(value: T) => T;',
			'',
		].join('\n'));
		return out.build('.mts');
	},
});
