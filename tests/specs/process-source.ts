import { describe, test, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { processSource } from '../../src/process-source.ts';

const processMarkdown = async (source: string) => {
	await using fixture = await createFixture({ 'test.md': source });
	const output = await processSource(source, fixture.getPath('test.md'));
	return output;
};

describe('processSource', () => {
	test('replaces marker with computed value', async () => {
		const source = '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '2'));
	});

	test('returns source unchanged when markers are up to date', async () => {
		const source = '<!--mdeval\nconst x = 1 + 1;\n-->\n\nResult: <!--mdeval x-->2<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source);
	});

	test('handles multiple script blocks', async () => {
		const source = '<!--mdeval\nconst a = 1;\n-->\n\n<!--mdeval\nconst b = 2;\n-->\n\n<!--mdeval a-->0<!--/mdeval--> <!--mdeval b-->0<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('a-->0', 'a-->1').replace('b-->0', 'b-->2'));
	});

	test('errors on duplicate variable names across blocks', async () => {
		await expect(processMarkdown(
			'<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval\nconst x = 2;\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		)).rejects.toThrow();
	});

	test('errors on undefined marker expression', async () => {
		await expect(processMarkdown(
			'<!--mdeval\nconst x = 1;\n-->\n\n<!--mdeval y-->0<!--/mdeval-->',
		)).rejects.toThrow();
	});

	test('returns source unchanged for files with no mdeval content', async () => {
		const source = '# Just a normal markdown file\n\nHello world.';
		const output = await processMarkdown(source);
		expect(output).toBe(source);
	});

	test('returns source unchanged for script blocks with no markers', async () => {
		const source = '<!--mdeval\nconst x = 1;\n-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source);
	});

	test('evaluates self-contained expressions without script blocks', async () => {
		const source = 'Value: <!--mdeval (() => 42)()-->0<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('0', '42'));
	});

	test('script with syntax error produces meaningful error', async () => {
		await expect(processMarkdown(
			'<!--mdeval\nconst x = {;\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		)).rejects.toThrow();
	});

	test('throws on reference error', async () => {
		await expect(processMarkdown(
			'<!--mdeval\nconst x = y + 1;\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		)).rejects.toThrow();
	});

	test('throws on async rejection', async () => {
		await expect(processMarkdown(
			'<!--mdeval\nconst x = await Promise.reject(new Error("async fail"));\n-->\n\n<!--mdeval x-->0<!--/mdeval-->',
		)).rejects.toThrow('async fail');
	});

	test('user-declared `block` shadows the global helper', async () => {
		const source = '<!--mdeval\nconst block = (x) => `<<${x}>>`;\nconst value = "test";\n-->\n\n<!--mdeval block(value)-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '<<test>>'));
	});

	test('user-declared `$` shadows the global helper', async () => {
		const source = '<!--mdeval\nconst $ = "jQuery";\n-->\n\n<!--mdeval $-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'jQuery'));
	});

	test('block() wraps value with newlines', async () => {
		const source = '<!--mdeval\nconst x = "# Title";\n-->\n\n<!--mdeval block(x)-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '\n# Title\n'));
	});

	test('coerces object to JSON', async () => {
		const source = '<!--mdeval\nconst x = { a: 1, b: 2 };\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '{"a":1,"b":2}'));
	});

	test('coerces number to string', async () => {
		const source = '<!--mdeval\nconst x = 3.14;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '3.14'));
	});

	test('writes HTML-like values literally', async () => {
		const source = '<!--mdeval\nconst x = "<strong>bold</strong>";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('x-->old<!--', 'x--><strong>bold</strong><!--'));
	});

	test('writes markdown-significant chars literally', async () => {
		const source = '<!--mdeval\nconst x = "**bold** [link](url)";\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('x-->old<!--', 'x-->**bold** [link](url)<!--'));
	});

	test('resolves unique expressions after duplicates', async () => {
		const source = '<!--mdeval\nconst x = "a";\nconst y = "b";\n-->\n\n<!--mdeval x-->?<!--/mdeval--> <!--mdeval x-->?<!--/mdeval--> <!--mdeval y-->?<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replaceAll('x-->?', 'x-->a').replace('y-->?', 'y-->b'));
	});

	test('replaces all markers referencing same variable', async () => {
		const source = '<!--mdeval\nconst x = 42;\n-->\n\nFirst: <!--mdeval x-->old<!--/mdeval--> Second: <!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		const matches = [...output.matchAll(/<!--mdeval x-->42<!--\/mdeval-->/g)];
		expect(matches).toHaveLength(2);
	});

	test('evaluates duplicate expressions only once', async () => {
		const expr = '(() => { counter += 1; return counter; })()';
		const source = `<!--mdeval\nlet counter = 0;\n-->\n\nFirst: <!--mdeval ${expr}-->old<!--/mdeval--> Second: <!--mdeval ${expr}-->old<!--/mdeval-->`;
		const output = await processMarkdown(source);
		expect(output).toBe(source.replaceAll('old', '1'));
	});

	test('sets import.meta to the source file path', async () => {
		const md = '<!--mdeval\nconst filename = import.meta.filename;\n-->\n\n<!--mdeval filename-->?<!--/mdeval-->';
		await using fixture = await createFixture({ 'test.md': md });
		const resolvedPath = fixture.getPath('test.md');
		const output = await processSource(
			await fixture.readFile('test.md', 'utf8'),
			resolvedPath,
		);
		expect(output).toContain(resolvedPath);
	});

	test('imports relative .ts files', async () => {
		const md = '<!--mdeval\nimport { value } from \'./helper.ts\';\nconst x = value;\n-->\n\n<!--mdeval x-->?<!--/mdeval-->';
		await using fixture = await createFixture({
			'helper.ts': 'export const value = 42;',
			'test.md': md,
		});
		const output = await processSource(
			await fixture.readFile('test.md', 'utf8'),
			fixture.getPath('test.md'),
		);
		expect(output).toBe(md.replace('?', '42'));
	});

	test('imports relative .js files', async () => {
		const md = '<!--mdeval\nimport { value } from \'./helper.js\';\nconst x = value;\n-->\n\n<!--mdeval x-->?<!--/mdeval-->';
		await using fixture = await createFixture({
			'helper.js': 'export const value = "hello";',
			'test.md': md,
		});
		const output = await processSource(
			await fixture.readFile('test.md', 'utf8'),
			fixture.getPath('test.md'),
		);
		expect(output).toBe(md.replace('?', 'hello'));
	});

	test('importing .md file without mdeval content resolves to empty namespace', async () => {
		const plainMd = '# Just markdown\n\nHello.';
		const consumerMd = '<!--mdeval\nimport * as plain from \'./plain.md\';\nconst label = plain.person ?? \'fallback\';\n-->\n\n<!--mdeval label-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'plain.md': plainMd,
			'consumer.md': consumerMd,
		});
		const output = await processSource(
			await fixture.readFile('consumer.md', 'utf8'),
			fixture.getPath('consumer.md'),
		);
		expect(output).toBe(consumerMd.replace('old', 'fallback'));
	});

	test('named imports against .md without exports surface a clear linker error', async () => {
		const plainMd = '# Just markdown\n\nHello.';
		const consumerMd = '<!--mdeval\nimport { person } from \'./plain.md\';\nconst x = person;\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		await using fixture = await createFixture({
			'plain.md': plainMd,
			'consumer.md': consumerMd,
		});
		await expect(
			processSource(
				await fixture.readFile('consumer.md', 'utf8'),
				fixture.getPath('consumer.md'),
			),
		).rejects.toThrow(/does not provide an export named ['"]person['"]/);
	});

	test('imports from other .md files', async () => {
		const dataMd = '<!--mdeval\nexport const version = "1.0.0";\nexport const name = "test";\n-->\n\nVersion: <!--mdeval version-->?<!--/mdeval-->';
		const consumerMd = '<!--mdeval\nimport { version, name } from \'./data.md\';\nconst label = name + "@" + version;\n-->\n\n<!--mdeval label-->?<!--/mdeval-->';
		await using fixture = await createFixture({
			'data.md': dataMd,
			'consumer.md': consumerMd,
		});
		const output = await processSource(
			await fixture.readFile('consumer.md', 'utf8'),
			fixture.getPath('consumer.md'),
		);
		expect(output).toBe(consumerMd.replace('?', 'test@1.0.0'));
	});

	test('imported .md ignores script blocks inside code fences', async () => {
		const dataMd = [
			'# Data',
			'',
			'````markdown',
			'<!--mdeval',
			'export const version = "wrong";',
			'-->',
			'````',
			'',
			'<!--mdeval',
			'export const version = "right";',
			'-->',
		].join('\n');
		const consumerMd = '<!--mdeval\nimport { version } from \'./data.md\';\nconst x = version;\n-->\n\n<!--mdeval x-->?<!--/mdeval-->';
		await using fixture = await createFixture({
			'data.md': dataMd,
			'consumer.md': consumerMd,
		});
		const output = await processSource(
			await fixture.readFile('consumer.md', 'utf8'),
			fixture.getPath('consumer.md'),
		);
		expect(output).toBe(consumerMd.replace('?', 'right'));
	});

	test('evaluates expression markers', async () => {
		const source = '<!--mdeval\nconst data = { name: "hello", count: 42 };\n-->\n\n<!--mdeval data.name-->?<!--/mdeval--> <!--mdeval data.count-->?<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(
			source.replace('data.name-->?', 'data.name-->hello').replace('data.count-->?', 'data.count-->42'),
		);
	});

	test('evaluates inline computation expressions', async () => {
		const source = '<!--mdeval\nconst items = [1, 2, 3];\n-->\n\n<!--mdeval items.length + " items"-->?<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('?', '3 items'));
	});

	test('evaluates multi-line IIFE expressions', async () => {
		const source = '<!--mdeval\nconst items = [1, 2, 3];\n-->\n\n<!--mdeval (() => {\n  const count = items.length;\n  return count + " items";\n})()-->?<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('?', '3 items'));
	});

	test('evaluates IIFE expressions', async () => {
		const source = '<!--mdeval\n-->\n\n<!--mdeval (() => 1 + 1)()-->?<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('?', '2'));
	});

	test('is idempotent — running twice produces identical output', async () => {
		const source = '<!--mdeval\nconst x = 1 + 1;\nconst y = "hello";\n-->\n\n<!--mdeval x-->old<!--/mdeval--> <!--mdeval y-->old<!--/mdeval-->';
		const first = await processMarkdown(source);
		const second = await processMarkdown(first);
		expect(second).toBe(first);
	});

	test('errors when value contains closing sentinel', async () => {
		await expect(processMarkdown([
			'<!--mdeval',
			'const x = String.fromCharCode(60) + "!--/mdeval" + String.fromCharCode(45,45,62);',
			'-->',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n'))).rejects.toThrow();
	});

	test('errors when value contains opening sentinel', async () => {
		await expect(processMarkdown([
			'<!--mdeval',
			'const x = String.fromCharCode(60) + "!--mdeval y" + String.fromCharCode(45,45,62);',
			'-->',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n'))).rejects.toThrow();
	});

	test('allows values containing non-matching mdeval substrings', async () => {
		const source = [
			'<!--mdeval',
			'const x = "<" + "!--mdevaluation" + String.fromCharCode(45,45,62);',
			'-->',
			'',
			'<!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '<!--mdevaluation-->'));
	});

	test('preserves markers inside code fences', async () => {
		const source = [
			'<!--mdeval',
			'const x = "hello";',
			'-->',
			'',
			'```',
			'<!--mdeval x-->example<!--/mdeval-->',
			'```',
			'',
			'Value: <!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'hello'));
	});

	test('preserves markers inside indented code blocks', async () => {
		const source = [
			'<!--mdeval',
			'const x = "hello";',
			'-->',
			'',
			'    some code',
			'    <!--mdeval x-->keep<!--/mdeval-->',
			'',
			'Value: <!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'hello'));
	});

	test('$ runs shell command and interpolates stdout', async () => {
		const source = '<!--mdeval $`echo hello`-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'hello'));
	});

	test('$ works with script variable', async () => {
		const source = '<!--mdeval\nconst result = $`echo world`;\n-->\n\n<!--mdeval result-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'world'));
	});

	test('$ with multiline output', async () => {
		const source = '<!--mdeval $`printf "a\\nb\\nc"`-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'a\nb\nc'));
	});

	test('resolves promise expressions', async () => {
		const source = '<!--mdeval\n-->\n\n<!--mdeval Promise.resolve("async value")-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', 'async value'));
	});

	test('resolves promise from script variable', async () => {
		const source = '<!--mdeval\nconst x = Promise.resolve(42);\n-->\n\n<!--mdeval x-->old<!--/mdeval-->';
		const output = await processMarkdown(source);
		expect(output).toBe(source.replace('old', '42'));
	});

	test('updates marker immediately after inline code', async () => {
		const source = [
			'<!--mdeval',
			'const x = "hello";',
			'-->',
			'',
			'`code`<!--mdeval x-->old<!--/mdeval-->',
		].join('\n');
		const output = await processMarkdown(source);
		expect(output).not.toBe(source);
		expect(output).toBe(source.replace('old', 'hello'));
	});
});
