import { describe, test, expect } from 'manten';
import {
	parseMarkdown, MARKER_OPEN, MARKER_CLOSE, COMMENT_CLOSE,
} from '../../src/parse-markdown.ts';

const markerContent = (
	source: string,
	marker: {
		expression: string;
		start: number;
		end: number;
	},
) => {
	const openLength = MARKER_OPEN.length + marker.expression.length + COMMENT_CLOSE.length;
	const contentStart = marker.start + openLength;
	const contentEnd = marker.end - MARKER_CLOSE.length;
	return source.slice(contentStart, contentEnd);
};

describe('parseMarkdown', () => {
	test('extracts script blocks', () => {
		const source = '<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval\nconst y = 2;\n-->';
		const { scriptBlocks } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([
			{
				content: 'const x = 1;\n',
				start: 0,
				end: 27,
			},
			{
				content: 'const y = 2;\n',
				start: 29,
				end: 56,
			},
		]);
	});

	test('preserves tab indentation in script block content', () => {
		const source = '<!--mdeval\n\tconst x = 1;\n-->';
		const { scriptBlocks } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([
			{
				content: '\tconst x = 1;\n',
				start: 0,
				end: 28,
			},
		]);
	});

	test('preserves CRLF line endings in script blocks', () => {
		const source = '<!--mdeval\r\nconst x = 1;\r\n-->';
		const { scriptBlocks } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([
			{
				content: 'const x = 1;\r\n',
				start: 0,
				end: source.length,
			},
		]);
	});

	test('skips <!--mdeval not followed by space or newline', () => {
		const source = '<!--mdevalfoo--> then <!--mdeval x-->42<!--/mdeval-->';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([]);
		expect(markers).toHaveLength(1);
		expect(markers[0].expression).toBe('x');
	});

	test('extracts value markers', () => {
		const source = 'The value is <!--mdeval x-->42<!--/mdeval-->.';
		const { markers } = parseMarkdown(source);
		expect(markers).toStrictEqual([
			{
				expression: 'x',
				start: 13,
				end: 44,
			},
		]);
		expect(markerContent(source, markers[0])).toBe('42');
	});

	test('extracts multiple markers', () => {
		const source = '<!--mdeval a-->1<!--/mdeval--> and <!--mdeval b-->2<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(2);
		expect(markers[0].expression).toBe('a');
		expect(markers[1].expression).toBe('b');
	});

	test('extracts markers in rich block and inline contexts', () => {
		const sources = [
			'> <!--mdeval x-->42<!--/mdeval-->',
			'- <!--mdeval x-->42<!--/mdeval-->',
			'| a |\n|---|\n| <!--mdeval x-->42<!--/mdeval--> |',
			'[<!--mdeval x-->42<!--/mdeval-->](https://example.com)',
			'**<!--mdeval x-->42<!--/mdeval-->**',
			'<div>\n<!--mdeval x-->42<!--/mdeval-->\n</div>',
		];
		for (const source of sources) {
			const { markers } = parseMarkdown(source);
			expect(markers).toHaveLength(1);
			expect(markers[0].expression).toBe('x');
		}
	});

	test('handles regular HTML comments interleaved with mdeval blocks', () => {
		const source = [
			'<!-- preamble -->',
			'<!--mdeval',
			'const x = 1;',
			'-->',
			'',
			'<!-- between -->',
			'',
			'Value: <!--mdeval x-->old<!--/mdeval-->',
			'',
			'<!-- after -->',
			'',
			'<!--mdeval',
			'const y = 2;',
			'-->',
		].join('\n');
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toHaveLength(2);
		expect(scriptBlocks[0].content).toBe('const x = 1;\n');
		expect(scriptBlocks[1].content).toBe('const y = 2;\n');
		expect(markers).toHaveLength(1);
		expect(markers[0].expression).toBe('x');
	});

	test('preserves regular HTML comments inside marker content', () => {
		const source = '<!--mdeval x-->42 <!-- note --> end<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('42 <!-- note --> end');
	});

	test('ignores content inside code fences', () => {
		const source = '```\n<!--mdeval\nconst x = 1;\n-->\n<!--mdeval x-->42<!--/mdeval-->\n```';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([]);
		expect(markers).toStrictEqual([]);
	});

	test('ignores markers inside nested code fences', () => {
		const source = [
			'````',
			'```',
			'<!--mdeval x-->42<!--/mdeval-->',
			'```',
			'````',
		].join('\n');
		const { markers } = parseMarkdown(source);
		expect(markers).toStrictEqual([]);
	});

	test('throws on unclosed marker followed by another well-formed marker', () => {
		const source = '<!--mdeval a-->some\n\n<!--mdeval b-->42<!--/mdeval-->';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('throws on unclosed marker at EOF', () => {
		const source = 'before <!--mdeval x-->42 no closing tag';
		expect(() => parseMarkdown(source)).toThrow(/offset 7/);
	});

	test('throws on unclosed marker even with non-mdeval HTML comment in content', () => {
		const source = '<!--mdeval x-->some <!-- note --> stuff';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('does not treat <!--mdevalfoo inside marker content as a real opening', () => {
		const source = '<!--mdeval x-->prefix <!--mdevalfoo--> suffix<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markers[0].expression).toBe('x');
		expect(markerContent(source, markers[0])).toBe('prefix <!--mdevalfoo--> suffix');
	});

	test('throws on first of two stacked unclosed opens', () => {
		const source = '<!--mdeval a-->one\n\n<!--mdeval b-->two\n\n<!--mdeval c-->42<!--/mdeval-->';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('throws on unclosed marker with CRLF line endings', () => {
		const source = '<!--mdeval a-->some\r\n\r\n<!--mdeval b-->42<!--/mdeval-->';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('throws on marker open with missing -->', () => {
		const source = '<!--mdeval x with no end of expression';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('does not throw on unclosed marker inside fenced code block', () => {
		const source = '```\n<!--mdeval x-->orphan\n```';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([]);
		expect(markers).toStrictEqual([]);
	});

	test('throws on unclosed script block followed by another well-formed marker', () => {
		const source = '<!--mdeval\nconst x = 1;\n\n<!--mdeval y-->42<!--/mdeval-->';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('throws on unclosed script block at EOF', () => {
		const source = '<!--mdeval\nconst x = 1;\n';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('throws on unclosed script block with intervening script open', () => {
		const source = '<!--mdeval\nconst x = 1;\n\n<!--mdeval\nconst y = 2;\n-->';
		expect(() => parseMarkdown(source)).toThrow(/offset 0/);
	});

	test('does not throw on unclosed script block inside fenced code block', () => {
		const source = '````\n<!--mdeval\nconst x = 1;\n````';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([]);
		expect(markers).toStrictEqual([]);
	});

	test('handles marker with empty content', () => {
		const source = '<!--mdeval x--><!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markerContent(source, markers[0])).toBe('');
	});

	test('multiple markers with same expression both appear', () => {
		const source = '<!--mdeval\nconst x = 1;\n-->\n\nFirst: <!--mdeval x-->old<!--/mdeval--> Second: <!--mdeval x-->old<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(2);
		expect(markers[0].expression).toBe('x');
		expect(markers[1].expression).toBe('x');
	});

	test('marker adjacent to script block', () => {
		const source = '<!--mdeval\nconst x = 1;\n-->\n<!--mdeval x-->old<!--/mdeval-->';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toHaveLength(1);
		expect(markers).toHaveLength(1);
	});

	test('extracts complex expressions', () => {
		const source = '<!--mdeval items.length + " items"-->old<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers[0].expression).toBe('items.length + " items"');
	});

	test('ignores markers inside fenced code when same expression exists outside', () => {
		const source = [
			'<!--mdeval',
			'const x = 42;',
			'-->',
			'',
			'```',
			'<!--mdeval x-->example<!--/mdeval-->',
			'```',
			'',
			'Value: <!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('old');
	});

	test('ignores markers inside inline code when same expression exists outside', () => {
		const source = 'Use `<!--mdeval x-->42<!--/mdeval-->` syntax.\n\n<!--mdeval x-->old<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('old');
	});

	test('ignores markers inside tilde fences when same expression exists outside', () => {
		const source = [
			'~~~',
			'<!--mdeval x-->example<!--/mdeval-->',
			'~~~',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('old');
	});

	test('ignores markers inside multi-line indented code when same expression exists outside', () => {
		const source = [
			'    some code',
			'    <!--mdeval x-->keep<!--/mdeval-->',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('old');
	});

	test('ignores markers inside indented code when first and last lines are identical', () => {
		const source = [
			'    same',
			'    <!--mdeval x-->keep<!--/mdeval-->',
			'    same',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markerContent(source, markers[0])).toBe('old');
	});

	test('returns independent results for non-mdeval inputs', () => {
		const r1 = parseMarkdown('# no markers');
		const r2 = parseMarkdown('# also no markers');
		expect(r1.markers).toHaveLength(0);
		r1.markers.push({
			expression: 'injected',
			start: 0,
			end: 10,
		});
		expect(r2.markers).toHaveLength(0);
	});

	test('does not exclude marker immediately after inline code', () => {
		const source = '`code`<!--mdeval x-->old<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(markers[0].expression).toBe('x');
	});
});
