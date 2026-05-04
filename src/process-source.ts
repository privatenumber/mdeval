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
	cacheBust?: number,
): Promise<string> => {
	const { markers } = parseMarkdown(source);

	if (markers.length === 0) {
		return source;
	}

	// In watch mode the same file gets imported repeatedly. Node's ESM cache
	// keys on URL, so a `?mtime=...` suffix forces a fresh evaluation when the
	// file changes. Outside watch mode no cacheBust value is passed and the
	// import is plain.
	const url = pathToFileURL(filePath).href + (cacheBust === undefined ? '' : `?mtime=${cacheBust}`);
	const rawValues = await import(url);
	const expressionMap = buildExpressionMap(markers);

	const resolvedValues = await Promise.all(
		Array.from(expressionMap).map(async ([expression, index]) => {
			const value = coerceValue(await rawValues[`${EXPORT_PREFIX}${index}`]);
			if (value.includes(MARKER_OPEN) || value.includes(`${COMMENT_TAG}\n`) || value.includes(MARKER_CLOSE)) {
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
