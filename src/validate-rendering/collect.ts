import type { Node } from 'unist';
import type { LeakKind, RenderedLeak, WalkNode } from './types.ts';
import { type Point, type Position, advanceByValue } from './line-index.ts';
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

const rangeOf = (node: WalkNode): PositionRange | undefined => {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) {
		return undefined;
	}
	return {
		startOffset: start,
		endOffset: end,
		startLine: node.position?.start.line,
		startColumn: node.position?.start.column,
	};
};

// The node's own position is best; fall back to the nearest positioned
// ancestor (hast text nodes inside fenced code lose their position during
// conversion). Walks ancestors from innermost out without allocating.
const positionRange = (node: WalkNode, ancestors: readonly Node[]): PositionRange => {
	const own = rangeOf(node);
	if (own) {
		return own;
	}
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const fromAncestor = rangeOf(ancestors[index] as WalkNode);
		if (fromAncestor) {
			return fromAncestor;
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

// Source-scan strategy: each offset is a real source-byte position, so
// `point()` resolves it to an exact line:column.
const mapOffsetsToLeaks = (
	offsets: readonly number[],
	point: Point,
	kind: LeakKind,
): RenderedLeak[] => offsets.map((offset) => {
	const { line, column } = point(offset);
	return {
		kind,
		line,
		column,
	};
});

// Where the rendered content begins, as a (line, column). Falls back to the
// node's own start when there's no usable content offset (position-less nodes).
const resolveContentStart = (
	range: PositionRange,
	contentOffset: number | undefined,
	point: Point,
): Position => (
	contentOffset === undefined
		? {
			line: range.startLine ?? 1,
			column: range.startColumn ?? 1,
		}
		: point(contentOffset)
);

// Value-walk strategy: the decoded value is what renders, but it has no
// per-character source map, so walk it from the content start.
const valueWalkLeaks = (
	value: string,
	valueLeaks: readonly number[],
	contentStart: Position,
	kind: LeakKind,
): RenderedLeak[] => valueLeaks.map((valueOffset) => {
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
	};
});

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
	// position math. Token is the bare word `mdeval` — see the rationale on
	// the gate in `findRenderedLeaks`.
	if (!value.includes('mdeval')) {
		return [];
	}
	const valueLeaks = findMarkerLeaks(value);
	if (valueLeaks.length === 0) {
		return [];
	}
	const range = positionRange(node, ancestors);
	const contentOffset = findContentStart(source, range, kind);

	// Prefer exact source positions: scan the source content range for the
	// same markers. When the count matches the rendered value's, each marker
	// is literal in source (code spans are verbatim; backslash-escaped text
	// keeps a literal `<!--mdeval`), so `point()` gives an exact line:col —
	// including correct lines for multi-line spans, where inline code
	// normalizes newlines to spaces in `value` and value-walking would
	// undercount. A count mismatch means the value diverged from source
	// (entity decoding like `&lt;!--mdeval`, or mixed escaped/decoded
	// orderings) — fall back to walking the decoded value.
	if (contentOffset !== undefined && range.endOffset !== undefined) {
		const sourceLeaks = findMarkerLeaks(source, contentOffset, range.endOffset);
		if (sourceLeaks.length === valueLeaks.length) {
			return mapOffsetsToLeaks(sourceLeaks, point, kind);
		}
	}

	// Fallback: walk the decoded value from the content-start position.
	// Uniformly correct across entity-decoded markers and mixed orderings,
	// at the cost of approximate columns.
	const contentStart = resolveContentStart(range, contentOffset, point);
	return valueWalkLeaks(value, valueLeaks, contentStart, kind);
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
	// Bare-word `mdeval` token — same rationale as `findRenderedLeaks`.
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
	}));
};
