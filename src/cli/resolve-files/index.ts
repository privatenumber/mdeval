import fs from 'node:fs/promises';
import path from 'node:path';
import { convertPathToPattern, glob } from 'tinyglobby';
import { toPosixPath } from '../../utils/to-posix-path.ts';
import { classifyArgument, type Argument } from './classify-argument.ts';
import { createExclusionMatcher } from './exclusions.ts';
import { includesNodeModules, isInNodeModules } from './node-modules.ts';

type Group = {
	base: string;
	optedIn: boolean;
	patterns: Set<string>;
};
type Candidate = {
	file: string;
	base: string;
	optedIn: boolean;
};

const groupPatterns = (classified: Argument[], matchesExclusion: (file: string) => boolean) => {
	const groups = new Map<string, Group>();
	const entries: ({ file: string } | { group: string })[] = [];
	for (const argument of classified) {
		if (argument.type === 'literal' && !matchesExclusion(argument.value)) {
			entries.push({ file: argument.value });
		}
		if (argument.type !== 'glob' && argument.type !== 'directory') {
			continue;
		}
		const rawBase = argument.type === 'directory' ? argument.value : argument.base;
		const base = path.resolve(rawBase);
		const optedIn = includesNodeModules(toPosixPath(rawBase));
		const pattern = argument.type === 'directory'
			? `${convertPathToPattern(argument.value.replace(/[\\/]$/, ''))}/**/*.md`
			: argument.value;
		const key = JSON.stringify([base, optedIn]);
		if (!groups.has(key)) {
			groups.set(key, {
				base,
				optedIn,
				patterns: new Set(),
			});
			entries.push({ group: key });
		}
		groups.get(key)!.patterns.add(pattern);
	}
	return {
		groups,
		entries,
	};
};

const crawlGroups = async (groups: Map<string, Group>, exclusions: string[]) => new Map(
	await Promise.all([...groups].map(async ([key, group]) => {
		const [files, base] = await Promise.all([
			glob([...group.patterns, ...exclusions], { ignore: group.optedIn ? [] : ['**/node_modules/**'] }),
			fs.realpath(group.base).catch(() => group.base),
		]);
		return [key, files.map(file => ({
			file,
			base,
			optedIn: group.optedIn,
		}))] as const;
	})),
);

const selectFiles = async (candidates: Candidate[]) => {
	const realPaths = await Promise.all(
		candidates.map(({ file }) => fs.realpath(file).catch(() => path.resolve(file))),
	);
	const unique = new Set<string>();
	return candidates.filter(({ base, optedIn }, index) => {
		const realPath = realPaths[index];
		if ((!optedIn && isInNodeModules(base, realPath)) || unique.has(realPath)) {
			return false;
		}
		unique.add(realPath);
		return true;
	}).map(({ file }) => file);
};

export const resolveFiles = async (args: string[]) => {
	const classified = await Promise.all(args.map(classifyArgument));
	const errors = classified.flatMap(argument => (argument.type === 'error' ? [argument.message] : []));
	if (errors.length > 0) {
		return {
			files: [],
			errors,
		};
	}
	const exclusions = classified.flatMap(argument => (argument.type === 'exclusion' ? [argument.value] : []));
	const { groups, entries } = groupPatterns(classified, createExclusionMatcher(exclusions));
	const matches = await crawlGroups(groups, exclusions);
	const candidates = entries.flatMap(entry => ('file' in entry
		? [{
			file: entry.file,
			base: '',
			optedIn: true,
		}]
		: matches.get(entry.group)!));
	const files = await selectFiles(candidates);
	return {
		files,
		errors,
	};
};
