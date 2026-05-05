import { setupLoader } from './setup-loader.ts';

// Public entry for `node --import mdeval/loader`: registers the loader with
// defaults. cli.ts imports `./setup-loader.ts` directly and calls
// `setupLoader({ cacheBust: argv.flags.watch })` so watch mode opts into
// mtime-based cache invalidation declaratively.
setupLoader();
