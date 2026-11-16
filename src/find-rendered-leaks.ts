import { findComments, type Comment } from 'gfm-comments';
import { COMMENT_TAG, MARKER_CLOSE, isOpeningAt } from './parse-markdown.ts';

export type RenderedLeak = {
	delimiter: typeof COMMENT_TAG | typeof MARKER_CLOSE;
	line: number;
	column: number;
};

const delimiterPattern = /<!--(?:mdeval|\/mdeval-->)/g;

// Locates increasing offsets, counting each line break once, so all lookups
// together take O(n)
const createLocator = (source: string) => {
	let line = 1;
	// A BOM is not a column
	let lineStart = source.codePointAt(0) === 0xFE_FF ? 1 : 0;
	let cursor = 0;
	return (offset: number) => {
		for (; cursor < offset; cursor += 1) {
			const character = source[cursor];
			if (character === '\n' || (character === '\r' && source[cursor + 1] !== '\n')) {
				line += 1;
				lineStart = cursor + 1;
			}
		}
		return {
			line,
			column: offset - lineStart + 1,
		};
	};
};

// Returns the comment that contains each increasing offset, if any
const createCommentLookup = (comments: Comment[]) => {
	let index = 0;
	return (offset: number) => {
		while (index < comments.length && comments[index].end <= offset) {
			index += 1;
		}
		const comment = comments[index];
		return comment && comment.start <= offset ? comment : undefined;
	};
};

// Finds mdeval delimiters that GitHub does not render as comments, such as a
// marker in code, in image alt text, or in a link title. GitHub shows or
// encodes them, and mdeval does not run them. A delimiter inside a rendered
// comment is hidden, so it is not reported. Entity-encoded openings such as
// `&lt;!--mdeval` are literal examples, not delimiters.
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	// Both delimiters contain the name
	if (!source.includes('mdeval')) {
		return [];
	}

	const commentAt = createCommentLookup(findComments(source));
	const locate = createLocator(source);
	const leaks: RenderedLeak[] = [];
	// A leaked opening and its closing tag are one leak, such as a whole
	// marker in a code block, so its closing tag is not reported again
	let openingLeaked = false;

	for (const { 0: delimiter, index: offset } of source.matchAll(delimiterPattern)) {
		const isClose = delimiter === MARKER_CLOSE;
		if (!isClose && !isOpeningAt(source, offset)) {
			continue;
		}

		const comment = commentAt(offset);
		if (comment) {
			// A delimiter that starts a rendered comment is live
			if (comment.start === offset) {
				openingLeaked = false;
			}
			continue;
		}

		if (isClose && openingLeaked) {
			openingLeaked = false;
			continue;
		}
		openingLeaked = !isClose;
		leaks.push({
			delimiter: isClose ? MARKER_CLOSE : COMMENT_TAG,
			...locate(offset),
		});
	}

	return leaks;
};
