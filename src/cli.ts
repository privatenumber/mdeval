import fs from 'node:fs/promises';
import path from 'node:path';
import { styleText } from 'node:util';
import { cli } from 'cleye';
import './loader.ts';
import packageJson from '../package.json' with { type: 'json' };
import { formatErrorLocation } from './cli/error-location.ts';
import { createExitStatus } from './cli/exit-status.ts';
import { resolveFiles } from './cli/resolve-files.ts';
import { parseMarkdown, isOnlyMdeval } from './parse-markdown.ts';
import { processSource } from './process-source.ts';
import { findRenderedLeaks } from './validate-rendering/index.ts';

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

const status = createExitStatus();
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

		const output = await processSource(source, resolvedPath);

		if (output !== source) {
			if (argv.flags.check) {
				status.fail();
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
		status.fail();
	}
}));
status.complete();
