import fs from 'node:fs/promises';
import path from 'node:path';
import { cli } from 'cleye';
import { glob } from 'tinyglobby';
import { block, $ } from './runtime.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';

// Seed helpers on globalThis so `.md` files can reference `block(...)` and
// `$\`...\`` directly. Library imports of `mdeval` are side-effect-free; this
// seeding is part of the CLI's setup.
Object.assign(globalThis, {
	block,
	$,
});

const argv = cli({
	name: 'mdeval',
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
			console.warn(`Warning: ${file} has no markdown content outside of mdeval blocks`);
		}

		const output = await processSource(source, resolvedPath);

		if (output !== source) {
			await fs.writeFile(resolvedPath, output, 'utf8');
			console.log(file);
		}
	} catch (error) {
		console.error(`Error processing ${file}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}));
