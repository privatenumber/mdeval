import { pathToFileURL } from 'node:url';
import {
	parseMarkdown, COMMENT_TAG, MARKER_OPEN, MARKER_CLOSE, EXPORT_PREFIX, buildExpressionMap,
} from './parse-markdown.ts';
import { coerceValue } from './coerce-value.ts';

export const processSource = async (
	source: string,
	filePath: string,
): Promise<string> => {
	const { markers } = parseMarkdown(source);

	if (markers.length === 0) {
		return source;
	}

	const rawValues = await import(pathToFileURL(filePath).href);
	const expressionMap = buildExpressionMap(markers);

	const valueCache = new Map<number, string>();
	const resolveValue = (exportIndex: number, expression: string): string => {
		const cached = valueCache.get(exportIndex);
		if (cached !== undefined) {
			return cached;
		}
		const value = coerceValue(rawValues[`${EXPORT_PREFIX}${exportIndex}`]);
		if (value.includes(MARKER_OPEN) || value.includes(`${COMMENT_TAG}\n`) || value.includes(MARKER_CLOSE)) {
			throw new Error(
				`Expression "${expression}" produced a value containing mdeval comment syntax, which would corrupt the document on re-parse`,
			);
		}
		valueCache.set(exportIndex, value);
		return value;
	};

	const parts: string[] = [];
	let cursor = 0;

	for (const marker of markers) {
		const exportIndex = expressionMap.get(marker.expression)!;
		const value = resolveValue(exportIndex, marker.expression);
		parts.push(source.slice(cursor, marker.contentStart), value);
		cursor = marker.contentEnd;
	}

	parts.push(source.slice(cursor));
	return parts.join('');
};
