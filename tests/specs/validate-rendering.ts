import { describe, test, expect } from 'manten';
import { findRenderedLeaks } from '../../src/validate-rendering/index.ts';

describe('validate-rendering', () => {
	test('marker outside any code construct does not leak', () => {
		const leaks = findRenderedLeaks('Value: <!--mdeval x-->42<!--/mdeval-->.');
		expect(leaks).toStrictEqual([]);
	});

	test('marker plain inside a table cell does not leak', () => {
		// GFM treats inline raw HTML (including comments) the same way in
		// table cells as in paragraphs, so this should NOT warn.
		const source = '| a | b |\n|---|---|\n| <!--mdeval x-->42<!--/mdeval--> | y |';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('source with no marker text at all short-circuits', () => {
		expect(findRenderedLeaks('# Just markdown\n\nNothing to see.')).toStrictEqual([]);
	});

	test('inline code marker leaks once per opening tag', () => {
		const source = '`<!--mdeval x-->42<!--/mdeval-->`';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
		expect(leaks[0].line).toBe(1);
	});

	test('inline code marker leaks inside a table cell', () => {
		// The case that motivated the feature: backticks wrap the marker
		// inside a GFM table cell, mdeval skips it (correctly per its
		// code-skip rule), and on GitHub the comment text appears verbatim
		// inside the `<code>` element.
		const source = '| v |\n|---|\n| `<!--mdeval x-->¥1<!--/mdeval-->` |';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
		expect(leaks[0].line).toBe(3);
	});

	test('fenced code block (backtick) marker leaks', () => {
		const source = '```\n<!--mdeval x-->42<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
		expect(leaks[0].line).toBe(2);
		expect(leaks[0].column).toBe(1);
	});

	test('fenced code block (tilde) marker leaks', () => {
		const source = '~~~\n<!--mdeval x-->42<!--/mdeval-->\n~~~';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
	});

	test('nested fenced code (outer four-backtick, inner three-backtick) leaks once', () => {
		const source = '````\n```\n<!--mdeval x-->42<!--/mdeval-->\n```\n````';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
	});

	test('fenced code block with language tag still leaks', () => {
		const source = '```js\n<!--mdeval x-->42<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
	});

	test('indented code block marker leaks', () => {
		// Four-space indent inside a list item or after a blank line makes
		// this an indented code block in CommonMark.
		const source = 'Before.\n\n    <!--mdeval x-->42<!--/mdeval-->\n\nAfter.';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
	});

	test('multiple markers in the same fenced block produce multiple leaks', () => {
		const source = '```\n<!--mdeval a-->1<!--/mdeval-->\n<!--mdeval b-->2<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(2);
		expect(leaks[0].kind).toBe('code block');
		expect(leaks[1].kind).toBe('code block');
		expect(leaks[0].line).toBe(2);
		expect(leaks[1].line).toBe(3);
	});

	test('mix of leaky and non-leaky markers in the same source', () => {
		const source = [
			'Plain: <!--mdeval x-->42<!--/mdeval-->',
			'Inline: `<!--mdeval x-->42<!--/mdeval-->`',
		].join('\n');
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
		expect(leaks[0].line).toBe(2);
	});

	test('closing tag alone is not counted as a leak', () => {
		// Only the opening `<!--mdeval` prefix counts. A stray closing tag
		// is malformed and would have been caught by parse-markdown earlier;
		// we don't double-warn.
		const source = '`<!--/mdeval-->`';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('source positions point at the construct containing the marker', () => {
		// Positions identify the line containing the leak (and the column
		// of the wrapping construct, not the exact byte offset of the
		// marker inside it). Reviewers open the file at that line and
		// the marker is visible on the same line.
		const source = 'Line one.\nLine two: `<!--mdeval x-->42<!--/mdeval-->`';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].line).toBe(2);
	});

	test('known constructs together produce only known-kind leaks', () => {
		// No `unrecognized context` should surface for constructs we already
		// understand — this guards against the AST walk silently degrading
		// into the fallback path.
		const source = [
			'`<!--mdeval a-->1<!--/mdeval-->`',
			'```',
			'<!--mdeval b-->2<!--/mdeval-->',
			'```',
			'',
			'    <!--mdeval c-->3<!--/mdeval-->',
		].join('\n');
		const leaks = findRenderedLeaks(source);
		expect(leaks.every(leak => leak.kind !== 'text')).toBe(true);
		expect(leaks).toHaveLength(3);
	});

	test('non-marker prefix in code block is not a leak', () => {
		// `<!--mdevaluation-->` and `<!--mdevalfoo-->` are not mdeval
		// markers (parseMarkdown rejects them). Validation must use the
		// same marker-opening predicate or it will false-positive on
		// any code example that happens to contain the substring.
		const sources = [
			'`<!--mdevaluation-->`',
			'`<!--mdevalfoo-->`',
			'```\n<!--mdevaluation-->\n```',
			'    <!--mdevaluation-->',
		];
		for (const source of sources) {
			expect(findRenderedLeaks(source)).toStrictEqual([]);
		}
	});

	test('marker followed by LF (no trailing space) inside fenced code still counts', () => {
		// A real marker can open at end-of-line — the predicate accepts LF
		// or CRLF after `<!--mdeval`, not just space.
		const source = '```\n<!--mdeval\nconst x = 1;\n-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
	});

	test('backslash-escaped opener in a paragraph is flagged as unrecognized context', () => {
		// `\<` makes the `<` a literal text character in CommonMark, so the
		// opener ends up in a text node rather than an html node. It still
		// renders visibly on GitHub. Caught via the text-node branch.
		const source = String.raw`\<!--mdeval x-->y<!--/mdeval-->`;
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('text');
		expect(leaks[0].line).toBe(1);
	});

	test('character-reference-escaped opener is flagged as unrecognized context', () => {
		// `&lt;` decodes to a literal `<` in the rendered text. The mdast
		// text node's value contains the decoded `<!--mdeval ...`, even
		// though no `<!--mdeval` literal appears in source.
		const source = '&lt;!--mdeval x-->y<!--/mdeval-->';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('text');
		expect(leaks[0].line).toBe(1);
	});

	test('marker in fenced-code info string is not a leak', () => {
		// The opening fence line (lang + meta) is not part of the rendered
		// code body. A marker-shaped substring there must not flag.
		const source = '```js <!--mdeval foo-->bar\nconst x = 1;\n```';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker still flagged when present in both fence-info AND code body', () => {
		// The info string is skipped, but markers in the actual code body
		// are still caught.
		const source = '```js <!--mdeval foo-->\n<!--mdeval x-->1<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('code block');
		expect(leaks[0].line).toBe(2);
	});

	test('text node with decoded-then-literal openers reports both at correct columns', () => {
		// Inverse ordering: entity-encoded marker FIRST, then literal
		// backslash-escaped one. The decoded `a` opener is at column 1,
		// the literal `b` opener is later. Both must warn at their actual
		// columns — pure value-walk handles this regardless of order.
		const source = String.raw`&lt;!--mdeval a-->y \<!--mdeval b-->z`;
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(2);
		const columns = leaks.map(leak => leak.column).sort((a, b) => a - b);
		expect(columns[0]).toBeLessThan(columns[1]);
	});

	test('marker in a raw HTML attribute on any element is flagged', () => {
		// A marker in an attribute value can never become an HTML comment
		// (`<!--` isn't comment syntax inside an attribute), so it's always
		// a leak — regardless of tag or whether the attribute is visible.
		const source = '<span alt="<!--mdeval x-->old<!--/mdeval-->">text</span>';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('text node with both source-visible and decoded openers reports both at correct columns', () => {
		// One leak's source bytes contain `<!--mdeval` literally (the
		// backslash-escaped form); the other only appears after CommonMark
		// decodes `&lt;` to `<`. Both render visibly, both must warn —
		// and the decoded one must report a column AFTER the literal one,
		// not at the text-node start.
		const source = String.raw`\<!--mdeval a-->y &lt;!--mdeval b-->z`;
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(2);
		expect(leaks.every(leak => leak.kind === 'text')).toBe(true);
		const columns = leaks.map(leak => leak.column).sort((a, b) => a - b);
		expect(columns[0]).toBeLessThan(columns[1]);
	});

	test('marker in image alt text is flagged as image alt leak', () => {
		// Image alt becomes an HTML attribute value. The marker chars
		// appear as literal text visible to screen readers and image-
		// fallback rendering.
		const source = '![<!--mdeval description-->Photo<!--/mdeval-->](photo.png)';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('image alt');
	});

	test('marker in image title attribute is flagged as image title leak', () => {
		const source = '![Photo](photo.png "<!--mdeval caption-->A photo<!--/mdeval-->")';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('image title');
	});

	test('marker in link title attribute is flagged as link title leak', () => {
		const source = '[Click](https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->")';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('link title');
	});

	test('marker in link text is not a leak (HTML comment is preserved and stripped)', () => {
		// CommonMark recognizes the comment inside link text as inline raw
		// HTML, producing an `<a>` with literal `<!--...-->` markers inside.
		// GitHub's sanitizer strips HTML comments, so readers see only the
		// link's visible text without marker syntax.
		const source = '[<!--mdeval label-->Old<!--/mdeval-->](https://example.com)';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in reference-style image alt is flagged', () => {
		// `![alt][ref]` + `[ref]: url` produces an `imageReference` node,
		// not `image`. Same attribute-escape mechanism as inline images.
		const source = '![<!--mdeval description-->Photo<!--/mdeval-->][img]\n\n[img]: photo.png';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('image alt');
	});

	test('marker in used reference definition title is flagged at the link reference', () => {
		// Definition title becomes the `<a title>` attribute on whichever
		// linkReference points at it. Reported at the reference (the
		// rendered tooltip location), not the definition source.
		const source = '[Click][ref]\n\n[ref]: https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->"';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('link title');
	});

	test('marker in used reference definition title is flagged at the image reference', () => {
		const source = '![Photo][img]\n\n[img]: photo.png "<!--mdeval caption-->A photo<!--/mdeval-->"';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('image title');
	});

	test('marker in unused reference definition title is not flagged', () => {
		// Unused definitions render nothing, so a marker in the title is
		// invisible to readers. Don't warn.
		const source = 'No references here.\n\n[unused]: https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->"';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in raw HTML attribute value is flagged as raw html leak', () => {
		// Raw HTML tags pass through to the DOM unmodified. A marker
		// inside an attribute value renders as literal text visible in
		// the attribute.
		const source = '<img alt="<!--mdeval caption-->old<!--/mdeval-->" src="x.png">';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('mdeval marker tags themselves are not raw-html leaks', () => {
		// `<!--mdeval x-->...<!--/mdeval-->` outside any code becomes two
		// `html` nodes whose values are standalone HTML comments. Those
		// are stripped by GitHub's sanitizer and must not warn.
		const source = '<!--mdeval x-->old<!--/mdeval-->';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker inside a raw HTML block as a real HTML comment is not a leak', () => {
		// `<div>` wraps the marker but the marker delimiters are valid HTML
		// comments; the renderer strips them. False positive guard.
		const source = '<div>\n<!--mdeval x-->old<!--/mdeval-->\n</div>';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in single-quoted raw HTML attribute is also a leak', () => {
		const source = "<img alt='<!--mdeval cap-->old<!--/mdeval-->' src='x.png'>";
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('entity-escaped marker in raw HTML attribute is flagged', () => {
		// `&lt;!--mdeval ...` decodes to a visible `<!--mdeval ...` at
		// render time because HTML entity decoding happens after comment
		// recognition.
		const source = '<img alt="&lt;!--mdeval cap-->old<!--/mdeval-->" src="x.png">';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('entity-escaped marker in raw HTML text content is flagged', () => {
		// `<div>&lt;!--...</div>` — same story for text content of raw HTML
		// blocks. The entity-encoded form bypasses comment recognition.
		const source = '<div>&lt;!--mdeval x-->old<!--/mdeval--></div>';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('hex and decimal entity forms are also detected', () => {
		const sources = [
			'<img alt="&#x3C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#x3c;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#60;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
		];
		for (const source of sources) {
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('raw html');
		}
	});

	test('marker inside referenced footnote definition is flagged', () => {
		// `[^a]` references the definition, so its rendered content is
		// reachable — markers inside leak.
		const source = 'See [^a].\n\n[^a]: `<!--mdeval x-->old<!--/mdeval-->`';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
	});

	test('marker inside unreferenced footnote definition is not flagged', () => {
		// No `[^a]` reference exists; GitHub doesn't render the definition.
		// Marker inside is invisible to readers.
		const source = '[^a]: `<!--mdeval x-->old<!--/mdeval-->`';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('backticks in adjacent table cells do not form a phantom code span', () => {
		// GFM parses cells separately, so a lone backtick in one cell and a
		// marker-then-backtick in the next are NOT a single inline-code
		// span. The marker is a comment in its own cell and is stripped.
		// Without table parsing, the `|` would be swallowed into a phantom
		// span and the marker falsely flagged.
		const source = '| h1 | h2 |\n|---|---|\n| ` | <!--mdeval x-->old<!--/mdeval-->` |';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in a real table cell code span is still flagged', () => {
		// Sanity: table parsing doesn't suppress genuine leaks. A marker
		// inside inline code within a single cell still leaks.
		const source = '| h1 | h2 |\n|---|---|\n| a | `<!--mdeval x-->old<!--/mdeval-->` |';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
		expect(leaks[0].line).toBe(3);
	});

	test('marker on a later line of a multi-line inline code span reports the marker line', () => {
		// Inline code normalizes source newlines to spaces in the rendered
		// value, so position must come from the source, not the value. The
		// marker is on source line 2.
		const source = '`foo\nbar <!--mdeval x-->old<!--/mdeval-->`';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('inline code');
		expect(leaks[0].line).toBe(2);
	});

	test('marker in href/src/class/data attributes are all flagged', () => {
		// The leak rule is "didn't become a comment", not "is visible to a
		// reader". A marker in any attribute is stranded literal text:
		// `href`/`src` break the link/image, `class`/`data-*` pollute the
		// value. All leak.
		const sources = [
			'<a href="<!--mdeval url-->https://example.com<!--/mdeval-->">link</a>',
			'<img src="<!--mdeval path-->x.png<!--/mdeval-->">',
			'<span class="<!--mdeval x-->old<!--/mdeval-->">text</span>',
			'<div data-value="<!--mdeval x-->old<!--/mdeval-->">text</div>',
		];
		for (const source of sources) {
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('raw html');
		}
	});

	test('entity-encoded marker on a later line of markdown paragraph reports the marker line', () => {
		// Same multi-line position-handling as raw HTML, but for plain
		// markdown text where `&lt;!--mdeval` decodes to a visible marker.
		const source = 'First line.\nSecond line: &lt;!--mdeval x-->old<!--/mdeval-->\n';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].line).toBe(2);
	});

	test('entity-encoded marker on a later line of raw HTML text reports the marker line', () => {
		// `<div>\n&lt;!--mdeval x-->...\n</div>` — the marker only exists
		// in the text-node value after entity decoding. parse5 gives us
		// the text node's start position; per-marker line:column comes
		// from walking the decoded value. Should warn at line 2 (the
		// `&lt;` line), not line 1 (the `<div>` line).
		const source = '<div>\n&lt;!--mdeval x-->old<!--/mdeval-->\n</div>';
		const leaks = findRenderedLeaks(source).filter(leak => leak.kind === 'raw html');
		expect(leaks).toHaveLength(1);
		expect(leaks[0].line).toBe(2);
	});

	test('marker in raw HTML inside unreferenced footnote is not flagged', () => {
		// Same rule, raw-HTML variant: `mdast-util-to-hast` drops the
		// unreferenced footnote body during conversion, so the raw HTML
		// never reaches the rendered hast tree and the marker isn't
		// visible to readers.
		const source = '[^a]: <img alt="<!--mdeval x-->old<!--/mdeval-->" src="x.png">';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('duplicate footnote definition uses the first; later marker-laden duplicate does not leak', () => {
		// GFM renders only the FIRST body for any given footnote
		// identifier, even when duplicates follow.
		const source = 'See [^a].\n\n[^a]: safe.\n[^a]: `<!--mdeval bad-->bad<!--/mdeval-->`';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('uppercase named less-than entity is detected', () => {
		const source = '<img alt="&LT;!--mdeval x-->old<!--/mdeval-->" src="x.png">';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('raw html');
	});

	test('uppercase-X hex entity and zero-padded forms are detected', () => {
		const sources = [
			'<img alt="&#X3C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#X3c;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#x003C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#00060;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<div>&#X3C;!--mdeval x-->old<!--/mdeval--></div>',
		];
		for (const source of sources) {
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('raw html');
		}
	});

	test('semicolonless legacy entity forms are detected', () => {
		// HTML5 parser still decodes `&lt`, `&LT`, `&#60`, `&#x3C` when
		// they are not followed by a continuation character (alphanumeric
		// or `=` for named; digit for numeric).
		const sources = [
			'<img alt="&lt!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&LT!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#60!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			'<img alt="&#x3C!--mdeval x-->old<!--/mdeval-->" src="x.png">',
		];
		for (const source of sources) {
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('raw html');
		}
	});

	test('semicolonless `&lt` followed by alphanumeric is NOT an entity (and not a leak)', () => {
		// `&lta...` would be parsed as a different named reference attempt,
		// not as `&lt`. So no marker opener exists here.
		const source = '<img alt="&ltabc" src="x.png">';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in link destination position is not a leak (markers become real HTML comments)', () => {
		// `[text](<!--mdeval url-->...<!--/mdeval-->)` breaks link parsing,
		// but the marker tags themselves are parsed as standalone HTML
		// comments (`html` mdast nodes whose value starts with `<!--`).
		// GitHub's sanitizer strips those — the visible result is just
		// `[text](...)` text with the URL auto-linked. The marker syntax
		// is NOT visible to readers, so no leak warning.
		const source = '[text](<!--mdeval url-->https://example.com<!--/mdeval-->)';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('marker in image destination position is not a leak (same as link destination)', () => {
		const source = '![alt](<!--mdeval src-->image.png<!--/mdeval-->)';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('duplicate reference definition uses the first; later marker-laden duplicate does not leak', () => {
		// CommonMark resolves `[x][ref]` against the FIRST `[ref]:` line.
		// A marker on a later duplicate is unreachable at the use site.
		const source = '[x][ref]\n\n[ref]: /a "safe"\n[ref]: /b "<!--mdeval bad-->bad<!--/mdeval-->"';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});

	test('single-line fence with marker only in info string and no body is not a leak', () => {
		// An unclosed empty fence at EOF (`` ```js <!--mdeval foo-->``)
		// has no rendered code body. The info string isn't rendered, so
		// no warning.
		const source = '```js <!--mdeval foo-->';
		expect(findRenderedLeaks(source)).toStrictEqual([]);
	});
});
