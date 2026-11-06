import { styleText } from 'node:util';
import { cli } from 'cleye';
import './loader.ts';
import packageJson from '../package.json' with { type: 'json' };
import { formatErrorLocation } from './cli/error-location.ts';
import { processFile } from './cli/process-file.ts';
import { resolveFiles } from './cli/resolve-files/index.ts';

const warningPrefix = styleText('yellow', 'Warning:', { stream: process.stderr });
const warn = (message: string) => console.warn(`${warningPrefix} ${message}`);

const argv = cli({
	name: packageJson.name,
	version: packageJson.version,
	strictFlags: true,
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
} else {
	await Promise.all(files.map(async (file) => {
		try {
			await processFile(file, {
				warn,
				onUpdate: console.log,
			});
		} catch (error) {
			console.error(`Error processing ${formatErrorLocation(error, file)}:`, error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	}));
}
