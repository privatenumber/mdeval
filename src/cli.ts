import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from 'cleye';
import { glob } from 'tinyglobby';
import './loader.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';

const argv = cli({
	name: 'mdeval',
	flags: {
		watch: {
			type: Boolean,
			alias: 'w',
			description: 'Re-render on file changes (uses Node\'s --watch internally to track imports)',
		},
	},
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

if (argv.flags.watch) {
	const child = spawn(
		process.execPath,
		[
			'--watch',
			fileURLToPath(import.meta.url),
			...patterns,
		],
		{
			stdio: 'inherit',
		},
	);

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			child.kill(signal);
		});
	}

	const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
	process.exit(signal === 'SIGINT' ? 130 : (code ?? 1));
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
