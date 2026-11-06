import fs from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdown, isOnlyMdeval } from '../parse-markdown.ts';
import { processSource } from '../process-source.ts';
import { readUtf8File } from '../utils/read-utf8-file.ts';
import { findRenderedLeaks } from '../validate-rendering/index.ts';

export const processFile = async (
	file: string,
	{ warn, onUpdate }: {
		warn: (message: string) => void;
		onUpdate: (file: string) => void;
	},
) => {
	if (path.extname(file) !== '.md') {
		throw new Error('mdeval only processes .md files');
	}
	const resolvedPath = path.resolve(file);
	const source = await readUtf8File(resolvedPath);
	const parsed = parseMarkdown(source);
	if (isOnlyMdeval(source, parsed)) {
		warn(`${file} has no markdown content outside of mdeval blocks`);
	}
	const output = await processSource(source, resolvedPath);
	if (output !== source) {
		await fs.writeFile(resolvedPath, output, 'utf8');
		onUpdate(file);
	}
	for (const leak of findRenderedLeaks(output)) {
		warn(`${file}:${leak.line}:${leak.column} mdeval marker leaks into rendered ${leak.kind}`);
	}
};
