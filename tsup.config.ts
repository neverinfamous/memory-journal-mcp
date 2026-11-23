import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkgJson = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli/index.ts',
        'cli/index': 'src/cli/index.ts',
        'cli/commands/entry': 'src/cli/commands/entry.ts',
        'vendor/commit/commit': 'src/vendor/commit/commit.ts',
        'worker-script': 'src/codemode/worker-script.ts',
    },
    format: ['esm'],
    platform: 'node',
    dts: false,
    clean: true,
    treeshake: true,
    splitting: true,
    sourcemap: false,
    minify: false,
    outDir: 'dist',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    define: {
        __MJ_PACKAGE_VERSION__: JSON.stringify(pkgJson.version),
    },
    external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers', 'yaml'],
})
