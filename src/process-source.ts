import { pathToFileURL } from 'node:url';
import './loader.ts';
import {
	parseMarkdown, COMMENT_TAG, MARKER_OPEN, MARKER_CLOSE,
	COMMENT_CLOSE, EXPORT_PREFIX, buildExpressionMap, type Marker, type ParseResult,
} from './parse-markdown.ts';
import { coerceValue } from './coerce-value.ts';
import { handoffKey, parsedHandoffs } from './parsed-handoff.ts';

const getLineEnding = (source: string, markers: Marker[]): string => {
	const unchangedParts: string[] = [];
	let cursor = 0;
	for (const marker of markers) {
		const openLength = MARKER_OPEN.length + marker.expression.length + COMMENT_CLOSE.length;
		const contentStart = marker.start + openLength;
		unchangedParts.push(source.slice(cursor, contentStart));
		cursor = marker.end - MARKER_CLOSE.length;
	}
	unchangedParts.push(source.slice(cursor));

	const counts = new Map([['\n', 0], ['\r\n', 0], ['\r', 0]]);
	for (const part of unchangedParts) {
		for (const [lineEnding] of part.matchAll(/\r\n|\r|\n/g)) {
			counts.set(lineEnding, counts.get(lineEnding)! + 1);
		}
	}
	let selected = '\n';
	for (const [lineEnding, count] of counts) {
		if (count > counts.get(selected)!) {
			selected = lineEnding;
		}
	}
	return selected;
};

export const processSource = async (
	source: string,
	filePath: string,
	parsed: ParseResult = parseMarkdown(source),
): Promise<string> => {
	const { markers } = parsed;

	if (markers.length === 0) {
		return source;
	}

	const lineEnding = getLineEnding(source, markers);

	const url = pathToFileURL(filePath).href;
	const key = handoffKey(url);
	parsedHandoffs.set(key, {
		source,
		parsed,
	});
	// Await the import directly, not through .finally() or an async helper. Each
	// extra promise reaction lets un-awaited work in script blocks settle before
	// the markers evaluate, which changes their values.
	let rawValues;
	try {
		rawValues = await import(url);
	} finally {
		parsedHandoffs.delete(key);
	}
	const expressionMap = buildExpressionMap(markers);
	const markerValues: unknown[] = await rawValues[`${EXPORT_PREFIX}markers`]();

	const resolvedValues = await Promise.all(
		Array.from(expressionMap).map(async ([expression, index]) => {
			const result = await markerValues[index];
			if (result === null || result === undefined) {
				throw new Error(`Expression "${expression}" evaluated to ${result}`);
			}
			const value = coerceValue(result).replaceAll(/\r\n|\r|\n/g, lineEnding);
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
