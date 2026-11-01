import type { LoadFnOutput, LoadHook, LoadHookSync } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateModule } from './generate-module.ts';
import { createSourceBuilder } from './source-builder.ts';

const toModule = (url: string, source: string): LoadFnOutput => {
	const out = createSourceBuilder(fileURLToPath(url), source);
	for (const { text, sourceOffset } of generateModule(source)) {
		if (sourceOffset === undefined) {
			out.appendSynthetic(text);
		} else {
			out.appendSource(text, sourceOffset);
		}
	}

	return {
		format: 'module',
		source: out.toModuleSource(),
		shortCircuit: true,
	};
};

// For module.register(), which runs hooks on a separate thread. Async reads let
// that thread overlap I/O across concurrent imports.
export const load: LoadHook = async (url, context, nextLoad) => {
	if (!url.endsWith('.md')) {
		return nextLoad(url, context);
	}
	return toModule(url, await fs.promises.readFile(fileURLToPath(url), 'utf8'));
};

// For module.registerHooks(), which runs hooks synchronously in-thread
export const loadSync: LoadHookSync = (url, context, nextLoad) => {
	if (!url.endsWith('.md')) {
		return nextLoad(url, context);
	}
	return toModule(url, fs.readFileSync(fileURLToPath(url), 'utf8'));
};
