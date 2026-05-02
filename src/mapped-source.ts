import { pathToFileURL } from 'node:url';
import {
	GenMapping, addSegment, setSourceContent, toEncodedMap,
} from '@jridgewell/gen-mapping';

const lineFromOffset = (source: string, offset: number): number => {
	let line = 0;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
		}
	}
	return line;
};

// Builds a synthesized JS string alongside a source map back to an original
// `.md` file, then emits it with an inline `//# sourceMappingURL=` so Node's
// built-in source-map support can remap stack traces to the `.md`.
export const createMappedSource = (
	filePath: string,
	source: string,
) => {
	const sourceURL = pathToFileURL(filePath).href;
	const map = new GenMapping({ file: filePath });
	setSourceContent(map, sourceURL, source);
	const lines: string[] = [];

	return {
		// Append `text` to the output, mapping each of its lines to consecutive
		// source lines starting at the line of `sourceOffset`. A trailing empty
		// line (from `text` ending with `\n`) is dropped.
		appendLines(text: string, sourceOffset: number) {
			const startLine = lineFromOffset(source, sourceOffset);
			const textLines = text.split('\n');
			if (textLines.at(-1) === '') {
				textLines.pop();
			}
			for (let index = 0; index < textLines.length; index += 1) {
				addSegment(map, lines.length, 0, sourceURL, startLine + index, 0);
				lines.push(textLines[index]);
			}
		},
		toString: () => {
			const body = `${lines.join('\n')}\n`;
			const encoded = toEncodedMap(map);
			const inlineMap = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(encoded)).toString('base64')}`;
			return `${body}${inlineMap}\n`;
		},
	};
};
