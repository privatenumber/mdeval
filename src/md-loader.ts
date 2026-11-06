import type { LoadHookSync } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generateModule } from './generate-module.ts';
import { createSourceBuilder } from './source-builder.ts';
import { InvalidUtf8Error, readUtf8FileSync } from './utils/read-utf8-file.ts';

const nodeModulesPattern = /[\\/]node_modules[\\/]/;

// For module.registerHooks(), which runs hooks synchronously in-thread
export const load: LoadHookSync = (url, context, nextLoad) => {
	const moduleUrl = new URL(url);
	if (moduleUrl.protocol !== 'file:' || !moduleUrl.pathname.endsWith('.md')) {
		return nextLoad(url, context);
	}

	const filePath = fileURLToPath(moduleUrl);
	let source: string;
	try {
		source = readUtf8FileSync(filePath);
	} catch (error) {
		if (error instanceof InvalidUtf8Error) {
			throw new Error(`${filePath}: not valid UTF-8`);
		}
		throw error;
	}
	const out = createSourceBuilder(filePath, source);
	for (const { text, sourceOffset } of generateModule(source)) {
		if (sourceOffset === undefined) {
			out.appendSynthetic(text);
		} else {
			out.appendSource(text, sourceOffset);
		}
	}

	return {
		// Node.js strips TypeScript types in place, so the source map stays valid.
		// It refuses to strip URLs with a node_modules segment, even plain JavaScript.
		// It checks the full URL, including query and fragment, for / or \ on both sides:
		// https://github.com/nodejs/node/blob/v24.14.1/lib/internal/util.js#L562-L565
		format: nodeModulesPattern.test(url) ? 'module' : 'module-typescript',
		source: out.toModuleSource(),
		shortCircuit: true,
	};
};
