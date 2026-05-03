import { pathToFileURL } from 'node:url';
import {
	GenMapping, addSegment, toEncodedMap,
} from '@jridgewell/gen-mapping';

type Position = {
	line: number;
	column: number;
};

const LF = 10;
const CR = 13;

const isWhitespaceCode = (code: number) => (
	code === 9
	|| code === LF
	|| code === 11
	|| code === 12
	|| code === CR
	|| code === 32
);

const isIdentifierCode = (code: number) => (
	(code >= 48 && code <= 57)
	|| (code >= 65 && code <= 90)
	|| code === 95
	|| (code >= 97 && code <= 122)
	|| code === 36
);

// Builds synthesized JS alongside a source map back to an original `.md` file.
// Callers append either source-backed text or synthetic JS; the builder owns
// generated positions, compact segment emission, and inline map serialization.
export const createSourceBuilder = (
	filePath: string,
	source: string,
) => {
	const sourceURL = pathToFileURL(filePath).href;
	const map = new GenMapping({ file: filePath });
	const lines: string[] = [];
	let currentLine = '';

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

	const appendLineChunk = (text: string) => {
		currentLine += text;
	};

	const flushLine = () => {
		lines.push(currentLine);
		currentLine = '';
	};

	const appendSourceText = (
		text: string,
		sourceOffset: number,
	) => {
		const sourceStart = positionFromOffset(sourceOffset);
		let sourceLine = sourceStart.line;
		let sourceColumn = sourceStart.column;
		let previousIsIdentifier = false;
		let previousIsWhitespace = false;
		let lineStart = 0;
		const generatedColumn = (offset: number) => currentLine.length + offset - lineStart;
		for (
			let offset = 0;
			offset < text.length;
			offset += 1
		) {
			const code = text.codePointAt(offset)!;
			const isWhitespace = isWhitespaceCode(code);
			const isIdentifier = isIdentifierCode(code);
			const isSegmentBoundary = (
				!isWhitespace
				&& (
					offset === 0
					|| previousIsWhitespace
					|| !previousIsIdentifier
					|| !isIdentifier
				)
			);

			if (isSegmentBoundary) {
				addSegment(
					map,
					lines.length,
					generatedColumn(offset),
					sourceURL,
					sourceLine,
					sourceColumn,
				);
			}

			if (code === LF) {
				sourceLine += 1;
				sourceColumn = 0;
			} else {
				sourceColumn += 1;
			}
			previousIsIdentifier = isIdentifier;
			previousIsWhitespace = isWhitespace;

			if (code === LF) {
				appendLineChunk(text.slice(lineStart, offset));
				flushLine();
				lineStart = offset + 1;
			}
		}
		if (lineStart < text.length) {
			appendLineChunk(text.slice(lineStart));
		}
	};

	const appendSyntheticText = (text: string) => {
		let cursor = 0;
		for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', cursor)) {
			appendLineChunk(text.slice(cursor, nl));
			flushLine();
			cursor = nl + 1;
		}
		if (cursor < text.length) {
			appendLineChunk(text.slice(cursor));
		}
	};

	return {
		// Append source text copied verbatim into the output. Segments are emitted
		// at likely token boundaries so maps stay compact without a JS parser.
		appendSource(text: string, sourceOffset: number) {
			appendSourceText(text, sourceOffset);
		},
		appendSynthetic(text: string) {
			appendSyntheticText(text);
		},
		toModuleSource: () => {
			const bodyLines = currentLine === '' ? lines : [...lines, currentLine];
			const body = `${bodyLines.join('\n')}\n`;
			const encoded = toEncodedMap(map);
			const inlineMap = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(encoded)).toString('base64')}`;
			return `${body}${inlineMap}\n`;
		},
	};
};
