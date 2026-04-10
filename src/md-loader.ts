import type { LoadHook } from 'node:module';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
	parseMarkdown, EXPORT_PREFIX, buildExpressionMap, type ScriptBlock, type Marker,
} from './parse-markdown.ts';

const generateModule = (
	scriptBlocks: ScriptBlock[],
	markers: Marker[],
): string => {
	const scriptCode = scriptBlocks.map(block => block.content).join('\n');
	const expressionMap = buildExpressionMap(markers);

	if (expressionMap.size === 0) {
		return scriptCode;
	}

	const exports = [...expressionMap].map(
		([expression, index]) => `export const ${EXPORT_PREFIX}${index} = ${expression};`,
	);

	return `${scriptCode}\n${exports.join('\n')}`;
};

export const load: LoadHook = async (url, context, nextLoad) => {
	if (!url.endsWith('.md')) {
		return nextLoad(url, context);
	}

	const source = await fs.readFile(fileURLToPath(url), 'utf8');
	const { scriptBlocks, markers } = parseMarkdown(source);

	if (scriptBlocks.length === 0 && markers.length === 0) {
		return nextLoad(url, context);
	}

	return {
		format: 'module',
		source: generateModule(scriptBlocks, markers),
		shortCircuit: true,
	};
};
