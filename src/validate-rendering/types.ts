import type { Node } from 'unist';

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
};

// Structural type covering both mdast and hast nodes. Fields that exist on
// only one tree (`tagName`/`properties` on hast, `value` on either) are
// optional so the same walk callbacks can handle both.
export type WalkNode = Node & {
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: WalkNode[];
};
