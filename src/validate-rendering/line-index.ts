// Precompute newline positions so offset-to-line-column lookups are O(log n)
// instead of O(offset). For a doc with many leaks this matters: every leak
// triggers one lookup, and walking the whole source per lookup is O(n*leaks).

export type Point = (offset: number) => { line: number;
	column: number; };

export const buildLineIndex = (source: string): number[] => {
	const newlines: number[] = [];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === '\n') {
			newlines.push(index);
		}
	}
	return newlines;
};

export const offsetToLineColumn = (
	newlines: readonly number[],
	offset: number,
) => {
	// Binary search for the largest newline index strictly before `offset`.
	let lo = 0;
	let hi = newlines.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (newlines[mid] < offset) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	const previousNewline = lo === 0 ? -1 : newlines[lo - 1];
	return {
		line: lo + 1,
		column: offset - previousNewline,
	};
};
