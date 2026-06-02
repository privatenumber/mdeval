import { parseFragment } from 'parse5';
import { findMarkerLeaks } from './marker.ts';
import { advanceByValue, type Point } from './line-index.ts';

// Raw HTML scanning via parse5. parse5 is the WHATWG-spec HTML parser, so
// it handles attribute value extraction, entity decoding (named `&lt;`,
// hex `&#x3C;`, decimal `&#60;`, semicolonless legacy `&lt`), and the
// distinction between comments and text content correctly. With
// `sourceCodeLocationInfo: true` it preserves source positions on every
// node and attribute, so we can point the user at the right line.
//
// The leak rule: a marker that does NOT become an HTML comment is a leak.
// Inside raw HTML there are exactly two non-comment positions a marker can
// land in — text content and attribute values — and we flag both:
//
// - Text content: parse5 gives `#comment` nodes for real `<!--...-->`
//   comments and `#text` nodes for everything else, so scanning `#text`
//   automatically skips legitimate comments.
// - Attribute values: `<!--` is never comment syntax inside an attribute,
//   so a marker there is always literal. We scan EVERY attribute, not an
//   allowlist — `href`/`src` markers break the link/image, `class`/`data-*`
//   markers pollute the value, `alt`/`title` markers show as text. There's
//   no attribute where a stranded `<!--mdeval ...-->` is intended, and
//   mdeval's delimiters are permanent, so this never false-positives.
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
				const location = node.sourceCodeLocation.attrs[attribute.name];
				if (!location) {
					continue;
				}
				const attributeOffset = rangeStart + location.startOffset;
				// Attribute values don't have per-character source
				// positions; best-effort pointer is the attribute's start.
				for (const _ of findMarkerLeaks(attribute.value)) {
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
			const valueLeaks = findMarkerLeaks(node.value);
			if (valueLeaks.length === 0) {
				return;
			}
			const textStartOffset = rangeStart + node.sourceCodeLocation.startOffset;
			const textStart = point(textStartOffset);
			for (const valueOffset of valueLeaks) {
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
