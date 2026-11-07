import { parse, preprocess, postprocess } from 'micromark';
import { gfmTable } from 'micromark-extension-gfm-table';

export type Marker = {
	expression: string;
	start: number;
	end: number;
};

export class MarkdownParseError extends Error {
	readonly offset: number;

	constructor(message: string, offset: number) {
		super(message);
		this.offset = offset;
	}
}

const NAME = 'mdeval';
export const COMMENT_TAG = `<!--${NAME}`;
export const MARKER_OPEN = `${COMMENT_TAG} `;
export const MARKER_CLOSE = `<!--/${NAME}-->`;
export const EXPORT_PREFIX = `__${NAME}_`;
export const COMMENT_CLOSE = '-->';

export const buildExpressionMap = (
	markers: Marker[],
): Map<string, number> => {
	const map = new Map<string, number>();
	for (const { expression } of markers) {
		if (!map.has(expression)) {
			map.set(expression, map.size);
		}
	}
	return map;
};

export type ScriptBlock = {
	content: string;
	contentStart: number;
	start: number;
	end: number;
};

type CodeRange = [number, number];

const codeTokenTypes = new Set(['codeFenced', 'codeIndented', 'codeText']);

// Collect source ranges for code constructs and escaped opening angle brackets.
// GFM tables constrain inline code spans to individual cells.
//
// micromark emits events in document order, so the ranges come out sorted.
// micromark's preprocess() strips a leading BOM; we shift offsets back so the
// ranges align with positions in the original source that our mdeval scanners
// also operate on.
const findCodeRanges = (source: string) => {
	const bomOffset = source.codePointAt(0) === 0xFE_FF ? 1 : 0;
	// The table extension differs from GitHub for escaped backslashes before a
	// pipe: https://github.com/github/cmark-gfm/issues/277. Parse the original
	// source so this scanner agrees with rendering validation.
	const events = postprocess(
		parse({ extensions: [gfmTable()] }).document()
			.write(preprocess()(source, undefined, true)),
	);
	const ranges: CodeRange[] = [];
	const cells: CodeRange[] = [];
	let headerWidth = 0;
	let column = 0;
	let discardedCell = false;
	for (const [phase, token] of events) {
		if (discardedCell) {
			if (phase === 'exit' && token.type === 'tableData') {
				discardedCell = false;
			}
			continue;
		}
		if (phase !== 'enter') {
			continue;
		}
		if (token.type === 'tableHeader' || token.type === 'tableData') {
			cells.push([token.start.offset + bomOffset, token.end.offset + bomOffset]);
		}
		switch (token.type) {
			case 'table': {
				headerWidth = 0;
				break;
			}
			case 'tableRow': {
				column = 0;
				break;
			}
			case 'tableHeader': {
				headerWidth += 1;
				break;
			}
			case 'tableData': {
				column += 1;
				if (column > headerWidth) {
					ranges.push([token.start.offset + bomOffset, token.end.offset + bomOffset]);
					discardedCell = true;
					continue;
				}
				break;
			}
			default: {
				break;
			}
		}
		if (codeTokenTypes.has(token.type) || (
			token.type === 'characterEscape'
			&& source[token.end.offset + bomOffset - 1] === '<'
		)) {
			ranges.push([token.start.offset + bomOffset, token.end.offset + bomOffset]);
		}
	}
	return {
		ranges,
		cells,
	};
};

export type ParseResult = {
	scriptBlocks: ScriptBlock[];
	markers: Marker[];
};

// Lazy, forward-only membership test for literal source ranges.
const createIsInCode = (source: string) => {
	let parsed: ReturnType<typeof findCodeRanges> | null = null;
	let rangeIndex = 0;
	let cellIndex = 0;
	const context = (position: number) => {
		if (parsed === null) {
			parsed = findCodeRanges(source);
		}
		const { ranges, cells } = parsed;
		while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= position) {
			rangeIndex += 1;
		}
		if (rangeIndex < ranges.length && position >= ranges[rangeIndex][0]) {
			return {
				literal: true,
				cellEnd: undefined,
			};
		}
		while (cellIndex < cells.length && cells[cellIndex][1] <= position) {
			cellIndex += 1;
		}
		return {
			literal: false,
			cellEnd: cellIndex < cells.length && position >= cells[cellIndex][0]
				? cells[cellIndex][1]
				: undefined,
		};
	};
	const isInCode = (position: number) => {
		const { ranges } = parsed!;
		let left = 0;
		let right = ranges.length;
		while (left < right) {
			const middle = Math.floor((left + right) / 2);
			if (ranges[middle][1] <= position) {
				left = middle + 1;
			} else {
				right = middle;
			}
		}
		return left < ranges.length && ranges[left][0] <= position;
	};
	return {
		context,
		isInCode,
	};
};

// Locate the next real mdeval opening — a `<!--mdeval` followed by space, LF,
// or CRLF. Skips false matches like `<!--mdevalfoo` so they don't get mistaken
// for a stray opening when reasoning about an unclosed marker.
const findNextMdevalOpening = (source: string, from: number): number => {
	let cursor = from;
	while (cursor < source.length) {
		const candidate = source.indexOf(COMMENT_TAG, cursor);
		if (candidate === -1) {
			return -1;
		}
		const after = source[candidate + COMMENT_TAG.length];
		if (
			after === ' '
			|| after === '\n'
			|| (after === '\r' && source[candidate + COMMENT_TAG.length + 1] === '\n')
		) {
			return candidate;
		}
		cursor = candidate + COMMENT_TAG.length;
	}
	return -1;
};

// Single-pass scan of `source` for both script blocks (`<!--mdeval\n…-->`) and
// value markers (`<!--mdeval expr-->value<!--/mdeval-->`). Candidates whose
// opening offset falls inside a code range are dropped — those are literal
// syntax examples in the document, not active mdeval markers.
export const parseMarkdown = (source: string): ParseResult => {
	if (!source.includes(COMMENT_TAG)) {
		return {
			scriptBlocks: [],
			markers: [],
		};
	}

	const { context, isInCode } = createIsInCode(source);

	const scriptBlocks: ScriptBlock[] = [];
	const markers: Marker[] = [];
	let searchFrom = 0;

	while (searchFrom < source.length) {
		const start = findNextMdevalOpening(source, searchFrom);
		if (start === -1) {
			break;
		}

		const afterTag = start + COMMENT_TAG.length;
		const nextChar = source[afterTag];
		const { literal, cellEnd } = context(start);
		if (literal) {
			searchFrom = afterTag;
			continue;
		}
		if (cellEnd !== undefined) {
			const cell = source.slice(start, cellEnd);
			const exprEnd = cell.indexOf(COMMENT_CLOSE, COMMENT_TAG.length);
			const closeStart = exprEnd === -1
				? -1
				: cell.indexOf(MARKER_CLOSE, exprEnd + COMMENT_CLOSE.length);
			if (nextChar !== ' ' || closeStart === -1 || isInCode(start + closeStart)) {
				searchFrom = afterTag;
				continue;
			}
			const nextOpening = findNextMdevalOpening(cell, exprEnd + COMMENT_CLOSE.length);
			if (nextOpening !== -1 && nextOpening < closeStart) {
				throw new MarkdownParseError(
					`mdeval: unclosed marker open at offset ${start} (missing \`<!--/mdeval-->\`)`,
					start,
				);
			}
			const markerEnd = start + closeStart + MARKER_CLOSE.length;
			markers.push({
				expression: cell.slice(COMMENT_TAG.length + 1, exprEnd),
				start,
				end: markerEnd,
			});
			searchFrom = markerEnd;
			continue;
		}

		// Script block: <!--mdeval followed by LF or CRLF. We accept CRLF so
		// files saved on Windows (or via git autocrlf) still parse.
		if (nextChar === '\n' || (nextChar === '\r' && source[afterTag + 1] === '\n')) {
			const contentStart = nextChar === '\n' ? afterTag + 1 : afterTag + 2;
			const closeStart = source.indexOf(COMMENT_CLOSE, contentStart);
			const nextOpening = findNextMdevalOpening(source, contentStart);
			const interveningOpen = (
				nextOpening !== -1
				&& (closeStart === -1 || nextOpening < closeStart)
			);
			if (closeStart === -1 || interveningOpen) {
				throw new MarkdownParseError(
					interveningOpen
						? `mdeval: unclosed script block at offset ${start} (another mdeval opening found before \`-->\`)`
						: `mdeval: unclosed script block at offset ${start} (missing \`-->\`)`,
					start,
				);
			}
			const end = closeStart + COMMENT_CLOSE.length;
			scriptBlocks.push({
				content: source.slice(contentStart, closeStart),
				contentStart,
				start,
				end,
			});
			searchFrom = end;
			continue;
		}

		// Value marker: <!--mdeval followed by a space.
		if (nextChar === ' ') {
			const exprStart = afterTag + 1;
			const exprEnd = source.indexOf(COMMENT_CLOSE, exprStart);
			if (exprEnd === -1) {
				throw new MarkdownParseError(
					`mdeval: unclosed marker open at offset ${start} (missing \`-->\` on the marker open)`,
					start,
				);
			}
			const contentStart = exprEnd + COMMENT_CLOSE.length;
			const closeStart = source.indexOf(MARKER_CLOSE, contentStart);
			const nextOpening = findNextMdevalOpening(source, contentStart);
			const isUnclosed = (
				closeStart === -1
				|| (nextOpening !== -1 && nextOpening < closeStart)
			);
			if (isUnclosed) {
				throw new MarkdownParseError(
					`mdeval: unclosed marker open at offset ${start} (missing \`<!--/mdeval-->\`)`,
					start,
				);
			}
			const markerEnd = closeStart + MARKER_CLOSE.length;
			markers.push({
				expression: source.slice(exprStart, exprEnd),
				start,
				end: markerEnd,
			});
			searchFrom = markerEnd;
			continue;
		}
	}

	return {
		scriptBlocks,
		markers,
	};
};

export const isOnlyMdeval = (
	source: string,
	{ scriptBlocks, markers }: ParseResult,
): boolean => {
	// Marker values render as page content, so only a file of script blocks renders nothing
	if (scriptBlocks.length === 0 || markers.length > 0) {
		return false;
	}

	let cursor = 0;
	for (const block of scriptBlocks) {
		if (source.slice(cursor, block.start).trim() !== '') {
			return false;
		}
		cursor = block.end;
	}
	return source.slice(cursor).trim() === '';
};
