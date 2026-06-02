import type { Parent } from 'unist';
import type { LeakKind, WalkNode } from './types.ts';

// Kind of a text-node leak, from the ancestor chain. `<pre>` wraps fenced and
// indented code (identical rendering) → `code block`; `<code>` alone → inline
// code; anything else is plain `text`, only reachable via an escape (a
// well-placed marker in prose becomes a comment, never a text node).
export const classifyTextLeak = (ancestors: readonly Parent[]): LeakKind => {
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

// `alt` always means image alt text. `title` is shared between `<a>` (link
// title) and `<img>` (image title) — we disambiguate by tag name.
export const classifyAttributeLeak = (node: WalkNode, attribute: string): LeakKind => {
	if (attribute === 'alt') {
		return 'image alt';
	}
	return node.tagName === 'a' ? 'link title' : 'image title';
};
