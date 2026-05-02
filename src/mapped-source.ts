import { pathToFileURL } from 'node:url';
import {
	GenMapping, addSegment, setSourceContent, toEncodedMap,
} from '@jridgewell/gen-mapping';

type Position = {
	line: number;
	column: number;
};

type FirstLineAnchor = {
	genColumn: number;
	sourceOffset: number;
};

const positionFromOffset = (source: string, offset: number): Position => {
	let line = 0;
	let lastNewline = -1;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
			lastNewline = index;
		}
	}
	return {
		line,
		column: offset - lastNewline - 1,
	};
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
		//
		// `firstLineAnchor` adds a second segment on the first emitted line
		// pointing from `genColumn` to a real position in source. Useful when
		// the first line of `text` includes a synthetic prefix and the actual
		// source content starts at `sourceOffset` within it.
		appendLines(
			text: string,
			sourceOffset: number,
			firstLineAnchor?: FirstLineAnchor,
		) {
			const start = positionFromOffset(source, sourceOffset);
			const textLines = text.split('\n');
			if (textLines.at(-1) === '') {
				textLines.pop();
			}
			for (let index = 0; index < textLines.length; index += 1) {
				const genLine = lines.length;
				addSegment(map, genLine, 0, sourceURL, start.line + index, 0);
				if (index === 0 && firstLineAnchor) {
					const anchor = positionFromOffset(source, firstLineAnchor.sourceOffset);
					addSegment(
						map,
						genLine,
						firstLineAnchor.genColumn,
						sourceURL,
						anchor.line,
						anchor.column,
					);
				}
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
