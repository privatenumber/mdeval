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

type MappingSpan = {
	generatedOffset: number;
	sourceOffset: number;
	length: number;
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
	for (let nl = source.indexOf('\n'); nl !== -1; nl = source.indexOf('\n', nl + 1)) {
		newlineIndices.push(nl);
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

	const appendMappedText = (
		text: string,
		span: MappingSpan,
	) => {
		const generatedStartLine = lines.length;
		const textLines = text.split('\n');
		if (textLines.at(-1) === '') {
			textLines.pop();
		}

		const generatedLineStarts: number[] = [];
		let offset = 0;
		for (const line of textLines) {
			generatedLineStarts.push(offset);
			offset += line.length + 1;
			lines.push(line);
		}

		let lineIndex = 0;
		const { generatedOffset: spanStart } = span;
		const spanEnd = spanStart + span.length;
		for (
			let generatedOffset = spanStart;
			generatedOffset < spanEnd;
			generatedOffset += 1
		) {
			const char = text[generatedOffset];
			if (char === '\n' || char === '\r') {
				continue;
			}
			while (
				lineIndex + 1 < generatedLineStarts.length
				&& generatedLineStarts[lineIndex + 1] <= generatedOffset
			) {
				lineIndex += 1;
			}
			const sourcePosition = positionFromOffset(
				span.sourceOffset + generatedOffset - span.generatedOffset,
			);
			addSegment(
				map,
				generatedStartLine + lineIndex,
				generatedOffset - generatedLineStarts[lineIndex],
				sourceURL,
				sourcePosition.line,
				sourcePosition.column,
			);
		}
	};

	return {
		// Append source text copied verbatim into the output. Every generated
		// column maps back to the matching source column so stack traces can point
		// at the actual failing token, not just the start of its line.
		appendSource(text: string, sourceOffset: number) {
			appendMappedText(text, {
				generatedOffset: 0,
				sourceOffset,
				length: text.length,
			});
		},
		// Append generated text containing one source-backed span. Useful for an
		// export line where a synthetic prefix wraps the original marker expression.
		appendGenerated(
			text: string,
			firstLineAnchor: FirstLineAnchor,
			length: number,
		) {
			appendMappedText(text, {
				generatedOffset: firstLineAnchor.genColumn,
				sourceOffset: firstLineAnchor.sourceOffset,
				length,
			});
		},
		toString: () => {
			const body = `${lines.join('\n')}\n`;
			const encoded = toEncodedMap(map);
			const inlineMap = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(encoded)).toString('base64')}`;
			return `${body}${inlineMap}\n`;
		},
	};
};
