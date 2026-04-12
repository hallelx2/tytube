import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: 'es2022',
    platform: 'neutral',
    esbuildOptions(options) {
      options.conditions = ['node', 'import', 'default'];
    },
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    target: 'es2022',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
