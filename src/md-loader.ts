import type { LoadHook } from 'node:module';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
	parseMarkdown, EXPORT_PREFIX, MARKER_OPEN, type ScriptBlock, type Marker,
} from './parse-markdown.ts';
import { createSourceBuilder } from './source-builder.ts';

const generateModule = (
	source: string,
	filePath: string,
	scriptBlocks: ScriptBlock[],
	markers: Marker[],
): string => {
	const out = createSourceBuilder(filePath, source);

	for (const block of scriptBlocks) {
		out.appendSource(block.content, block.contentStart);
		if (!block.content.endsWith('\n')) {
			out.appendSynthetic('\n');
		}
	}

	// Single pass: assign each unique expression an index and remember the
	// first marker that produced it, so we can map the export back to its
	// source position.
	type ExpressionInfo = {
		index: number;
		marker: Marker;
	};
	const expressionToInfo = new Map<string, ExpressionInfo>();
	for (const marker of markers) {
		if (!expressionToInfo.has(marker.expression)) {
			expressionToInfo.set(marker.expression, {
				index: expressionToInfo.size,
				marker,
			});
		}
	}

	for (const [expression, { index, marker }] of expressionToInfo) {
		const prefix = `export const ${EXPORT_PREFIX}${index} = `;
		out.appendSynthetic(prefix);
		out.appendSource(expression, marker.start + MARKER_OPEN.length);
		out.appendSynthetic(';\n');
	}

	return out.toModuleSource();
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
