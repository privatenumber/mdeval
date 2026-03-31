export const coerceValue = (value: unknown): string => {
	if (value === null || value === undefined) {
		throw new Error(`Cannot interpolate ${value} — this is likely a bug in your script`);
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'object') {
		return JSON.stringify(value);
	}

	return String(value);
};
