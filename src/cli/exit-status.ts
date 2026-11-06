export const createExitStatus = () => {
	let failed = false;
	let completed = false;
	process.on('exit', () => {
		if (!completed || failed) {
			process.exitCode = 1;
		}
	});
	return {
		fail: () => {
			failed = true;
			process.exitCode = 1;
		},
		complete: () => {
			completed = true;
		},
	};
};
