import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mdFrame = /^\s*at (?:.*? \()?((?:file:\/\/|\/|[A-Za-z]:[\\/]).*?\.md):(\d+):(\d+)\)?$/m;

export const formatErrorLocation = (error: unknown, file: string): string => {
	try {
		const stack = String((error as Error).stack);
		// Skip the "Name: message" header, which can be long, so only the frames are scanned
		const header = String(error);
		const frame = (stack.startsWith(header) ? stack.slice(header.length) : stack).match(mdFrame);
		if (!frame) {
			return file;
		}
		const framePath = frame[1].startsWith('file:') ? fileURLToPath(frame[1]) : frame[1];
		const displayPath = path.resolve(framePath) === path.resolve(file)
			? file
			: path.relative(process.cwd(), framePath);
		return `${displayPath}:${frame[2]}:${frame[3]}`;
	} catch {
		// Errors from user code can have any shape. Throwing here would reject the CLI's
		// per-file callback, end the process, and can truncate a file that is being written.
		return file;
	}
};
