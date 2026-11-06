import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect } from 'manten';
import { fromMarkdown } from 'mdast-util-from-markdown';
import spawn from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');

type Node = {
	type: string;
	url?: string;
	children?: Node[];
};

const collectUrls = (node: Node, urls: string[] = []) => {
	if (node.url !== undefined) {
		urls.push(node.url);
	}
	for (const child of node.children ?? []) {
		collectUrls(child, urls);
	}
	return urls;
};

describe('package files', () => {
	test('relative links in packed Markdown resolve to packed files', async () => {
		// --ignore-scripts skips prepack, whose clean-pkg-json rewrites package.json even in a dry run
		const { stdout } = await spawn('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: projectRoot });
		const [{ files }] = JSON.parse(stdout) as [{ files: { path: string }[] }];
		const packed = new Set(files.map(file => file.path));

		const broken: string[] = [];
		for (const file of [...packed].filter(packedPath => packedPath.endsWith('.md'))) {
			const tree = fromMarkdown(await fs.readFile(path.join(projectRoot, file), 'utf8')) as Node;
			for (const url of collectUrls(tree)) {
				// Skip absolute URLs (any scheme) and same-file anchors
				if (/^[a-z][\d+.a-z-]*:/i.test(url) || url.startsWith('#')) {
					continue;
				}
				const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURI(url.split('#')[0])));
				if (!packed.has(target)) {
					broken.push(`${file}: ${url}`);
				}
			}
		}
		expect(broken).toStrictEqual([]);
	});
});
