import { parseMarkdown, EXPORT_PREFIX, MARKER_OPEN } from './parse-markdown.ts';

type SourceChunk = {
	text: string;
	sourceOffset?: number;
};

// Both execution and type checking use the same evaluate-once module.
export const generateModule = (
	source: string,
): SourceChunk[] => {
	const { scriptBlocks, markers } = parseMarkdown(source);
	const chunks: SourceChunk[] = [];
	for (const block of scriptBlocks) {
		chunks.push({
			text: block.content,
			sourceOffset: block.contentStart,
		});
		if (!block.content.endsWith('\n')) {
			chunks.push({ text: '\n' });
		}
	}

	if (markers.length === 0) {
		return chunks;
	}

	const expressions = new Set<string>();
	// The holder widens primitive marker types for TypeScript's instanceof check.
	chunks.push({ text: `const ${EXPORT_PREFIX}run = async () => {\nconst ${EXPORT_PREFIX}Promise = (async () => {})().constructor;\nconst ${EXPORT_PREFIX}check = [${EXPORT_PREFIX}Promise.prototype];\n` });
	for (const marker of markers) {
		if (expressions.has(marker.expression)) {
			continue;
		}
		const variable = `${EXPORT_PREFIX}${expressions.size}`;
		// The leading operand makes V8 report the expression instead of the synthetic declaration.
		// Attach a rejection handler without assimilating thenables before all markers run.
		chunks.push(
			{ text: `const ${variable} = (void 0,\n` },
			{
				text: marker.expression,
				sourceOffset: marker.start + MARKER_OPEN.length,
			},
			{ text: `\n);\n${EXPORT_PREFIX}check[0] = ${variable};\nif (${EXPORT_PREFIX}check[0] instanceof ${EXPORT_PREFIX}Promise) ${EXPORT_PREFIX}Promise.prototype.then.call(${EXPORT_PREFIX}check[0], undefined, () => {});\n` },
		);
		expressions.add(marker.expression);
	}
	const variables = Array.from(expressions, (_, index) => `${EXPORT_PREFIX}${index}`);
	chunks.push({ text: `return [${variables.join(', ')}];\n};\nlet ${EXPORT_PREFIX}get = ${EXPORT_PREFIX}run;\nexport const ${EXPORT_PREFIX}markers = () => {\nconst ${EXPORT_PREFIX}promise = ${EXPORT_PREFIX}get();\n${EXPORT_PREFIX}get = () => ${EXPORT_PREFIX}promise;\nreturn ${EXPORT_PREFIX}promise;\n};\n` });
	return chunks;
};
