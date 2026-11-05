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
	chunks.push({ text: `export const ${EXPORT_PREFIX}markers = () => [\n` });
	for (const marker of markers) {
		if (expressions.has(marker.expression)) {
			continue;
		}
		chunks.push(
			{ text: '(async () => (\n' },
			{
				text: marker.expression,
				sourceOffset: marker.start + MARKER_OPEN.length,
			},
			{ text: '\n))(),\n' },
		);
		expressions.add(marker.expression);
	}
	chunks.push({ text: '];\n' });
	return chunks;
};
