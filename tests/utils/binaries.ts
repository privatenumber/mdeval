import {
	spawn as spawnChildProcess,
	type ChildProcess,
	type SpawnOptions,
} from 'node:child_process';
import path from 'node:path';
import spawn, { type Options } from 'nano-spawn';

export const projectRoot = path.resolve(import.meta.dirname, '../..');

const nodeBinary = process.execPath;
const mdevalBinary = path.join(projectRoot, 'dist/cli.mjs');

export const node = (
	arguments_: string[],
	options?: Options,
) => spawn(nodeBinary, arguments_, options);

export const mdeval = (
	arguments_: string[],
	options?: Options,
) => node([mdevalBinary, ...arguments_], options);

export const spawnNode = (
	arguments_: string[],
	options: SpawnOptions = {},
): ChildProcess => spawnChildProcess(nodeBinary, arguments_, options);

export const spawnMdeval = (
	arguments_: string[],
	options: SpawnOptions = {},
): ChildProcess => spawnNode([mdevalBinary, ...arguments_], options);
