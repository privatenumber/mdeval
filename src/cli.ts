import module from 'node:module';

module.enableCompileCache();
await import('./cli/index.ts');
