import { describe, test, expect } from 'manten';
import { block, $ } from '../../src/runtime.ts';

describe('runtime', () => {
	test('exports block as a function', () => {
		expect(typeof block).toBe('function');
		expect(block('# Title')).toBe('\n# Title\n');
	});

	test('exports $ as zx tagged template', () => {
		expect(typeof $).toBe('function');
	});
});
