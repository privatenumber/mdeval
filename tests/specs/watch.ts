import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test } from 'manten';
import { createFixture } from 'fs-fixture';
import { mdeval, spawnMdeval } from '../utils/binaries.ts';

const startWatcher = (
	fixturePath: string,
	patterns: string[],
	extraArguments: string[] = [],
): ChildProcess => spawnMdeval(
	[
		'--watch',
		...extraArguments,
		...patterns,
	],
	{
		cwd: fixturePath,
		stdio: ['ignore', 'pipe', 'pipe'],
	},
);

const scheduleHardKill = (child: ChildProcess, timeoutMs: number) => {
	const abortController = new AbortController();
	const timeout = delay(timeoutMs, undefined, {
		ref: false,
		signal: abortController.signal,
	}).then(
		() => {
			child.kill('SIGKILL');
		},
		(error: unknown) => {
			if (!(error instanceof Error && error.name === 'AbortError')) {
				throw error;
			}
		},
	);

	return async () => {
		abortController.abort();
		await timeout;
	};
};

const stopWatcher = async (child: ChildProcess) => {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}

	const cancelHardKill = scheduleHardKill(child, 2000);

	try {
		const exited = once(child, 'exit');
		child.kill('SIGINT');
		await exited;
	} finally {
		await cancelHardKill();
	}
};

const waitForFileContent = async (
	filePath: string,
	predicate: (content: string) => boolean,
	{ timeoutMs = 15_000, pollMs = 50 } = {},
): Promise<string> => {
	const deadline = Date.now() + timeoutMs;
	let lastContent = '';

	while (Date.now() < deadline) {
		lastContent = await fs.readFile(filePath, 'utf8');
		if (predicate(lastContent)) {
			return lastContent;
		}
		await delay(pollMs);
	}

	throw new Error(`Timeout waiting for ${filePath} to satisfy predicate.\nLast content:\n${lastContent}`);
};

describe('--watch', async () => {
	await test('re-renders on .md change', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nlet v = 1;\nexport { v };\n-->\n\nValue: <!--mdeval v-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = startWatcher(fixture.path, ['data.md']);

		try {
			await waitForFileContent(dataPath, content => /Value: <!--mdeval v-->1<!--\/mdeval-->/.test(content));
			const initialContent = await fs.readFile(dataPath, 'utf8');
			await fs.writeFile(dataPath, initialContent.replace('let v = 1;', 'let v = 42;'), 'utf8');
			await waitForFileContent(dataPath, content => /Value: <!--mdeval v-->42<!--\/mdeval-->/.test(content));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('-w short alias works', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nlet v = 1;\nexport { v };\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = spawnMdeval(
			['-w', 'data.md'],
			{
				cwd: fixture.path,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);

		try {
			await waitForFileContent(dataPath, content => content.includes('-->1<'));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('--watch=true form works', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nlet v = 1;\nexport { v };\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = spawnMdeval(
			['--watch=true', 'data.md'],
			{
				cwd: fixture.path,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);

		try {
			await waitForFileContent(dataPath, content => content.includes('-->1<'));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('re-renders when an imported .ts file changes', async () => {
		await using fixture = await createFixture({
			'helper.ts': 'export const value = 1;\n',
			'data.md': '<!--mdeval\nimport { value } from "./helper.ts";\nexport { value };\n-->\n\nValue: <!--mdeval value-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const helperPath = fixture.getPath('helper.ts');
		const watcher = startWatcher(fixture.path, ['data.md']);

		try {
			await waitForFileContent(dataPath, content => /Value: <!--mdeval value-->1<!--\/mdeval-->/.test(content));
			await fs.writeFile(helperPath, 'export const value = 99;\n', 'utf8');
			await waitForFileContent(dataPath, content => /Value: <!--mdeval value-->99<!--\/mdeval-->/.test(content));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('re-renders when an imported .json file changes', async () => {
		await using fixture = await createFixture({
			'helper.json': '{"value": 1}\n',
			'data.md': [
				'<!--mdeval',
				'import helper from "./helper.json" with { type: "json" };',
				'export const value = helper.value;',
				'-->',
				'',
				'Value: <!--mdeval value-->0<!--/mdeval-->',
				'',
			].join('\n'),
		});
		const dataPath = fixture.getPath('data.md');
		const helperPath = fixture.getPath('helper.json');
		const watcher = startWatcher(fixture.path, ['data.md']);

		try {
			await waitForFileContent(dataPath, content => /Value: <!--mdeval value-->1<!--\/mdeval-->/.test(content));
			await fs.writeFile(helperPath, '{"value": 99}\n', 'utf8');
			await waitForFileContent(dataPath, content => /Value: <!--mdeval value-->99<!--\/mdeval-->/.test(content));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('re-renders any of multiple files', async () => {
		await using fixture = await createFixture({
			'a.md': '<!--mdeval\nexport const a = "alpha";\n-->\n\n<!--mdeval a-->old<!--/mdeval-->\n',
			'b.md': '<!--mdeval\nexport const b = "bravo";\n-->\n\n<!--mdeval b-->old<!--/mdeval-->\n',
		});
		const aPath = fixture.getPath('a.md');
		const bPath = fixture.getPath('b.md');
		const watcher = startWatcher(fixture.path, ['a.md', 'b.md']);

		try {
			await waitForFileContent(aPath, content => content.includes('-->alpha<'));
			await waitForFileContent(bPath, content => content.includes('-->bravo<'));
			const aContent = await fs.readFile(aPath, 'utf8');
			await fs.writeFile(aPath, aContent.replace('"alpha"', '"alphax"'), 'utf8');
			await waitForFileContent(aPath, content => content.includes('-->alphax<'));
			const bContent = await fs.readFile(bPath, 'utf8');
			await fs.writeFile(bPath, bContent.replace('"bravo"', '"bravox"'), 'utf8');
			await waitForFileContent(bPath, content => content.includes('-->bravox<'));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('survives a runtime error in a script block', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nexport const v = thisDoesNotExist();\n-->\n\n<!--mdeval v-->old<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = startWatcher(fixture.path, ['data.md']);

		try {
			await delay(500);
			expect(watcher.exitCode).toBe(null);
			await fs.writeFile(
				dataPath,
				'<!--mdeval\nexport const v = "ok";\n-->\n\n<!--mdeval v-->old<!--/mdeval-->\n',
				'utf8',
			);
			await waitForFileContent(dataPath, content => content.includes('-->ok<'));
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('with zero matches exits 1 before entering watch mode', async () => {
		await using fixture = await createFixture({});
		const child = spawnMdeval(
			['--watch', 'docs/*.md'],
			{
				cwd: fixture.path,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		let stderr = '';
		child.stderr!.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const cancelHardKill = scheduleHardKill(child, 3000);

		const [exitCode] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
		await cancelHardKill();

		expect(exitCode).toBe(1);
		expect(stderr).toContain('No files matched');
	});

	await test('exits cleanly on SIGINT', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nexport const v = 1;\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		const watcher = startWatcher(fixture.path, ['data.md']);

		try {
			await waitForFileContent(fixture.getPath('data.md'), content => content.includes('-->1<'));
			const exitedWith = once(watcher, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
			watcher.kill('SIGINT');
			const [code, signal] = await exitedWith;
			const exitCode = signal === 'SIGINT' ? 130 : code;
			expect([0, 130, null]).toContain(exitCode);
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('--help shows the watch flag', async () => {
		const result = await mdeval(['--help']);
		expect(result.stdout).toMatch(/-w,\s+--watch/);
		expect(result.stdout).toMatch(/Re-render on file changes/);
	});

	await test('without --watch, the CLI does one render and exits', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nexport const v = 1;\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		await mdeval(
			['data.md'],
			{
				cwd: fixture.path,
			},
		);
		const content = await fs.readFile(fixture.getPath('data.md'), 'utf8');
		expect(content).toContain('-->1<');
	});

	await test('output does not contain Node watch lifecycle lines', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nlet v = 1;\nexport { v };\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = startWatcher(fixture.path, ['data.md']);

		let combinedOutput = '';
		watcher.stdout!.on('data', (chunk: Buffer) => {
			combinedOutput += chunk.toString();
		});
		watcher.stderr!.on('data', (chunk: Buffer) => {
			combinedOutput += chunk.toString();
		});

		try {
			await waitForFileContent(dataPath, content => /-->1</.test(content));
			// Trigger a re-render to confirm the lifecycle output is also absent
			// across restarts, not just on initial run.
			const initialContent = await fs.readFile(dataPath, 'utf8');
			const updated = initialContent.replace('let v = 1;', 'let v = 7;');
			await fs.writeFile(dataPath, updated, 'utf8');
			await waitForFileContent(dataPath, content => /-->7</.test(content));
			expect(combinedOutput).not.toContain('Restarting');
			expect(combinedOutput).not.toContain('Completed running');
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('self-writes do not trigger another render', async () => {
		await using fixture = await createFixture({
			'data.md': '<!--mdeval\nlet v = 1;\nexport { v };\n-->\n\n<!--mdeval v-->0<!--/mdeval-->\n',
		});
		const dataPath = fixture.getPath('data.md');
		const watcher = startWatcher(fixture.path, ['data.md']);

		let stdoutChunks = '';
		watcher.stdout!.on('data', (chunk: Buffer) => {
			stdoutChunks += chunk.toString();
		});

		try {
			// Initial render writes once.
			await waitForFileContent(dataPath, content => /-->1</.test(content));
			// One user edit. mdeval rewrites the file, which would historically
			// trigger another render iteration under `node --watch`.
			const initialContent = await fs.readFile(dataPath, 'utf8');
			const updated = initialContent.replace('let v = 1;', 'let v = 99;');
			await fs.writeFile(dataPath, updated, 'utf8');
			await waitForFileContent(dataPath, content => /-->99</.test(content));
			// Hold for a beat so any spurious follow-up render would have time
			// to write — then count the path-printed lines.
			await delay(500);
			const pathLines = stdoutChunks
				.split('\n')
				.filter(line => line.trim() === 'data.md');
			// Expect exactly two path-prints: initial render + one for the user
			// edit. A third would mean we re-rendered on our own write.
			expect(pathLines.length).toBe(2);
		} finally {
			await stopWatcher(watcher);
		}
	});

	await test('picks up a newly-added file matching the glob', async () => {
		await using fixture = await createFixture({
			'a.md': '<!--mdeval\nexport const a = "alpha";\n-->\n\n<!--mdeval a-->old<!--/mdeval-->\n',
		});
		const watcher = startWatcher(fixture.path, ['*.md']);

		try {
			// Initial render is on a.md only — b.md doesn't exist yet.
			await waitForFileContent(fixture.getPath('a.md'), content => content.includes('-->alpha<'));
			// Create b.md mid-session. It matches the glob, so chokidar's `add`
			// event should kick off a render that picks it up.
			await fs.writeFile(
				fixture.getPath('b.md'),
				'<!--mdeval\nexport const b = "bravo";\n-->\n\n<!--mdeval b-->none<!--/mdeval-->\n',
				'utf8',
			);
			await waitForFileContent(fixture.getPath('b.md'), content => content.includes('-->bravo<'));
		} finally {
			await stopWatcher(watcher);
		}
	});
});
