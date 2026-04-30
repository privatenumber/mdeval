import { parse, preprocess, postprocess } from 'micromark';

export type Marker = {
	expression: string;
	start: number;
	end: number;
};

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
	start: number;
	end: number;
};

type CodeRange = [number, number];

// Collect the byte ranges of all code constructs via micromark — the CommonMark
// reference parser. Fenced code, inline code, and indented code blocks are the
// regions where mdeval patterns are treated as literal content (part of a docs
// example) rather than active syntax.
//
// micromark emits events in document order, so the ranges come out sorted.
// micromark's preprocess() strips a leading BOM; we shift offsets back so the
// ranges align with positions in the original source that our mdeval scanners
// also operate on.
const findCodeRanges = (source: string): CodeRange[] => {
	const bomOffset = source.codePointAt(0) === 0xFE_FF ? 1 : 0;
	const events = postprocess(
		parse().document().write(preprocess()(source, undefined, true)),
	);
	const ranges: CodeRange[] = [];
	for (const [phase, token] of events) {
		if (phase !== 'enter') {
			continue;
		}
		if (
			token.type === 'codeFenced'
			|| token.type === 'codeIndented'
			|| token.type === 'codeText'
		) {
			ranges.push([token.start.offset + bomOffset, token.end.offset + bomOffset]);
		}
	}
	return ranges;
};

type ParseResult = {
	scriptBlocks: ScriptBlock[];
	markers: Marker[];
};

// Lazy, forward-only code-range membership test. We defer the micromark parse
// until we actually find a candidate mdeval opening in source — the substring
// check in parseMarkdown can pass on matches that only exist inside code (e.g.
// a string literal `<!--mdeval` inside a fenced block), in which case we never
// need the parser at all.
const createIsInCode = (source: string) => {
	let ranges: CodeRange[] | null = null;
	let rangeIndex = 0;
	return (position: number): boolean => {
		if (ranges === null) {
			ranges = findCodeRanges(source);
		}
		while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= position) {
			rangeIndex += 1;
		}
		return rangeIndex < ranges.length && position >= ranges[rangeIndex][0];
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

	const isInCode = createIsInCode(source);

	const scriptBlocks: ScriptBlock[] = [];
	const markers: Marker[] = [];
	let searchFrom = 0;

	while (searchFrom < source.length) {
		const start = source.indexOf(COMMENT_TAG, searchFrom);
		if (start === -1) {
			break;
		}

		const afterTag = start + COMMENT_TAG.length;
		const nextChar = source[afterTag];

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
				if (isInCode(start)) {
					if (closeStart === -1) {
						break;
					}
					searchFrom = contentStart;
					continue;
				}
				if (interveningOpen) {
					throw new Error(
						`mdeval: unclosed script block at offset ${start} (another mdeval opening found before \`-->\`)`,
					);
				}
				throw new Error(
					`mdeval: unclosed script block at offset ${start} (missing \`-->\`)`,
				);
			}
			const end = closeStart + COMMENT_CLOSE.length;
			if (!isInCode(start)) {
				scriptBlocks.push({
					content: source.slice(contentStart, closeStart),
					start,
					end,
				});
			}
			searchFrom = end;
			continue;
		}

		// Value marker: <!--mdeval followed by a space.
		if (nextChar === ' ') {
			const exprStart = afterTag + 1;
			const exprEnd = source.indexOf(COMMENT_CLOSE, exprStart);
			if (exprEnd === -1) {
				if (isInCode(start)) {
					break;
				}
				throw new Error(
					`mdeval: unclosed marker open at offset ${start} (missing \`-->\` on the marker open)`,
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
				if (isInCode(start)) {
					searchFrom = contentStart;
					continue;
				}
				throw new Error(
					`mdeval: unclosed marker open at offset ${start} (missing \`<!--/mdeval-->\`)`,
				);
			}
			const markerEnd = closeStart + MARKER_CLOSE.length;
			if (!isInCode(start)) {
				markers.push({
					expression: source.slice(exprStart, exprEnd),
					start,
					end: markerEnd,
				});
			}
			searchFrom = markerEnd;
			continue;
		}

		// Not a script or marker — advance past the tag and keep looking.
		searchFrom = afterTag;
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
	if (scriptBlocks.length === 0 && markers.length === 0) {
		return false;
	}

	const ranges = [
		...scriptBlocks.map((block): [number, number] => [block.start, block.end]),
		...markers.map((marker): [number, number] => [marker.start, marker.end]),
	].sort((a, b) => a[0] - b[0]);

	let cursor = 0;
	for (const [start, end] of ranges) {
		if (source.slice(cursor, start).trim() !== '') {
			return false;
		}
		cursor = end;
	}
	return source.slice(cursor).trim() === '';
};
