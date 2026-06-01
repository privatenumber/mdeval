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

	test('AST walk and HTML backstop agree on count for known constructs', () => {
		// Cross-checks that the MDAST walk doesn't miss anything the HTML
		// stringification finds — i.e. no `unrecognized context` leaks
		// surface for constructs we already understand.
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
});
