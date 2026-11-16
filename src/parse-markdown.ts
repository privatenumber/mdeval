import { findComments, type Comment } from 'gfm-comments';

export type Marker = {
	expression: string;
	start: number;
	end: number;
};

export class MarkdownParseError extends Error {
	readonly offset: number;

	constructor(message: string, offset: number) {
		super(message);
		this.offset = offset;
	}
}

const NAME = 'mdeval';
export const COMMENT_TAG = `<!--${NAME}`;
export const MARKER_OPEN = `${COMMENT_TAG} `;
export const MARKER_CLOSE = `<!--/${NAME}-->`;
export const EXPORT_PREFIX = `__${NAME}_`;
export const COMMENT_CLOSE = '-->';

export const buildExpressionMap = (
	markers: Marker[],
): Map<string, number> => {
	const map = new Map<string, number>();
	for (const { expression } of markers) {
		if (!map.has(expression)) {
			map.set(expression, map.size);
		}
	}
	return map;
};

export type ScriptBlock = {
	content: string;
	contentStart: number;
	start: number;
	end: number;
};

export type ParseResult = {
	scriptBlocks: ScriptBlock[];
	markers: Marker[];
};

// `<!--mdeval` followed by a space, LF, or CRLF opens a marker or script block.
// Strings like `<!--mdevalfoo` are not openings.
export const isOpeningAt = (source: string, position: number): boolean => {
	if (!source.startsWith(COMMENT_TAG, position)) {
		return false;
	}
	const after = source[position + COMMENT_TAG.length];
	return after === ' '
		|| after === '\n'
		|| (after === '\r' && source[position + COMMENT_TAG.length + 1] === '\n');
};

const findNextMdevalOpening = (source: string, from: number): number => {
	let cursor = from;
	while (cursor < source.length) {
		const candidate = source.indexOf(COMMENT_TAG, cursor);
		if (candidate === -1 || isOpeningAt(source, candidate)) {
			return candidate;
		}
		cursor = candidate + COMMENT_TAG.length;
	}
	return -1;
};

const unclosedScriptMessage = (start: number, detail: string) => `mdeval: unclosed script block at offset ${start} (${detail})`;
const unclosedMarkerMessage = (start: number, detail: string) => `mdeval: unclosed marker open at offset ${start} (${detail})`;

// Returns the index of the first rendered comment that is an mdeval opening or
// a `<!--/mdeval-->`, or `comments.length` when there is none.
const findMarkerBoundary = (source: string, comments: Comment[], from: number): number => {
	for (let index = from; index < comments.length; index += 1) {
		const { start, end } = comments[index];
		if (
			isOpeningAt(source, start)
			|| (end - start === MARKER_CLOSE.length && source.startsWith(MARKER_CLOSE, start))
		) {
			return index;
		}
	}
	return comments.length;
};

// Script blocks (`<!--mdeval\n…-->`) and value markers
// (`<!--mdeval expr-->value<!--/mdeval-->`) are found among the comments that
// GitHub renders, so literal syntax examples in code are not active markers.
export const parseMarkdown = (source: string): ParseResult => {
	if (!source.includes(COMMENT_TAG)) {
		return {
			scriptBlocks: [],
			markers: [],
		};
	}

	const comments = findComments(source);
	const scriptBlocks: ScriptBlock[] = [];
	const markers: Marker[] = [];

	for (let index = 0; index < comments.length; index += 1) {
		const { start, end, contentEnd } = comments[index];
		if (!isOpeningAt(source, start)) {
			continue;
		}
		const afterTag = start + COMMENT_TAG.length;
		const nextChar = source[afterTag];

		// A comment that GitHub never closes hides the rest of the page or footnote.
		// Openings that GitHub shows as text, such as examples in code, are not
		// comments, so they are not reported.
		if (contentEnd === end) {
			throw new MarkdownParseError(
				nextChar === ' '
					? unclosedMarkerMessage(start, 'missing `-->` on the marker open')
					: unclosedScriptMessage(start, 'missing `-->`'),
				start,
			);
		}

		// `--!>` also closes a comment on GitHub, but only `-->` closes an opening
		if (!source.startsWith(COMMENT_CLOSE, contentEnd)) {
			continue;
		}

		// Script block: <!--mdeval followed by LF or CRLF. We accept CRLF so
		// files saved on Windows (or via git autocrlf) still parse.
		if (nextChar !== ' ') {
			const contentStart = nextChar === '\n' ? afterTag + 1 : afterTag + 2;
			const nextOpening = findNextMdevalOpening(source, contentStart);
			if (nextOpening !== -1 && nextOpening < contentEnd) {
				throw new MarkdownParseError(
					unclosedScriptMessage(start, 'another mdeval opening found before `-->`'),
					start,
				);
			}
			scriptBlocks.push({
				content: source.slice(contentStart, contentEnd),
				contentStart,
				start,
				end,
			});
			continue;
		}

		// Value marker: <!--mdeval followed by a space. Its value runs to the
		// next rendered closing comment, and comments in the value are skipped.
		const close = findMarkerBoundary(source, comments, index + 1);
		const closing = comments[close];
		if (!closing || isOpeningAt(source, closing.start)) {
			// A `<!--/mdeval-->` that GitHub shows as text or code does not close a
			// marker, such as one after a fence on the same line, which becomes the
			// fence's info string.
			const literal = source.indexOf(MARKER_CLOSE, end);
			throw new MarkdownParseError(
				unclosedMarkerMessage(
					start,
					literal !== -1 && literal < (closing?.start ?? source.length)
						? `\`<!--/mdeval-->\` at offset ${literal} does not render as a comment on GitHub`
						: 'missing `<!--/mdeval-->`',
				),
				start,
			);
		}
		markers.push({
			expression: source.slice(afterTag + 1, contentEnd),
			start,
			end: closing.end,
		});
		index = close;
	}

	return {
		scriptBlocks,
		markers,
	};
};

export const isOnlyMdeval = (
	source: string,
	{ scriptBlocks, markers }: ParseResult,
): boolean => {
	// Marker values render as page content, so only a file of script blocks renders nothing
	if (scriptBlocks.length === 0 || markers.length > 0) {
		return false;
	}

	let cursor = 0;
	for (const block of scriptBlocks) {
		if (source.slice(cursor, block.start).trim() !== '') {
			return false;
		}
		cursor = block.end;
	}
	return source.slice(cursor).trim() === '';
};
