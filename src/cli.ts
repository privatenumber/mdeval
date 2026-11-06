import fs from 'node:fs/promises';
import path from 'node:path';
import { styleText } from 'node:util';
import { cli } from 'cleye';
import { glob } from 'tinyglobby';
import './loader.ts';
import packageJson from '../package.json' with { type: 'json' };
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';
import { findRenderedLeaks } from './validate-rendering/index.ts';

// Warnings go to stderr, so color depends on stderr, not stdout
const WARNING_PREFIX = styleText('yellow', 'Warning:', { stream: process.stderr });

const argv = cli({
	name: packageJson.name,
	version: packageJson.version,
	strictFlags: true,
	parameters: ['<files...>'],
});

const patterns = argv._.files;
const targetsNodeModules = patterns.some(pattern => pattern.includes('node_modules'));
const files = await glob(patterns, {
	ignore: targetsNodeModules ? [] : ['**/node_modules/**'],
});

if (files.length === 0) {
	console.error('No files matched the given patterns');
	process.exit(1);
}

await Promise.all(files.map(async (file) => {
	try {
		const resolvedPath = path.resolve(file);
		const source = await fs.readFile(resolvedPath, 'utf8');
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
		console.error(`Error processing ${file}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}));
