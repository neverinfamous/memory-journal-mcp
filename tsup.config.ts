import { defineConfig } from 'tsup'

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli/index.ts',
        'cli/index': 'src/cli/index.ts',
        'worker-script': 'src/codemode/worker-script.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    treeshake: true,
    splitting: true,
    sourcemap: false,
    minify: false,
    outDir: 'dist',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
})
