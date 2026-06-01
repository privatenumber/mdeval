import type { Node } from 'unist';
import type { LeakKind, RenderedLeak, WalkNode } from './types.ts';
import { type Point, advanceByValue } from './line-index.ts';
import { findMarkerOpenings } from './marker.ts';

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

// For a text-node leak, prefer the per-marker source offset (gives exact
// `line:col` of each opener inside a code block or escape context). Fall
// back to the node's start position for any leaks that exist only after
// entity decoding (the source bytes don't contain a literal `<!--mdeval`
// then, but the rendered text does).
export const collectTextNodeLeaks = (
	source: string,
	point: Point,
	node: WalkNode,
	ancestors: readonly WalkNode[],
	kind: LeakKind,
): RenderedLeak[] => {
	const value = node.value ?? '';
	// Most text nodes don't contain marker text. A cheap substring check
	// short-circuits before the heavier `findMarkerOpenings` scan + the
	// position math.
	if (!value.includes('mdeval')) {
		return [];
	}
	const valueOpenings = findMarkerOpenings(value);
	if (valueOpenings.length === 0) {
		return [];
	}
	const range = positionRange(node, ancestors);
	const leaks: RenderedLeak[] = [];
	const allSourceOffsets = range.startOffset !== undefined && range.endOffset !== undefined
		? findMarkerOpenings(source, range.startOffset, range.endOffset)
		: [];
	// `valueOpenings.length` is the count of markers that actually render
	// (the text-node value is what GitHub will show). The source range may
	// contain more openings — fenced-code info strings live in the same
	// `<code>` source span but route to `className`, not the body — so we
	// keep only the trailing `valueOpenings.length` source matches. Source
	// order puts info-string markers first, body markers last; the tail is
	// the rendered subset.
	const visibleSourceOffsets = allSourceOffsets.slice(-valueOpenings.length);
	for (const offset of visibleSourceOffsets) {
		const { line, column } = point(offset);
		leaks.push({
			kind,
			line,
			column,
			offset,
		});
	}
	const fallbackCount = valueOpenings.length - visibleSourceOffsets.length;
	if (fallbackCount > 0) {
		// These openings exist in the (decoded) value but not in source
		// bytes — they got there via `&lt;`, `&#x3C;`, etc. We can't map
		// back to a real source offset, but we CAN report the marker's
		// line and column by counting newlines in `value` up to each
		// opening, starting from the range's source position. Without
		// this the warning lands on the text node's first line for every
		// marker, even ones several lines deep.
		const fallbackOffset = range.startOffset ?? -1;
		const startPosition = fallbackOffset === -1
			? {
				line: range.startLine ?? 1,
				column: range.startColumn ?? 1,
			}
			: point(fallbackOffset);
		const fallbackOpenings = valueOpenings.slice(0, fallbackCount);
		for (const valueOffset of fallbackOpenings) {
			const { line, column } = advanceByValue(
				startPosition.line,
				startPosition.column,
				value,
				valueOffset,
			);
			leaks.push({
				kind,
				line,
				column,
				offset: fallbackOffset,
			});
		}
	}
	return leaks;
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
	const openings = findMarkerOpenings(value);
	if (openings.length === 0) {
		return [];
	}
	const offset = node.position?.start.offset ?? -1;
	const { line, column } = offset === -1
		? {
			line: node.position?.start.line ?? 1,
			column: node.position?.start.column ?? 1,
		}
		: point(offset);
	return openings.map(() => ({
		kind,
		line,
		column,
		offset,
	}));
};
