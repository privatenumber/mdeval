import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ParseResult } from './parse-markdown.ts';

type ParsedHandoff = {
	source: string;
	parsed: ParseResult;
};

export const parsedHandoffs = new Map<string, ParsedHandoff>();

export const handoffKey = (url: string): string => {
	const parsedUrl = new URL(url);
	try {
		const resolved = pathToFileURL(realpathSync.native(fileURLToPath(parsedUrl))).href;
		return resolved + parsedUrl.search + parsedUrl.hash;
	} catch {
		// Leave file errors to the import or load operation.
		return url;
	}
};
