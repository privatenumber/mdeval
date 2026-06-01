import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
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

// HTML state machine for raw HTML mdast nodes. Tracks tag / attribute /
// outside-tag context so we can distinguish text-content `<!--...-->`
// (becomes a real HTML comment, stripped by GitHub) from attribute-value
// `<!--...-->` (literal text inside an attribute, visible via alt/title
// fallback). Entity-encoded openers (`&lt;!--mdeval`, `&LT;`, `&#x3C;`,
// `&#60;`, all-case-variations and HTML5 semicolonless legacy forms) are
// decoded inline because they leak the same way as literal openers in both
// text content and attribute values of raw HTML.
type HtmlScanState = 'outside_tag' | 'inside_tag' | 'attr_dq' | 'attr_sq';

const INSIDE_TAG_TRANSITIONS: Record<string, HtmlScanState | undefined> = {
	'>': 'outside_tag',
	'"': 'attr_dq',
	'\'': 'attr_sq',
};

const matchHtmlLessThan = (text: string, position: number): number => {
	if (text.startsWith('&lt;', position) || text.startsWith('&LT;', position)) {
		return 4;
	}
	if (text.startsWith('&lt', position) || text.startsWith('&LT', position)) {
		const after = text[position + 3];
		const extendsReference = after !== undefined
			&& ((after >= 'a' && after <= 'z')
				|| (after >= 'A' && after <= 'Z')
				|| (after >= '0' && after <= '9')
				|| after === '=');
		if (!extendsReference && after !== undefined) {
			return 3;
		}
	}
	if (text[position] !== '&' || text[position + 1] !== '#') {
		return 0;
	}
	let cursor = position + 2;
	const hex = text[cursor] === 'x' || text[cursor] === 'X';
	if (hex) {
		cursor += 1;
	}
	const digitsStart = cursor;
	while (cursor < text.length) {
		const ch = text[cursor];
		const isDigit = hex
			? (ch >= '0' && ch <= '9')
				|| (ch >= 'a' && ch <= 'f')
				|| (ch >= 'A' && ch <= 'F')
			: ch >= '0' && ch <= '9';
		if (!isDigit) {
			break;
		}
		cursor += 1;
	}
	if (cursor === digitsStart) {
		return 0;
	}
	const codePoint = Number.parseInt(text.slice(digitsStart, cursor), hex ? 16 : 10);
	if (codePoint !== 0x3C) {
		return 0;
	}
	return cursor + (text[cursor] === ';' ? 1 : 0) - position;
};

const matchEntityMarkerOpening = (text: string, position: number): number => {
	const ltLength = matchHtmlLessThan(text, position);
	if (ltLength === 0) {
		return 0;
	}
	const afterLt = position + ltLength;
	if (!text.startsWith('!--mdeval', afterLt)) {
		return 0;
	}
	const afterMdeval = afterLt + '!--mdeval'.length;
	const next = text[afterMdeval];
	if (next === ' ' || next === '\n') {
		return afterMdeval - position;
	}
	if (next === '\r' && text[afterMdeval + 1] === '\n') {
		return afterMdeval - position;
	}
	return 0;
};

const findRawHtmlLeakOffsets = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const offsets: number[] = [];
	let state: HtmlScanState = 'outside_tag';
	let cursor = rangeStart;

	while (cursor < rangeEnd) {
		if (state === 'outside_tag') {
			if (source.startsWith('<!--', cursor)) {
				const end = source.indexOf('-->', cursor + 4);
				cursor = end === -1 || end >= rangeEnd ? rangeEnd : end + 3;
				continue;
			}
			const entityLength = matchEntityMarkerOpening(source, cursor);
			if (entityLength > 0) {
				offsets.push(cursor);
				cursor += entityLength;
				continue;
			}
			if (source[cursor] === '<') {
				state = 'inside_tag';
			}
			cursor += 1;
			continue;
		}

		if (state === 'inside_tag') {
			const transition = INSIDE_TAG_TRANSITIONS[source[cursor]];
			if (transition) {
				state = transition;
			}
			cursor += 1;
			continue;
		}

		const closingQuote = state === 'attr_dq' ? '"' : '\'';
		if (source[cursor] === closingQuote) {
			state = 'inside_tag';
			cursor += 1;
			continue;
		}
		if (source.startsWith(COMMENT_TAG, cursor) && isMarkerOpening(source, cursor)) {
			offsets.push(cursor);
			cursor += COMMENT_TAG.length;
			continue;
		}
		const entityLength = matchEntityMarkerOpening(source, cursor);
		if (entityLength > 0) {
			offsets.push(cursor);
			cursor += entityLength;
			continue;
		}
		cursor += 1;
	}

	return offsets;
};

// Minimal tree walker. Returns SKIP from the callback to prune the subtree
// rooted at the current node. Used for both mdast (one type) and hast
// (another type) trees, hence the structural typing.
const SKIP = Symbol('skip');

type WalkNode = {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	position?: {
		start: { line: number;
			column: number;
			offset?: number; };
	};
	children?: WalkNode[];
};

type WalkCallback = (node: WalkNode, ancestors: readonly WalkNode[]) => void | typeof SKIP;

const walk = (root: WalkNode, callback: WalkCallback): void => {
	const ancestors: WalkNode[] = [];
	const visit = (node: WalkNode): void => {
		if (callback(node, ancestors) === SKIP) {
			return;
		}
		if (!node.children) {
			return;
		}
		ancestors.push(node);
		for (const child of node.children) {
			visit(child);
		}
		ancestors.pop();
	};
	visit(root);
};

const classifyTextLeak = (ancestors: readonly WalkNode[]): LeakKind => {
	let inCode = false;
	for (const ancestor of ancestors) {
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

const positionRange = (node: WalkNode, ancestors: readonly WalkNode[]): PositionRange => {
	const candidates = [node, ...[...ancestors].reverse()];
	for (const candidate of candidates) {
		const start = candidate.position?.start.offset;
		const end = (candidate as { position?: { end?: { offset?: number } } }).position?.end?.offset;
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
	}) as unknown as WalkNode;
	const leaks: RenderedLeak[] = [];

	// Pass 1: raw HTML nodes need source-byte scanning because hast-util-raw
	// would strip positions when re-parsing through parse5. The state machine
	// over the mdast `html` node's source range gives us exact line:column.
	walk(mdast, (node) => {
		if (node.type !== 'html') {
			return;
		}
		const start = node.position?.start.offset;
		const end = (node as { position?: { end?: { offset?: number } } }).position?.end?.offset;
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
	const hast = toHast(mdast as never, { allowDangerousHtml: true }) as unknown as WalkNode;

	walk(hast, (node, ancestors) => {
		if (node.type === 'text' && typeof node.value === 'string') {
			leaks.push(...collectTextNodeLeaks(source, node, ancestors, classifyTextLeak(ancestors)));
			return;
		}
		if (node.type !== 'element' || !node.properties) {
			return;
		}
		for (const attribute of ['alt', 'title']) {
			const value = node.properties[attribute];
			if (typeof value === 'string') {
				const kind = classifyAttributeLeak(node, attribute);
				leaks.push(...collectAttributeLeaks(source, node, value, kind));
			}
		}
	});

	return leaks;
};
