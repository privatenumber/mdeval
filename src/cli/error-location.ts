import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const formatErrorLocation = (error: unknown, file: string): string => {
	const stack = error instanceof Error ? error.stack : undefined;
	const frame = typeof stack === 'string'
		? stack.match(/^\s*at (?:.*? \()?((?:file:\/\/|\/|[A-Za-z]:[\\/]).*?\.md):(\d+):(\d+)\)?$/m)
		: undefined;
	if (!frame) {
		return file;
	}
	const framePath = frame[1].startsWith('file:') ? fileURLToPath(frame[1]) : frame[1];
	const displayPath = path.resolve(framePath) === path.resolve(file)
		? file
		: path.relative(process.cwd(), framePath);
	return `${displayPath}:${frame[2]}:${frame[3]}`;
};
