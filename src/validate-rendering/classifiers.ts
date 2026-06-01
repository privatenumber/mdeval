import type { Parent } from 'unist';
import type { LeakKind, WalkNode } from './types.ts';

// Pick a kind for a text-node leak based on the ancestor element chain.
// `<pre>` wraps fenced and indented code blocks (which render identically),
// so they collapse to one `code block` kind. `<code>` outside `<pre>` is an
// inline code span. Anything else is plain visible text — only reachable
// via an escape mechanism (backslash, character reference, etc), since
// well-placed markers in normal text become real HTML comments and never
// appear in a text node.
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
