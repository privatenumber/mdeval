import { COMMENT_TAG, MARKER_CLOSE } from '../parse-markdown.ts';

// `<!--mdeval` followed by space, LF, or CRLF is a real marker opening.
// Strings like `<!--mdevalfoo` are not markers and must not be flagged.
// Matches the predicate in `parse-markdown.ts`.
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

// Scan `text` for visible mdeval delimiters within `[start, end)`, returning
// the `<` offset of each leak. Both the opening (`<!--mdeval ...-->`) and the
// closing (`<!--/mdeval-->`) are mdeval syntax, so either rendered as
// non-comment text leaks. To avoid double-counting a fully-leaked marker
// (both delimiters in one string), we balance them: report every opening, but
// a closing only when it has no matching opening earlier in the string (e.g.
// a lone closing whose opening rendered as a stripped comment elsewhere).
export const findMarkerLeaks = (
	text: string,
	start = 0,
	end = text.length,
): number[] => {
	const offsets: number[] = [];
	let depth = 0;
	let cursor = start;
	while (cursor < end) {
		const found = text.indexOf('<!--', cursor);
		if (found === -1 || found >= end) {
			break;
		}
		if (isMarkerOpening(text, found)) {
			offsets.push(found);
			depth += 1;
			cursor = found + COMMENT_TAG.length;
		} else if (text.startsWith(MARKER_CLOSE, found)) {
			if (depth > 0) {
				depth -= 1;
			} else {
				offsets.push(found);
			}
			cursor = found + MARKER_CLOSE.length;
		} else {
			// Some other HTML comment (`<!-- ... -->`); skip past `<!--`.
			cursor = found + '<!--'.length;
		}
	}
	return offsets;
};
