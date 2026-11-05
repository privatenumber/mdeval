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

const getStaticBase = (pattern: string) => {
	const normalized = process.platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
	const parts = normalized.split('/');
	const dynamicIndex = parts.findIndex(part => isDynamicPattern(part));
	const base = parts.slice(0, dynamicIndex === -1 ? -1 : dynamicIndex).join('/') || (normalized.startsWith('/') ? '/' : '.');
	return {
		base: path.resolve(base),
		optedIn: NODE_MODULES_SEGMENT.test(base),
	};
};

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
	directory?: string;
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
				directory: pattern,
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
			const message = error instanceof Error
				? ('code' in error && typeof error.code === 'string' ? error.code : error.message)
				: error;
			console.error(`${pattern}:`, message);
			invalid = true;
			continue;
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
	const groups = new Map<string, {
		base: string;
		optedIn: boolean;
		patterns: Set<string>;
	}>();
	const entries: ({ file: string } | { group: string })[] = [];
	for (const { pattern, literal, directory } of positives) {
		if (literal) {
			if (!excluded.has(path.resolve(pattern))) {
				entries.push({ file: pattern });
			}
			continue;
		}
		const { base, optedIn } = directory
			? {
				base: path.resolve(directory),
				optedIn: NODE_MODULES_SEGMENT.test(directory),
			}
			: getStaticBase(pattern);
		const key = JSON.stringify([base, optedIn]);
		if (!groups.has(key)) {
			groups.set(key, {
				base,
				optedIn,
				patterns: new Set(),
			});
			entries.push({ group: key });
		}
		groups.get(key)!.patterns.add(pattern);
	}
	const groupedMatches = new Map(await Promise.all([...groups].map(async ([key, group]) => {
		const [files, base] = await Promise.all([
			glob([...group.patterns, ...negatives], {
				ignore: group.optedIn ? [] : ['**/node_modules/**'],
			}),
			fs.realpath(group.base).catch(() => group.base),
		]);
		return [key, files.map(file => ({
			file,
			base,
			optedIn: group.optedIn,
		}))] as const;
	})));
	const candidates = entries.flatMap(entry => ('file' in entry
		? [{
			file: entry.file,
			base: '',
			optedIn: true,
		}]
		: groupedMatches.get(entry.group)!));
	const realPaths = await Promise.all(
		candidates.map(({ file }) => fs.realpath(file).catch(() => path.resolve(file))),
	);
	const unique = new Set<string>();
	const files = candidates.filter(({ base, optedIn }, index) => {
		const realPath = realPaths[index];
		if (
			(!optedIn && NODE_MODULES_SEGMENT.test(path.relative(base, realPath)))
			|| unique.has(realPath)
		) {
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
			const stack = error instanceof Error ? error.stack : undefined;
			const frame = typeof stack === 'string' ? stack.match(/^\s*at (?:.*? \()?((?:file:\/\/|\/|[A-Za-z]:[\\/]).*?\.md):(\d+):(\d+)\)?$/m) : undefined;
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
