import { parseFragment } from 'parse5';
import { findMarkerLeaks } from './marker.ts';
import { advanceByValue, type Point } from './line-index.ts';

// Raw HTML scanning via parse5 (the WHATWG-spec parser): it decodes entities
// (`&lt;`, `&#x3C;`, `&#60;`, semicolonless `&lt`), distinguishes comments
// from text, and with `sourceCodeLocationInfo` keeps source positions.
//
// A marker that doesn't become an HTML comment leaks. Inside raw HTML it can
// only land in two non-comment places, and we flag both:
// - Text content: parse5 emits `#comment` for real comments and `#text` for
//   everything else, so scanning `#text` skips legitimate comments for free.
// - Attribute values: `<!--` is never comment syntax in an attribute, so a
//   marker there is always literal. We scan every attribute — there's no
//   attribute where a stranded `<!--mdeval ...-->` is intended.
type Parse5Node = {
	nodeName: string;
	tagName?: string;
	value?: string;
	attrs?: { name: string;
		value: string; }[];
	childNodes?: Parse5Node[];
	sourceCodeLocation?: {
		startOffset?: number;
		endOffset?: number;
		attrs?: Record<string, { startOffset: number } | undefined>;
	};
};

type RawHtmlLeakPosition = {
	line: number;
	column: number;
};

// Markers in attribute values. Attribute values have no per-character source
// positions, so the best-effort pointer is the attribute's start offset.
const attributeLeaks = (
	node: Parse5Node,
	rangeStart: number,
	point: Point,
): RawHtmlLeakPosition[] => {
	if (!node.attrs || !node.sourceCodeLocation?.attrs) {
		return [];
	}
	const leaks: RawHtmlLeakPosition[] = [];
	for (const attribute of node.attrs) {
		const location = node.sourceCodeLocation.attrs[attribute.name];
		if (!location) {
			continue;
		}
		const offset = rangeStart + location.startOffset;
		const { line, column } = point(offset);
		for (const _ of findMarkerLeaks(attribute.value)) {
			leaks.push({
				line,
				column,
			});
		}
	}
	return leaks;
};

// Markers in text content. parse5 emits `#comment` for real comments and
// `#text` for everything else, so legitimate comments are skipped for free.
// The text value is already entity-decoded, so positions come from walking
// the value (see `advanceByValue`).
const textLeaks = (
	node: Parse5Node,
	rangeStart: number,
	point: Point,
): RawHtmlLeakPosition[] => {
	const { value } = node;
	if (
		node.nodeName !== '#text'
		|| typeof value !== 'string'
		|| node.sourceCodeLocation?.startOffset === undefined
	) {
		return [];
	}
	const textStartOffset = rangeStart + node.sourceCodeLocation.startOffset;
	const textStart = point(textStartOffset);
	return findMarkerLeaks(value).map((valueOffset) => {
		const { line, column } = advanceByValue(textStart.line, textStart.column, value, valueOffset);
		return {
			line,
			column,
		};
	});
};

export const findRawHtmlLeaks = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
	point: Point,
): RawHtmlLeakPosition[] => {
	const fragment = source.slice(rangeStart, rangeEnd);
	const tree = parseFragment(fragment, {
		sourceCodeLocationInfo: true,
	}) as unknown as Parse5Node;

	const leaks: RawHtmlLeakPosition[] = [];
	const visit = (node: Parse5Node): void => {
		leaks.push(
			...attributeLeaks(node, rangeStart, point),
			...textLeaks(node, rangeStart, point),
		);
		for (const child of node.childNodes ?? []) {
			visit(child);
		}
	};
	visit(tree);
	return leaks;
};
