import type { LoadHookSync } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateModule } from './generate-module.ts';
import { createSourceBuilder } from './source-builder.ts';

// For module.registerHooks(), which runs hooks synchronously in-thread
export const load: LoadHookSync = (url, context, nextLoad) => {
	if (!url.endsWith('.md')) {
		return nextLoad(url, context);
	}

	const filePath = fileURLToPath(url);
	const source = fs.readFileSync(filePath, 'utf8');
	const out = createSourceBuilder(filePath, source);
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
