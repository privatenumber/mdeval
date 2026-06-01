import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { COMMENT_TAG } from './parse-markdown.ts';

export type LeakKind = 'inline code' | 'fenced code' | 'indented code' | 'unrecognized context';

export type RenderedLeak = {
	kind: LeakKind;
	line: number;
	column: number;
	offset: number;
};

type Position = {
	line: number;
	column: number;
};

const offsetToLineColumn = (source: string, offset: number): Position => {
	let line = 1;
	let column = 1;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return {
		line,
		column,
	};
};

// Mirror parseMarkdown's marker-opening predicate (`<!--mdeval` followed by
// space, LF, or CRLF). Strings like `<!--mdevaluation-->` or `<!--mdevalfoo`
// are not markers and must not be flagged. Operates on either source or a
// decoded text-node value — the rule is identical.
const isMarkerOpening = (text: string, position: number): boolean => {
	if (!text.startsWith(COMMENT_TAG, position)) {
		return false;
	}
	const after = text[position + COMMENT_TAG.length];
	if (after === ' ' || after === '\n') {
		return true;
	}
	return after === '\r' && text[position + COMMENT_TAG.length + 1] === '\n';
};

const findMarkerOpeningsInRange = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const offsets: number[] = [];
	let cursor = rangeStart;
	while (cursor < rangeEnd) {
		const found = source.indexOf(COMMENT_TAG, cursor);
		if (found === -1 || found >= rangeEnd) {
			break;
		}
		if (isMarkerOpening(source, found)) {
			offsets.push(found);
		}
		cursor = found + COMMENT_TAG.length;
	}
	return offsets;
};

// MDAST uses a single `code` node type for both fenced and indented blocks.
// Indented blocks always start with a space or tab character at the node's
// source offset; fenced blocks start with `` ` `` or `~`.
const fencedOrIndented = (
	source: string,
	startOffset: number,
): 'fenced code' | 'indented code' => {
	const firstChar = source[startOffset];
	return (firstChar === ' ' || firstChar === '\t') ? 'indented code' : 'fenced code';
};

const collectCodeLeaks = (
	source: string,
	startOffset: number,
	endOffset: number,
	kind: 'inline code' | 'fenced code' | 'indented code',
): RenderedLeak[] => findMarkerOpeningsInRange(source, startOffset, endOffset)
	.map((offset) => {
		const { line, column } = offsetToLineColumn(source, offset);
		return {
			kind,
			line,
			column,
			offset,
		};
	});

// Text nodes contain visible-rendered content. A marker opening here means
// some escape mechanism kept CommonMark from parsing the opener as inline
// HTML (`\<!--mdeval` via backslash escape, `&lt;!--mdeval` via character
// reference, or a future construct that yields verbatim text). The opener
// still renders visibly to the reader and we surface it as `unrecognized
// context`.
//
// Try source bytes first: when no escape mechanism is in play, source and
// the text node's value byte-align and we get an exact source offset. The
// fallback scans the (decoded) value — line-accurate, column points at the
// text run start because the per-opener source position is shifted by an
// unknown amount.
const collectTextLeaks = (
	source: string,
	startOffset: number,
	endOffset: number,
	value: string,
): RenderedLeak[] => {
	const sourceOffsets = findMarkerOpeningsInRange(source, startOffset, endOffset);
	if (sourceOffsets.length > 0) {
		return sourceOffsets.map((offset) => {
			const { line, column } = offsetToLineColumn(source, offset);
			return {
				kind: 'unrecognized context',
				line,
				column,
				offset,
			};
		});
	}

	const leaks: RenderedLeak[] = [];
	let cursor = 0;
	while (cursor < value.length) {
		const at = value.indexOf(COMMENT_TAG, cursor);
		if (at === -1) {
			break;
		}
		if (isMarkerOpening(value, at)) {
			const { line, column } = offsetToLineColumn(source, startOffset);
			leaks.push({
				kind: 'unrecognized context',
				line,
				column,
				offset: startOffset,
			});
		}
		cursor = at + COMMENT_TAG.length;
	}
	return leaks;
};

// Find every `<!--mdeval` opening that ends up visible in the rendered output
// on GitHub.
//
// CommonMark recognizes raw HTML comments in normal inline and block
// positions, so a well-placed marker becomes an `html` node and is stripped
// by GitHub's sanitizer — invisible. The cases where it leaks visibly:
//
// 1. `inlineCode` (`...`) — content is verbatim text; the marker chars are
//    HTML-escaped and shown to the reader inside `<code>`.
// 2. `code` (fenced or indented) — same verbatim treatment, wrapped in
//    `<pre><code>`.
// 3. `text` nodes containing `<!--mdeval ...` — see `collectTextLeaks`.
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	// Broader predicate than `COMMENT_TAG` because encoded forms — `\<!--`
	// (backslash escape) and `&lt;!--` (character reference) — won't contain
	// the literal `<!--mdeval` substring but still produce visible markers
	// in the rendered output via the text-node fallback path.
	if (!source.includes('mdeval')) {
		return [];
	}

	const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
	const leaks: RenderedLeak[] = [];

	visit(tree, (node) => {
		const startOffset = node.position?.start.offset;
		const endOffset = node.position?.end.offset;
		if (startOffset === undefined || endOffset === undefined) {
			return;
		}

		switch (node.type) {
			case 'inlineCode': {
				leaks.push(...collectCodeLeaks(source, startOffset, endOffset, 'inline code'));
				break;
			}
			case 'code': {
				const kind = fencedOrIndented(source, startOffset);
				leaks.push(...collectCodeLeaks(source, startOffset, endOffset, kind));
				break;
			}
			case 'text': {
				const { value } = node as { value: string };
				leaks.push(...collectTextLeaks(source, startOffset, endOffset, value));
				break;
			}
			// Other node types don't contribute to the leak surface.
			default:
		}
	});

	return leaks;
};
