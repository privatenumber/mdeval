import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit, SKIP } from 'unist-util-visit';
import { COMMENT_TAG } from './parse-markdown.ts';

export type LeakKind =
	| 'inline code'
	| 'fenced code'
	| 'indented code'
	| 'image alt'
	| 'image title'
	| 'link title'
	| 'raw html'
	| 'unrecognized context';

export type RenderedLeak = {
	kind: LeakKind;
	line: number;
	column: number;
	offset: number;
};

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

// Mirror parseMarkdown's marker-opening predicate (`<!--mdeval` followed by
// space, LF, or CRLF). Strings like `<!--mdevaluation-->` or `<!--mdevalfoo`
// are not markers and must not be flagged. Operates on either source or a
// decoded text-node value — the rule is identical.
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

const findMarkerOpeningsInRange = (
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
		if (isMarkerOpening(source, found)) {
			offsets.push(found);
		}
		cursor = found + COMMENT_TAG.length;
	}
	return offsets;
};

// MDAST uses a single `code` node type for both fenced and indented blocks.
// Indented blocks always start with a space or tab character at the node's
// source offset; fenced blocks start with `` ` `` or `~`.
const fencedOrIndented = (
	source: string,
	startOffset: number,
): 'fenced code' | 'indented code' => {
	const firstChar = source[startOffset];
	return (firstChar === ' ' || firstChar === '\t') ? 'indented code' : 'fenced code';
};

// Fenced code blocks include the opening fence line in their source range,
// but the info string after the fence (lang + meta) is not part of the
// rendered code body. Skip past the first newline so the scan doesn't
// false-positive on markers that appear only in the meta string (e.g.
// ` ```js <!--mdeval foo` ). When the fence has no newline before its end
// — e.g. an unclosed empty fence at EOF — there's no rendered body at all,
// so return an empty range.
const renderedCodeRange = (
	source: string,
	startOffset: number,
	endOffset: number,
	kind: 'fenced code' | 'indented code',
): [number, number] => {
	if (kind !== 'fenced code') {
		return [startOffset, endOffset];
	}
	const firstNewline = source.indexOf('\n', startOffset);
	if (firstNewline === -1 || firstNewline >= endOffset) {
		return [startOffset, startOffset];
	}
	return [firstNewline + 1, endOffset];
};

const collectCodeLeaks = (
	source: string,
	startOffset: number,
	endOffset: number,
	kind: 'inline code' | 'fenced code' | 'indented code',
): RenderedLeak[] => {
	const [scanStart, scanEnd] = kind === 'inline code'
		? [startOffset, endOffset]
		: renderedCodeRange(source, startOffset, endOffset, kind);
	return findMarkerOpeningsInRange(source, scanStart, scanEnd).map((offset) => {
		const { line, column } = offsetToLineColumn(source, offset);
		return {
			kind,
			line,
			column,
			offset,
		};
	});
};

const countMarkerOpeningsInValue = (value: string): number => {
	let count = 0;
	let cursor = 0;
	while (cursor < value.length) {
		const at = value.indexOf(COMMENT_TAG, cursor);
		if (at === -1) {
			break;
		}
		if (isMarkerOpening(value, at)) {
			count += 1;
		}
		cursor = at + COMMENT_TAG.length;
	}
	return count;
};

// Raw HTML nodes pass through to the rendered DOM untouched. Markers inside
// them only leak when they appear in a position the HTML parser treats as
// verbatim text:
//
// - Inside an HTML comment (`<!--...-->`): the renderer strips the comment.
//   NOT a leak. This includes mdeval marker tags themselves, which are
//   syntactically valid HTML comments.
// - In text content (between tags) where the marker takes the shape of a
//   well-formed comment (`<!--mdeval x-->...<!--/mdeval-->`): also stripped
//   by the renderer's HTML-comment recognition. NOT a leak.
// - Inside a quoted attribute value (`="..."` or `='...'`): attribute values
//   are not comment-parsed, so the marker characters become literal text
//   visible in the rendered DOM via the attribute (alt text, title tooltip,
//   etc). LEAK.
//
// A small state machine walks the raw HTML and returns positions of marker
// openings that fall inside quoted attribute values. Unquoted attribute
// values and HTML5 corner cases (CDATA, etc) aren't handled — those are
// rare in mdeval-touched documents and a full HTML parser would be the
// right answer if they show up in practice.
type HtmlScanState = 'outside_tag' | 'inside_tag' | 'attr_dq' | 'attr_sq';

const INSIDE_TAG_TRANSITIONS: Record<string, HtmlScanState | undefined> = {
	'>': 'outside_tag',
	'"': 'attr_dq',
	'\'': 'attr_sq',
};

// Match an HTML character reference at `position` that decodes to `<`,
// returning its source length (or 0 if no such reference is present).
// Handles every valid form:
// - Named: `&lt;` and `&LT;` (HTML5 has both for backward compat with HTML4)
// - Hex: `&#x3C;`, `&#X3c;`, `&#x003C;` (any case for the `x`/`X` and hex
//   digit, any number of leading zeros)
// - Decimal: `&#60;`, `&#060;`, `&#00060;` (any number of leading zeros)
const matchHtmlLessThan = (text: string, position: number): number => {
	if (text.startsWith('&lt;', position) || text.startsWith('&LT;', position)) {
		return 4;
	}
	if (text[position] !== '&' || text[position + 1] !== '#') {
		return 0;
	}
	let cursor = position + 2;
	const hex = text[cursor] === 'x' || text[cursor] === 'X';
	if (hex) {
		cursor += 1;
	}
	const digitsStart = cursor;
	while (cursor < text.length) {
		const ch = text[cursor];
		const isDigit = hex
			? (ch >= '0' && ch <= '9')
				|| (ch >= 'a' && ch <= 'f')
				|| (ch >= 'A' && ch <= 'F')
			: ch >= '0' && ch <= '9';
		if (!isDigit) {
			break;
		}
		cursor += 1;
	}
	if (cursor === digitsStart || text[cursor] !== ';') {
		return 0;
	}
	const codePoint = Number.parseInt(text.slice(digitsStart, cursor), hex ? 16 : 10);
	if (codePoint !== 0x3C) {
		return 0;
	}
	return cursor + 1 - position;
};

// When a marker opener is encoded via an HTML character reference (e.g.
// `&lt;!--mdeval x-->`), the HTML parser sees the entity (not a `<!--`), so
// the would-be comment is parsed as plain text; at decode time the entity
// becomes a visible `<` and the marker text renders to the reader. Returns
// the total source length of the entity + `!--mdeval` + predicate suffix,
// or 0 if no encoded opener begins at `position`.
const matchEntityMarkerOpening = (text: string, position: number): number => {
	const ltLength = matchHtmlLessThan(text, position);
	if (ltLength === 0) {
		return 0;
	}
	const afterLt = position + ltLength;
	if (!text.startsWith('!--mdeval', afterLt)) {
		return 0;
	}
	const afterMdeval = afterLt + '!--mdeval'.length;
	const next = text[afterMdeval];
	if (next === ' ' || next === '\n') {
		return afterMdeval - position;
	}
	if (next === '\r' && text[afterMdeval + 1] === '\n') {
		return afterMdeval - position;
	}
	return 0;
};

const findRawHtmlAttributeLeaks = (
	source: string,
	rangeStart: number,
	rangeEnd: number,
): number[] => {
	const leaks: number[] = [];
	let state: HtmlScanState = 'outside_tag';
	let cursor = rangeStart;

	while (cursor < rangeEnd) {
		if (state === 'outside_tag') {
			// Real HTML comments — including marker tags themselves — are
			// stripped at render time. Skip the comment span entirely.
			if (source.startsWith('<!--', cursor)) {
				const end = source.indexOf('-->', cursor + 4);
				cursor = end === -1 || end >= rangeEnd ? rangeEnd : end + 3;
				continue;
			}
			// Entity-encoded openers in text content render as visible
			// `<!--mdeval...` after entity decoding (the literal `<!--`
			// recognition has already passed when entities are decoded).
			const entityLength = matchEntityMarkerOpening(source, cursor);
			if (entityLength > 0) {
				leaks.push(cursor);
				cursor += entityLength;
				continue;
			}
			if (source[cursor] === '<') {
				state = 'inside_tag';
			}
			cursor += 1;
			continue;
		}

		if (state === 'inside_tag') {
			const transition = INSIDE_TAG_TRANSITIONS[source[cursor]];
			if (transition) {
				state = transition;
			}
			cursor += 1;
			continue;
		}

		const closingQuote = state === 'attr_dq' ? '"' : '\'';
		if (source[cursor] === closingQuote) {
			state = 'inside_tag';
			cursor += 1;
			continue;
		}
		// Attribute values aren't comment-parsed, so both literal and
		// entity-encoded openers render visibly via the attribute.
		if (source.startsWith(COMMENT_TAG, cursor) && isMarkerOpening(source, cursor)) {
			leaks.push(cursor);
			cursor += COMMENT_TAG.length;
			continue;
		}
		const entityLength = matchEntityMarkerOpening(source, cursor);
		if (entityLength > 0) {
			leaks.push(cursor);
			cursor += entityLength;
			continue;
		}
		cursor += 1;
	}

	return leaks;
};

// HTML-attribute values (image alt, image title, link title) become literal
// text in the rendered DOM — attribute values aren't HTML-comment-processed.
// A marker in alt text is visible to screen readers and image-fallback
// rendering; a title shows in browser tooltips. Source positions for
// attribute leaks are approximate (the wrapping node's start) because mdast
// stores attribute values as plain strings without per-character positions.
const collectAttributeLeaks = (
	source: string,
	startOffset: number,
	attributeValue: string | null | undefined,
	kind: LeakKind,
): RenderedLeak[] => {
	if (!attributeValue) {
		return [];
	}
	const count = countMarkerOpeningsInValue(attributeValue);
	if (count === 0) {
		return [];
	}
	const { line, column } = offsetToLineColumn(source, startOffset);
	return Array.from({ length: count }, () => ({
		kind,
		line,
		column,
		offset: startOffset,
	}));
};

// Text nodes contain visible-rendered content. A marker opening here means
// some escape mechanism kept CommonMark from parsing the opener as inline
// HTML (`\<!--mdeval` via backslash escape, `&lt;!--mdeval` via character
// reference, or a future construct that yields verbatim text). The opener
// still renders visibly to the reader and we surface it as `unrecognized
// context`.
//
// We need to report every opening that appears in the rendered output. Some
// openings exist in source bytes (e.g. `\<!--mdeval` — the backslash escapes
// the `<` but the literal `<!--mdeval` still appears in source); these get
// exact source positions. Others exist only after decoding (e.g.
// `&lt;!--mdeval` — the literal substring isn't in source); these get the
// text node's start position as a best-effort pointer. A single text node
// can contain both, so we count value openings independently of source
// openings and emit one warning per value opening, attaching exact positions
// to as many as source matched.
const collectTextLeaks = (
	source: string,
	startOffset: number,
	endOffset: number,
	value: string,
): RenderedLeak[] => {
	const valueOpeningCount = countMarkerOpeningsInValue(value);
	if (valueOpeningCount === 0) {
		return [];
	}

	const sourceOffsets = findMarkerOpeningsInRange(source, startOffset, endOffset);
	const leaks: RenderedLeak[] = sourceOffsets.map((offset) => {
		const { line, column } = offsetToLineColumn(source, offset);
		return {
			kind: 'unrecognized context',
			line,
			column,
			offset,
		};
	});

	const approximatePosition = offsetToLineColumn(source, startOffset);
	for (let index = sourceOffsets.length; index < valueOpeningCount; index += 1) {
		leaks.push({
			kind: 'unrecognized context',
			line: approximatePosition.line,
			column: approximatePosition.column,
			offset: startOffset,
		});
	}
	return leaks;
};

// Find every `<!--mdeval` opening that ends up visible in the rendered output
// on GitHub.
//
// CommonMark recognizes raw HTML comments in normal inline and block
// positions, so a well-placed marker becomes an `html` node and is stripped
// by GitHub's sanitizer — invisible. The cases where it leaks visibly:
//
// 1. `inlineCode` (`...`) — content is verbatim text; the marker chars are
//    HTML-escaped and shown to the reader inside `<code>`.
// 2. `code` (fenced or indented) — same verbatim treatment, wrapped in
//    `<pre><code>`.
// 3. `text` nodes containing `<!--mdeval ...` — see `collectTextLeaks`.
// 4. `image.alt`, `image.title`, `link.title` — inline link/image HTML
//    attribute values, see `collectAttributeLeaks`. Link children (link
//    text) are NOT a leak: inline HTML inside `<a>` is preserved as a real
//    HTML comment and sanitized by GitHub.
// 5. `imageReference.alt` and reference definition titles used by
//    `linkReference` / `imageReference` — same attribute-escape mechanism
//    as inline links/images, just via reference syntax.
export const findRenderedLeaks = (source: string): RenderedLeak[] => {
	// Broader predicate than `COMMENT_TAG` because encoded forms — `\<!--`
	// (backslash escape) and `&lt;!--` (character reference) — won't contain
	// the literal `<!--mdeval` substring but still produce visible markers
	// in the rendered output via the text-node fallback path.
	if (!source.includes('mdeval')) {
		return [];
	}

	const tree = unified().use(remarkParse).use(remarkGfm).parse(source);

	// Pre-pass: collect identifiers of referenced GFM footnotes. Unreferenced
	// footnote definitions are not rendered by GitHub, so any marker inside
	// their subtree is invisible — and warning on them is a false positive.
	const referencedFootnotes = new Set<string>();
	visit(tree, 'footnoteReference', (node) => {
		referencedFootnotes.add((node as { identifier: string }).identifier);
	});

	// Pre-pass: index the FIRST reference definition's title by identifier.
	// CommonMark resolves references against the first definition for any
	// given label even if duplicates follow, so a later definition with a
	// marker-laden title doesn't actually render anywhere. Empty-string
	// entries are kept for first-seen definitions with no useful title, so
	// a later duplicate doesn't overwrite the canonical first.
	//
	// Lets reference-style link/image leaks be reported at the reference's
	// use site (where the tooltip / alt actually renders) rather than at
	// the definition source. Unused definitions don't render anything and
	// are never queried.
	const definitionTitles = new Map<string, string>();
	visit(tree, 'definition', (node) => {
		const definition = node as { identifier: string;
			title?: string | null; };
		if (definitionTitles.has(definition.identifier)) {
			return;
		}
		definitionTitles.set(definition.identifier, definition.title ?? '');
	});

	const leaks: RenderedLeak[] = [];

	// Track which referenced footnote definitions we've already walked into.
	// GFM renders only the first body for any given footnote identifier,
	// even if duplicates follow — same rule as duplicate `[ref]:` lines.
	const renderedFootnoteDefinitions = new Set<string>();

	visit(tree, (node) => {
		// Skip the subtree of any footnote definition that GitHub wouldn't
		// render: unreferenced definitions, and duplicates of a referenced
		// identifier whose first occurrence is the canonical body.
		if (node.type === 'footnoteDefinition') {
			const definition = node as { identifier: string };
			if (!referencedFootnotes.has(definition.identifier)) {
				return SKIP;
			}
			if (renderedFootnoteDefinitions.has(definition.identifier)) {
				return SKIP;
			}
			renderedFootnoteDefinitions.add(definition.identifier);
		}

		const startOffset = node.position?.start.offset;
		const endOffset = node.position?.end.offset;
		if (startOffset === undefined || endOffset === undefined) {
			return;
		}

		switch (node.type) {
			case 'inlineCode': {
				leaks.push(...collectCodeLeaks(source, startOffset, endOffset, 'inline code'));
				break;
			}
			case 'code': {
				const kind = fencedOrIndented(source, startOffset);
				leaks.push(...collectCodeLeaks(source, startOffset, endOffset, kind));
				break;
			}
			case 'text': {
				const { value } = node as { value: string };
				leaks.push(...collectTextLeaks(source, startOffset, endOffset, value));
				break;
			}
			case 'image': {
				const image = node as {
					alt: string | null;
					title: string | null;
				};
				leaks.push(
					...collectAttributeLeaks(source, startOffset, image.alt, 'image alt'),
					...collectAttributeLeaks(source, startOffset, image.title, 'image title'),
				);
				break;
			}
			case 'link': {
				const link = node as { title: string | null };
				leaks.push(...collectAttributeLeaks(source, startOffset, link.title, 'link title'));
				break;
			}
			case 'imageReference': {
				// imageReference carries its own alt; the title (if any)
				// comes from the referenced definition.
				const reference = node as { alt: string | null;
					identifier: string; };
				const referencedTitle = definitionTitles.get(reference.identifier);
				leaks.push(
					...collectAttributeLeaks(source, startOffset, reference.alt, 'image alt'),
					...collectAttributeLeaks(source, startOffset, referencedTitle, 'image title'),
				);
				break;
			}
			case 'linkReference': {
				// Link text comes from children (visited recursively, see
				// case 4 in the docstring above for why link text is not a
				// leak). The title comes from the referenced definition.
				const reference = node as { identifier: string };
				const referencedTitle = definitionTitles.get(reference.identifier);
				leaks.push(
					...collectAttributeLeaks(source, startOffset, referencedTitle, 'link title'),
				);
				break;
			}
			case 'html': {
				// Raw HTML: only markers inside quoted attribute values
				// leak. Comments and text-content markers are stripped or
				// recognized-as-comments by the renderer.
				for (const offset of findRawHtmlAttributeLeaks(source, startOffset, endOffset)) {
					const { line, column } = offsetToLineColumn(source, offset);
					leaks.push({
						kind: 'raw html',
						line,
						column,
						offset,
					});
				}
				break;
			}
			// Other node types don't contribute to the leak surface.
			// `definition` nodes themselves don't render — their data only
			// surfaces via linkReference/imageReference, handled above.
			default:
		}
	});

	return leaks;
};
