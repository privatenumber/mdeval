import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { COMMENT_TAG } from './parse-markdown.ts';

export type LeakKind = 'inline code' | 'fenced code' | 'indented code' | 'unrecognized context';

export type RenderedLeak = {
	kind: LeakKind;
	line: number;
	column: number;
	offset: number;
};

// CommonMark recognizes raw HTML comments in inline and block positions, so a
// well-placed `<!--mdeval ... -->` renders as an HTML comment (and is stripped
// by GitHub's sanitizer). But inline code, fenced code, and indented code
// blocks treat their contents as verbatim text — anything that looks like a
// comment in there ends up HTML-escaped and visible to the reader. Those are
// the constructs we need to walk.

type Position = {
	line: number;
	column: number;
};

const offsetToLineColumn = (source: string, offset: number): Position => {
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

// MDAST uses a single `code` node type for both fenced and indented code
// blocks. The source character distinguishes them: indented code always begins
// with a space or tab (4-space or hard-tab indent), while fenced code begins
// with `, ~, or — for an info-string-prefixed block — with whitespace before
// the fence is impossible because mdast collapses leading indent into the node
// span. We only need to look at the first character of the source range.
const fencedOrIndented = (
	source: string,
	startOffset: number,
): 'fenced code' | 'indented code' => {
	const firstChar = source[startOffset];
	return (firstChar === ' ' || firstChar === '\t') ? 'indented code' : 'fenced code';
};

const findCommentTagOffsets = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const offsets: number[] = [];
	let cursor = rangeStart;
	while (cursor < rangeEnd) {
		const found = source.indexOf(COMMENT_TAG, cursor);
		if (found === -1 || found >= rangeEnd) {
			break;
		}
		offsets.push(found);
		cursor = found + COMMENT_TAG.length;
	}
	return offsets;
};

// Find every `<!--mdeval` that ends up in a rendered-visible position on
// GitHub. The MDAST walk catches the constructs we know about; the HTML
// backstop catches anything we don't — that's the tripwire for the day GFM
// grows a new escape context.
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	if (!source.includes(COMMENT_TAG)) {
		return [];
	}

	const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
	const leaks: RenderedLeak[] = [];

	visit(tree, (node) => {
		const startOffset = node.position?.start.offset;
		const endOffset = node.position?.end.offset;
		if (startOffset === undefined || endOffset === undefined) {
			return;
		}

		let kind: LeakKind | undefined;
		if (node.type === 'inlineCode') {
			kind = 'inline code';
		} else if (node.type === 'code') {
			kind = fencedOrIndented(source, startOffset);
		}
		if (!kind) {
			return;
		}

		for (const offset of findCommentTagOffsets(source, startOffset, endOffset)) {
			const { line, column } = offsetToLineColumn(source, offset);
			leaks.push({
				kind,
				line,
				column,
				offset,
			});
		}
	});

	// Backstop: render the same source to HTML and count escaped `<!--mdeval`
	// occurrences. Anything beyond what the AST walk found lives in a
	// construct we don't yet recognize as an escape context. Surface those as
	// `unrecognized context` so the user has a signal to file a bug — without
	// this, a future GFM extension that escapes its content would silently
	// pass validation.
	const html = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeStringify, { allowDangerousHtml: true })
		.processSync(source)
		.toString();
	const renderedCount = Array.from(html.matchAll(/&lt;!--mdeval\b/g)).length;
	const unaccountedFor = renderedCount - leaks.length;
	for (let index = 0; index < unaccountedFor; index += 1) {
		leaks.push({
			kind: 'unrecognized context',
			line: 0,
			column: 0,
			offset: -1,
		});
	}

	return leaks;
};
