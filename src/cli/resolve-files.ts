import fs from 'node:fs/promises';
import path from 'node:path';
import { convertPathToPattern, glob, isDynamicPattern } from 'tinyglobby';

const classifyArgument = async (argument: string) => {
	try {
		const stat = await fs.stat(argument);
		if (stat.isDirectory()) {
			const directory = argument.replace(/[\\/]$/, '') || argument;
			return { pattern: `${convertPathToPattern(directory)}/**/*.md` };
		}
		if (stat.isFile()) {
			return { file: argument };
		}
		return { error: `${argument}: not a file` };
	} catch (error) {
		const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return isDynamicPattern(argument)
				? { pattern: argument }
				: { error: `${argument}: file does not exist` };
		}
		const message = typeof code === 'string' ? code : (error instanceof Error ? error.message : error);
		return { error: `${argument}: ${message}` };
	}
};

export const resolveFiles = async (args: string[]) => {
	const classified = await Promise.all(args.map(classifyArgument));
	const errors = classified.flatMap(result => (result.error === undefined ? [] : [result.error]));
	if (errors.length > 0) {
		return {
			files: [],
			errors,
		};
	}
	const literals = classified.flatMap(result => (result.file === undefined ? [] : [result.file]));
	const patterns = classified.flatMap(result => (
		result.pattern === undefined ? [] : [result.pattern]
	));
	const targetsNodeModules = args.some(argument => argument.includes('node_modules'));
	const matches = patterns.length > 0
		? await glob(patterns, { ignore: targetsNodeModules ? [] : ['**/node_modules/**'] })
		: [];
	const seen = new Set<string>();
	const files = [...literals, ...matches].filter((file) => {
		const resolved = path.resolve(file);
		if (seen.has(resolved)) {
			return false;
		}
		seen.add(resolved);
		return true;
	});
	return {
		files,
		errors,
	};
};
