import { parseAST, type ComarkNode } from 'md4x';

type Marker = {
	expression: string;
	contentStart: number;
	contentEnd: number;
};

const NAME = 'mdeval';
export const COMMENT_TAG = `<!--${NAME}`;
export const MARKER_OPEN = `${COMMENT_TAG} `;
export const MARKER_CLOSE = `<!--/${NAME}-->`;
export const EXPORT_PREFIX = `__${NAME}_`;
const COMMENT_CLOSE = '-->';
const SCRIPT_PREFIX = `${NAME}\n`;

export const buildExpressionMap = (
	markers: Array<{ expression: string }>,
): Map<string, number> => {
	const map = new Map<string, number>();
	for (const { expression } of markers) {
		if (!map.has(expression)) {
			map.set(expression, map.size);
		}
	}
	return map;
};

const walkAst = (
	ast: { nodes: ComarkNode[] },
	source: string,
): {
	scriptBlocks: string[];
	codeRanges: Array<[number, number]>;
} => {
	const scriptBlocks: string[] = [];
	const codeRanges: Array<[number, number]> = [];
	let cursor = 0;

	const walk = (node: ComarkNode) => {
		if (!Array.isArray(node)) {
			return;
		}

		const [tag, , ...children] = node;

		if (tag === 'code') {
			const text = children[0];
			if (typeof text === 'string' && text.length > 0) {
				const position = source.indexOf(text, cursor);
				if (position !== -1) {
					codeRanges.push([position, position + text.length]);
					cursor = position + text.length;
					return;
				}

				// Indented code blocks: md4x strips leading spaces,
				// so the full content won't match the source verbatim.
				const contentLines = text.split('\n').filter(line => line.length > 0);
				if (contentLines.length > 0) {
					const firstPosition = source.indexOf(contentLines[0], cursor);
					if (firstPosition !== -1) {
						let rangeEnd = firstPosition + contentLines[0].length;
						for (let lineIndex = 1; lineIndex < contentLines.length; lineIndex += 1) {
							const linePosition = source.indexOf(contentLines[lineIndex], rangeEnd);
							if (linePosition !== -1) {
								rangeEnd = linePosition + contentLines[lineIndex].length;
							}
						}
						codeRanges.push([firstPosition, rangeEnd]);
						cursor = rangeEnd;
					}
				}
			}
			return;
		}

		if (tag === null && typeof children[0] === 'string') {
			const content = children[0];
			if (content.startsWith(SCRIPT_PREFIX)) {
				scriptBlocks.push(content.slice(SCRIPT_PREFIX.length));
			}
			const needle = `<!--${content}-->`;
			const position = source.indexOf(needle, cursor);
			if (position !== -1) {
				cursor = position + needle.length;
			}
			return;
		}

		for (const child of children) {
			if (Array.isArray(child)) {
				walk(child);
			}
		}
	};

	for (const node of ast.nodes) {
		walk(node);
	}

	return {
		scriptBlocks,
		codeRanges,
	};
};

const findMarkers = (
	source: string,
	codeRanges: Array<[number, number]>,
): Marker[] => {
	let codeRangeIndex = 0;
	const isInCode = (position: number) => {
		while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex][1] <= position) {
			codeRangeIndex += 1;
		}
		if (codeRangeIndex >= codeRanges.length) {
			return false;
		}
		const [start, end] = codeRanges[codeRangeIndex];
		return position >= start && position < end;
	};

	const markers: Marker[] = [];
	let searchFrom = 0;

	while (searchFrom < source.length) {
		const start = source.indexOf(MARKER_OPEN, searchFrom);
		if (start === -1) {
			break;
		}

		const exprStart = start + MARKER_OPEN.length;
		const exprEnd = source.indexOf(COMMENT_CLOSE, exprStart);
		if (exprEnd === -1) {
			break;
		}

		const contentStart = exprEnd + COMMENT_CLOSE.length;
		const closeStart = source.indexOf(MARKER_CLOSE, contentStart);
		if (closeStart === -1) {
			searchFrom = contentStart;
			continue;
		}

		const markerEnd = closeStart + MARKER_CLOSE.length;

		if (!isInCode(start)) {
			markers.push({
				expression: source.slice(exprStart, exprEnd),
				contentStart,
				contentEnd: closeStart,
			});
		}

		searchFrom = markerEnd;
	}

	return markers;
};

export const parseMarkdown = (source: string): {
	scriptBlocks: string[];
	markers: Marker[];
} => {
	if (!source.includes(COMMENT_TAG)) {
		return {
			scriptBlocks: [],
			markers: [],
		};
	}

	const ast = parseAST(source);
	const { scriptBlocks, codeRanges } = walkAst(ast, source);

	return {
		scriptBlocks,
		markers: findMarkers(source, codeRanges),
	};
};
