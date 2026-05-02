import { pathToFileURL } from 'node:url';
import {
	GenMapping, addSegment, setSourceContent, toEncodedMap,
} from '@jridgewell/gen-mapping';

// Builds a synthesized JS string alongside a source map back to an original
// `.md` file, then emits it with an inline `//# sourceMappingURL=` so Node's
// built-in source-map support can remap stack traces to the `.md`.
export const createMappedSource = (
	filePath: string,
	source: string,
) => {
	const sourceURL = pathToFileURL(filePath).href;
	const map = new GenMapping({ file: filePath });
	setSourceContent(map, sourceURL, source);
	const lines: string[] = [];

	return {
		appendLine(text: string, sourceLine: number) {
			addSegment(map, lines.length, 0, sourceURL, sourceLine, 0);
			lines.push(text);
		},
		toString() {
			const body = `${lines.join('\n')}\n`;
			const encoded = toEncodedMap(map);
			const inlineMap = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(encoded)).toString('base64')}`;
			return `${body}${inlineMap}\n`;
		},
	};
};
