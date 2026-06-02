import { describe, test, expect } from 'manten';
import { findRenderedLeaks } from '../../src/validate-rendering/index.ts';

describe('validate-rendering', () => {
	test('source with no marker text at all short-circuits', () => {
		expect(findRenderedLeaks('# Just markdown\n\nNothing to see.')).toStrictEqual([]);
	});

	test('known constructs together produce only known-kind leaks', () => {
		// Guards against the AST walk silently degrading into a `text`
		// fallback for constructs we already understand.
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

	describe('code blocks', () => {
		// Fenced and indented code render the marker verbatim as visible code.
		const cases = [
			{
				name: 'backtick fence',
				source: '```\n<!--mdeval x-->42<!--/mdeval-->\n```',
			},
			{
				name: 'tilde fence',
				source: '~~~\n<!--mdeval x-->42<!--/mdeval-->\n~~~',
			},
			{
				name: 'nested fence leaks once (four-backtick outer, three-backtick inner)',
				source: '````\n```\n<!--mdeval x-->42<!--/mdeval-->\n```\n````',
			},
			{
				name: 'fence with language tag',
				source: '```js\n<!--mdeval x-->42<!--/mdeval-->\n```',
			},
			{
				name: 'indented code block',
				source: 'Before.\n\n    <!--mdeval x-->42<!--/mdeval-->\n\nAfter.',
			},
		];
		for (const { name, source } of cases) {
			test(name, () => {
				const leaks = findRenderedLeaks(source);
				expect(leaks).toHaveLength(1);
				expect(leaks[0].kind).toBe('code block');
			});
		}

		test('reports the marker line and column', () => {
			const leaks = findRenderedLeaks('```\n<!--mdeval x-->42<!--/mdeval-->\n```');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].line).toBe(2);
			expect(leaks[0].column).toBe(1);
		});

		test('multiple markers in the same fence produce multiple leaks', () => {
			const source = '```\n<!--mdeval a-->1<!--/mdeval-->\n<!--mdeval b-->2<!--/mdeval-->\n```';
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(2);
			expect(leaks[0].kind).toBe('code block');
			expect(leaks[1].kind).toBe('code block');
			expect(leaks[0].line).toBe(2);
			expect(leaks[1].line).toBe(3);
		});

		test('marker terminated by LF (script-block open) still counts', () => {
			// The opener predicate accepts LF/CRLF after `<!--mdeval`, not just space.
			const leaks = findRenderedLeaks('```\n<!--mdeval\nconst x = 1;\n-->\n```');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('code block');
		});

		test('marker in the fenced-code info string is not a leak', () => {
			// The opening fence line (lang + meta) is not rendered code body.
			expect(findRenderedLeaks('```js <!--mdeval foo-->bar\nconst x = 1;\n```')).toStrictEqual([]);
		});

		test('marker in both fence-info AND code body flags only the body', () => {
			const leaks = findRenderedLeaks('```js <!--mdeval foo-->\n<!--mdeval x-->1<!--/mdeval-->\n```');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('code block');
			expect(leaks[0].line).toBe(2);
		});

		test('single-line fence with a marker only in the info string and no body is not a leak', () => {
			expect(findRenderedLeaks('```js <!--mdeval foo-->')).toStrictEqual([]);
		});
	});

	describe('inline code', () => {
		test('leaks once per opening tag (open + matched close in one span)', () => {
			const leaks = findRenderedLeaks('`<!--mdeval x-->42<!--/mdeval-->`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
			expect(leaks[0].line).toBe(1);
		});

		test('leaks inside a table cell', () => {
			// The case that motivated the feature: backticks wrap the marker
			// in a GFM table cell; the comment text shows verbatim in `<code>`.
			const leaks = findRenderedLeaks('| v |\n|---|\n| `<!--mdeval x-->¥1<!--/mdeval-->` |');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
			expect(leaks[0].line).toBe(3);
		});

		test('a real table-cell code span is still flagged', () => {
			// Table parsing must not suppress genuine in-cell leaks.
			const leaks = findRenderedLeaks('| h1 | h2 |\n|---|---|\n| a | `<!--mdeval x-->old<!--/mdeval-->` |');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
			expect(leaks[0].line).toBe(3);
		});

		test('a lone closing delimiter visible in code is a leak', () => {
			// Either delimiter rendered as non-comment text leaks.
			const leaks = findRenderedLeaks('`<!--/mdeval-->`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
		});

		test('closing delimiter leaks into a span while its opening stays a comment', () => {
			// The opening renders as a stripped comment; the closing lands in
			// the following inline-code span and shows verbatim.
			const leaks = findRenderedLeaks('Text <!--mdeval x-->a`<!--/mdeval--> b `c`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
		});

		test('marker on a later line of a multi-line span reports the marker line', () => {
			const leaks = findRenderedLeaks('`foo\nbar <!--mdeval x-->old<!--/mdeval-->`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
			expect(leaks[0].line).toBe(2);
		});

		test('only the code-wrapped marker leaks when mixed with a safe one', () => {
			const source = [
				'Plain: <!--mdeval x-->42<!--/mdeval-->',
				'Inline: `<!--mdeval x-->42<!--/mdeval-->`',
			].join('\n');
			const leaks = findRenderedLeaks(source);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
			expect(leaks[0].line).toBe(2);
		});

		test('position points at the line containing the marker', () => {
			const leaks = findRenderedLeaks('Line one.\nLine two: `<!--mdeval x-->42<!--/mdeval-->`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].line).toBe(2);
		});
	});

	describe('escaped & entity text', () => {
		// `\<` and `&lt;` put a literal `<!--mdeval` in a text node (not an
		// HTML comment node), so it renders visibly on GitHub.
		test('backslash-escaped opener', () => {
			const leaks = findRenderedLeaks(String.raw`\<!--mdeval x-->y<!--/mdeval-->`);
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('text');
			expect(leaks[0].line).toBe(1);
		});

		test('character-reference-escaped opener', () => {
			const leaks = findRenderedLeaks('&lt;!--mdeval x-->y<!--/mdeval-->');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('text');
			expect(leaks[0].line).toBe(1);
		});

		test('decoded-then-literal openers report both at correct columns', () => {
			const leaks = findRenderedLeaks(String.raw`&lt;!--mdeval a-->y \<!--mdeval b-->z`);
			expect(leaks).toHaveLength(2);
			const columns = leaks.map(leak => leak.column).sort((a, b) => a - b);
			expect(columns[0]).toBeLessThan(columns[1]);
		});

		test('source-visible and decoded openers report both at correct columns', () => {
			const leaks = findRenderedLeaks(String.raw`\<!--mdeval a-->y &lt;!--mdeval b-->z`);
			expect(leaks).toHaveLength(2);
			expect(leaks.every(leak => leak.kind === 'text')).toBe(true);
			const columns = leaks.map(leak => leak.column).sort((a, b) => a - b);
			expect(columns[0]).toBeLessThan(columns[1]);
		});

		test('entity-encoded marker on a later line of a paragraph reports the marker line', () => {
			const leaks = findRenderedLeaks('First line.\nSecond line: &lt;!--mdeval x-->old<!--/mdeval-->\n');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].line).toBe(2);
		});
	});

	describe('markdown link/image attributes', () => {
		// alt/title become HTML attribute values, so a marker shows as literal text.
		const cases = [
			{
				name: 'image alt',
				kind: 'image alt',
				source: '![<!--mdeval description-->Photo<!--/mdeval-->](photo.png)',
			},
			{
				name: 'image title',
				kind: 'image title',
				source: '![Photo](photo.png "<!--mdeval caption-->A photo<!--/mdeval-->")',
			},
			{
				name: 'link title',
				kind: 'link title',
				source: '[Click](https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->")',
			},
			{
				name: 'reference-style image alt',
				kind: 'image alt',
				source: '![<!--mdeval description-->Photo<!--/mdeval-->][img]\n\n[img]: photo.png',
			},
			{
				name: 'used reference-definition link title',
				kind: 'link title',
				source: '[Click][ref]\n\n[ref]: https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->"',
			},
			{
				name: 'used reference-definition image title',
				kind: 'image title',
				source: '![Photo][img]\n\n[img]: photo.png "<!--mdeval caption-->A photo<!--/mdeval-->"',
			},
		];
		for (const { name, kind, source } of cases) {
			test(name, () => {
				const leaks = findRenderedLeaks(source);
				expect(leaks).toHaveLength(1);
				expect(leaks[0].kind).toBe(kind);
			});
		}
	});

	describe('raw html', () => {
		// Markers inside raw HTML never become comments — they live in
		// attribute values or text content and render verbatim. parse5 decodes
		// every WHATWG entity form (named/hex/decimal, uppercase, zero-padded,
		// semicolonless) before we scan, so all encodings are caught.
		const cases = [
			{
				name: 'double-quoted attribute',
				source: '<img alt="<!--mdeval caption-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'attribute on a non-img element',
				source: '<span alt="<!--mdeval x-->old<!--/mdeval-->">text</span>',
			},
			{
				name: 'single-quoted attribute',
				source: "<img alt='<!--mdeval cap-->old<!--/mdeval-->' src='x.png'>",
			},
			{
				name: 'href attribute',
				source: '<a href="<!--mdeval url-->https://example.com<!--/mdeval-->">link</a>',
			},
			{
				name: 'src attribute',
				source: '<img src="<!--mdeval path-->x.png<!--/mdeval-->">',
			},
			{
				name: 'class attribute',
				source: '<span class="<!--mdeval x-->old<!--/mdeval-->">text</span>',
			},
			{
				name: 'data-* attribute',
				source: '<div data-value="<!--mdeval x-->old<!--/mdeval-->">text</div>',
			},
			{
				name: 'entity &lt; in attribute',
				source: '<img alt="&lt;!--mdeval cap-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'entity &lt; in text content',
				source: '<div>&lt;!--mdeval x-->old<!--/mdeval--></div>',
			},
			{
				name: 'hex entity &#x3C;',
				source: '<img alt="&#x3C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'lowercase hex entity &#x3c;',
				source: '<img alt="&#x3c;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'decimal entity &#60;',
				source: '<img alt="&#60;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'uppercase named entity &LT;',
				source: '<img alt="&LT;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'uppercase-X hex entity &#X3C;',
				source: '<img alt="&#X3C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'uppercase-X lowercase hex entity &#X3c;',
				source: '<img alt="&#X3c;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'zero-padded hex entity &#x003C;',
				source: '<img alt="&#x003C;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'zero-padded decimal entity &#00060;',
				source: '<img alt="&#00060;!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'uppercase-X hex entity in text content',
				source: '<div>&#X3C;!--mdeval x-->old<!--/mdeval--></div>',
			},
			{
				name: 'semicolonless &lt',
				source: '<img alt="&lt!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'semicolonless &LT',
				source: '<img alt="&LT!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'semicolonless &#60',
				source: '<img alt="&#60!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'semicolonless &#x3C',
				source: '<img alt="&#x3C!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
		];
		for (const { name, source } of cases) {
			test(name, () => {
				const leaks = findRenderedLeaks(source);
				expect(leaks).toHaveLength(1);
				expect(leaks[0].kind).toBe('raw html');
			});
		}

		test('BOM-prefixed file is still flagged at the right place', () => {
			// micromark strips a leading BOM; offsets must account for it or the
			// source slice is off by one and parse5 fails to recover the tag.
			const leaks = findRenderedLeaks('\uFEFF<img alt="<!--mdeval x-->old<!--/mdeval-->">');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('raw html');
			expect(leaks[0].line).toBe(1);
		});

		test('entity-encoded marker on a later line of text content reports the marker line', () => {
			const source = '<div>\n&lt;!--mdeval x-->old<!--/mdeval-->\n</div>';
			const leaks = findRenderedLeaks(source).filter(leak => leak.kind === 'raw html');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].line).toBe(2);
		});
	});

	describe('references & footnotes', () => {
		test('referenced footnote definition is flagged', () => {
			// `[^a]` references the definition, so its rendered content leaks.
			const leaks = findRenderedLeaks('See [^a].\n\n[^a]: `<!--mdeval x-->old<!--/mdeval-->`');
			expect(leaks).toHaveLength(1);
			expect(leaks[0].kind).toBe('inline code');
		});

		// Content GitHub never renders (unreferenced/duplicate definitions)
		// must not warn — the marker is invisible to readers.
		const noLeak = [
			{
				name: 'unreferenced footnote definition',
				source: '[^a]: `<!--mdeval x-->old<!--/mdeval-->`',
			},
			{
				name: 'raw HTML in an unreferenced footnote',
				source: '[^a]: <img alt="<!--mdeval x-->old<!--/mdeval-->" src="x.png">',
			},
			{
				name: 'duplicate footnote definition (first body wins)',
				source: 'See [^a].\n\n[^a]: safe.\n[^a]: `<!--mdeval bad-->bad<!--/mdeval-->`',
			},
			{
				name: 'unused reference-definition title',
				source: 'No references here.\n\n[unused]: https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->"',
			},
			{
				name: 'duplicate reference-definition (first wins)',
				source: '[x][ref]\n\n[ref]: /a "safe"\n[ref]: /b "<!--mdeval bad-->bad<!--/mdeval-->"',
			},
		];
		for (const { name, source } of noLeak) {
			test(`not flagged: ${name}`, () => {
				expect(findRenderedLeaks(source)).toStrictEqual([]);
			});
		}
	});

	describe('not a leak', () => {
		// Markers that become real HTML comments (stripped by GitHub),
		// non-marker look-alikes, and parser edge cases must stay silent.
		const cases = [
			{
				name: 'marker outside any code construct',
				source: 'Value: <!--mdeval x-->42<!--/mdeval-->.',
			},
			{
				name: 'bare marker tags become standalone comments',
				source: '<!--mdeval x-->old<!--/mdeval-->',
			},
			{
				name: 'marker as a real comment inside a raw HTML block',
				source: '<div>\n<!--mdeval x-->old<!--/mdeval-->\n</div>',
			},
			{
				name: 'marker in link text',
				source: '[<!--mdeval label-->Old<!--/mdeval-->](https://example.com)',
			},
			{
				name: 'marker in link destination',
				source: '[text](<!--mdeval url-->https://example.com<!--/mdeval-->)',
			},
			{
				name: 'marker in image destination',
				source: '![alt](<!--mdeval src-->image.png<!--/mdeval-->)',
			},
			{
				name: 'plain marker inside a table cell',
				source: '| a | b |\n|---|---|\n| <!--mdeval x-->42<!--/mdeval--> | y |',
			},
			{
				name: 'backticks in adjacent table cells (no phantom span)',
				source: '| h1 | h2 |\n|---|---|\n| ` | <!--mdeval x-->old<!--/mdeval-->` |',
			},
			{
				name: 'non-marker prefix <!--mdevaluation--> in inline code',
				source: '`<!--mdevaluation-->`',
			},
			{
				name: 'non-marker prefix <!--mdevalfoo--> in inline code',
				source: '`<!--mdevalfoo-->`',
			},
			{
				name: 'non-marker prefix in a fenced block',
				source: '```\n<!--mdevaluation-->\n```',
			},
			{
				name: 'non-marker prefix in an indented block',
				source: '    <!--mdevaluation-->',
			},
			{
				name: 'semicolonless &lt followed by alphanumeric is not an entity',
				source: '<img alt="&ltabc" src="x.png">',
			},
		];
		for (const { name, source } of cases) {
			test(name, () => {
				expect(findRenderedLeaks(source)).toStrictEqual([]);
			});
		}
	});
});
