import { pathToFileURL } from 'node:url';
import './loader.ts';
import {
	parseMarkdown, MarkdownParseError, COMMENT_TAG, MARKER_OPEN, MARKER_CLOSE,
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

const contentRange = (marker: Marker) => {
	const openLength = MARKER_OPEN.length + marker.expression.length + COMMENT_CLOSE.length;
	return [marker.start + openLength, marker.end - MARKER_CLOSE.length] as const;
};

// Writes `contents[i]` into marker `i`.
const replaceContents = (source: string, markers: Marker[], contents: string[]) => {
	const parts: string[] = [];
	let cursor = 0;
	for (const [index, marker] of markers.entries()) {
		const [contentStart, contentEnd] = contentRange(marker);
		parts.push(source.slice(cursor, contentStart), contents[index]);
		cursor = contentEnd;
	}
	parts.push(source.slice(cursor));
	return parts.join('');
};

// Whether `output` parses to the same script blocks, and to the same markers
// holding `contents`, so the next run finds what this run wrote.
const roundTrips = (
	output: string,
	{ scriptBlocks, markers }: ParseResult,
	contents: string[],
) => {
	let reparsed: ParseResult;
	try {
		reparsed = parseMarkdown(output);
	} catch (error) {
		if (error instanceof MarkdownParseError) {
			return false;
		}
		throw error;
	}
	return reparsed.scriptBlocks.length === scriptBlocks.length
		&& reparsed.scriptBlocks.every((block, index) => block.content === scriptBlocks[index].content)
		&& reparsed.markers.length === markers.length
		&& reparsed.markers.every((marker, index) => {
			const [contentStart, contentEnd] = contentRange(marker);
			return marker.expression === markers[index].expression
				&& output.slice(contentStart, contentEnd) === contents[index];
		});
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
	const handoff = {
		source,
		parsed,
	};
	parsedHandoffs.set(key, handoff);
	// Await the import directly, not through .finally() or an async helper. Each
	// extra promise reaction lets un-awaited work in script blocks settle before
	// the markers evaluate, which changes their values.
	let rawValues;
	try {
		rawValues = await import(url);
	} finally {
		// An overlapping call for the same file may have replaced the entry.
		if (parsedHandoffs.get(key) === handoff) {
			parsedHandoffs.delete(key);
		}
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

	const values = markers.map(marker => resolvedValues[expressionMap.get(marker.expression)!]);
	const output = replaceContents(source, markers, values);
	if (roundTrips(output, parsed, values)) {
		return output;
	}

	// A value can make GitHub render the rest of the document differently, such
	// as a fence that turns a closing tag into its info string. A value changes
	// only how the text after it parses, so the first value that breaks the
	// round trip on its own is the cause.
	const contents = markers.map(marker => source.slice(...contentRange(marker)));
	for (const [index, marker] of markers.entries()) {
		contents[index] = values[index];
		if (!roundTrips(replaceContents(source, markers, contents), parsed, contents)) {
			const hint = values[index].startsWith(lineEnding)
				? ''
				: ' Wrap block-level Markdown, such as a code block, in block().';
			throw new Error(
				`Expression "${marker.expression}" produced a value that changes which mdeval comments GitHub renders, so the next run would not find the same markers.${hint}`,
			);
		}
	}
	return output;
};
