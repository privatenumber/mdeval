import { describe, test, expect } from 'manten';
import { findRenderedLeaks } from '../../src/validate-rendering.ts';

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
		expect(leaks[0]).toStrictEqual({
			kind: 'inline code',
			line: 1,
			column: 2,
			offset: 1,
		});
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
		expect(leaks[0].kind).toBe('fenced code');
		expect(leaks[0].line).toBe(2);
		expect(leaks[0].column).toBe(1);
	});

	test('fenced code block (tilde) marker leaks', () => {
		const source = '~~~\n<!--mdeval x-->42<!--/mdeval-->\n~~~';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('fenced code');
	});

	test('nested fenced code (outer four-backtick, inner three-backtick) leaks once', () => {
		const source = '````\n```\n<!--mdeval x-->42<!--/mdeval-->\n```\n````';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('fenced code');
	});

	test('fenced code block with language tag still leaks', () => {
		const source = '```js\n<!--mdeval x-->42<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('fenced code');
	});

	test('indented code block marker leaks', () => {
		// Four-space indent inside a list item or after a blank line makes
		// this an indented code block in CommonMark.
		const source = 'Before.\n\n    <!--mdeval x-->42<!--/mdeval-->\n\nAfter.';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('indented code');
	});

	test('multiple markers in the same fenced block produce multiple leaks', () => {
		const source = '```\n<!--mdeval a-->1<!--/mdeval-->\n<!--mdeval b-->2<!--/mdeval-->\n```';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(2);
		expect(leaks[0].kind).toBe('fenced code');
		expect(leaks[1].kind).toBe('fenced code');
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

	test('source positions point to the opening of each marker', () => {
		// Line 1: 'Line one.' (9 chars + LF = 10)
		// Line 2: 'Line two: `<!--mdeval...' — the `<!--mdeval` starts at
		// column 12 (after 'Line two: `' which is 11 chars).
		const source = 'Line one.\nLine two: `<!--mdeval x-->42<!--/mdeval-->`';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].line).toBe(2);
		expect(leaks[0].column).toBe(12);
		expect(leaks[0].offset).toBe(source.indexOf('<!--mdeval'));
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
		expect(leaks.every(leak => leak.kind !== 'unrecognized context')).toBe(true);
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
		expect(leaks[0].kind).toBe('fenced code');
	});

	test('backslash-escaped opener in a paragraph is flagged as unrecognized context', () => {
		// `\<` makes the `<` a literal text character in CommonMark, so the
		// opener ends up in a text node rather than an html node. It still
		// renders visibly on GitHub. Caught via the text-node branch.
		const source = String.raw`\<!--mdeval x-->y<!--/mdeval-->`;
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('unrecognized context');
		expect(leaks[0].line).toBe(1);
	});

	test('character-reference-escaped opener is flagged as unrecognized context', () => {
		// `&lt;` decodes to a literal `<` in the rendered text. The mdast
		// text node's value contains the decoded `<!--mdeval ...`, even
		// though no `<!--mdeval` literal appears in source.
		const source = '&lt;!--mdeval x-->y<!--/mdeval-->';
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(1);
		expect(leaks[0].kind).toBe('unrecognized context');
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
		expect(leaks[0].kind).toBe('fenced code');
		expect(leaks[0].line).toBe(2);
	});

	test('text node with both source-visible and decoded openers reports both', () => {
		// One leak's source bytes contain `<!--mdeval` literally (the
		// backslash-escaped form); the other only appears after CommonMark
		// decodes `&lt;` to `<`. Both render visibly, both must warn.
		const source = String.raw`\<!--mdeval a-->y &lt;!--mdeval b-->z`;
		const leaks = findRenderedLeaks(source);
		expect(leaks).toHaveLength(2);
		expect(leaks.every(leak => leak.kind === 'unrecognized context')).toBe(true);
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
