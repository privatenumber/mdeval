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

	test('seeds globalThis.block on import (side effect)', () => {
		expect((globalThis as Record<string, unknown>).block).toBe(block);
	});

	test('seeds globalThis.$ on import (side effect)', () => {
		expect((globalThis as Record<string, unknown>).$).toBe($);
	});
});
