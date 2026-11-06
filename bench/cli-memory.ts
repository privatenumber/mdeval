import process from 'node:process';

process.on('exit', () => {
	console.error(process.resourceUsage().maxRSS);
});
