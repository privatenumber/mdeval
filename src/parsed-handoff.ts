import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParseResult } from './parse-markdown.ts';

type ParsedHandoff = {
	source: string;
	parsed: ParseResult;
};

export const parsedHandoffs = new Map<string, ParsedHandoff>();

// Keyed by real path, because several URLs can load one file: /var and
// /private/var on macOS, or a resolve hook that adds a query. The loader
// still compares the source before it reuses a hand-off.
export const handoffKey = (url: string): string => {
	try {
		return realpathSync.native(fileURLToPath(url));
	} catch {
		// Leave file errors to the import or load operation.
		return url;
	}
};
