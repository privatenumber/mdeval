import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { toHast } from 'mdast-util-to-hast';
import { visitParents } from 'unist-util-visit-parents';
import type { Node, Parent } from 'unist';
import type { RenderedLeak, WalkNode } from './types.ts';
import { buildLineIndex, offsetToLineColumn, type Point } from './line-index.ts';
import { findRawHtmlLeaks } from './raw-html.ts';
import { classifyAttributeLeak, classifyTextLeak } from './classifiers.ts';
import { collectAttributeLeaks, collectTextNodeLeaks } from './collect.ts';

export type { LeakKind, RenderedLeak } from './types.ts';

// The leak rule applied per hast node type. Each handler returns the leaks
// for that node (empty for non-matching types), so the walk is a flat sum.

// `text` nodes hold rendered visible text. A marker here only exists via a
// code construct or an escape (well-placed markers become comment nodes).
const textNodeLeaks = (
	body: string,
	point: Point,
	node: WalkNode,
	ancestors: readonly Parent[],
): RenderedLeak[] => {
	if (node.type !== 'text' || typeof node.value !== 'string') {
		return [];
	}
	return collectTextNodeLeaks(body, point, node, ancestors, classifyTextLeak(ancestors));
};

// `raw` nodes are unparsed HTML strings (kept verbatim by `toHast` with
// `allowDangerousHtml`, with source positions). parse5 finds markers in their
// attribute values and text content. Only raw nodes that survive into the
// rendered tree reach us — unreferenced/duplicate footnote bodies are already
// pruned by `toHast`.
const rawNodeLeaks = (body: string, point: Point, node: WalkNode): RenderedLeak[] => {
	if (node.type !== 'raw' || typeof node.value !== 'string') {
		return [];
	}
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) {
		return [];
	}
	return findRawHtmlLeaks(body, start, end, point).map(leak => ({
		kind: 'raw html' as const,
		...leak,
	}));
};

// `element` nodes from markdown can only carry a marker in `alt` or `title`.
// A marker in a link/image DESTINATION breaks parsing and becomes a comment
// node rather than reaching `href`/`src`. Raw HTML (where a marker can land
// in any attribute) arrives as a `raw` node, handled above — so this short
// allowlist is complete, not a deviation from the "any attribute" rule.
const elementAttributeLeaks = (point: Point, node: WalkNode): RenderedLeak[] => {
	if (node.type !== 'element' || !node.properties) {
		return [];
	}
	const leaks: RenderedLeak[] = [];
	for (const attribute of ['alt', 'title']) {
		const value = node.properties[attribute];
		if (typeof value === 'string') {
			const kind = classifyAttributeLeak(node, attribute);
			leaks.push(...collectAttributeLeaks(point, node, value, kind));
		}
	}
	return leaks;
};

// Find every `<!--mdeval` delimiter that ends up visible to a reader on
// GitHub.
//
// The rule: a marker that does NOT become an HTML comment node is a leak.
// Well-placed markers in prose parse as comments and GitHub strips them; a
// marker that lands in code, an attribute value, or escaped/entity text
// survives as visible syntax.
//
// `mdast-util-to-hast` does the rendering work that would otherwise be
// special-cased per node type: resolves link/image references against
// definitions, drops unused/duplicate definitions and unreferenced footnote
// bodies, routes fenced-code info strings to `className`, and distinguishes
// comment nodes from text. We then walk the rendered hast once and sum the
// per-node-type leaks.
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	// Fast-path: skip parsing files with no marker. The token is the bare
	// word `mdeval`, NOT `<!--mdeval` — the `<` can be entity-encoded
	// (`&lt;`, `&#60;`, ...) and the closing delimiter is `<!--/mdeval-->`
	// (note the slash). `mdeval` is the only substring common to every form;
	// tightening it would drop entity-encoded and lone-closing leaks.
	if (!source.includes('mdeval')) {
		return [];
	}

	// micromark (and thus mdast/hast) positions are relative to the
	// BOM-stripped stream. Strip a leading BOM so the source we slice, the
	// line index, and every reported offset all share one coordinate space.
	const body = source.codePointAt(0) === 0xFE_FF ? source.slice(1) : source;

	const newlines = buildLineIndex(body);
	const point: Point = offset => offsetToLineColumn(newlines, offset);

	// Two GFM sub-extensions, not the full bundle (which is ~50% more parse
	// cost):
	// - footnote: `mdast-util-to-hast` needs it to drop unreferenced and
	//   duplicate footnote bodies from the rendered hast.
	// - table: `|` is a cell separator that changes inline-code boundaries.
	//   Without table parsing, backticks in adjacent cells can pair into a
	//   phantom code span across the `|`, falsely capturing a marker that
	//   GitHub would parse cell-locally and strip as a comment.
	// Strikethrough, autolinks, and task lists are omitted: they don't move
	// a marker between node types, so they can't change leak detection.
	const mdast = fromMarkdown(body, {
		extensions: [gfmFootnote(), gfmTable()],
		mdastExtensions: [gfmFootnoteFromMarkdown(), gfmTableFromMarkdown()],
	});
	const leaks: RenderedLeak[] = [];

	const hast = toHast(mdast, { allowDangerousHtml: true });

	visitParents(hast as Node, (node, ancestors) => {
		const walkable = node as WalkNode;
		leaks.push(
			...textNodeLeaks(body, point, walkable, ancestors),
			...rawNodeLeaks(body, point, walkable),
			...elementAttributeLeaks(point, walkable),
		);
	});

	return leaks;
};
