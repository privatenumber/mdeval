import path from 'node:path';

export const toPosixPath = (value: string) => value.split(path.sep).join('/');
