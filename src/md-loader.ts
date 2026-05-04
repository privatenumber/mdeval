import type { InitializeHook, LoadHook, ResolveHook } from 'node:module';
import type { MessagePort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
	parseMarkdown, EXPORT_PREFIX, MARKER_OPEN, type ScriptBlock, type Marker,
} from './parse-markdown.ts';
import { createSourceBuilder } from './source-builder.ts';

// Watch mode appends a `?mtime=...` query so Node's URL-keyed ESM cache treats
// the changed file as a new module. The query is stripped before we read the
// file or compare the extension; outside watch mode, URLs come through
// unmodified.
const stripQuery = (url: string) => {
	const index = url.indexOf('?');
	return index === -1 ? url : url.slice(0, index);
};

let port: MessagePort | undefined;
let cacheBustEnabled = false;

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

export const initialize: InitializeHook = (
	data: { port?: MessagePort } | undefined,
) => {
	port = data?.port;
	port?.on('message', (message) => {
		if (message && typeof message === 'object' && 'enableCacheBust' in message) {
			cacheBustEnabled = Boolean(message.enableCacheBust);
		}
	});
};

// Watch mode: every project-owned import gets an mtime suffix so a fresh
// content load happens automatically when the file changes. URLs that already
// carry a query (e.g. the entry `.md` busted by processSource with Date.now())
// pass through unchanged so we don't double-mangle them.
export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
	const result = await nextResolve(specifier, context);
	if (
		!cacheBustEnabled
		|| !result.url.startsWith('file://')
		|| result.url.includes('/node_modules/')
		|| result.url.includes('?')
	) {
		return result;
	}
	try {
		const filePath = fileURLToPath(result.url);
		const stat = await fs.stat(filePath);
		return {
			...result,
			url: `${result.url}?mtime=${stat.mtimeMs}`,
			shortCircuit: true,
		};
	} catch {
		return result;
	}
};

export const load: LoadHook = async (url, context, nextLoad) => {
	const cleanUrl = stripQuery(url);

	// Report project files (skip node: built-ins and anything under
	// node_modules) so cli.ts can wire up file watchers for transitive imports
	// in watch mode. Outside watch mode no port is set and this is a no-op.
	if (
		port
		&& cleanUrl.startsWith('file://')
		&& !cleanUrl.includes('/node_modules/')
	) {
		port.postMessage(fileURLToPath(cleanUrl));
	}

	if (!cleanUrl.endsWith('.md')) {
		return nextLoad(url, context);
	}

	const filePath = fileURLToPath(cleanUrl);
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
