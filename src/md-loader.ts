import type { LoadHook } from 'node:module';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
	parseMarkdown, EXPORT_PREFIX, buildExpressionMap, type ScriptBlock, type Marker,
} from './parse-markdown.ts';
import { createMappedSource } from './mapped-source.ts';

// Convert a 0-indexed source offset to a 0-indexed line number.
const lineFromOffset = (source: string, offset: number): number => {
	let line = 0;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
		}
	}
	return line;
};

const generateModule = (
	source: string,
	filePath: string,
	scriptBlocks: ScriptBlock[],
	markers: Marker[],
): string => {
	const out = createMappedSource(filePath, source);

	for (const block of scriptBlocks) {
		// `block.start` points at `<!--mdeval`; content begins on the next line.
		const contentStartLine = lineFromOffset(source, block.start) + 1;
		const blockLines = block.content.split('\n');
		// `content` ends with the newline before `-->`, so split leaves a trailing
		// empty entry. Drop it so we don't emit a phantom blank line.
		if (blockLines.at(-1) === '') {
			blockLines.pop();
		}
		for (let index = 0; index < blockLines.length; index += 1) {
			out.appendLine(blockLines[index], contentStartLine + index);
		}
	}

	const expressionMap = buildExpressionMap(markers);
	const firstMarker = new Map<string, Marker>();
	for (const marker of markers) {
		if (!firstMarker.has(marker.expression)) {
			firstMarker.set(marker.expression, marker);
		}
	}

	for (const [expression, index] of expressionMap) {
		const marker = firstMarker.get(expression)!;
		const markerLine = lineFromOffset(source, marker.start);
		const exprLines = expression.split('\n');
		const prefix = `export const ${EXPORT_PREFIX}${index} = `;
		out.appendLine(
			`${prefix}${exprLines[0]}${exprLines.length === 1 ? ';' : ''}`,
			markerLine,
		);
		for (let lineIndex = 1; lineIndex < exprLines.length; lineIndex += 1) {
			const isLast = lineIndex === exprLines.length - 1;
			out.appendLine(
				`${exprLines[lineIndex]}${isLast ? ';' : ''}`,
				markerLine + lineIndex,
			);
		}
	}

	return out.toString();
};

export const load: LoadHook = async (url, context, nextLoad) => {
	if (!url.endsWith('.md')) {
		return nextLoad(url, context);
	}

	const filePath = fileURLToPath(url);
	const source = await fs.readFile(filePath, 'utf8');
	const { scriptBlocks, markers } = parseMarkdown(source);

	// Stub `.md` files (no mdeval content yet) must stay importable so consumers
	// don't break the load graph while stubs are filled in incrementally.
	if (scriptBlocks.length === 0 && markers.length === 0) {
		return {
			format: 'module',
			source: '',
			shortCircuit: true,
		};
	}

	return {
		format: 'module',
		source: generateModule(source, filePath, scriptBlocks, markers),
		shortCircuit: true,
	};
};
