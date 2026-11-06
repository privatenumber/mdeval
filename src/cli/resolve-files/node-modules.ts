import path from 'node:path';

export const includesNodeModules = (base: string) => base.split('/').includes('node_modules');
export const isInNodeModules = (base: string, file: string) => path.relative(base, file).split(path.sep).includes('node_modules');
