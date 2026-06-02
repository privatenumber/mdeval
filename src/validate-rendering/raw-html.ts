import { parseFragment } from 'parse5';
import { findMarkerOpenings } from './marker.ts';
import { advanceByValue, type Point } from './line-index.ts';

// HTML attributes whose values render visibly. `title` is a global tooltip
// attribute (visible on hover for any element). `alt` is only visible when
// it lives on an `<img>` — on other tags it's a no-op (or, on `<input>` and
// `<area>`, also visible, but those are rarer). Anything else (`class`,
// `id`, `data-*`, `href`, `src`) is not visible as text and isn't a leak.
const isVisibleAttribute = (tagName: string | undefined, attributeName: string): boolean => {
	if (attributeName === 'title') {
		return true;
	}
	if (attributeName === 'alt') {
		return tagName === 'img' || tagName === 'area' || tagName === 'input';
	}
	return false;
};

// Raw HTML scanning via parse5. parse5 is the WHATWG-spec HTML parser, so
// it handles attribute value extraction, entity decoding (named `&lt;`,
// hex `&#x3C;`, decimal `&#60;`, semicolonless legacy `&lt`), and the
// distinction between comments and text content correctly. With
// `sourceCodeLocationInfo: true` it preserves source positions on every
// node and attribute, so we can point the user at the right line.
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

export type RawHtmlLeakPosition = {
	line: number;
	column: number;
	offset: number;
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
		if (node.attrs && node.sourceCodeLocation?.attrs) {
			for (const attribute of node.attrs) {
				if (!isVisibleAttribute(node.tagName, attribute.name)) {
					continue;
				}
				const location = node.sourceCodeLocation.attrs[attribute.name];
				if (!location) {
					continue;
				}
				const attributeOffset = rangeStart + location.startOffset;
				// Attribute values don't have per-character source
				// positions; best-effort pointer is the attribute's start.
				for (const _ of findMarkerOpenings(attribute.value)) {
					const { line, column } = point(attributeOffset);
					leaks.push({
						line,
						column,
						offset: attributeOffset,
					});
				}
			}
		}
		if (
			node.nodeName === '#text'
			&& typeof node.value === 'string'
			&& node.sourceCodeLocation?.startOffset !== undefined
		) {
			const valueOpenings = findMarkerOpenings(node.value);
			if (valueOpenings.length === 0) {
				return;
			}
			const textStartOffset = rangeStart + node.sourceCodeLocation.startOffset;
			const textStart = point(textStartOffset);
			for (const valueOffset of valueOpenings) {
				const { line, column } = advanceByValue(
					textStart.line,
					textStart.column,
					node.value,
					valueOffset,
				);
				leaks.push({
					line,
					column,
					offset: textStartOffset,
				});
			}
		}
		for (const child of node.childNodes ?? []) {
			visit(child);
		}
	};
	visit(tree);
	return leaks;
};
