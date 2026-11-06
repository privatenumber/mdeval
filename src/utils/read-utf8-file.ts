import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

export class InvalidUtf8Error extends Error {
	constructor() {
		super('not valid UTF-8');
	}
}

const decode = (bytes: Uint8Array) => {
	try {
		return new TextDecoder('utf-8', {
			fatal: true,
			ignoreBOM: true,
		}).decode(bytes);
	} catch {
		throw new InvalidUtf8Error();
	}
};

export const readUtf8File = async (file: string) => decode(await fsPromises.readFile(file));
export const readUtf8FileSync = (file: string) => decode(fs.readFileSync(file));
