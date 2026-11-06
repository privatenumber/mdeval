import { parseArgs } from 'node:util';
import process from 'node:process';
import spawn from 'nano-spawn';
import { shapes, sizes } from './fixtures.ts';

const { values } = parseArgs({
	options: {
		shape: {
			type: 'string',
			multiple: true,
		},
		size: {
			type: 'string',
			multiple: true,
		},
		step: {
			type: 'string',
			multiple: true,
		},
	},
});
const selectedShapes: string[] = values.shape ?? [...shapes, 'readme'];
const selectedSizes: string[] = values.size ?? ['10k', '100k'];
const steps: string[] = values.step ?? ['parse', 'generate', 'leaks', 'process', 'cli'];
for (const [selected, available] of [[selectedShapes, [...shapes, 'readme']], [selectedSizes, Object.keys(sizes)], [steps, ['parse', 'generate', 'leaks', 'process', 'cli']]]) {
	if (selected.some(value => !available.includes(value))) {
		throw new Error(`Expected one of: ${available.join(', ')}`);
	}
}

console.log('step\tshape\tsize\tbytes\tavg ms\tp75 ms\tpeak RSS MiB');
for (const shape of selectedShapes) {
	for (const size of shape === 'readme' ? ['readme'] : selectedSizes) {
		for (const step of steps) {
			const result = await spawn(process.execPath, ['--expose-gc', 'bench/worker.ts', step, shape, size]);
			console.log(result.stdout);
		}
	}
}
