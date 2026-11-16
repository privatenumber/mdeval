import { describe, test, expect } from 'manten';
import { findRenderedLeaks } from '../../src/find-rendered-leaks.ts';

const opening = (line: number, column: number) => ({
	delimiter: '<!--mdeval',
	line,
	column,
});

const closing = (line: number, column: number) => ({
	delimiter: '<!--/mdeval-->',
	line,
	column,
});

describe('findRenderedLeaks', () => {
	describe('not reported', () => {
		const cases = [
			['no mdeval syntax', '# Just markdown\n\nNothing to see.'],
			['marker in a paragraph', 'Value: <!--mdeval x-->42<!--/mdeval-->.'],
			['marker on its own line', '<!--mdeval x-->old<!--/mdeval-->'],
			['script block', '<!--mdeval\nconst x = 1;\n-->'],
			['marker in a table cell', '| a | b |\n|---|---|\n| <!--mdeval x-->42<!--/mdeval--> | y |'],
			['backticks in adjacent table cells', '| h1 | h2 |\n|---|---|\n| ` | <!--mdeval x-->old<!--/mdeval-->` |'],
			// A destination cannot contain a space, so this is text, not a link
			['marker after link text', '[text](<!--mdeval url-->https://example.com<!--/mdeval-->)'],
			['marker in link text', '[<!--mdeval label-->Old<!--/mdeval-->](https://example.com)'],
			['marker in a raw HTML block', '<div>\n<!--mdeval x-->old<!--/mdeval-->\n</div>'],
			['delimiters inside another comment', '<!-- example: <!--mdeval x--> and <!--/mdeval-->'],
			['lone closing tag that renders as a comment', 'a <!--/mdeval--> b'],
			['non-marker prefix in code', '`<!--mdevaluation-->`\n\n```\n<!--mdevalfoo-->\n```'],
			// GitHub's tagfilter escapes these tags, so their text is parsed as HTML
			// and the marker renders as a comment
			...['textarea', 'title', 'style', 'script', 'iframe'].map(tag => [
				`marker inside <${tag}>`,
				`<${tag}><!--mdeval 1-->x<!--/mdeval--></${tag}>`,
			]),
			// An escaped opening is how a document shows the syntax as text
			['entity-encoded opening', '&lt;!--mdeval x-->y<!--/mdeval-->'],
			['entity-encoded opening in raw HTML text', '<div>&#X3C;!--mdeval x-->old<!--/mdeval--></div>'],
		];
		for (const [name, source] of cases) {
			test(name, () => {
				expect(findRenderedLeaks(source)).toStrictEqual([]);
			});
		}
	});

	describe('code', () => {
		const blocks = [
			['backtick fence', '```\n<!--mdeval x-->42<!--/mdeval-->\n```', 2],
			['tilde fence', '~~~\n<!--mdeval x-->42<!--/mdeval-->\n~~~', 2],
			['fence with a language', '```js\n<!--mdeval x-->42<!--/mdeval-->\n```', 2],
			['nested fence', '````\n```\n<!--mdeval x-->42<!--/mdeval-->\n```\n````', 3],
		] as const;
		for (const [name, source, line] of blocks) {
			test(`marker in a ${name} is one leak`, () => {
				expect(findRenderedLeaks(source)).toStrictEqual([opening(line, 1)]);
			});
		}

		test('indented code block', () => {
			expect(findRenderedLeaks('Before.\n\n    <!--mdeval x-->42<!--/mdeval-->\n\nAfter.')).toStrictEqual([opening(3, 5)]);
		});

		test('each marker in a block is reported', () => {
			const source = '```\n<!--mdeval a-->1<!--/mdeval-->\n<!--mdeval b-->2<!--/mdeval-->\n```';
			expect(findRenderedLeaks(source)).toStrictEqual([opening(2, 1), opening(3, 1)]);
		});

		test('script block opening in code', () => {
			expect(findRenderedLeaks('```\n<!--mdeval\nconst x = 1;\n-->\n```')).toStrictEqual([opening(2, 1)]);
		});

		test('fence info string', () => {
			// GitHub puts the info string in a class name, so the comment never renders
			expect(findRenderedLeaks('```js <!--mdeval foo-->\n<!--mdeval x-->1<!--/mdeval-->\n```')).toStrictEqual([opening(1, 7), opening(2, 1)]);
		});

		test('inline code', () => {
			expect(findRenderedLeaks('Line one.\nLine two: `<!--mdeval x-->42<!--/mdeval-->`')).toStrictEqual([opening(2, 12)]);
		});

		test('inline code in a table cell', () => {
			expect(findRenderedLeaks('| h1 | h2 |\n|---|---|\n| a | `<!--mdeval x-->old<!--/mdeval-->` |')).toStrictEqual([opening(3, 8)]);
		});

		test('only the marker in code is reported', () => {
			expect(findRenderedLeaks('Plain: <!--mdeval x-->42<!--/mdeval-->\nInline: `<!--mdeval x-->42<!--/mdeval-->`')).toStrictEqual([opening(2, 10)]);
		});

		test('lone closing tag in code', () => {
			expect(findRenderedLeaks('`<!--/mdeval-->`')).toStrictEqual([closing(1, 2)]);
		});

		test('closing tag in code after a live opening', () => {
			expect(findRenderedLeaks('Text <!--mdeval x-->a`<!--/mdeval--> b `c`')).toStrictEqual([closing(1, 23)]);
		});

		test('backslash-escaped opening shows the delimiter as text', () => {
			expect(findRenderedLeaks(String.raw`\<!--mdeval x-->y<!--/mdeval-->`)).toStrictEqual([opening(1, 2)]);
		});
	});

	describe('attributes and URLs', () => {
		const cases = [
			['image alt', '![<!--mdeval description-->Photo<!--/mdeval-->](photo.png)', [opening(1, 3)]],
			['image title', '![Photo](photo.png "<!--mdeval caption-->A photo<!--/mdeval-->")', [opening(1, 21)]],
			['link title', '[Click](https://example.com "<!--mdeval tooltip-->Hover<!--/mdeval-->")', [opening(1, 30)]],
			['reference definition title', '[x][ref]\n\n[ref]: /url "<!--mdeval x-->old<!--/mdeval-->"', [opening(3, 14)]],
			// Markers here never run, even though GitHub does not show the definition
			['unused reference definition title', 'Text.\n\n[ref]: /url "<!--mdeval x-->old<!--/mdeval-->"', [opening(3, 14)]],
			['raw HTML attribute', '<img alt="<!--mdeval caption-->old<!--/mdeval-->" src="x.png">', [opening(1, 11)]],
			// The encoded opening is text, but the closing tag is still in the attribute
			['entity-encoded opening in an attribute', '<img alt="&lt;!--mdeval cap-->old<!--/mdeval-->" src="x.png">', [closing(1, 34)]],
		] as const;
		for (const [name, source, leaks] of cases) {
			test(name, () => {
				expect(findRenderedLeaks(source)).toStrictEqual(leaks);
			});
		}
	});

	describe('positions', () => {
		for (const [name, separator] of [['LF', '\n\n'], ['CR', '\r\r'], ['CRLF', '\r\n\r\n'], ['mixed', '\r\n\r']]) {
			test(`${name} line endings`, () => {
				expect(findRenderedLeaks(`x${separator}a \`<!--mdeval 1-->1<!--/mdeval-->\``)).toStrictEqual([opening(3, 4)]);
			});
		}

		test('a BOM does not count as a column', () => {
			expect(findRenderedLeaks('﻿`<!--mdeval x-->old<!--/mdeval-->`\n`<!--mdeval y-->`')).toStrictEqual([opening(1, 2), opening(2, 2)]);
		});
	});
});
