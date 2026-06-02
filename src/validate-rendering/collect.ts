import type { Node } from 'unist';
import type { LeakKind, RenderedLeak, WalkNode } from './types.ts';
import { type Point, advanceByValue } from './line-index.ts';
import { findMarkerLeaks } from './marker.ts';

// Hast text nodes inside fenced code lose position info during conversion,
// so we walk ancestors to find the nearest element with a position to use
// as the source-byte range for the scan.
type PositionRange = {
	startOffset?: number;
	endOffset?: number;
	startLine?: number;
	startColumn?: number;
};

const positionRange = (node: WalkNode, ancestors: readonly Node[]): PositionRange => {
	const candidates: readonly WalkNode[] = [node, ...(ancestors.toReversed() as WalkNode[])];
	for (const candidate of candidates) {
		const start = candidate.position?.start.offset;
		const end = candidate.position?.end.offset;
		if (start !== undefined && end !== undefined) {
			return {
				startOffset: start,
				endOffset: end,
				startLine: candidate.position?.start.line,
				startColumn: candidate.position?.start.column,
			};
		}
	}
	return {};
};

// The text-node `value` is what the renderer will show. The node's source
// range from the ancestor element often covers MORE than the rendered text
// (a fenced-code `<code>` range includes the opening/closing fences and the
// info-string line; an inline-code range includes the surrounding backticks;
// an indented-code range starts at the indent characters). To map a value
// offset back to a real source line/column, we need to find the source
// offset where the rendered content actually starts.
const findContentStart = (
	source: string,
	range: PositionRange,
	kind: LeakKind,
): number | undefined => {
	if (range.startOffset === undefined) {
		return undefined;
	}
	if (kind === 'code block') {
		// Fenced code blocks start with a fence line (` ``` ` or `~~~`,
		// possibly with an info string). The body content begins after
		// the first newline. Indented code blocks have no fence — the
		// indent characters are part of the rendered content range, but
		// the text-node value has them stripped, so we skip them too.
		const firstChar = source[range.startOffset];
		if (firstChar === ' ' || firstChar === '\t') {
			let cursor = range.startOffset;
			while (source[cursor] === ' ' || source[cursor] === '\t') {
				cursor += 1;
			}
			return cursor;
		}
		const newlineIndex = source.indexOf('\n', range.startOffset);
		return newlineIndex === -1 ? range.startOffset : newlineIndex + 1;
	}
	if (kind === 'inline code') {
		// Skip the opening backtick run.
		let cursor = range.startOffset;
		while (source[cursor] === '`') {
			cursor += 1;
		}
		return cursor;
	}
	// Plain text content (escaped paragraph text, etc): the text node's
	// own start IS the content start.
	return range.startOffset;
};

export const collectTextNodeLeaks = (
	source: string,
	point: Point,
	node: WalkNode,
	ancestors: readonly WalkNode[],
	kind: LeakKind,
): RenderedLeak[] => {
	const value = node.value ?? '';
	// Most text nodes don't contain marker text. A cheap substring check
	// short-circuits before the heavier `findMarkerLeaks` scan + the
	// position math.
	if (!value.includes('mdeval')) {
		return [];
	}
	const valueLeaks = findMarkerLeaks(value);
	if (valueLeaks.length === 0) {
		return [];
	}
	const range = positionRange(node, ancestors);
	const contentOffset = findContentStart(source, range, kind);

	// Code constructs (inline, fenced, indented) are verbatim source — no
	// entity decoding or escape processing — so each marker exists literally
	// in the source byte range. Scanning the source gives EXACT line:col,
	// crucially for multi-line spans: inline code normalizes newlines to
	// spaces in the rendered `value`, so value-walking would undercount
	// lines. We only trust source-scan when its count matches the value's
	// (a mismatch means our content-start guess was off — fall back).
	if (
		(kind === 'inline code' || kind === 'code block')
		&& contentOffset !== undefined
		&& range.endOffset !== undefined
	) {
		const sourceLeaks = findMarkerLeaks(source, contentOffset, range.endOffset);
		if (sourceLeaks.length === valueLeaks.length) {
			return sourceLeaks.map((offset) => {
				const { line, column } = point(offset);
				return {
					kind,
					line,
					column,
					offset,
				};
			});
		}
	}

	// Plain text (and the rare code-construct fallback): the value may differ
	// from source (entity decoding, escapes), so walk the decoded value from
	// the content-start position. Uniformly correct across literal markers,
	// entity-decoded markers, and mixed orderings.
	const contentStart = contentOffset === undefined
		? {
			line: range.startLine ?? 1,
			column: range.startColumn ?? 1,
		}
		: point(contentOffset);
	const reportedOffset = contentOffset ?? -1;
	return valueLeaks.map((valueOffset) => {
		const { line, column } = advanceByValue(
			contentStart.line,
			contentStart.column,
			value,
			valueOffset,
		);
		return {
			kind,
			line,
			column,
			offset: reportedOffset,
		};
	});
};

// Attribute values come from the rendering pipeline already decoded, and
// hast doesn't track per-character positions inside `properties`. Best-effort
// pointer is the wrapping element's start position.
export const collectAttributeLeaks = (
	point: Point,
	node: WalkNode,
	value: string,
	kind: LeakKind,
): RenderedLeak[] => {
	if (!value.includes('mdeval')) {
		return [];
	}
	const leakOffsets = findMarkerLeaks(value);
	if (leakOffsets.length === 0) {
		return [];
	}
	const offset = node.position?.start.offset ?? -1;
	const { line, column } = offset === -1
		? {
			line: node.position?.start.line ?? 1,
			column: node.position?.start.column ?? 1,
		}
		: point(offset);
	return leakOffsets.map(() => ({
		kind,
		line,
		column,
		offset,
	}));
};
