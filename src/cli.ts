// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { register } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cli } from 'cleye';
import { processSource } from './process-source.ts';

declare global {
	// eslint-disable-next-line vars-on-top
	var block: (value: unknown) => string;
}

register('#md-loader', import.meta.url);

globalThis.block = (value: unknown) => `\n${String(value)}\n`;

const argv = cli({
	name: 'mdeval',
	parameters: ['<files...>'],
});

await Promise.all(argv._.files.map(async (file) => {
	try {
		const resolvedPath = path.resolve(file);
		const source = await fs.readFile(resolvedPath, 'utf8');
		const output = await processSource(source, resolvedPath);

		if (output !== source) {
			await fs.writeFile(resolvedPath, output, 'utf8');
			console.log(`Updated: ${file}`);
		}
	} catch (error) {
		console.error(`Error processing ${file}:`, error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}));
