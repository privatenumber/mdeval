import fs from 'node:fs/promises';
import picomatch from 'picomatch';

export type Argument =
	| {
		type: 'literal';
		value: string;
	}
	| {
		type: 'directory';
		value: string;
	}
	| {
		type: 'exclusion';
		value: string;
	}
	| {
		type: 'glob';
		value: string;
		base: string;
	}
	| {
		type: 'error';
		message: string;
	};

export const classifyArgument = async (argument: string): Promise<Argument> => {
	try {
		const stat = await fs.stat(argument);
		if (stat.isDirectory()) {
			return {
				type: 'directory',
				value: argument,
			};
		}
		if (stat.isFile()) {
			return {
				type: 'literal',
				value: argument,
			};
		}
		return {
			type: 'error',
			message: `${argument}: not a file`,
		};
	} catch (error) {
		const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
		const missingPath = code === 'ENOENT' || code === 'ENOTDIR';
		if (!missingPath) {
			const message = error instanceof Error
				? (typeof code === 'string' ? code : error.message)
				: error;
			return {
				type: 'error',
				message: `${argument}: ${message}`,
			};
		}
	}
	const scan = picomatch.scan(argument);
	if (scan.negated) {
		return {
			type: 'exclusion',
			value: argument,
		};
	}
	if (scan.isGlob) {
		return {
			type: 'glob',
			value: argument,
			base: scan.base || '.',
		};
	}
	return {
		type: 'error',
		message: `${argument}: file does not exist`,
	};
};
