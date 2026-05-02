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

	// Precompute newline indices once so per-offset position lookup is O(log N)
	// via binary search instead of O(offset) re-scans of `source`.
	const newlineIndices: number[] = [];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === '\n') {
			newlineIndices.push(index);
		}
	}

	const positionFromOffset = (offset: number): Position => {
		let lo = 0;
		let hi = newlineIndices.length;
		while (lo < hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (newlineIndices[mid] < offset) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		const previousNewline = lo > 0 ? newlineIndices[lo - 1] : -1;
		return {
			line: lo,
			column: offset - previousNewline - 1,
		};
	};

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
			const start = positionFromOffset(sourceOffset);
			const textLines = text.split('\n');
			if (textLines.at(-1) === '') {
				textLines.pop();
			}
			for (let index = 0; index < textLines.length; index += 1) {
				const genLine = lines.length;
				addSegment(map, genLine, 0, sourceURL, start.line + index, 0);
				if (index === 0 && firstLineAnchor) {
					const anchor = positionFromOffset(firstLineAnchor.sourceOffset);
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
