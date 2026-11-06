import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
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
	const exclusions: string[] = [];
	const normal: string[] = [];
	const dependencies: string[] = [];
	for (const pattern of patterns) {
		const scan = picomatch.scan(pattern);
		if (scan.negated) {
			exclusions.push(pattern);
		} else if (scan.base.split('/').includes('node_modules')) {
			dependencies.push(pattern);
		} else {
			normal.push(pattern);
		}
	}
	const [normalMatches, dependencyMatches] = await Promise.all([
		normal.length > 0 ? glob([...normal, ...exclusions], { ignore: ['**/node_modules/**'] }) : [],
		dependencies.length > 0 ? glob([...dependencies, ...exclusions]) : [],
	]);
	const seen = new Set<string>();
	const files = [...literals, ...normalMatches, ...dependencyMatches].filter((file) => {
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
