import { describe, test, expect } from 'manten';
import { block, $ } from '../../src/runtime.ts';

describe('runtime', () => {
	test('exports block as a function', () => {
		expect(typeof block).toBe('function');
		expect(block('# Title')).toBe('\n# Title\n');
	});

	test('$ runs shell commands and exposes trimmed stdout', async () => {
		const result = await $`echo hello`;
		expect(result.stdout).toBe('hello\n');
		expect(String(result)).toBe('hello');
	});

	test('$ interpolates JS values via tagged template', async () => {
		const message = 'world';
		const result = await $`echo ${message}`;
		expect(String(result)).toBe('world');
	});

	test('$ rejects on non-zero exit code', async () => {
		await expect($`exit 1`).rejects.toMatchObject({ exitCode: 1 });
	});
});
