import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { cli } from 'cleye';
import { escapePath, glob, isDynamicPattern } from 'tinyglobby';
import './loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';
import { findRenderedLeaks } from './validate-rendering/index.ts';

// Warnings go to stderr, so color depends on stderr, not stdout
const WARNING_PREFIX = styleText('yellow', 'Warning:', { stream: process.stderr });

const argv = cli({
	name: 'mdeval',
	version: (JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version,
	strictFlags: true,
	parameters: ['<files...>'],
});

const patterns = argv._.files;
const positives: {
	pattern: string;
	literal: boolean;
}[] = [];
const negatives: string[] = [];
let invalid = false;
for (const pattern of patterns) {
	try {
		const stat = await fs.stat(pattern);
		if (!stat.isFile()) {
			console.error(`${pattern}: not a file`);
			invalid = true;
			continue;
		}
		positives.push({
			pattern,
			literal: true,
		});
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))) {
			throw error;
		}
		if (!isDynamicPattern(pattern)) {
			console.error(`${pattern}: file does not exist`);
			invalid = true;
		} else if (pattern.startsWith('!')) {
			negatives.push(pattern);
		} else {
			positives.push({
				pattern,
				literal: false,
			});
		}
	}
}
if (invalid) {
	process.exit(1);
}

const matches = await Promise.all(positives.map(({ pattern, literal }) => glob([
	literal ? escapePath(pattern) : pattern,
	...negatives,
], {
	ignore: pattern.includes('node_modules') ? [] : ['**/node_modules/**'],
})));
const files = [...new Map(matches.flat().map(file => [path.resolve(file), file])).values()];

if (files.length === 0) {
	console.error('No files matched the given patterns');
	process.exit(1);
}

await Promise.all(files.map(async (file) => {
	try {
		if (path.extname(file) !== '.md') {
			throw new Error('mdeval only processes .md files');
		}
		const resolvedPath = path.resolve(file);
		const bytes = await fs.readFile(resolvedPath);
		let source: string;
		try {
			source = new TextDecoder('utf-8', {
				fatal: true,
				ignoreBOM: true,
			}).decode(bytes);
		} catch {
			throw new Error('not valid UTF-8');
		}
		const parsed = parseMarkdown(source);

		if (isOnlyMdeval(source, parsed)) {
			console.warn(`${WARNING_PREFIX} ${file} has no markdown content outside of mdeval blocks`);
		}

		const output = await processSource(source, resolvedPath);

		if (output !== source) {
			await fs.writeFile(resolvedPath, output, 'utf8');
			console.log(file);
		}

		// Validation runs on the post-rewrite content regardless of whether we
		// touched the file — a leaky marker that was already on disk should
		// still surface a warning so the user can decide whether to act on it
		// or accept it (e.g. an intentional documentation example).
		for (const leak of findRenderedLeaks(output)) {
			console.warn(
				`${WARNING_PREFIX} ${file}:${leak.line}:${leak.column} mdeval marker leaks into rendered ${leak.kind}`,
			);
		}
	} catch (error) {
		const frame = error instanceof Error ? error.stack?.match(/^\s*at (?:.* \()?(.+\.md):(\d+):(\d+)\)?$/m) : undefined;
		let location = file;
		if (frame) {
			const framePath = frame[1].startsWith('file:') ? fileURLToPath(frame[1]) : frame[1];
			location = `${path.resolve(framePath) === path.resolve(file) ? file : path.relative(process.cwd(), framePath)}:${frame[2]}:${frame[3]}`;
		}
		console.error(`Error processing ${location}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}));
