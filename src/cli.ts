import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { cli } from 'cleye';
import { convertPathToPattern, glob, isDynamicPattern } from 'tinyglobby';
import './loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';
import { findRenderedLeaks } from './validate-rendering/index.ts';

// Warnings go to stderr, so color depends on stderr, not stdout
const WARNING_PREFIX = styleText('yellow', 'Warning:', { stream: process.stderr });
const NODE_MODULES_SEGMENT = /(?:^|[\\/])node_modules(?:[\\/]|$)/;

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
		if (stat.isDirectory()) {
			positives.push({
				pattern: `${convertPathToPattern(pattern.replace(/[\\/]$/, ''))}/**/*.md`,
				literal: false,
			});
			continue;
		}
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
		} else if (pattern.startsWith('!') && !pattern.startsWith('!(')) {
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
	process.exitCode = 1;
} else {
	const exclusions = negatives.length > 0 && positives.some(({ literal }) => literal)
		? await glob(negatives.map(pattern => pattern.slice(1)))
		: [];
	const excluded = new Set(exclusions.map(file => path.resolve(file)));
	const groups = [new Set<string>(), new Set<string>()];
	for (const { pattern, literal } of positives) {
		if (!literal) {
			groups[Number(NODE_MODULES_SEGMENT.test(pattern))].add(pattern);
		}
	}
	const groupedMatches = await Promise.all(groups.map((patterns_, index) => (patterns_.size === 0
		? []
		: glob([...patterns_, ...negatives], {
			ignore: index === 1 ? [] : ['**/node_modules/**'],
		}))));
	const emitted = new Set<number>();
	const candidates = positives.flatMap(({ pattern, literal }) => {
		const optedIn = literal || NODE_MODULES_SEGMENT.test(pattern);
		if (literal) {
			return excluded.has(path.resolve(pattern))
				? []
				: [{
					file: pattern,
					optedIn,
				}];
		}
		const group = Number(optedIn);
		if (emitted.has(group)) {
			return [];
		}
		emitted.add(group);
		return groupedMatches[group].map(file => ({
			file,
			optedIn,
		}));
	});
	const realPaths = await Promise.all(
		candidates.map(({ file }) => fs.realpath(file).catch(() => path.resolve(file))),
	);
	const unique = new Set<string>();
	const files = candidates.filter(({ optedIn }, index) => {
		const realPath = realPaths[index];
		if ((!optedIn && NODE_MODULES_SEGMENT.test(realPath)) || unique.has(realPath)) {
			return false;
		}
		unique.add(realPath);
		return true;
	}).map(({ file }) => file);

	if (files.length === 0) {
		console.error('No files matched the given patterns');
		process.exitCode = 1;
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
			const frame = error instanceof Error ? error.stack?.match(/^\s*at (?:.*? \()?((?:file:\/\/|\/|[A-Za-z]:[\\/]).*?\.md):(\d+):(\d+)\)?$/m) : undefined;
			let location = file;
			if (frame) {
				const framePath = frame[1].startsWith('file:') ? fileURLToPath(frame[1]) : frame[1];
				location = `${path.resolve(framePath) === path.resolve(file) ? file : path.relative(process.cwd(), framePath)}:${frame[2]}:${frame[3]}`;
			}
			console.error(`Error processing ${location}:`, error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	}));
}
