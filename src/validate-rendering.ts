import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { parseFragment } from 'parse5';
import { visitParents } from 'unist-util-visit-parents';
import type { Node, Parent } from 'unist';
import { COMMENT_TAG } from './parse-markdown.ts';

export type LeakKind =
	| 'inline code'
	| 'code block'
	| 'image alt'
	| 'image title'
	| 'link title'
	| 'raw html'
	| 'text';

export type RenderedLeak = {
	kind: LeakKind;
	line: number;
	column: number;
	offset: number;
};

// Find every `<!--mdeval` opening that ends up visible to a reader on GitHub.
//
// The principled definition of "visible": render the markdown the way GitHub
// would and look at the DOM. Markers parsed as HTML comments are stripped
// by GitHub's sanitizer (invisible). Markers as text content of any element,
// or in a visible attribute (`alt` for image fallback / screen readers,
// `title` for hover tooltips), survive.
//
// `mdast-util-to-hast` is the rendering pipeline that does the work that
// would otherwise be special-cased per mdast node type:
//
// - Resolves linkReference / imageReference against definitions.
// - Drops unused definitions and unreferenced or duplicate footnote bodies
//   (only the rendered subset reaches the hast tree).
// - Routes fenced-code info strings to `className`, not the body.
// - Distinguishes comments from text content via dedicated `comment` nodes.
//
// We walk the resulting hast tree for text leaks and visible-attribute leaks.
// Then a second pass over mdast `html` nodes catches raw HTML attribute and
// text-content leaks (`<img alt="...">`, `<div>...</div>`), because
// `hast-util-raw` would strip source positions and leave us unable to point
// at the failing line.

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

const findMarkerOpenings = (text: string, start = 0, end = text.length): number[] => {
	const offsets: number[] = [];
	let cursor = start;
	while (cursor < end) {
		const found = text.indexOf(COMMENT_TAG, cursor);
		if (found === -1 || found >= end) {
			break;
		}
		if (isMarkerOpening(text, found)) {
			offsets.push(found);
		}
		cursor = found + COMMENT_TAG.length;
	}
	return offsets;
};

const offsetToLineColumn = (source: string, offset: number) => {
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

const findRawHtmlLeakOffsets = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const fragment = source.slice(rangeStart, rangeEnd);
	const tree = parseFragment(fragment, { sourceCodeLocationInfo: true }) as unknown as Parse5Node;

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

// The mdast and hast trees we walk are unist-compatible (both extend the
// `Node` interface), so we can use the canonical `visitParents` traversal
// with ancestor tracking. Parse5's tree is a different shape and stays on
// its custom recursive walk inside `findRawHtmlLeakOffsets`.

type WalkNode = Node & {
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: WalkNode[];
};

const classifyTextLeak = (ancestors: readonly Parent[]): LeakKind => {
	let inCode = false;
	for (const ancestor of ancestors as WalkNode[]) {
		if (ancestor.tagName === 'pre') {
			return 'code block';
		}
		if (ancestor.tagName === 'code') {
			inCode = true;
		}
	}
	return inCode ? 'inline code' : 'text';
};

const classifyAttributeLeak = (node: WalkNode, attribute: string): LeakKind => {
	if (attribute === 'alt') {
		return 'image alt';
	}
	return node.tagName === 'a' ? 'link title' : 'image title';
};

// For a text-node leak, prefer the per-marker source offset (gives exact
// `line:col` of each opener inside a code block or escape context). Fall
// back to the node's start position for any leaks that exist only after
// entity decoding (the source bytes don't contain a literal `<!--mdeval`
// then, but the rendered text does).
//
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

const collectTextNodeLeaks = (
	source: string,
	node: WalkNode,
	ancestors: readonly WalkNode[],
	kind: LeakKind,
): RenderedLeak[] => {
	const value = node.value ?? '';
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
		const { line, column } = offsetToLineColumn(source, offset);
		leaks.push({
			kind,
			line,
			column,
			offset,
		});
	}
	const fallbackCount = valueOpenings.length - visibleSourceOffsets.length;
	if (fallbackCount > 0) {
		const fallbackOffset = range.startOffset ?? -1;
		const { line, column } = fallbackOffset === -1
			? {
				line: range.startLine ?? 1,
				column: range.startColumn ?? 1,
			}
			: offsetToLineColumn(source, fallbackOffset);
		for (let index = 0; index < fallbackCount; index += 1) {
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
const collectAttributeLeaks = (
	source: string,
	node: WalkNode,
	value: string,
	kind: LeakKind,
): RenderedLeak[] => {
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
		: offsetToLineColumn(source, offset);
	return openings.map(() => ({
		kind,
		line,
		column,
		offset,
	}));
};

export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	if (!source.includes('mdeval')) {
		return [];
	}

	const mdast = fromMarkdown(source, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
	const leaks: RenderedLeak[] = [];

	// Pass 1: raw HTML nodes get scanned via parse5 on the source range.
	// (`mdast-util-to-hast` would route raw HTML into hast `raw` nodes, and
	// running them through `hast-util-raw` strips source positions, so we
	// keep parse5 invoked directly on the mdast `html` node's source.)
	visitParents(mdast as Node, 'html', (node) => {
		const html = node as WalkNode;
		const start = html.position?.start.offset;
		const end = html.position?.end.offset;
		if (start === undefined || end === undefined) {
			return;
		}
		for (const offset of findRawHtmlLeakOffsets(source, start, end)) {
			const { line, column } = offsetToLineColumn(source, offset);
			leaks.push({
				kind: 'raw html',
				line,
				column,
				offset,
			});
		}
	});

	// Pass 2: walk the hast tree for everything that came from markdown
	// syntax. Reference resolution, footnote skipping, info-string routing,
	// and comment-vs-text discrimination are all handled by the rendering
	// pipeline; we just inspect text-node values and visible attributes.
	const hast = toHast(mdast, { allowDangerousHtml: true });

	visitParents(hast as Node, (node, ancestors) => {
		const walkable = node as WalkNode;
		if (walkable.type === 'text' && typeof walkable.value === 'string') {
			const kind = classifyTextLeak(ancestors);
			leaks.push(...collectTextNodeLeaks(source, walkable, ancestors, kind));
			return;
		}
		if (walkable.type !== 'element' || !walkable.properties) {
			return;
		}
		for (const attribute of ['alt', 'title']) {
			const value = walkable.properties[attribute];
			if (typeof value === 'string') {
				const kind = classifyAttributeLeak(walkable, attribute);
				leaks.push(...collectAttributeLeaks(source, walkable, value, kind));
			}
		}
	});

	return leaks;
};
