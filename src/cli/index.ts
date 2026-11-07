import fs from 'node:fs/promises';
import path from 'node:path';
import { styleText } from 'node:util';
import { cli } from 'cleye';
import '../loader.ts';
import packageJson from '../../package.json' with { type: 'json' };
import { parseMarkdown, isOnlyMdeval } from '../parse-markdown.ts';
import { processSource } from '../process-source.ts';
import { findRenderedLeaks } from '../validate-rendering/index.ts';
import { formatErrorLocation } from './error-location.ts';
import { resolveFiles } from './resolve-files.ts';

// Warnings go to stderr, so color depends on stderr, not stdout
const WARNING_PREFIX = styleText('yellow', 'Warning:', { stream: process.stderr });

const argv = cli({
	name: packageJson.name,
	version: packageJson.version,
	strictFlags: true,
	flags: {
		check: {
			type: Boolean,
			description: 'Report files with outdated values instead of rewriting them',
		},
	},
	parameters: ['<files...>'],
});

const { files, errors } = await resolveFiles(argv._.files);

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else if (files.length === 0) {
	console.error('No files matched the given patterns');
	process.exitCode = 1;
}

// Markdown scripts can call process.exit() or reset process.exitCode, so the code is
// decided on exit: 0 only when every file finished and none failed
let failed = false;
let completed = false;
process.on('exit', () => {
	if (failed || !completed) {
		process.exitCode = 1;
	}
});
await Promise.all(files.map(async (file) => {
	try {
		if (path.extname(file) !== '.md') {
			throw new Error('mdeval only processes .md files');
		}
		const resolvedPath = path.resolve(file);
		// Lenient decoding is safe: evaluating the file runs the loader's strict decoder,
		// which throws on invalid UTF-8 before anything is written
		const source = await fs.readFile(resolvedPath, 'utf8');
		const parsed = parseMarkdown(source);

		if (isOnlyMdeval(source, parsed)) {
			console.warn(`${WARNING_PREFIX} ${file} has no markdown content outside of mdeval blocks`);
		}

		const output = await processSource(source, resolvedPath, parsed);

		if (output !== source) {
			if (argv.flags.check) {
				failed = true;
			} else {
				await fs.writeFile(resolvedPath, output, 'utf8');
			}
			console.log(file);
		}

		// Validate the content on disk, including in check mode where it is not rewritten.
		for (const leak of findRenderedLeaks(argv.flags.check ? source : output)) {
			console.warn(
				`${WARNING_PREFIX} ${file}:${leak.line}:${leak.column} mdeval marker leaks into rendered ${leak.kind}`,
			);
		}
	} catch (error) {
		console.error(`Error processing ${formatErrorLocation(error, file)}:`, error instanceof Error ? error.message : error);
		failed = true;
	}
}));
completed = true;
