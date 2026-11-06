import fs from 'node:fs/promises';

export const shapes = ['prose', 'markers', 'scripts', 'gfm'];
export const sizes: Record<string, number> = {
	'10k': 10_000,
	'100k': 100_000,
	'1m': 1_000_000,
	'10m': 10_000_000,
};

export const fixture = async (shape: string, size: string): Promise<string> => {
	if (shape === 'readme') {
		return fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
	}
	const chunks: Record<string, string> = {
		prose: 'A paragraph of ordinary prose with words and punctuation.\n\n',
		markers: `Value: <!--mdeval 1-->0<!--/mdeval-->\n\n${'Ordinary prose. '.repeat(60)}\n\n`,
		scripts: `<!--mdeval\nvoid 0;\n-->\n\n${'Ordinary prose. '.repeat(60)}\n\n`,
		gfm: `| Name | Value |\n| --- | --- |\n| [link][ref] | \`code\` |\n\n\`\`\`js\nconst n = 1;\n\`\`\`\n\n<div>HTML</div>\n\n[ref]: https://example.com\n\n${'Ordinary prose. '.repeat(60)}\n\n`,
	};
	const chunk = chunks[shape];
	if (!chunk || !sizes[size]) {
		throw new Error(`Unknown fixture: ${shape}/${size}`);
	}
	const prefix = shape === 'scripts' || shape === 'gfm' ? '<!--mdeval 1-->0<!--/mdeval-->\n\n' : '';
	return prefix + chunk.repeat(Math.ceil((sizes[size] - prefix.length) / chunk.length));
};
