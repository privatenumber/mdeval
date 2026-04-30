import { $ } from 'zx';

export const block = (value: unknown): string => `\n${String(value)}\n`;
export { $ };

// Side effect: seed `block` and `$` on `globalThis` so they're available to
// `.md` files when this runtime is imported (directly or transitively via the
// CLI / processSource). External Node scripts that load `.md` files should
// `import 'mdeval/runtime'` (this file) before triggering the load.
const globals = globalThis as Record<string, unknown>;
globals.block = block;
globals.$ = $;
