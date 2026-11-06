import type * as runtime from './runtime.ts';

type Block = typeof runtime.block;
type Shell = typeof runtime.$;

/* eslint-disable vars-on-top -- ambient global variables must use var */
declare global {
	var block: Block;
	var $: Shell;
}
/* eslint-enable vars-on-top */
