import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { toHast } from 'mdast-util-to-hast';
import { visitParents } from 'unist-util-visit-parents';
import type { Node } from 'unist';
import type { RenderedLeak, WalkNode } from './types.ts';
import { buildLineIndex, offsetToLineColumn, type Point } from './line-index.ts';
import { findRawHtmlLeaks } from './raw-html.ts';
import { classifyAttributeLeak, classifyTextLeak } from './classifiers.ts';
import { collectAttributeLeaks, collectTextNodeLeaks } from './collect.ts';

export type { LeakKind, RenderedLeak } from './types.ts';

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
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	if (!source.includes('mdeval')) {
		return [];
	}

	const newlines = buildLineIndex(source);
	const point: Point = offset => offsetToLineColumn(newlines, offset);

	// Only the GFM footnote sub-extension is enabled. mdeval's leak detection
	// doesn't care about tables, strikethrough, autolinks, or task lists —
	// those constructs don't change which markers appear visible. Footnotes
	// matter because `mdast-util-to-hast` needs to drop unreferenced and
	// duplicate footnote bodies from the rendered hast. The full GFM bundle
	// is ~50% more parse cost than just this one piece.
	const mdast = fromMarkdown(source, {
		extensions: [gfmFootnote()],
		mdastExtensions: [gfmFootnoteFromMarkdown()],
	});
	const leaks: RenderedLeak[] = [];

	// Single walk over the rendered hast tree. `toHast` with
	// `allowDangerousHtml: true` preserves raw HTML mdast nodes as hast
	// `raw` nodes — with positions — but only for nodes that survive into
	// the rendered output. Unreferenced and duplicate-shadowed footnote
	// bodies are pruned at this stage, so raw HTML inside them never
	// reaches us. That's the right behavior: GitHub doesn't render those
	// bodies either, and the markers inside aren't visible to readers.
	const hast = toHast(mdast, { allowDangerousHtml: true });

	visitParents(hast as Node, (node, ancestors) => {
		const walkable = node as WalkNode;
		if (walkable.type === 'text' && typeof walkable.value === 'string') {
			const kind = classifyTextLeak(ancestors);
			leaks.push(...collectTextNodeLeaks(source, point, walkable, ancestors, kind));
			return;
		}
		if (walkable.type === 'raw' && typeof walkable.value === 'string') {
			const start = walkable.position?.start.offset;
			const end = walkable.position?.end.offset;
			if (start === undefined || end === undefined) {
				return;
			}
			for (const leak of findRawHtmlLeaks(source, start, end, point)) {
				leaks.push({
					kind: 'raw html',
					...leak,
				});
			}
			return;
		}
		if (walkable.type !== 'element' || !walkable.properties) {
			return;
		}
		// Markdown-derived elements can only carry a marker in `alt` or
		// `title`. A marker in a link/image DESTINATION breaks parsing and
		// becomes a comment node instead of reaching `href`/`src` (so it's
		// not a leak). Raw HTML — where a marker can land in any attribute
		// (`href`, `src`, `class`, ...) — is a `raw` node handled above via
		// parse5, not here. So this short allowlist is complete, not a
		// deviation from the "any attribute leaks" rule.
		for (const attribute of ['alt', 'title']) {
			const value = walkable.properties[attribute];
			if (typeof value === 'string') {
				const kind = classifyAttributeLeak(walkable, attribute);
				leaks.push(...collectAttributeLeaks(point, walkable, value, kind));
			}
		}
	});

	return leaks;
};
