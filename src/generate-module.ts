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

	const expressions = new Set<string>();
	for (const marker of markers) {
		if (expressions.has(marker.expression)) {
			continue;
		}
		chunks.push(
			{ text: `export const ${EXPORT_PREFIX}${expressions.size} = ` },
			{
				text: marker.expression,
				sourceOffset: marker.start + MARKER_OPEN.length,
			},
			{ text: ';\n' },
		);
		expressions.add(marker.expression);
	}
	return chunks;
};
