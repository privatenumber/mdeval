import { describe, test, expect } from 'manten';
import { parseMarkdown } from '../../src/parse-markdown.ts';

describe('parseMarkdown', () => {
	test('extracts script blocks', () => {
		const source = '<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval\nconst y = 2;\n-->';
		const { scriptBlocks } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual(['const x = 1;\n', 'const y = 2;\n']);
	});

	test('extracts value markers', () => {
		const source = 'The value is <!--mdeval x-->42<!--/mdeval-->.';
		const { markers } = parseMarkdown(source);
		expect(markers).toStrictEqual([
			{
				expression: 'x',
				contentStart: 28,
				contentEnd: 30,
			},
		]);
	});

	test('extracts multiple markers', () => {
		const source = '<!--mdeval a-->1<!--/mdeval--> and <!--mdeval b-->2<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(2);
		expect(markers[0].expression).toBe('a');
		expect(markers[1].expression).toBe('b');
	});

	test('ignores content inside code fences', () => {
		const source = '```\n<!--mdeval\nconst x = 1;\n-->\n<!--mdeval x-->42<!--/mdeval-->\n```';
		const { scriptBlocks, markers } = parseMarkdown(source);
		expect(scriptBlocks).toStrictEqual([]);
		expect(markers).toStrictEqual([]);
	});

	test('handles marker with empty content', () => {
		const source = '<!--mdeval x--><!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers[0].contentStart).toBe(markers[0].contentEnd);
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
		expect(source.slice(markers[0].contentStart, markers[0].contentEnd)).toBe('old');
	});

	test('ignores markers inside inline code when same expression exists outside', () => {
		const source = 'Use `<!--mdeval x-->42<!--/mdeval-->` syntax.\n\n<!--mdeval x-->old<!--/mdeval-->';
		const { markers } = parseMarkdown(source);
		expect(markers).toHaveLength(1);
		expect(source.slice(markers[0].contentStart, markers[0].contentEnd)).toBe('old');
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
		expect(source.slice(markers[0].contentStart, markers[0].contentEnd)).toBe('old');
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
		expect(source.slice(markers[0].contentStart, markers[0].contentEnd)).toBe('old');
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
		expect(source.slice(markers[0].contentStart, markers[0].contentEnd)).toBe('old');
	});

	test('returns independent results for non-mdeval inputs', () => {
		const r1 = parseMarkdown('# no markers');
		const r2 = parseMarkdown('# also no markers');
		expect(r1.markers).toHaveLength(0);
		r1.markers.push({
			expression: 'injected',
			contentStart: 5,
			contentEnd: 8,
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
