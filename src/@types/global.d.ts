import type { $ } from 'zx';

declare global {
	// eslint-disable-next-line vars-on-top
	var block: (value: unknown) => string;
	// eslint-disable-next-line vars-on-top
	var $: $;
}
