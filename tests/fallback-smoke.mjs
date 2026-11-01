// Smoke test for Node.js versions without `module.registerHooks()` (below 22.15),
// where the loader falls back to `module.register()`. The TypeScript suite
// cannot run there (Node.js 20 cannot strip types and 22.14 cannot parse
// `await using`), so this checks the built artifacts with built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const distDirectory = path.resolve(import.meta.dirname, '../dist');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mdeval-smoke-'));
const markdownPath = path.join(temporaryDirectory, 'data.md');

const run = (args) => {
	const result = spawnSync(process.execPath, args, {
		cwd: temporaryDirectory,
		encoding: 'utf8',
	});
	assert.equal(result.stderr, '');
	assert.equal(result.status, 0);
	return result.stdout;
};

try {
	fs.writeFileSync(markdownPath, '# Data\n\n<!--mdeval\nexport const value = 42;\n-->\n\n<!--mdeval value-->old<!--/mdeval-->\n');

	const imported = run([
		'--import',
		path.join(distDirectory, 'loader.mjs'),
		'--input-type=module',
		'--eval',
		'const { value } = await import("./data.md"); console.log(value);',
	]);
	assert.equal(imported.trim(), '42');

	run([path.join(distDirectory, 'cli.mjs'), markdownPath]);
	assert.match(fs.readFileSync(markdownPath, 'utf8'), /<!--mdeval value-->42<!--\/mdeval-->/);
} finally {
	fs.rmSync(temporaryDirectory, {
		recursive: true,
		force: true,
	});
}
