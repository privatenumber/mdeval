import { pathToFileURL } from 'node:url';
import './loader.ts';
import {
	parseMarkdown, COMMENT_TAG, MARKER_OPEN, MARKER_CLOSE,
	COMMENT_CLOSE, EXPORT_PREFIX, buildExpressionMap,
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
	const markerValues: unknown[] = await rawValues[`${EXPORT_PREFIX}markers`]();

	const resolvedValues = await Promise.all(
		Array.from(expressionMap).map(async ([expression, index]) => {
			const result = await markerValues[index];
			if (result === null || result === undefined) {
				throw new Error(`Expression "${expression}" evaluated to ${result}`);
			}
			const value = coerceValue(result);
			if (value.includes(MARKER_OPEN) || value.includes(`${COMMENT_TAG}\n`) || value.includes(`${COMMENT_TAG}\r\n`) || value.includes(MARKER_CLOSE)) {
				throw new Error(
					`Expression "${expression}" produced a value containing mdeval comment syntax, which would corrupt the document on re-parse`,
				);
			}
			return value;
		}),
	);

	const parts: string[] = [];
	let cursor = 0;

	for (const marker of markers) {
		const openLength = MARKER_OPEN.length + marker.expression.length + COMMENT_CLOSE.length;
		const contentStart = marker.start + openLength;
		const contentEnd = marker.end - MARKER_CLOSE.length;
		const exportIndex = expressionMap.get(marker.expression)!;
		parts.push(source.slice(cursor, contentStart), resolvedValues[exportIndex]);
		cursor = contentEnd;
	}

	parts.push(source.slice(cursor));
	return parts.join('');
};
