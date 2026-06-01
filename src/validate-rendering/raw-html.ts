import { parseFragment } from 'parse5';
import { findMarkerOpenings } from './marker.ts';

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
		attrs?: Record<string, { startOffset: number } | undefined>;
	};
};

export const findRawHtmlLeakOffsets = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const fragment = source.slice(rangeStart, rangeEnd);
	const tree = parseFragment(fragment, {
		sourceCodeLocationInfo: true,
	}) as unknown as Parse5Node;

	const offsets: number[] = [];
	const visit = (node: Parse5Node): void => {
		if (node.attrs && node.sourceCodeLocation?.attrs) {
			for (const attribute of node.attrs) {
				const location = node.sourceCodeLocation.attrs[attribute.name];
				if (!location) {
					continue;
				}
				for (const _ of findMarkerOpenings(attribute.value)) {
					offsets.push(rangeStart + location.startOffset);
				}
			}
		}
		if (
			node.nodeName === '#text'
			&& typeof node.value === 'string'
			&& node.sourceCodeLocation?.startOffset !== undefined
		) {
			for (const _ of findMarkerOpenings(node.value)) {
				offsets.push(rangeStart + node.sourceCodeLocation.startOffset);
			}
		}
		for (const child of node.childNodes ?? []) {
			visit(child);
		}
	};
	visit(tree);
	return offsets;
};
