import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkgJson = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string; dependencies: Record<string, string> }

const sharedOptions = {
    format: ['esm'] as ('esm')[],
    platform: 'node' as const,
    dts: false,
    treeshake: true,
    sourcemap: false,
    minify: false,
    outDir: 'dist',
    target: 'es2022' as const,
    tsconfig: 'tsconfig.build.json',
    define: {
        __MJ_PACKAGE_VERSION__: JSON.stringify(pkgJson.version),
    },
}

export default defineConfig([
    {
        ...sharedOptions,
        entry: {
            index: 'src/index.ts',
            cli: 'src/cli/index.ts',
            'cli/index': 'src/cli/index.ts',
            'cli/commands/entry': 'src/cli/commands/entry.ts',
            'vendor/commit/commit': 'src/vendor/commit/commit.ts',
        },
        clean: false,
        splitting: true,
        external: Object.keys(pkgJson.dependencies),
    },
    {
        ...sharedOptions,
        entry: {
            'worker-script': 'src/codemode/worker-script.ts',
        },
        clean: false,
        splitting: false,
        external: [],
    },
])
