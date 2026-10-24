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
				extension: '.mjs',
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
		// The loader always treats Markdown as ESM, including script-only files.
		out.append('\nexport {};\n');
		return out.build('.mjs');
	},
});
