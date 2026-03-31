import { describe, test, expect } from 'manten';
import { coerceValue } from '../../src/coerce-value.ts';

describe('coerceValue', () => {
	test('coerces string as-is', () => {
		expect(coerceValue('hello')).toBe('hello');
	});

	test('coerces number to string', () => {
		expect(coerceValue(42)).toBe('42');
	});

	test('coerces boolean to string', () => {
		expect(coerceValue(true)).toBe('true');
	});

	test('coerces bigint to string', () => {
		expect(coerceValue(100n)).toBe('100');
	});

	test('coerces object to JSON', () => {
		expect(coerceValue({ a: 1 })).toBe('{"a":1}');
	});

	test('coerces array to JSON', () => {
		expect(coerceValue([1, 2, 3])).toBe('[1,2,3]');
	});

	test('throws on null', () => {
		expect(() => coerceValue(null)).toThrow();
	});

	test('throws on undefined', () => {
		expect(() => coerceValue(undefined)).toThrow();
	});
});
