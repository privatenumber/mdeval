import path from 'node:path';
import picomatch from 'picomatch';
import { toPosixPath } from '../../utils/to-posix-path.ts';

export const createExclusionMatcher = (exclusions: string[]) => {
	const patterns = exclusions.map(pattern => pattern.slice(1));
	const relative = patterns.filter(pattern => !path.isAbsolute(pattern));
	const absolute = patterns.filter(pattern => path.isAbsolute(pattern));
	const matchesRelative = relative.length > 0 ? picomatch(relative) : () => false;
	const matchesAbsolute = absolute.length > 0 ? picomatch(absolute) : () => false;
	return (file: string) => {
		const resolved = path.resolve(file);
		return matchesRelative(toPosixPath(path.relative(process.cwd(), resolved)))
			|| matchesAbsolute(toPosixPath(resolved));
	};
};
