import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect } from 'manten';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import spawn from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');

type Node = {
	type: string;
	url?: string;
	value?: string;
	children?: Node[];
};

// Images, such as the README logo, are left out: npm resolves them from the repository
const htmlLink = /\bhref="([^"]*)"/g;

const collectUrls = (node: Node, urls: string[] = []) => {
	if (node.type === 'link' || node.type === 'definition') {
		urls.push(node.url!);
	}
	if (node.type === 'html') {
		urls.push(...Array.from(node.value!.matchAll(htmlLink), match => match[1]));
	}
	for (const child of node.children ?? []) {
		collectUrls(child, urls);
	}
	return urls;
};

describe('package files', () => {
	test('relative links in packed Markdown resolve to packed files', async () => {
		// --ignore-scripts skips the prepack build, which is not needed to list files
		const { stdout } = await spawn('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: projectRoot });
		const [{ files }] = JSON.parse(stdout) as [{ files: { path: string }[] }];
		const packed = new Set(files.map(file => file.path));

		const broken: string[] = [];
		for (const file of [...packed].filter(packedPath => packedPath.endsWith('.md'))) {
			const tree = fromMarkdown(await fs.readFile(path.join(projectRoot, file), 'utf8'), {
				extensions: [gfmTable()],
				mdastExtensions: [gfmTableFromMarkdown()],
			}) as Node;
			for (const url of collectUrls(tree)) {
				// Resolving against the file handles anchors, queries, and escapes
				const resolved = new URL(url, `file:///${file}`);
				if (resolved.protocol === 'file:' && !packed.has(decodeURIComponent(resolved.pathname.slice(1)))) {
					broken.push(`${file}: ${url}`);
				}
			}
		}
		expect(broken).toStrictEqual([]);
	});
});
