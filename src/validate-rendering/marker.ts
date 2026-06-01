import { COMMENT_TAG } from '../parse-markdown.ts';

// `<!--mdeval` followed by space, LF, or CRLF is a real marker opening.
// Strings like `<!--mdevalfoo` are not markers and must not be flagged.
// Matches the predicate in `parse-markdown.ts`.
export const isMarkerOpening = (text: string, position: number): boolean => {
	if (!text.startsWith(COMMENT_TAG, position)) {
		return false;
	}
	const after = text[position + COMMENT_TAG.length];
	if (after === ' ' || after === '\n') {
		return true;
	}
	return after === '\r' && text[position + COMMENT_TAG.length + 1] === '\n';
};

// Scan `text` for marker openings within the optional `[start, end)` range.
// Returns the offsets of each opening's `<` byte.
export const findMarkerOpenings = (
	text: string,
	start = 0,
	end = text.length,
): number[] => {
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
